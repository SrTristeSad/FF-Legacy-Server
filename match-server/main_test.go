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
