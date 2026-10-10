package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type handoffPayload struct {
	MatchID      string         `json:"matchId"`
	RoomID       string         `json:"roomId"`
	Players      []string       `json:"players"`
	Teams        map[string]int `json:"teams,omitempty"`
	Mode         string         `json:"mode,omitempty"`
	TargetRounds int            `json:"targetRounds,omitempty"`
	Exp          int64          `json:"exp"`
}

type clientSession struct {
	PlayerID string
	MatchID  string
	RoomID   string
	SeenAt   time.Time
}

type vec3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type playerState struct {
	PlayerID  string `json:"playerId"`
	Team      int    `json:"team"`
	Position  vec3   `json:"position"`
	Health    int    `json:"health"`
	MaxHealth int    `json:"maxHealth"`
	Alive     bool   `json:"alive"`
	Downed    bool   `json:"downed"`
	Kills     int    `json:"kills"`
	Deaths    int    `json:"deaths"`
	Revives   int    `json:"revives"`
	Connected bool   `json:"connected"`
	LastSeen  int64  `json:"lastSeen"`
}

type matchState struct {
	mu           sync.Mutex
	MatchID      string                  `json:"matchId"`
	RoomID       string                  `json:"roomId"`
	Mode         string                  `json:"mode"`
	Status       string                  `json:"status"`
	Round        int                     `json:"round"`
	TargetRounds int                     `json:"targetRounds"`
	Score        map[int]int             `json:"score"`
	Players      map[string]*playerState `json:"players"`
	CreatedAt    int64                   `json:"createdAt"`
	UpdatedAt    int64                   `json:"updatedAt"`
}

type hitResult struct {
	AttackerID  string `json:"attackerId"`
	TargetID    string `json:"targetId"`
	Damage      int    `json:"damage"`
	Health      int    `json:"health"`
	Downed      bool   `json:"downed"`
	Killed      bool   `json:"killed"`
	RoundEnded  bool   `json:"roundEnded"`
	RoundWinner int    `json:"roundWinner,omitempty"`
	MatchEnded  bool   `json:"matchEnded"`
}

type reviveResult struct {
	ReviverID string `json:"reviverId"`
	TargetID  string `json:"targetId"`
	Health    int    `json:"health"`
}

func main() {
	port := envOr("GAME_SERVER_PORT", "10100")
	secret := envOr("MATCH_HANDOFF_SECRET", "dev-change-me")

	addr, err := net.ResolveUDPAddr("udp", ":"+port)
	if err != nil {
		log.Fatal(err)
	}

	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	var sessions sync.Map
	var matches sync.Map
	go cleanupStaleSessions(&sessions, &matches)

	log.Printf("[match] listening on :%s/udp", port)
	buf := make([]byte, 64*1024)

	for {
		n, remote, err := conn.ReadFromUDP(buf)
		if err != nil {
			log.Printf("[match] read error: %v", err)
			continue
		}

		payload := strings.TrimSpace(string(buf[:n]))
		if payload == "PING" {
			writeUDP(conn, remote, "PONG\n")
			continue
		}

		if strings.HasPrefix(payload, "HELLO ") {
			handleHello(conn, remote, payload, secret, &sessions, &matches)
			continue
		}

		value, ok := sessions.Load(remote.String())
		if !ok {
			writeUDP(conn, remote, "ERR authentication_required\n")
			continue
		}

		session := value.(clientSession)
		session.SeenAt = time.Now()
		sessions.Store(remote.String(), session)

		matchValue, ok := matches.Load(session.MatchID)
		if !ok {
			writeUDP(conn, remote, "ERR match_not_found\n")
			continue
		}
		match := matchValue.(*matchState)
		response, event := handleCommand(match, session.PlayerID, payload)
		writeUDP(conn, remote, response+"\n")
		if event != "" {
			broadcastToMatch(conn, &sessions, session.MatchID, remote.String(), event+"\n")
		}
	}
}

