console.log("DEBUG: Main app.js file loaded.");
import {
    initFuzzySearch,
    loadSettings,
    saveSettings,
    handleModelSelection,
    fuse
} from './modules/settings.js';
import {
    launchLLM
} from './modules/llm.js';
import {
    sendMessage
} from './modules/chat.js';
import {
    NewChat,
    LoadChatSessions,
    DeleteChatSession,
    LoadChatHistory,
    StopStream,
    GetPrompts,
    GetPrompt
} from '../wailsjs/go/main/App';
import {
    EventsOn
} from '../wailsjs/runtime';
import * as runtime from '../wailsjs/runtime';

document.addEventListener('DOMContentLoaded', () => {
    console.log("DEBUG: DOMContentLoaded event fired.");
    // This line will send a message to the Go backend, which should appear in your terminal
    runtime.LogInfo("DEBUG: Frontend DOMContentLoaded event fired, attempting to log via Go runtime.");

    // Keep these checks, and add runtime.LogInfo/Error for clearer output
    if (typeof marked !== 'undefined') {
        console.log("DEBUG: 'marked' is defined and loaded.");
        runtime.LogInfo("DEBUG: 'marked' is defined and loaded.");
    } else {
        console.error("ERROR: 'marked' is NOT defined! The script might not be loading correctly.");
        runtime.LogError("ERROR: 'marked' is NOT defined! The script might not be loading correctly.");
    }

    // if (typeof hljs !== 'undefined') {
    //     console.log("DEBUG: 'hljs' is defined and loaded.");
    //     runtime.LogInfo("DEBUG: 'hljs' is defined and loaded.");
    // } else {
    //     console.error("ERROR: 'hljs' is NOT defined! The script might not be loading correctly.");
    //     runtime.LogError("ERROR: 'hljs' is NOT defined! The script might not be loading correctly.");
    // }

    const newChatButton = document.getElementById('newChatButton');
    const chatSessionList = document.getElementById('chatSessionList');
    const sendButton = document.getElementById('sendButton');
    const messageInput = document.getElementById('messageInput');

    // Initial state setup
    messageInput.placeholder = "no model loaded...";
    sendButton.disabled = true;
    const stopButton = document.getElementById('stopButton');
    const chatWindow = document.querySelector('.messages-container');
    const systemPromptSelect = document.getElementById('systemPromptSelect');
    const customSystemPrompt = document.getElementById('customSystemPrompt');

    let currentSessionId = localStorage.getItem('currentSessionId') || null;
    let messages = [];
    let isStreaming = false;
    let selectedSystemPrompt = '';

    function loadPrompts() {
        GetPrompts().then(prompts => {
            systemPromptSelect.innerHTML = '<option value="">Default</option>';
            prompts.forEach(prompt => {
                const option = document.createElement('option');
                option.value = prompt;
                option.textContent = prompt;
                systemPromptSelect.appendChild(option);
            });
        });
    }

    systemPromptSelect.addEventListener('change', () => {
        const selectedPromptName = systemPromptSelect.value;
        if (selectedPromptName) {
            GetPrompt(selectedPromptName).then(promptContent => {
                selectedSystemPrompt = promptContent;
                customSystemPrompt.value = promptContent;
                // visually distinguish the active prompt
                systemPromptSelect.querySelectorAll('option').forEach(option => {
                    if (option.value === selectedPromptName) {
                        option.classList.add('active');
                    } else {
                        option.classList.remove('active');
                    }
                });
            });
        } else {
            selectedSystemPrompt = '';
            customSystemPrompt.value = '';
            systemPromptSelect.querySelectorAll('option').forEach(option => {
                option.classList.remove('active');
            });
        }
    });

    const parseStreamedContent = (rawContent) => {
        const parts = [];
        let remainingContent = rawContent;
        const thinkRegex = /<think>(.*?)<\/think>/gs;
        let match;
        let lastIndex = 0;

        while ((match = thinkRegex.exec(remainingContent)) !== null) {
            if (match.index > lastIndex) {
                parts.push({
                    type: 'text',
                    content: remainingContent.substring(lastIndex, match.index)
                });
            }
            parts.push({
                type: 'thought',
                content: match[1].trim()
            });
            lastIndex = thinkRegex.lastIndex;
        }

        if (lastIndex < remainingContent.length) {
            parts.push({
                type: 'text',
                content: remainingContent.substring(lastIndex)
            });
        }

        return parts;
    };

    function renderMessages() {
    chatWindow.innerHTML = '';
    messages.forEach(message => {
        addMessageToChatWindow(message.role, message.content);
    });
    // *** ADD THIS BLOCK HERE ***
    if (typeof hljs !== 'undefined') {
        hljs.highlightAll(); // This tells highlight.js to find and highlight code blocks in all newly rendered messages
    } else {
        // This should appear in your terminal if hljs is still not defined
        runtime.LogError("ERROR: hljs.highlightAll() called in renderMessages but hljs is not defined.");
    }
    // *****************************
}

    function addMessageToChatWindow(sender, messageContent) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender);

        if (sender === 'assistant') {
            const parsedParts = parseStreamedContent(messageContent || '');
            parsedParts.forEach(part => {
                const partContainer = document.createElement('div');

                if (part.type === 'thought') {
                    const detailsElement = document.createElement('details');
                    detailsElement.classList.add('thought-block');

                    const summaryElement = document.createElement('summary');
                    summaryElement.classList.add('thought-summary');
                    summaryElement.innerHTML = '<span class="inline-block mr-2">💡</span>Thinking Process';

                    const contentElement = document.createElement('p');
                    contentElement.classList.add('thought-content');
                    contentElement.textContent = part.content;

                    detailsElement.appendChild(summaryElement);
                    detailsElement.appendChild(contentElement);
                    partContainer.appendChild(detailsElement);
                } else {
                    const markdownDiv = document.createElement('div');
                    markdownDiv.classList.add('markdown-content');
                    markdownDiv.innerHTML = marked.parse(part.content);
                    partContainer.appendChild(markdownDiv);
                }
                messageElement.appendChild(partContainer);
            });
        } else {
            messageElement.textContent = messageContent;
        }

        chatWindow.appendChild(messageElement);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return messageElement;
    }

    function loadSessions() {
        LoadChatSessions().then(sessions => {
            chatSessionList.innerHTML = '';
            if (sessions) {
                sessions.forEach(session => {
                    const sessionButton = document.createElement('button');
                    sessionButton.textContent = session.name;
                    sessionButton.dataset.sessionId = session.id;
                    sessionButton.addEventListener('click', (e) => {
                        e.preventDefault();
                        const sessionId = parseInt(sessionButton.dataset.sessionId);
                        if (e.ctrlKey) {
                            DeleteChatSession(sessionId).then(() => {
                                if (currentSessionId === sessionId) {
                                    currentSessionId = null;
                                    messages = [];
                                    renderMessages();
                                }
                                loadSessions();
                            });
                        } else {
                            switchSession(sessionId);
                        }
                    });
                    chatSessionList.appendChild(sessionButton);
                });
            }
        });
    }

    function switchSession(sessionId) {
        console.log("DEBUG: switchSession function entered. Session ID:", sessionId); // ADD THIS LINE
        if (isStreaming) {
            console.log("Cannot switch session while streaming.");
            return;
        }
        if (currentSessionId === sessionId) {
            console.log("Session already active.");
            return;
        }
        currentSessionId = sessionId;
        localStorage.setItem('currentSessionId', currentSessionId);
        console.log("Switching to session:", currentSessionId);

        console.log("DEBUG: Calling LoadChatHistory for session:", currentSessionId); // ADD THIS LINE
        LoadChatHistory(currentSessionId).then(history => {
            console.log("DEBUG: LoadChatHistory promise resolved. Received history from backend:", history); // MODIFY THIS LINE
            if (history) {
                messages = history.map(m => ({
                    role: m.role,
                    content: m.content
                }));
                console.log("DEBUG: Mapped messages:", messages); // MODIFY THIS LINE
            } else {
                messages = [];
                console.log("DEBUG: History is null or undefined, clearing messages."); // MODIFY THIS LINE
            }
            renderMessages();
        }).catch(error => {
            console.error("DEBUG: Error loading chat history:", error); // MODIFY THIS LINE
            messages = [];
            renderMessages();
        });
        updateActiveSessionButton();
    }

    function updateActiveSessionButton() {
        const sessionButtons = document.querySelectorAll('#chatSessionList button');
        sessionButtons.forEach(button => {
            if (parseInt(button.dataset.sessionId) === currentSessionId) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    function handleSendMessage() {
        if (isStreaming) return;
        let messageContent = messageInput.value.trim();
        if (messageContent === '' || currentSessionId === null) {
            return;
        }

        if (selectedSystemPrompt) {
            messageContent = selectedSystemPrompt + '\n\n' + messageContent;
        }

        const userMessage = {
            role: 'user',
            rawContent: messageContent
        };
        messages.push({ role: 'user', content: messageContent });
        addMessageToChatWindow('user', messageContent);
        messageInput.value = '';

        isStreaming = true;
        sendButton.style.display = 'none';
        stopButton.style.display = 'block';

        let assistantResponse = '';
        messages.push({ role: 'assistant', content: '' });

        sendMessage(currentSessionId, messageContent).catch(error => {
            console.error("Error sending message:", error);
            messages.pop();
            messages.push({
                role: 'error',
                content: 'Failed to send message.'
            });
            renderMessages();
            isStreaming = false;
            sendButton.style.display = 'block';
            stopButton.style.display = 'none';
        });
    }

    sendButton.addEventListener('click', (e) => {
        e.preventDefault();
        handleSendMessage();
    });

    stopButton.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentSessionId) {
            StopStream(currentSessionId);
        }
    });

    newChatButton.addEventListener('click', (e) => {
        e.preventDefault();
        NewChat().then((newId) => {
            switchSession(newId);
            loadSessions();
        }).catch(error => {
            console.error("Error creating new chat:", error);
        });
    });

