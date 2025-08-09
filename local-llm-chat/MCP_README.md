# MCP Integration in local-llm-chat: Agentic Workflow

This document outlines the current architecture and operational flow of the Multi-Agent Communication Protocol (MCP) integration within the `local-llm-chat` application. Unlike previous versions that used simplistic, hardcoded routing, this system now employs a sophisticated, LLM-driven agentic approach to tool utilization.

## Core Components

The MCP integration is orchestrated by a two-agent system, ensuring that the main conversational LLM remains focused while tool-use is handled intelligently.

1.  **Router Agent (in `router.go`):**
    *   **Purpose:** Acts as a lightweight dispatcher. Its sole responsibility is to quickly determine if a user's query *might* require the use of external tools.
    *   **Operation:** It makes a very specific, low-overhead LLM call (to the same LLM instance) with a focused prompt (e.g., "Does this request need tools? Yes/No?"). This keeps the main conversational flow clean.

2.  **Tool-Using Agent (in `app.go`):**
    *   **Purpose:** When the Router Agent indicates that tools are needed, this agent takes over. It is responsible for dynamically discovering, selecting, and executing the appropriate tools.
    *   **Operation:** It operates in an iterative loop, interacting with the LLM in a specialized "tool-use" mode until a final answer is generated.

3.  **MCP Clients (in `mcpclient/client.go`):**
    *   **Purpose:** These clients manage the actual connection and communication with external MCP servers (e.g., a filesystem server). They expose the available tools and handle their execution.

## Order of Operations: How a Query is Processed

When a user submits a message, the following sequence of events occurs:

1.  **User Input:** The user types a message (e.g., "read mcp.json").
2.  **Initial Message Handling (`app.go` -> `HandleChat`):
    *   The user's message is received and saved to the conversation history.
    *   The `HandleChat` function immediately passes the user's raw query to the Router Agent.
3.  **Router Agent Decision (`router.go` -> `NeedsTools`):
    *   The Router Agent constructs a concise prompt (e.g., "Does 'read mcp.json' require tools?").
    *   It sends this prompt to the LLM (non-streaming, quick response expected).
    *   The LLM responds with either "yes" or "no".
4.  **Conditional Routing (`app.go` -> `HandleChat`):
    *   **If the Router Agent responds "no":** The system proceeds with a standard conversational LLM interaction (`app.go` -> `standardChat`). The LLM receives the conversation history and generates a response without any knowledge of tools.
    *   **If the Router Agent responds "yes":** The system hands control to the Tool-Using Agent (`app.go` -> `toolAgentChat`).
5.  **Tool-Using Agent Execution (`app.go` -> `toolAgentChat` - Agentic Loop):
    *   **Tool Discovery:** The agent first queries all connected MCP clients (`mcpclient/client.go`) to get a dynamic list of all available tools and their descriptions (`router.go` -> `GetToolManifest`).
    *   **LLM Interaction (Tool Mode):** The agent constructs a specialized system prompt for the LLM. This prompt includes the dynamically generated tool manifest, instructing the LLM on how to use tools (e.g., by responding with a `<tool_code>` JSON block). The entire conversation history (including the user's original query) is sent to the LLM.
    *   **Tool Call Parsing:** The LLM, now in "tool mode," analyzes the request and the available tools. If it decides to use a tool, it generates a response containing a `<tool_code>` block with the `tool_name` and `arguments` (e.g., `<tool_code>{"tool_name": "read_file", "arguments": {"path": "mcp.json"}}</tool_code>`).
    *   **Tool Execution:** The Tool-Using Agent parses this `<tool_code>` block and calls the appropriate function (`router.go` -> `ExecuteToolCall`), which then dispatches the request to the relevant MCP client.
    *   **Result/Error Feedback:** The output (or error) from the tool execution is captured.
    *   **Loop Continuation:** The tool's output (or error) is added to the conversation history as a "tool" message. The agent then loops back, sending the updated conversation history (including the tool's result) back to the LLM. This allows the LLM to refine its understanding, make further tool calls, or generate a final answer.
    *   **Final Answer:** The loop continues until the LLM generates a response that *does not* contain a `<tool_code>` block. This is considered the final answer, which is then streamed to the user.

## Example: "read mcp.json"

1.  **User:** "read mcp.json"
2.  **Router Agent:** LLM responds "yes" (needs tools).
3.  **Tool-Using Agent (Loop 1):**
    *   LLM receives tool manifest and "read mcp.json".
    *   LLM responds: `<tool_code>{"tool_name": "read_file", "arguments": {"path": "mcp.json"}}</tool_code>`
    *   Tool `read_file` is executed with `path: "mcp.json"`.
    *   **MCP Server Response (Stderr):** "Error: File path 'mcp.json' is not in the allowed directory. Please provide a full, absolute path." (This is from the MCP server, not the Go app).
    *   This error is added to the conversation history as a "tool" message.
4.  **Tool-Using Agent (Loop 2):**
    *   LLM receives updated history (user query + tool error).
    *   LLM understands the error and responds: "It seems I need the complete path. Could you please provide it?" (This is streamed to the user).
5.  **User:** "/home/simpala/Desktop/test/w-chat/local-llm-chat/mcp.json"
6.  **Tool-Using Agent (Loop 3):**
    *   LLM receives updated history (previous + new user input).
    *   LLM responds: `<tool_code>{"tool_name": "read_file", "arguments": {"path": "/home/simpala/Desktop/test/w-chat/local-llm-chat/mcp.json"}}</tool_code>`
    *   Tool `read_file` is executed with the absolute path.
    *   **MCP Server Response:** (Content of `mcp.json`).
    *   This content is added to the conversation history as a "tool" message.
7.  **Tool-Using Agent (Loop 4):**
    *   LLM receives updated history (previous + tool content).
    *   LLM generates a final, conversational answer based on the file content (no `<tool_code>` block). This is streamed to the user.

## Implemented Changes Summary

*   **`router.go`:**
    *   Removed the old `ShouldUseTools`, `ExecuteTools`, and `AugmentQueryWithToolResults` functions.
    *   Introduced `NeedsTools` (Router Agent logic) for initial tool-use determination.
    *   Added `GetToolManifest` to dynamically retrieve and format tool descriptions from connected MCP clients.
    *   Implemented `ExecuteToolCall` to parse LLM-generated tool calls and execute them via MCP clients.
*   **`app.go`:**
    *   The `HandleChat` function was refactored to orchestrate the two-agent system, first calling `NeedsTools` and then dispatching to either `standardChat` or `toolAgentChat`.
    *   `toolAgentChat` was added to encapsulate the iterative, agentic loop for tool execution.
    *   A new helper function `makeLLMRequest` was introduced to facilitate non-streaming LLM calls required by the agent loops.
    *   Corrected a typo: `wailsruntime.LogWarn` was changed to `wailsruntime.LogWarningf`.

This new architecture provides a more flexible, intelligent, and robust way for the LLM to interact with external tools.
