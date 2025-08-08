package main

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Router handles the decision making for routing queries to tools or directly to LLM
type Router struct {
	app *App
}

// NewRouter creates a new router instance
func NewRouter(app *App) *Router {
	return &Router{
		app: app,
	}
}

// RouteDecision represents the decision made by the router
type RouteDecision struct {
	UseTools     bool
	ToolPatterns []string
	Reason       string
}

// ShouldUseTools determines if the query should be routed to tools
func (r *Router) ShouldUseTools(query string) RouteDecision {
	// If no MCP clients are connected, skip tool routing
	if len(r.app.mcpClients) == 0 {
		return RouteDecision{
			UseTools: false,
			Reason:   "No MCP clients connected",
		}
	}

	// Define regex patterns for tool usage
	toolPatterns := []string{
		`(?i)\b(read|write|list|create|delete|update)\s+(file|document|folder|directory)\b`,
		`(?i)\b(run|execute|command)\b`,
		`(?i)\b(search|find|locate)\b`,
		`(?i)\b(calculate|compute|math|sum|multiply|divide|subtract|add)\b`,
		`(?i)\b(weather|time|date)\b`,
		`(?i)\b(convert|translate)\b`,
	}

	matchedPatterns := []string{}
	for _, pattern := range toolPatterns {
		re := regexp.MustCompile(pattern)
		if re.MatchString(query) {
			matchedPatterns = append(matchedPatterns, pattern)
		}
	}

	// If any patterns matched, route to tools
	if len(matchedPatterns) > 0 {
		return RouteDecision{
			UseTools:     true,
			ToolPatterns: matchedPatterns,
			Reason:       fmt.Sprintf("Matched %d tool patterns", len(matchedPatterns)),
		}
	}

	// Default to direct LLM path
	return RouteDecision{
		UseTools: false,
		Reason:   "No tool patterns matched",
	}
}

// ExecuteTools executes the appropriate tools based on the query
func (r *Router) ExecuteTools(sessionID int64, query string) ([]mcp.CallToolResult, error) {
	// For now, we'll use a simple approach - in the future we might want to
	// use an LLM to determine which tools to call
	
	var allResults []mcp.CallToolResult
	
	// Get all available tools from connected MCP servers
	for serverName, mcpClient := range r.app.mcpClients {
		// Get tools from the connected client
		tools, err := mcpClient.ListTools(context.Background())
		if err != nil {
			wailsruntime.LogErrorf(r.app.ctx, "Failed to list tools for %s: %v", serverName, err)
			continue
		}
		
		// For demonstration, we'll execute the first tool that matches our query
		// In a real implementation, you'd want to use an LLM to determine which tools to call
		for _, tool := range tools {
			// Simple matching - in reality, you'd use more sophisticated logic
			if strings.Contains(strings.ToLower(query), strings.ToLower(tool.Name)) {
				// Execute the tool with a simple argument structure
				arguments := map[string]interface{}{
					"query": query,
				}
				
				// Convert arguments to JSON string as required by the MCP protocol
				argsJSON, err := json.Marshal(arguments)
				if err != nil {
					wailsruntime.LogErrorf(r.app.ctx, "Failed to marshal tool arguments: %v", err)
					continue
				}
				
				result, err := mcpClient.CallTool(context.Background(), tool.Name, string(argsJSON))
				if err != nil {
					wailsruntime.LogErrorf(r.app.ctx, "Failed to call tool %s: %v", tool.Name, err)
					continue
				}
				
				allResults = append(allResults, *result)
				
				// Add tool result as an artifact
				sessionIDStr := fmt.Sprintf("%d", sessionID)
				
				// Extract content from the result
				var contentBuilder strings.Builder
				for _, content := range result.Content {
					// Try to cast to TextContent
					if textContent, ok := content.(mcp.TextContent); ok {
						contentBuilder.WriteString(textContent.Text)
					}
				}
				
				content := fmt.Sprintf("Tool: %s\nResult: %s", tool.Name, contentBuilder.String())
				_, err = r.app.ArtifactService.AddArtifact(sessionIDStr, "TOOL_NOTIFICATION", fmt.Sprintf("Tool: %s", tool.Name), content)
				if err != nil {
					wailsruntime.LogErrorf(r.app.ctx, "Failed to add tool result as artifact: %v", err)
				}
				
				break // For now, just execute the first matching tool
			}
		}
	}
	
	return allResults, nil
}

// AugmentQueryWithToolResults augments the original query with tool results
func (r *Router) AugmentQueryWithToolResults(originalQuery string, toolResults []mcp.CallToolResult) string {
	if len(toolResults) == 0 {
		return originalQuery
	}
	
	// Create a context section with tool results
	var toolContext strings.Builder
	toolContext.WriteString("\n\nTool Results:\n")
	
	for _, result := range toolResults {
		// Extract content from the result
		var contentBuilder strings.Builder
		for _, content := range result.Content {
			if textContent, ok := content.(mcp.TextContent); ok {
				contentBuilder.WriteString(textContent.Text)
			}
		}
		toolContext.WriteString(fmt.Sprintf("- Result: %s\n", contentBuilder.String()))
	}
	
	// Append tool context to the original query
	return originalQuery + toolContext.String()
}