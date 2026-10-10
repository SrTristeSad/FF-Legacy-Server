package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"strings"
	"sync"
	"time"
)

type handoffPayload struct {
	MatchID string   `json:"matchId"`
	RoomID  string   `json:"roomId"`
	Players []string `json:"players"`
	Exp     int64    `json:"exp"`
}

type clientSession struct {
	PlayerID string
	MatchID  string
	RoomID   string
	SeenAt   time.Time
}

func main() {
	port := os.Getenv("GAME_SERVER_PORT")
	if port == "" {
		port = "10100"
	}
	secret := os.Getenv("MATCH_HANDOFF_SECRET")
	if secret == "" {
		secret = "dev-change-me"
	}

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
			_, _ = conn.WriteToUDP([]byte("PONG\n"), remote)
			continue
		}

		if strings.HasPrefix(payload, "HELLO ") {
			parts := strings.SplitN(payload, " ", 3)
			if len(parts) != 3 {
				_, _ = conn.WriteToUDP([]byte("ERR malformed_hello\n"), remote)
				continue
			}

			token := parts[1]
			playerID := strings.TrimSpace(parts[2])
			handoff, err := verifyHandoff(token, secret)
			if err != nil {
				_, _ = conn.WriteToUDP([]byte("ERR invalid_handoff\n"), remote)
				continue
			}
			if handoff.Exp < time.Now().UnixMilli() {
				_, _ = conn.WriteToUDP([]byte("ERR handoff_expired\n"), remote)
				continue
			}
			if !contains(handoff.Players, playerID) {
				_, _ = conn.WriteToUDP([]byte("ERR player_not_in_match\n"), remote)
				continue
			}

			sessions.Store(remote.String(), clientSession{
				PlayerID: playerID,
				MatchID:  handoff.MatchID,
				RoomID:   handoff.RoomID,
				SeenAt:   time.Now(),
			})
			_, _ = conn.WriteToUDP([]byte(fmt.Sprintf("WELCOME %s\n", handoff.MatchID)), remote)
			log.Printf("[match] authenticated player=%s match=%s from=%s", playerID, handoff.MatchID, remote.String())
			continue
		}

		if value, ok := sessions.Load(remote.String()); ok {
			session := value.(clientSession)
			session.SeenAt = time.Now()
			sessions.Store(remote.String(), session)
			log.Printf("[match] player=%s match=%s -> %d bytes", session.PlayerID, session.MatchID, n)
			continue
		}

		_, _ = conn.WriteToUDP([]byte("ERR authentication_required\n"), remote)
	}
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

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
