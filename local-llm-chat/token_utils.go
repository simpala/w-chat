package main

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/pkoukk/tiktoken-go"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// TokenCounter is responsible for counting tokens and calculating tokens per second.
type TokenCounter struct {
	ctx           context.Context
	tkm           *tiktoken.Tiktoken
	totalTokens   int
	startTime     time.Time
	mu            sync.Mutex
	sessionTotals map[int64]int
}

// NewTokenCounter creates a new TokenCounter.
func NewTokenCounter(ctx context.Context) *TokenCounter {
	// The p100k_base encoding is a good default for many models.
	tkm, err := tiktoken.GetEncoding("p100k_base")
	if err != nil {
		log.Fatalf("Failed to get tiktoken encoding: %v", err)
	}
	return &TokenCounter{
		ctx:           ctx,
		tkm:           tkm,
		sessionTotals: make(map[int64]int),
	}
}

// Start starts the token counting for a new response.
func (tc *TokenCounter) Start() {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.totalTokens = 0
	tc.startTime = time.Now()
}

// CountAndMeasure counts the tokens in a chunk of text and updates the metrics.
func (tc *TokenCounter) CountAndMeasure(text string) {
	tc.mu.Lock()
	defer tc.mu.Unlock()

	tokens := tc.tkm.Encode(text, nil, nil)
	tc.totalTokens += len(tokens)

	elapsed := time.Since(tc.startTime).Seconds()
	if elapsed > 0 {
		tps := float64(tc.totalTokens) / elapsed
		wailsruntime.EventsEmit(tc.ctx, "token-stats", map[string]interface{}{
			"tps": tps,
		})
	}
}

// UpdateSessionTotal updates the total token count for a session.
func (tc *TokenCounter) UpdateSessionTotal(sessionID int64) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.sessionTotals[sessionID] += tc.totalTokens
	wailsruntime.EventsEmit(tc.ctx, "session-token-total", map[string]interface{}{
		"sessionID": sessionID,
		"total":     tc.sessionTotals[sessionID],
	})
}

// GetSessionTotal returns the total token count for a session.
func (tc *TokenCounter) GetSessionTotal(sessionID int64) int {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	return tc.sessionTotals[sessionID]
}
