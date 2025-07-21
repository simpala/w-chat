package mcpclient

import (
	"context"
	"fmt"
	"log"
	"sync"

	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"
)

type McpClient struct {
	client *client.Client
	conn   *transport.Stdio
	mu     sync.Mutex
}

func NewMcpClient() *McpClient {
	return &McpClient{}
}

func (m *McpClient) Connect(command string, args []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.client != nil {
		return fmt.Errorf("client is already connected")
	}

	stdioTransport := transport.NewStdio(command, nil, args...)
	c := client.NewClient(stdioTransport)

	if err := c.Start(context.Background()); err != nil {
		return fmt.Errorf("failed to start client: %v", err)
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