func handleHello(conn *net.UDPConn, remote *net.UDPAddr, raw, secret string, sessions, matches *sync.Map) {
	parts := strings.SplitN(raw, " ", 3)
	if len(parts) != 3 {
		writeUDP(conn, remote, "ERR malformed_hello\n")
		return
	}

	token := parts[1]
	playerID := strings.TrimSpace(parts[2])
	handoff, err := verifyHandoff(token, secret)
	if err != nil {
		writeUDP(conn, remote, "ERR invalid_handoff\n")
		return
	}
	if handoff.Exp < time.Now().UnixMilli() {
		writeUDP(conn, remote, "ERR handoff_expired\n")
		return
	}
	if !contains(handoff.Players, playerID) {
		writeUDP(conn, remote, "ERR player_not_in_match\n")
		return
	}

	match := getOrCreateMatch(matches, handoff)
	match.mu.Lock()
	player := match.Players[playerID]
	player.Connected = true
	player.LastSeen = time.Now().UnixMilli()
	match.UpdatedAt = player.LastSeen
	match.mu.Unlock()

	evictPlayerSessions(sessions, handoff.MatchID, playerID, remote.String())
	sessions.Store(remote.String(), clientSession{
		PlayerID: playerID,
		MatchID:  handoff.MatchID,
		RoomID:   handoff.RoomID,
		SeenAt:   time.Now(),
	})
	writeUDP(conn, remote, fmt.Sprintf("WELCOME %s\n", handoff.MatchID))
	broadcastToMatch(conn, sessions, handoff.MatchID, remote.String(), fmt.Sprintf("EVENT JOIN %s\n", playerID))
	log.Printf("[match] authenticated player=%s match=%s from=%s", playerID, handoff.MatchID, remote.String())
}

func getOrCreateMatch(matches *sync.Map, handoff *handoffPayload) *matchState {
	if value, ok := matches.Load(handoff.MatchID); ok {
		return value.(*matchState)
	}

	now := time.Now().UnixMilli()
	targetRounds := handoff.TargetRounds
	if targetRounds <= 0 {
		if strings.Contains(handoff.Mode, "clash_squad") {
			targetRounds = 4
		} else {
			targetRounds = 1
		}
	}

	match := &matchState{
		MatchID:      handoff.MatchID,
		RoomID:       handoff.RoomID,
		Mode:         handoff.Mode,
		Status:       "active",
		Round:        1,
		TargetRounds: targetRounds,
		Score:        map[int]int{},
		Players:      map[string]*playerState{},
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	for index, id := range handoff.Players {
		team := handoff.Teams[id]
		if team <= 0 {
			team = 1
			if len(handoff.Players) > 1 && strings.Contains(handoff.Mode, "clash_squad") {
				team = (index % 2) + 1
			}
		}
		match.Players[id] = &playerState{
			PlayerID:  id,
			Team:      team,
			Position:  spawnForTeam(team, index),
			Health:    200,
			MaxHealth: 200,
			Alive:     true,
			LastSeen:  now,
		}
	}

	actual, loaded := matches.LoadOrStore(handoff.MatchID, match)
	if loaded {
		return actual.(*matchState)
	}
	return match
}

func handleCommand(match *matchState, playerID, raw string) (string, string) {
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return "ERR empty_command", ""
	}

	switch strings.ToUpper(fields[0]) {
	case "PING":
		return "PONG", ""
	case "STATE":
		return stateResponse(match), ""
	case "MOVE":
		if len(fields) != 4 {
			return "ERR malformed_move", ""
		}
		x, errX := strconv.ParseFloat(fields[1], 64)
		y, errY := strconv.ParseFloat(fields[2], 64)
		z, errZ := strconv.ParseFloat(fields[3], 64)
		if errX != nil || errY != nil || errZ != nil || !validCoordinate(x) || !validCoordinate(y) || !validCoordinate(z) {
			return "ERR invalid_position", ""
		}
		position, err := movePlayer(match, playerID, vec3{X: x, Y: y, Z: z})
		if err != nil {
			return "ERR " + err.Error(), ""
		}
		body, _ := json.Marshal(position)
		message := fmt.Sprintf("MOVE %s %s", playerID, string(body))
		return "OK " + message, "EVENT " + message
	case "HIT":
		if len(fields) != 3 {
			return "ERR malformed_hit", ""
		}
		damage, err := strconv.Atoi(fields[2])
		if err != nil || damage <= 0 || damage > 200 {
			return "ERR invalid_damage", ""
		}
		result, err := applyHit(match, playerID, fields[1], damage)
		if err != nil {
			return "ERR " + err.Error(), ""
		}
		body, _ := json.Marshal(result)
		return "OK HIT " + string(body), "EVENT HIT " + string(body)
	case "REVIVE":
		if len(fields) != 2 {
			return "ERR malformed_revive", ""
		}
		result, err := revivePlayer(match, playerID, fields[1])
		if err != nil {
			return "ERR " + err.Error(), ""
		}
		body, _ := json.Marshal(result)
		return "OK REVIVE " + string(body), "EVENT REVIVE " + string(body)
	case "LEAVE":
		match.mu.Lock()
		if player := match.Players[playerID]; player != nil {
			player.Connected = false
			player.LastSeen = time.Now().UnixMilli()
			match.UpdatedAt = player.LastSeen
		}
		match.mu.Unlock()
		return "OK LEAVE", "EVENT LEAVE " + playerID
	default:
		return "ERR unknown_command", ""
	}
}

