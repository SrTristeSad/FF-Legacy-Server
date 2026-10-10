package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type matchResultPlayer struct {
	PlayerID string `json:"playerId"`
	Team     int    `json:"team"`
	Kills    int    `json:"kills"`
	Deaths   int    `json:"deaths"`
	Revives  int    `json:"revives"`
	Credits  int    `json:"credits"`
}

type matchResultPayload struct {
	MatchID    string              `json:"matchId"`
	RoomID     string              `json:"roomId"`
	WinnerTeam int                 `json:"winnerTeam"`
	Score      map[int]int         `json:"score"`
	Players    []matchResultPlayer `json:"players"`
	FinishedAt int64               `json:"finishedAt"`
}

var reportedMatches sync.Map

func maybeReportMatchResult(match *matchState) {
	match.mu.Lock()
	if match.Status != "finished" {
		match.mu.Unlock()
		return
	}
	if _, loaded := reportedMatches.LoadOrStore(match.MatchID, true); loaded {
		match.mu.Unlock()
		return
	}

	winnerTeam := 0
	winnerScore := -1
	payload := matchResultPayload{
		MatchID:    match.MatchID,
		RoomID:     match.RoomID,
		Score:      map[int]int{},
		FinishedAt: match.UpdatedAt,
	}
	for team, score := range match.Score {
		payload.Score[team] = score
		if score > winnerScore {
			winnerScore = score
			winnerTeam = team
		}
	}
	payload.WinnerTeam = winnerTeam
	for _, player := range match.Players {
		payload.Players = append(payload.Players, matchResultPlayer{
			PlayerID: player.PlayerID,
			Team:     player.Team,
			Kills:    player.Kills,
			Deaths:   player.Deaths,
			Revives:  player.Revives,
			Credits:  player.Credits,
		})
	}
	match.mu.Unlock()

	body, err := json.Marshal(payload)
	if err != nil {
		reportedMatches.Delete(match.MatchID)
		return
	}

	base := strings.TrimRight(envOr("ROOMS_INTERNAL_URL", "http://rooms:19135"), "/")
	secret := strings.TrimSpace(os.Getenv("MATCH_RESULT_SECRET"))
	if secret == "" {
		secret = envOr("MATCH_HANDOFF_SECRET", "dev-change-me")
	}
	url := base + "/internal/match-result"
	client := &http.Client{Timeout: 3 * time.Second}
	var lastErr error

	for attempt := 0; attempt < 3; attempt++ {
		req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			lastErr = err
			break
		}
		req.Header.Set("content-type", "application/json")
		req.Header.Set("x-match-result-secret", secret)
		resp, err := client.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				log.Printf("[match] result persisted match=%s room=%s winner=%d", payload.MatchID, payload.RoomID, payload.WinnerTeam)
				return
			}
			lastErr = fmt.Errorf("room service returned %s", resp.Status)
		} else {
			lastErr = err
		}
		time.Sleep(time.Duration(attempt+1) * 200 * time.Millisecond)
	}

	reportedMatches.Delete(match.MatchID)
	log.Printf("[match] result report failed match=%s: %v", payload.MatchID, lastErr)
}
