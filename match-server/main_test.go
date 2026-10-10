package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func makeToken(t *testing.T, secret string, payload handoffPayload) string {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(encoded))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return encoded + "." + signature
}

func TestVerifyHandoffValid(t *testing.T) {
	secret := "test-secret"
	want := handoffPayload{
		MatchID:      "match-1",
		RoomID:       "room-1",
		Players:      []string{"1001", "1002"},
		Teams:        map[string]int{"1001": 1, "1002": 2},
		Mode:         "clash_squad",
		TargetRounds: 4,
		Exp:          time.Now().Add(time.Minute).UnixMilli(),
	}

	token := makeToken(t, secret, want)
	got, err := verifyHandoff(token, secret)
	if err != nil {
		t.Fatalf("verifyHandoff returned error: %v", err)
	}
	if got.MatchID != want.MatchID || got.RoomID != want.RoomID || len(got.Players) != 2 {
		t.Fatalf("unexpected payload: %#v", got)
	}
	if got.Teams["1002"] != 2 || got.TargetRounds != 4 || got.Mode != "clash_squad" {
		t.Fatalf("handoff metadata lost: %#v", got)
	}
}

func TestVerifyHandoffRejectsTamperedSignature(t *testing.T) {
	secret := "test-secret"
	token := makeToken(t, secret, handoffPayload{
		MatchID: "match-1",
		RoomID:  "room-1",
		Players: []string{"1001"},
		Exp:     time.Now().Add(time.Minute).UnixMilli(),
	})

	parts := strings.Split(token, ".")
	parts[1] = base64.RawURLEncoding.EncodeToString([]byte("tampered-signature"))
	if _, err := verifyHandoff(strings.Join(parts, "."), secret); err == nil {
		t.Fatal("expected tampered signature to fail")
	}
}