func movePlayer(match *matchState, playerID string, next vec3) (vec3, error) {
	match.mu.Lock()
	defer match.mu.Unlock()
	if match.Status != "active" {
		return vec3{}, fmt.Errorf("match_not_active")
	}
	player := match.Players[playerID]
	if player == nil {
		return vec3{}, fmt.Errorf("player_not_in_match")
	}
	if !player.Alive {
		return vec3{}, fmt.Errorf("player_dead")
	}
	if player.Downed {
		return vec3{}, fmt.Errorf("player_downed")
	}
	if distance(player.Position, next) > 120 {
		return vec3{}, fmt.Errorf("movement_too_large")
	}
	player.Position = next
	player.LastSeen = time.Now().UnixMilli()
	match.UpdatedAt = player.LastSeen
	return next, nil
}

func applyHit(match *matchState, attackerID, targetID string, damage int) (hitResult, error) {
	match.mu.Lock()
	defer match.mu.Unlock()
	if match.Status != "active" {
		return hitResult{}, fmt.Errorf("match_not_active")
	}
	attacker := match.Players[attackerID]
	target := match.Players[targetID]
	if attacker == nil || target == nil {
		return hitResult{}, fmt.Errorf("player_not_in_match")
	}
	if attackerID == targetID {
		return hitResult{}, fmt.Errorf("self_hit_not_allowed")
	}
	if !attacker.Alive {
		return hitResult{}, fmt.Errorf("attacker_dead")
	}
	if attacker.Downed {
		return hitResult{}, fmt.Errorf("attacker_downed")
	}
	if !target.Alive {
		return hitResult{}, fmt.Errorf("target_dead")
	}
	if attacker.Team > 0 && attacker.Team == target.Team {
		return hitResult{}, fmt.Errorf("friendly_fire_disabled")
	}

	wasDowned := target.Downed
	if damage > target.Health {
		damage = target.Health
	}
	target.Health -= damage
	result := hitResult{AttackerID: attackerID, TargetID: targetID, Damage: damage, Health: target.Health}

	if target.Health <= 0 {
		if !wasDowned && strings.Contains(match.Mode, "clash_squad") && hasStandingTeammateLocked(match, target.Team, targetID) {
			target.Health = 1
			target.Downed = true
			result.Health = 1
			result.Downed = true
		} else {
			target.Health = 0
			target.Downed = false
			target.Alive = false
			target.Deaths++
			attacker.Kills++
			result.Health = 0
			result.Killed = true
		}
	}

	now := time.Now().UnixMilli()
	attacker.LastSeen = now
	target.LastSeen = now
	match.UpdatedAt = now

	if result.Killed || result.Downed {
		ended, winner, finished := evaluateRoundLocked(match)
		result.RoundEnded = ended
		result.RoundWinner = winner
		result.MatchEnded = finished
	}
	return result, nil
}

func revivePlayer(match *matchState, reviverID, targetID string) (reviveResult, error) {
	match.mu.Lock()
	defer match.mu.Unlock()
	if match.Status != "active" {
		return reviveResult{}, fmt.Errorf("match_not_active")
	}
	reviver := match.Players[reviverID]
	target := match.Players[targetID]
	if reviver == nil || target == nil {
		return reviveResult{}, fmt.Errorf("player_not_in_match")
	}
	if reviverID == targetID {
		return reviveResult{}, fmt.Errorf("self_revive_not_allowed")
	}
	if !reviver.Alive || reviver.Downed {
		return reviveResult{}, fmt.Errorf("reviver_not_available")
	}
	if !target.Alive || !target.Downed {
		return reviveResult{}, fmt.Errorf("target_not_downed")
	}
	if reviver.Team != target.Team {
		return reviveResult{}, fmt.Errorf("target_not_teammate")
	}
	if distance(reviver.Position, target.Position) > 6 {
		return reviveResult{}, fmt.Errorf("target_too_far")
	}

	target.Downed = false
	target.Health = 50
	reviver.Revives++
	now := time.Now().UnixMilli()
	reviver.LastSeen = now
	target.LastSeen = now
	match.UpdatedAt = now
	return reviveResult{ReviverID: reviverID, TargetID: targetID, Health: target.Health}, nil
}

