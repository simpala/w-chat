
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Router handles the decision making for routing queries to tools or directly to LLM
type Router struct {
	app              *App
	lastToolCallTime map[string]time.Time
	mu               sync.Mutex
}

// NewRouter creates a new router instance
func NewRouter(app *App) *Router {
	return &Router{
		app:              app,
		lastToolCallTime: make(map[string]time.Time),
	}
}

// NeedsTools is the "Router Agent". It asks the LLM if the user's query
// requires tool usage.
func (r *Router) NeedsTools(userQuery string) (bool, error) {
	wailsruntime.LogInfof(r.app.ctx, "Router Agent: Checking if query needs tools: \"%s\"", userQuery)

	// If no clients are connected, no tools are available.
	if len(r.app.mcpClients) == 0 {
		wailsruntime.LogInfo(r.app.ctx, "Router Agent: No MCP clients connected. Skipping tool check.")
		return false, nil
	}

	// Construct the prompt for the Router Agent
	prompt := fmt.Sprintf("You are a dispatcher. Your only job is to decide if a user's request needs access to external tools to be answered. Respond with only 'yes' or 'no'. User Request: \"%s\"", userQuery)

	// Create a minimal message list for this check
	messages := []ChatMessage{
		{Role: "user", Content: prompt},
	}

	// Make a non-streaming call to the LLM
	responseContent, err := r.app.makeLLMRequest(messages, false)
	if err != nil {
		wailsruntime.LogErrorf(r.app.ctx, "Router Agent: Error making LLM request: %v", err)
		return false, err
	}

	// Check the response
	decision := strings.TrimSpace(strings.ToLower(responseContent))
	wailsruntime.LogInfof(r.app.ctx, "Router Agent: Decision received: \"%s\"", decision)
	return decision == "yes", nil
}

// GetToolManifest retrieves all available tools from connected MCP clients
// and formats them into a string for the system prompt.
func (r *Router) GetToolManifest() (string, error) {
	var manifestBuilder strings.Builder
	manifestBuilder.WriteString("You have access to the following tools. To use a tool, you must respond with a JSON object with 'tool_name' and 'arguments' keys.\n\n")
	manifestBuilder.WriteString("Available Tools:\n")

	for serverName, client := range r.app.mcpClients {
		if client == nil {
			continue
		}
		tools, err := client.ListTools(context.Background())
		if err != nil {
			wailsruntime.LogErrorf(r.app.ctx, "Error listing tools for server '%s': %v", serverName, err)
			continue
		}

		for _, tool := range tools {
			manifestBuilder.WriteString(fmt.Sprintf("- Tool: %s\n", tool.Name))
			manifestBuilder.WriteString(fmt.Sprintf("  Description: %s\n", tool.Description))
			// Attempt to add argument details from the InputSchema
			schemaBytes, err := json.MarshalIndent(tool.InputSchema, "  ", "  ")
			if err == nil {
				// Add the schema to the prompt only if it's not an empty object
				if string(schemaBytes) != "{}" {
					manifestBuilder.WriteString(fmt.Sprintf("  Arguments Schema:\n  %s\n", string(schemaBytes)))
				}
			}
		}
	}

	return manifestBuilder.String(), nil
}

// ToolCall represents the structure of a tool call from the LLM.
type ToolCall struct {
	ToolName  string                 `json:"tool_name"`
	Arguments map[string]interface{} `json:"arguments"`
}

// ExecuteToolCall parses a tool call from the LLM, executes it, and returns the result.
func (r *Router) ExecuteToolCall(toolCallJSON string) (*mcp.CallToolResult, error) {
	var toolCall ToolCall
	err := json.Unmarshal([]byte(toolCallJSON), &toolCall)
	if err != nil {
		return nil, fmt.Errorf("error unmarshalling tool call: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	cooldown := time.Duration(r.app.config.ToolCallCooldown) * time.Second
	if lastCall, found := r.lastToolCallTime[toolCall.ToolName]; found {
		if time.Since(lastCall) < cooldown {
			return nil, fmt.Errorf("tool '%s' is on cooldown. Please wait", toolCall.ToolName)
		}
	}

	wailsruntime.LogInfof(r.app.ctx, "Executing tool call: %s with args: %+v", toolCall.ToolName, toolCall.Arguments)

	// Find the client that has the tool and execute it
	for serverName, mcpClient := range r.app.mcpClients {
		if mcpClient == nil {
			continue
		}

		tools, err := mcpClient.ListTools(context.Background())
		if err != nil {
			wailsruntime.LogErrorf(r.app.ctx, "Failed to list tools for %s: %v", serverName, err)
			continue
		}

		for _, tool := range tools {
			if tool.Name == toolCall.ToolName {
				result, err := mcpClient.CallTool(context.Background(), tool.Name, toolCall.Arguments)
				if err != nil {
					return nil, fmt.Errorf("failed to call tool %s: %w", tool.Name, err)
				}
				r.lastToolCallTime[toolCall.ToolName] = time.Now() // Update last call time
				return result, nil
			}
		}
	}

	return nil, fmt.Errorf("tool '%s' not found on any connected server", toolCall.ToolName)
}
