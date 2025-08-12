# Local LLM Chat

**Local LLM Chat** is a cross-platform desktop application that provides a user-friendly chat interface for interacting with local large language models (LLMs), specifically designed to work with the `llama.cpp` server. It features agent workflow that allows the LLM to dynamically use external tools to answer questions and complete tasks.

## Features

*   **Chat Interface for Local LLMs:** A simple and intuitive interface for chatting with your local LLMs.
*   **`llama.cpp` Server Support:** Connects directly to a running `llama.cpp` server instance.
*   **Agentic Workflow:** A two-agent system (Router and Tool-Using Agent) intelligently determines when and how to use external tools.
*   **Dynamic Tool Discovery:** The application dynamically discovers and uses tools made available through the Multi-Agent Communication Protocol (MCP).
*   **Cross-Platform:** Built with Wails, it runs on Windows, macOS, and Linux.
*   **Conversation History:** Your conversations are saved locally for future reference.
*   **Save Model Settings:** Per Model argument setting's are saved in the config file and will be there the next time you need to use that model.
*   **AI slop** yes.
*   **bugs** most likely report them better yet fix them!
## Getting Started

### Prerequisites

*   **Go:** The backend is written in Go. You'll need Go installed to build the application.
*   **Node.js:**  
*   **`llama.cpp` the app expects you to have downloaded a llama.cpp release from https://github.com/ggml-org/llama.cpp/releases or built it yourself

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    ```
2.  **Navigate to the `local-llm-chat` directory:**
    ```bash
    cd local-llm-chat
    ```
3.  **Build the application:**

    *   **Windows & macOS:**
        ```bash
        wails build
        ```
    *   **Linux:** 
        ```bash
        wails build -tags webkit2_41
        ```
    This will create a binary in the `build/bin` directory.

## Usage

1.  **Run the application:**
    *   On Windows, run `local-llm-chat.exe`.
    *   On macOS, run `local-llm-chat.app`.
    *   On Linux, run `local-llm-chat`.
2.  **Configure the application:**
    The application uses a `config.json` file to store its settings. The first time you run the application, it will be created with default values.

    ```json
    {
      "llama_cpp_dir": "",
      "models_dir": "",
      "selected_model": "",
      "model_settings": {},
      "theme": "default",
      "mcp_connection_states": null
    }
    ```
    *   `llama_cpp_dir`: The directory where your `llama.cpp` server is located.
    *   `models_dir`: The directory where your LLM gguf models are stored.
    *   `selected_model`: The name of the model you want to use.
    *   `model_settings`: Specific settings for the selected model.
    *   `theme`: The theme of the application (e.g., "default", "dark").

## How MCP Works Within this app

The application uses a two-agent system to handle user queries:

1.  **Router Agent:** This agent first determines if a user's query requires the use of external tools.
2.  **Tool-Using Agent:** If tools are needed, this agent takes over. It discovers available tools, selects the appropriate one, and executes it.

This agent workflow allows the application to be extended with new tools without modifying the core logic. For more details, see the `MCP_README.md` file.

