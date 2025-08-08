# Model Context Protocol (MCP) Integration

This document explains the Model Context Protocol (MCP) integration in the local-llm-chat application, how it works, and how to use it.

## Overview

The MCP integration allows the local-llm-chat application to connect to external tools and services through the Model Context Protocol. This enables the LLM to access and interact with various tools without needing to have those capabilities built-in.

The implementation includes:
- A router that determines when to use tools vs. direct LLM interaction
- Integration with the MCP Go SDK for communication with MCP servers
- Tool execution and result augmentation
- Artifact display for tool results

## Architecture

The MCP integration follows this flow:

1. **User Query** → Recorded to chat history
2. **Router** → Determines if tools are needed using regex patterns
3. **Tool Path** → If tools are needed and servers are connected:
   - Use MCP to list available tools
   - Execute matching tools
   - Augment query with tool results
   - Send to main LLM
4. **Direct Path** → If no tools are needed or no servers connected:
   - Send directly to main LLM

## Implementation Details

### Backend (Go)

#### Router (`router.go`)
The router is responsible for determining whether a query should be routed to tools or directly to the LLM.

**Key Functions:**
- `ShouldUseTools(query string) RouteDecision` - Uses regex patterns to determine if tools are needed
- `ExecuteTools(sessionID int64, query string) ([]mcp.CallToolResult, error)` - Executes tools from connected MCP servers
- `AugmentQueryWithToolResults(originalQuery string, toolResults []mcp.CallToolResult) string` - Augments the query with tool results

**Regex Patterns:**
The router uses the following patterns to identify tool usage:
- File operations: `(?i)\b(read|write|list|create|delete|update)\s+(file|document|folder|directory)\b`
- System operations: `(?i)\b(run|execute|command)\b`
- Data operations: `(?i)\b(search|find|locate)\b`
- Math operations: `(?i)\b(calculate|compute|math|sum|multiply|divide|subtract|add)\b`
- Other operations: `(?i)\b(weather|time|date)\b`, `(?i)\b(convert|translate)\b`

#### App Integration (`app.go`)
- The router is initialized in the `startup` function
- `HandleChat` method uses the router to determine the flow
- Added helper method `getServerConfig` to retrieve MCP server configurations

#### MCP Client (`mcpclient/client.go`)
Enhanced MCP client with:
- `ListTools(ctx context.Context) ([]mcp.Tool, error)` - Lists available tools
- `CallTool(ctx context.Context, name, arguments string) (*mcp.CallToolResult, error)` - Executes a tool

### Frontend (JavaScript)

#### MCP Manager (`frontend/src/modules/mcp-manager.js`)
- Connection management for MCP servers
- Added `hasConnectedServers()` method to check connection status

## Configuration

### MCP Configuration File (`mcp.json`)
Create an `mcp.json` file in the application directory to define MCP servers:

```json
{
  "mcpServers": {
    "everything-server": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-everything"],
      "description": "MCP Everything Server - provides access to all tools"
    },
    "filesystem-server": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem"],
      "description": "MCP Filesystem Server - file operations"
    }
  }
}
```

## Usage

### Setting up MCP Servers

1. Install Node.js and npm if not already installed
2. Install MCP servers:
   ```bash
   npm install -g @modelcontextprotocol/server-everything
   npm install -g @modelcontextprotocol/server-filesystem
   ```
3. Create an `mcp.json` file in the application directory with your server configurations

### Connecting to MCP Servers

1. Start the local-llm-chat application
2. Navigate to the MCP panel in the UI
3. The configured servers should appear in the connection panel
4. Click "Connect" to establish connections to your MCP servers

### Using Tools

Once connected to MCP servers:
1. Send queries that match the regex patterns (e.g., "read file example.txt", "calculate 2+2")
2. The router will automatically detect tool usage
3. Matching tools from connected servers will be executed
4. Tool results will be displayed in the artifacts panel
5. The LLM will receive the augmented query with tool results for final response

## Example Queries

These queries will trigger tool usage if appropriate tools are available:

- "Read the contents of config.json"
- "List all files in the current directory"
- "Calculate the square root of 144"
- "What is the current time?"
- "Find all files containing 'TODO'"

## Modifying the Implementation

### Adding New Regex Patterns

To add new patterns for tool detection, modify the `toolPatterns` array in `router.go`:

```go
toolPatterns := []string{
    // Existing patterns...
    `(?i)\b(your new pattern)\b`,
}
```

### Customizing Tool Selection

The current implementation executes the first tool that matches the query. For more sophisticated tool selection:
1. Modify the `ExecuteTools` method in `router.go`
2. Consider using an LLM to determine which tools to call based on the query
3. Implement more complex matching logic

### Adding New MCP Server Types

To add support for new types of MCP servers:
1. Add new server configurations to `mcp.json`
2. Ensure the command and arguments are correct for the new server
3. Test the connection through the MCP panel

## Troubleshooting

### Common Issues

1. **MCP servers not appearing in the connection panel**
   - Ensure `mcp.json` is correctly formatted
   - Verify the file is in the application directory
   - Check that server names are unique

2. **Unable to connect to MCP servers**
   - Verify Node.js and npm are installed
   - Ensure MCP server packages are installed globally
   - Check command and arguments in `mcp.json`

3. **Tools not being executed**
   - Verify MCP servers are connected
   - Check that queries match the regex patterns
   - Ensure the connected servers provide the required tools

### Logs

Check the application logs for detailed error messages:
- Connection errors
- Tool execution failures
- Routing decisions

## Future Improvements

1. **Intelligent Tool Selection**: Use an LLM to determine which tools to call rather than simple pattern matching
2. **Tool Chaining**: Support for executing multiple tools in sequence
3. **Error Handling**: Enhanced error handling for tool execution failures
4. **Caching**: Cache tool lists to improve performance
5. **Configuration UI**: UI for managing MCP server configurations
6. **Authentication**: Support for authenticated MCP servers

## Dependencies

- [MCP Go SDK](https://github.com/modelcontextprotocol/go-sdk)
- Node.js and npm for MCP server packages
- Wails framework for the desktop application

## Contributing

To modify or extend the MCP integration:

1. Understand the existing code structure
2. Follow the existing patterns for integration
3. Test changes thoroughly with various MCP servers
4. Update this documentation as needed