func testMatch(targetRounds int) *matchState {
	now := time.Now().UnixMilli()
	return &matchState{
		MatchID:      "match-test",
		RoomID:       "room-test",
		Mode:         "clash_squad",
		Status:       "active",
		Round:        1,
		TargetRounds: targetRounds,
		Score:        map[int]int{},
		Players: map[string]*playerState{
			"a": {PlayerID: "a", Team: 1, Position: vec3{}, Health: 200, MaxHealth: 200, Alive: true, Connected: true},
			"b": {PlayerID: "b", Team: 2, Position: vec3{X: 30}, Health: 200, MaxHealth: 200, Alive: true, Connected: true},
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func squadMatch() *matchState {
	now := time.Now().UnixMilli()
	return &matchState{
		MatchID:      "squad-match",
		RoomID:       "squad-room",
		Mode:         "clash_squad",
		Status:       "active",
		Round:        1,
		TargetRounds: 4,
		Score:        map[int]int{},
		Players: map[string]*playerState{
			"a1": {PlayerID: "a1", Team: 1, Position: vec3{X: 0}, Health: 200, MaxHealth: 200, Alive: true, Connected: true},
			"a2": {PlayerID: "a2", Team: 1, Position: vec3{X: 2}, Health: 200, MaxHealth: 200, Alive: true, Connected: true},
			"b1": {PlayerID: "b1", Team: 2, Position: vec3{X: 30}, Health: 200, MaxHealth: 200, Alive: true, Connected: true},
			"b2": {PlayerID: "b2", Team: 2, Position: vec3{X: 32}, Health: 200, MaxHealth: 200, Alive: true, Connected: true},
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func TestMovePlayerRejectsLargeStep(t *testing.T) {
	match := testMatch(4)
	if _, err := movePlayer(match, "a", vec3{X: 500, Y: 0, Z: 0}); err == nil || err.Error() != "movement_too_large" {
		t.Fatalf("expected movement_too_large, got %v", err)
	}
	position, err := movePlayer(match, "a", vec3{X: 10, Y: 0, Z: 3})
	if err != nil {
		t.Fatalf("valid move failed: %v", err)
	}
	if position.X != 10 || position.Z != 3 {
		t.Fatalf("unexpected position: %#v", position)
	}
}

func TestKillEndsRoundAndResetsPlayers(t *testing.T) {
	match := testMatch(4)
	result, err := applyHit(match, "a", "b", 200)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Killed || !result.RoundEnded || result.RoundWinner != 1 || result.MatchEnded {
		t.Fatalf("unexpected hit result: %#v", result)
	}
	if match.Score[1] != 1 || match.Round != 2 {
		t.Fatalf("unexpected round state score=%v round=%d", match.Score, match.Round)
	}
	if !match.Players["b"].Alive || match.Players["b"].Health != 200 || match.Players["b"].Downed {
		t.Fatalf("player was not reset: %#v", match.Players["b"])
	}
	if match.Players["a"].Kills != 1 || match.Players["b"].Deaths != 1 {
		t.Fatalf("kill/death counters wrong: a=%#v b=%#v", match.Players["a"], match.Players["b"])
	}
}

func TestScoreFinishesMatch(t *testing.T) {
	match := testMatch(2)
	for round := 0; round < 2; round++ {
		result, err := applyHit(match, "a", "b", 200)
		if err != nil {
			t.Fatal(err)
		}
		if round == 0 && result.MatchEnded {
			t.Fatal("match ended too early")
		}
		if round == 1 && !result.MatchEnded {
			t.Fatal("match should be finished")
		}
	}
	if match.Status != "finished" || match.Score[1] != 2 {
		t.Fatalf("unexpected match finish state: status=%s score=%v", match.Status, match.Score)
	}
}

func TestFriendlyFireDisabled(t *testing.T) {
	match := testMatch(4)
	match.Players["b"].Team = 1
	if _, err := applyHit(match, "a", "b", 20); err == nil || err.Error() != "friendly_fire_disabled" {
		t.Fatalf("expected friendly_fire_disabled, got %v", err)
	}
}

func TestSquadHitDownsPlayerWhenTeammateStanding(t *testing.T) {
	match := squadMatch()
	result, err := applyHit(match, "b1", "a1", 200)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Downed || result.Killed || result.RoundEnded {
		t.Fatalf("expected downed without elimination: %#v", result)
	}
	target := match.Players["a1"]
	if !target.Alive || !target.Downed || target.Health != 1 || target.Deaths != 0 {
		t.Fatalf("unexpected downed state: %#v", target)
	}
	if match.Players["b1"].Kills != 0 || match.Score[2] != 0 || match.Round != 1 {
		t.Fatalf("down should not score a kill/round: attacker=%#v score=%v round=%d", match.Players["b1"], match.Score, match.Round)
	}
	if _, err := movePlayer(match, "a1", vec3{X: 1}); err == nil || err.Error() != "player_downed" {
		t.Fatalf("expected downed player movement rejection, got %v", err)
	}
}

func TestReviveRestoresDownedTeammate(t *testing.T) {
	match := squadMatch()
	if _, err := applyHit(match, "b1", "a1", 200); err != nil {
		t.Fatal(err)
	}
	result, err := revivePlayer(match, "a2", "a1")
	if err != nil {
		t.Fatal(err)
	}
	if result.Health != 50 || result.ReviverID != "a2" || result.TargetID != "a1" {
		t.Fatalf("unexpected revive result: %#v", result)
	}
	if match.Players["a1"].Downed || match.Players["a1"].Health != 50 || !match.Players["a1"].Alive {
		t.Fatalf("target not revived: %#v", match.Players["a1"])
	}
	if match.Players["a2"].Revives != 1 {
		t.Fatalf("revive counter not incremented: %#v", match.Players["a2"])
	}
}

func TestReviveRejectsEnemyAndDistance(t *testing.T) {
	match := squadMatch()
	if _, err := applyHit(match, "b1", "a1", 200); err != nil {
		t.Fatal(err)
	}
	if _, err := revivePlayer(match, "b2", "a1"); err == nil || err.Error() != "target_not_teammate" {
		t.Fatalf("expected enemy revive rejection, got %v", err)
	}
	match.Players["a2"].Position = vec3{X: 50}
	if _, err := revivePlayer(match, "a2", "a1"); err == nil || err.Error() != "target_too_far" {
		t.Fatalf("expected distance rejection, got %v", err)
	}
}

func TestSecondHitEliminatesDownedPlayer(t *testing.T) {
	match := squadMatch()
	first, err := applyHit(match, "b1", "a1", 200)
	if err != nil || !first.Downed {
		t.Fatalf("first hit should down: result=%#v err=%v", first, err)
	}
	second, err := applyHit(match, "b1", "a1", 1)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Killed || second.Downed {
		t.Fatalf("second hit should eliminate: %#v", second)
	}
	if match.Players["a1"].Alive || match.Players["a1"].Deaths != 1 || match.Players["b1"].Kills != 1 {
		t.Fatalf("elimination counters/state wrong: target=%#v attacker=%#v", match.Players["a1"], match.Players["b1"])
	}
	if second.RoundEnded {
		t.Fatal("round should continue while a2 is standing")
	}
}

func TestBuyWeaponDebitsCreditsAndEquips(t *testing.T) {
	match := testMatch(4)
	player := match.Players["a"]
	player.Credits = 2500
	player.Loadout = starterCombatLoadout()
	result, err := buyCombatItem(match, "a", "weapon.rifle", 1)
	if err != nil {
		t.Fatal(err)
	}
	if result.Credits != 700 || player.Credits != 700 {
		t.Fatalf("unexpected credits after purchase: result=%#v player=%#v", result, player)
	}
	if player.Loadout.Weapon != "weapon.rifle" || player.Loadout.Ammo["rifle"] != 60 {
		t.Fatalf("weapon purchase did not equip/grant ammo: %#v", player.Loadout)
	}
}

func TestBuyRejectsInsufficientCredits(t *testing.T) {
	match := testMatch(4)
	player := match.Players["a"]
	player.Credits = 100
	player.Loadout = starterCombatLoadout()
	if _, err := buyCombatItem(match, "a", "weapon.sniper", 1); err == nil || err.Error() != "insufficient_credits" {
		t.Fatalf("expected insufficient_credits, got %v", err)
	}
}

func TestFireConsumesAmmoAndUsesServerDamage(t *testing.T) {
	match := testMatch(4)
	attacker := match.Players["a"]
	attacker.Credits = 2500
	attacker.Loadout = starterCombatLoadout()
	if _, err := buyCombatItem(match, "a", "weapon.rifle", 1); err != nil {
		t.Fatal(err)
	}
	result, err := fireWeapon(match, "a", "b")
	if err != nil {
		t.Fatal(err)
	}
	if result.Hit.Damage != 40 || match.Players["b"].Health != 160 {
		t.Fatalf("server weapon damage mismatch: %#v target=%#v", result, match.Players["b"])
	}
	if result.AmmoRemaining != 59 || attacker.Loadout.Ammo["rifle"] != 59 {
		t.Fatalf("ammo not consumed correctly: %#v", result)
	}
}

func TestVestMitigatesDamageAndConsumesDurability(t *testing.T) {
	match := testMatch(4)
	target := match.Players["b"]
	target.Credits = 2500
	target.Loadout = starterCombatLoadout()
	if _, err := buyCombatItem(match, "b", "armor.vest1", 1); err != nil {
		t.Fatal(err)
	}
	result, err := applyHit(match, "a", "b", 100)
	if err != nil {
		t.Fatal(err)
	}
	if result.Damage != 80 || target.Health != 120 || target.Loadout.VestDurability != 80 {
		t.Fatalf("vest mitigation mismatch: result=%#v target=%#v", result, target)
	}
}

func TestMedkitPurchaseAndUse(t *testing.T) {
	match := testMatch(4)
	player := match.Players["a"]
	player.Credits = 2500
	player.Loadout = starterCombatLoadout()
	if _, err := buyCombatItem(match, "a", "utility.medkit", 1); err != nil {
		t.Fatal(err)
	}
	player.Health = 100
	result, err := useCombatItem(match, "a", "utility.medkit")
	if err != nil {
		t.Fatal(err)
	}
	if result.Health != 150 || result.Remaining != 0 || player.Health != 150 {
		t.Fatalf("medkit use mismatch: result=%#v player=%#v", result, player)
	}
}

func TestRoundAndKillCreditsAreAwarded(t *testing.T) {
	match := testMatch(4)
	match.Players["a"].Credits = 0
	match.Players["b"].Credits = 0
	result, err := applyHit(match, "a", "b", 200)
	if err != nil || !result.RoundEnded {
		t.Fatalf("round should end: result=%#v err=%v", result, err)
	}
	if match.Players["a"].Credits != 1200 {
		t.Fatalf("winner should receive kill+round credits, got %d", match.Players["a"].Credits)
	}
	if match.Players["b"].Credits != 600 {
		t.Fatalf("loser round credits mismatch, got %d", match.Players["b"].Credits)
	}
}
