package mcpclient

import (
	"context"
	"fmt"
	"os/exec"
	"sync"

	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"
)

type McpClient struct {
	client       *client.Client
	conn         *transport.Stdio
	mu           sync.Mutex
	Tools        []mcp.Tool
	EnabledTools map[string]bool
}

func NewMcpClient() *McpClient {
	return &McpClient{
		Tools:        make([]mcp.Tool, 0),
		EnabledTools: make(map[string]bool),
	}
}

// commandFunc is a custom command factory that creates a command with a hidden window on Windows.
func commandFunc(ctx context.Context, command string, env []string, args []string) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	setHideWindow(cmd)
	return cmd, nil
}

func (m *McpClient) Connect(command string, args []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.client != nil {
		return fmt.Errorf("client is already connected")
	}

	stdioTransport := transport.NewStdioWithOptions(command, nil, args, transport.WithCommandFunc(commandFunc))
	c := client.NewClient(stdioTransport) //stdio fits most cases in a local setup

	if err := c.Start(context.Background()); err != nil {
		return fmt.Errorf("failed to start client: %v", err)
	}

	// Initialize the client with the server
	initializeRequest := mcp.InitializeRequest{
		Request: mcp.Request{
			Method: "initialize",
		},
		Params: struct {
			ProtocolVersion string             `json:"protocolVersion"`
			Capabilities    mcp.ClientCapabilities `json:"capabilities"`
			ClientInfo      mcp.Implementation     `json:"clientInfo"`
		}{
			ProtocolVersion: mcp.LATEST_PROTOCOL_VERSION,
			Capabilities: mcp.ClientCapabilities{
				Experimental: map[string]interface{}{},
			},
			ClientInfo: mcp.Implementation{
				Name:    "local-llm-chat",
				Version: "1.0.0",
			},
		},
	}

	_, err := c.Initialize(context.Background(), initializeRequest)
	if err != nil {
		c.Close()
		return fmt.Errorf("failed to initialize client: %v", err)
	}

	m.client = c
	m.conn = stdioTransport

	return nil
}

func (m *McpClient) Disconnect() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.client != nil {
		m.client.Close()
		m.client = nil
		m.conn = nil
	}
}

// PopulateTools fetches the tools from the server and populates the client's tool list.
// This should be called once after a successful connection.
func (m *McpClient) PopulateTools(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.client == nil {
		return fmt.Errorf("client is not connected")
	}

	request := mcp.ListToolsRequest{}
	result, err := m.client.ListTools(ctx, request)
	if err != nil {
		return fmt.Errorf("failed to list tools: %w", err)
	}

	m.Tools = result.Tools
	// By default, all tools are enabled
	for _, tool := range m.Tools {
		m.EnabledTools[tool.Name] = true
	}

	return nil
}

// GetEnabledTools returns a list of tools that are currently enabled.
func (m *McpClient) GetEnabledTools() []mcp.Tool {
	m.mu.Lock()
	defer m.mu.Unlock()

	enabledTools := make([]mcp.Tool, 0)
	for _, tool := range m.Tools {
		if m.EnabledTools[tool.Name] {
			enabledTools = append(enabledTools, tool)
		}
	}
	return enabledTools
}

// SetToolEnabled sets the enabled state for a specific tool.
func (m *McpClient) SetToolEnabled(toolName string, enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.EnabledTools[toolName] = enabled
}

// CallTool executes a tool with the given name and arguments
func (m *McpClient) CallTool(ctx context.Context, name string, arguments map[string]interface{}) (*mcp.CallToolResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.client == nil {
		return nil, fmt.Errorf("client is not connected")
	}

	request := mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name:      name,
			Arguments: arguments,
		},
	}
	
	result, err := m.client.CallTool(ctx, request)
	if err != nil {
		return nil, fmt.Errorf("failed to call tool %s: %w", name, err)
	}
	
	return result, nil
}