func hasStandingTeammateLocked(match *matchState, team int, exceptID string) bool {
	for id, player := range match.Players {
		if id == exceptID || player.Team != team {
			continue
		}
		if player.Alive && !player.Downed {
			return true
		}
	}
	return false
}

func evaluateRoundLocked(match *matchState) (bool, int, bool) {
	allTeams := map[int]bool{}
	standingTeams := map[int]bool{}
	for _, player := range match.Players {
		allTeams[player.Team] = true
		if player.Alive && !player.Downed {
			standingTeams[player.Team] = true
		}
	}
	if len(allTeams) < 2 || len(standingTeams) != 1 {
		return false, 0, false
	}

	winner := 0
	for team := range standingTeams {
		winner = team
	}
	match.Score[winner]++
	if match.Score[winner] >= match.TargetRounds {
		match.Status = "finished"
		match.UpdatedAt = time.Now().UnixMilli()
		return true, winner, true
	}

	match.Round++
	spawnIndex := 0
	for _, player := range match.Players {
		player.Health = player.MaxHealth
		player.Alive = true
		player.Downed = false
		player.Position = spawnForTeam(player.Team, spawnIndex)
		spawnIndex++
	}
	match.UpdatedAt = time.Now().UnixMilli()
	return true, winner, false
}

func stateResponse(match *matchState) string {
	match.mu.Lock()
	defer match.mu.Unlock()
	body, err := json.Marshal(match)
	if err != nil {
		return "ERR state_encode_failed"
	}
	return "STATE " + string(body)
}

func evictPlayerSessions(sessions *sync.Map, matchID, playerID, keepRemote string) {
	sessions.Range(func(key, value any) bool {
		remote := key.(string)
		if remote == keepRemote {
			return true
		}
		session := value.(clientSession)
		if session.MatchID == matchID && session.PlayerID == playerID {
			sessions.Delete(key)
		}
		return true
	})
}

func cleanupStaleSessions(sessions, matches *sync.Map) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for now := range ticker.C {
		sessions.Range(func(key, value any) bool {
			session := value.(clientSession)
			if now.Sub(session.SeenAt) <= 90*time.Second {
				return true
			}
			sessions.Delete(key)
			if matchValue, ok := matches.Load(session.MatchID); ok {
				match := matchValue.(*matchState)
				match.mu.Lock()
				if player := match.Players[session.PlayerID]; player != nil {
					player.Connected = false
					player.LastSeen = now.UnixMilli()
				}
				match.UpdatedAt = now.UnixMilli()
				match.mu.Unlock()
			}
			return true
		})
	}
}

func broadcastToMatch(conn *net.UDPConn, sessions *sync.Map, matchID, exclude, message string) {
	sessions.Range(func(key, value any) bool {
		remoteString := key.(string)
		if remoteString == exclude {
			return true
		}
		session := value.(clientSession)
		if session.MatchID != matchID {
			return true
		}
		remote, err := net.ResolveUDPAddr("udp", remoteString)
		if err == nil {
			writeUDP(conn, remote, message)
		}
		return true
	})
}

func writeUDP(conn *net.UDPConn, remote *net.UDPAddr, message string) {
	_, _ = conn.WriteToUDP([]byte(message), remote)
}

func verifyHandoff(token, secret string) (*handoffPayload, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid token format")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0]))
	expected := mac.Sum(nil)
	provided, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(expected, provided) {
		return nil, fmt.Errorf("invalid signature")
	}

	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}

	var payload handoffPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if payload.MatchID == "" || payload.RoomID == "" || len(payload.Players) == 0 {
		return nil, fmt.Errorf("incomplete payload")
	}
	return &payload, nil
}

func spawnForTeam(team, index int) vec3 {
	baseX := float64((team - 1) * 30)
	return vec3{X: baseX + float64(index%4)*2, Y: 0, Z: float64(index/4) * 2}
}

func validCoordinate(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && math.Abs(value) <= 100000
}

func distance(a, b vec3) float64 {
	dx, dy, dz := a.X-b.X, a.Y-b.Y, a.Z-b.Z
	return math.Sqrt(dx*dx + dy*dy + dz*dz)
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