let debounceTimer;
const DEBOUNCE_DELAY_MS = 30; // Tune this: 50ms-100ms is a good starting point

EventsOn("chat-stream", function(data) {
    if (data === null) {
        // Stream finished, ensure final update and highlight
        clearTimeout(debounceTimer); // Clear any pending updates
        updateAssistantMessageUI(messages[messages.length - 1].content); // Force final render
        isStreaming = false;
        sendButton.style.display = 'block';
        stopButton.style.display = 'none';
        return;
    }

    let lastMessageBubble = document.querySelector('.message.assistant:last-child');
    if (!lastMessageBubble) {
        addMessageToChatWindow('assistant', '');
        lastMessageBubble = document.querySelector('.message.assistant:last-child');
    }

    let assistantResponse = messages[messages.length - 1].content;
    assistantResponse += data;
    messages[messages.length - 1].content = assistantResponse; // Update the stored full message

    // --- DEBOUNCE THE UI UPDATE ---
    clearTimeout(debounceTimer); // Reset the timer every time a new chunk arrives
    debounceTimer = setTimeout(() => {
        // This function will only execute after DEBOUNCE_DELAY_MS has passed
        // since the *last* 'chat-stream' event.
        updateAssistantMessageUI(assistantResponse);
    }, DEBOUNCE_DELAY_MS);
    // --- END DEBOUNCE ---
});
// Helper function for the actual UI update
function updateAssistantMessageUI(currentFullResponse) {
    let lastMessageBubble = document.querySelector('.message.assistant:last-child');
    if (!lastMessageBubble) {
        // Fallback if bubble not found (should be rare if addMessageToChatWindow is called)
        console.error("updateAssistantMessageUI called but no assistant message bubble found.");
        return;
    }

    // Clear and re-render the entire content of the last message bubble
    lastMessageBubble.innerHTML = ''; // Clear existing content
    const parsedParts = parseStreamedContent(currentFullResponse); // Re-parse the full accumulated response

    parsedParts.forEach(part => {
        const partContainer = document.createElement('div');
        // Your existing logic to create thought blocks or markdown divs
        if (part.type === 'thought') {
            const detailsElement = document.createElement('details');
            detailsElement.classList.add('thought-block');
            const summaryElement = document.createElement('summary');
            summaryElement.classList.add('thought-summary');
            summaryElement.innerHTML = '<span class="inline-block mr-2">💡</span>Thinking Process';
            const contentElement = document.createElement('p');
            contentElement.classList.add('thought-content');
            contentElement.textContent = part.content;
            detailsElement.appendChild(summaryElement);
            detailsElement.appendChild(contentElement);
            partContainer.appendChild(detailsElement);
        } else {
            const markdownDiv = document.createElement('div');
            markdownDiv.classList.add('markdown-content');
            markdownDiv.innerHTML = marked.parse(part.content); // Markdown parsing happens here
            partContainer.appendChild(markdownDiv);
        }
        lastMessageBubble.appendChild(partContainer);
    });

    // Highlight code blocks only after all content is appended
    if (typeof hljs !== 'undefined') { // Check if hljs is available
        hljs.highlightAll();
    } else {
        console.warn("highlight.js not available, code blocks will not be highlighted.");
    }

    // Scroll to bottom after the UI has been updated
    scrollToBottom();
}
    // Initial setup
    loadSessions();
    if (currentSessionId) {
        switchSession(parseInt(currentSessionId));
    }
    loadPrompts();
    const settingsToggleButton = document.getElementById('settingsToggleButton');
    const rightSidebar = document.querySelector('.sidebar-container.right');
    const artifactsPanel = document.getElementById('artifactsPanel');
    const toggleArtifactsPanelButton = document.getElementById('toggleArtifactsPanel');

    if (settingsToggleButton && rightSidebar) {
        settingsToggleButton.addEventListener('click', () => {
            rightSidebar.classList.toggle('sidebar-hidden');
        });
    }

    if (toggleArtifactsPanelButton && artifactsPanel) {
        toggleArtifactsPanelButton.addEventListener('click', () => {
            artifactsPanel.classList.toggle('collapsed');
            if (artifactsPanel.classList.contains('collapsed')) {
                toggleArtifactsPanelButton.textContent = '«';
                toggleArtifactsPanelButton.title = 'Show Artifacts';
            } else {
                toggleArtifactsPanelButton.textContent = '»';
                toggleArtifactsPanelButton.title = 'Hide Artifacts';
            }
        });
        if (artifactsPanel.classList.contains('collapsed')) {
            toggleArtifactsPanelButton.textContent = '«';
            toggleArtifactsPanelButton.title = 'Show Artifacts';
        } else {
            toggleArtifactsPanelButton.textContent = '»';
            toggleArtifactsPanelButton.title = 'Hide Artifacts';
        }
    }

    document.getElementById('chatModelSelectInput').addEventListener('input', (e) => {
        const query = e.target.value;
        const chatModelSelectList = document.getElementById('chatModelSelectList');
        if (query && fuse) {
            const results = fuse.search(query);
            const items = results.map(result => result.item);
            chatModelSelectList.innerHTML = '';
            items.forEach(item => {
                const option = document.createElement('div');
                option.textContent = item.name;
                option.setAttribute('data-path', item.path);
                option.addEventListener('click', () => handleModelSelection(item.name, item.path));
                chatModelSelectList.appendChild(option);
            });
            chatModelSelectList.classList.remove('select-hide');
        } else {
            chatModelSelectList.classList.add('select-hide');
        }
    });

    document.addEventListener('click', (e) => {
        const chatModelSelect = document.querySelector('.custom-select');
        if (!chatModelSelect.contains(e.target)) {
            document.getElementById('chatModelSelectList').classList.add('select-hide');
        }
    });

    document.getElementById('chatModelSelectInput').addEventListener('click', () => {
        document.getElementById('chatModelSelectList').classList.remove('select-hide');
    });

    document.getElementById('llamaPathInput').addEventListener('change', saveSettings);
    document.getElementById('modelPathInput').addEventListener('change', saveSettings);
    document.getElementById('chatModelArgs').addEventListener('change', saveSettings);

    document.getElementById('launchLLMButton').addEventListener('click', launchLLM);

    initFuzzySearch([]);
    loadSettings();
});
