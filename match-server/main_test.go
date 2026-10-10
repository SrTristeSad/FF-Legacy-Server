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
		MatchID: "match-1",
		RoomID:  "room-1",
		Players: []string{"1001", "1002"},
		Teams:   map[string]int{"1001": 1, "1002": 2},
		Mode:    "clash_squad",
		TargetRounds: 4,
		Exp:     time.Now().Add(time.Minute).UnixMilli(),
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
		MatchID: "match-test",
		RoomID: "room-test",
		Mode: "clash_squad",
		Status: "active",
		Round: 1,
		TargetRounds: targetRounds,
		Score: map[int]int{},
		Players: map[string]*playerState{
			"a": {PlayerID: "a", Team: 1, Position: vec3{}, Health: 200, MaxHealth: 200, Alive: true, Connected: true},
			"b": {PlayerID: "b", Team: 2, Position: vec3{X: 30}, Health: 200, MaxHealth: 200, Alive: true, Connected: true},
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
	if !match.Players["b"].Alive || match.Players["b"].Health != 200 {
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
