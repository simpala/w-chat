// app.js
import mermaid from 'mermaid';

console.log("DEBUG: Main app.js file loaded.");
import {
    initFuzzySearch,
    handleModelSelection,
    fuse,
    saveAllSettings,
    loadSettingsAndApplyTheme,
    applyTheme
} from './modules/settings.js';

import {
    launchLLM
} from './modules/llm.js';
import {
    mcpManager,
    MCP_CONNECTION_STATUS
} from './modules/mcp-manager.js';
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
    GetPrompt,
    SaveSettings as GoSaveSettings, // Alias to avoid conflict with local saveSettings
    LoadSettings as GoLoadSettings, // Alias to avoid conflict with local loadSettings
    UpdateChatSystemPrompt, // Import the new Go function for updating system prompt
    IsLLMLoaded, // <--- NEW: Import IsLLMLoaded
    // --- NEW: Artifacts Imports ---
    AddArtifact,
    ListArtifacts,
    DeleteArtifact
    // --- END NEW Artifacts Imports ---
} from '../wailsjs/go/main/App';
import {
    EventsOn
} from '../wailsjs/runtime';
import * as runtime from '../wailsjs/runtime';
import { getModelName } from './modules/path-utils.js';

let currentSessionId = localStorage.getItem('currentSessionId') ? parseInt(localStorage.getItem('currentSessionId'), 10) : null; // Ensure this is accessible globally and parsed as int


// --- NEW: Artifact Type Constants (Mirroring Go) ---
export const ArtifactType = {
    IMAGE: "IMAGE",
    VIDEO: "VIDEO",
    TOOL_NOTIFICATION: "TOOL_NOTIFICATION",
    MCP_MANAGER: "MCP_MANAGER",
    LOG_VIEW: "LOG_VIEW",
    LLAMA_UPDATER: "LLAMA_UPDATER",
    // Add other types as you define them in Go
};
// --- END NEW: Artifact Type Constants ---

// --- NEW: Artifacts State and UI Management ---
let artifacts = []; // Array to hold artifacts for the current session

function getArtifactsListElement() {
    return document.getElementById('artifactsContent'); // Assumes an element with this ID within artifactsPanel
}

function renderArtifacts() {
    const artifactsListElement = document.getElementById('artifactsContent');
    if (!artifactsListElement) {
        console.error("Artifacts list element not found (id='artifactsContent').");
        return;
    }

    artifactsListElement.innerHTML = ''; // Clear existing
    if (artifacts.length === 0) {
        artifactsListElement.innerHTML = '<p style="text-align: center; color: #888;">No artifacts for this session.</p>';
        return;
    }

    artifacts.forEach(artifact => {
        const artifactItem = document.createElement('div');
        artifactItem.classList.add('artifact-item');
        artifactItem.dataset.id = artifact.id; // Store ID for easy access

        // Delete button
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('delete-artifact-button');
        deleteButton.textContent = '×'; // Unicode 'times' character
        deleteButton.title = 'Delete Artifact';
        deleteButton.addEventListener('click', async (e) => {
            const artifactID = artifact.id; // Get ID directly from closure
            await DeleteArtifact(artifactID); // Call Go backend
        });
        artifactItem.appendChild(deleteButton);


        const nameElement = document.createElement('p');
        nameElement.innerHTML = `<strong>Name:</strong> ${artifact.metadata ? artifact.metadata.file_name || artifact.name : artifact.name}`;
        nameElement.style.fontSize = '0.9em';
        nameElement.style.fontWeight = 'bold';
        artifactItem.appendChild(nameElement);

        if (artifact.url) { // For IMAGE or VIDEO
            if (artifact.type === ArtifactType.IMAGE) {
                const img = document.createElement('img');
                img.src = artifact.url;
                img.alt = artifact.name || 'Generated Image';
                img.classList.add('artifact-thumbnail');
                img.onerror = () => { // Add error handler for image loading
                    console.error(`ERROR: Failed to load image artifact: ${artifact.url}`);
                    img.src = 'https://placehold.co/150x100/FF0000/FFFFFF?text=Error'; // Placeholder on error
                };
                artifactItem.appendChild(img);
            } else if (artifact.type === ArtifactType.VIDEO) {
                const video = document.createElement('video');
                video.src = artifact.url;
                video.controls = true;
                video.classList.add('artifact-thumbnail');
                video.onerror = () => { // Add error handler for video loading
                    console.error(`ERROR: Failed to load video artifact: ${artifact.url}`);
                    // You might add a placeholder or message for video errors too
                };
                artifactItem.appendChild(video);
            }
        } else if (artifact.type === ArtifactType.TOOL_NOTIFICATION && artifact.metadata && artifact.metadata.message) {
            const messageElement = document.createElement('p');
            messageElement.innerHTML = `<strong>Message:</strong> ${artifact.metadata.message}`;
            messageElement.style.fontStyle = 'italic';
            messageElement.style.color = 'var(--text-color-secondary)';
            artifactItem.appendChild(messageElement);
        } else if (artifact.type === ArtifactType.MCP_MANAGER) {
            const mcpManagerDiv = document.createElement('div');
            mcpManagerDiv.innerHTML = `<div class="mcp-server-list"></div>`;
            artifactItem.appendChild(mcpManagerDiv);
            setTimeout(renderMcpServers, 0);
        } else if (artifact.type === ArtifactType.LLAMA_UPDATER) {
            const llamaUpdaterDiv = document.createElement('div');
            llamaUpdaterDiv.id = 'llama-updater-content';
            llamaUpdaterDiv.innerHTML = `<button id="fetchLlamaReleases">Fetch Latest Releases</button>`;
            artifactItem.appendChild(llamaUpdaterDiv);
        } else if (artifact.type === ArtifactType.LOG_VIEW) {
            const iframe = document.createElement('iframe');
            iframe.src = "/artifacts/llm-server.log";
            iframe.style.width = '100%';
            iframe.style.height = '300px';
            iframe.style.border = 'none';
            artifactItem.appendChild(iframe);
        }

        artifactsListElement.appendChild(artifactItem);
    });
}

// Function to handle artifact added event from Go
function handleArtifactAdded(newArtifact) {
    if (String(newArtifact.session_id) === String(currentSessionId)) {
        if (!artifacts.some(a => a.id === newArtifact.id)) {
            artifacts.push(newArtifact);
            renderArtifacts();
        }
    }
}

// Function to handle artifact deleted event from Go
function handleArtifactDeleted(deletedArtifactID) {
    artifacts = artifacts.filter(art => art.id !== deletedArtifactID);
    renderArtifacts();
}

// Setup Wails Event Listeners for artifacts
function setupArtifactEventListeners() {
    EventsOn("artifactAdded", handleArtifactAdded);
    EventsOn("artifactDeleted", handleArtifactDeleted);
    console.log("DEBUG: Artifact event listeners setup.");
}

// Function to load artifacts for the current session
async function loadArtifactsForCurrentSession() {
    if (currentSessionId) {
        try {
            const fetchedArtifacts = await ListArtifacts(String(currentSessionId)); // Convert to string
            artifacts = fetchedArtifacts || [];
            renderArtifacts();
        } catch (error) {
            console.error("ERROR: Frontend: Error loading artifacts for session:", error);
            artifacts = [];
            renderArtifacts();
        }
    } else {
        artifacts = [];
        renderArtifacts();
    }
}
// --- END NEW: Artifacts State and UI Management ---




document.addEventListener('DOMContentLoaded', () => {
    console.log("DEBUG: DOMContentLoaded event fired.");
    runtime.LogInfo("DEBUG: Frontend DOMContentLoaded event fired, attempting to log via Go runtime.");

    mermaid.initialize({ startOnLoad: true });

    if (typeof marked !== 'undefined') {
        const renderer = new marked.Renderer();
        renderer.code = (code, language) => {
            if (language === 'mermaid') {
                return `
                    <div class="mermaid-container">
                        <div class="mermaid">${code}</div>
                        <button class="copy-code-button">Copy</button>
                    </div>
                `;
            }
            return `<pre><code>${code}</code></pre>`;
        };
        marked.setOptions({ renderer });
        console.log("DEBUG: 'marked' is defined and loaded.");
        runtime.LogInfo("DEBUG: 'marked' is defined and loaded.");
    } else {
        console.error("ERROR: 'marked' is NOT defined! The script might not be loading correctly.");
        runtime.LogError("ERROR: 'marked' is NOT defined! The script might not be loading correctly.");
    }

    const newChatButton = document.getElementById('newChatButton');
    const chatSessionList = document.getElementById('chatSessionList');
    const sendButton = document.getElementById('sendButton');
    const messageInput = document.getElementById('messageInput');
    const stopButton = document.getElementById('stopButton');
    const chatWindow = document.querySelector('.messages-container');
        // Intercept link clicks to open in system browser
    chatWindow.addEventListener('click', (e) => {
        const target = e.target.closest('a');
        if (target && target.href) {
            // Check if it's an external link
            if (target.protocol === 'http:' || target.protocol === 'https:') {
                e.preventDefault();
                runtime.BrowserOpenURL(target.href);
            }
        }
    });
    const systemPromptSelectInput = document.getElementById('systemPromptSelectInput');
    const systemPromptSelectList = document.getElementById('systemPromptSelectList');
    const customSystemPrompt = document.getElementById('customSystemPrompt');

    // Custom Theme Dropdown elements
    const themeSelectInput = document.getElementById('themeSelectInput');
    const themeSelectList = document.getElementById('themeSelectList');
    const selectedThemeValue = document.getElementById('selectedThemeValue'); // Hidden input for value


    let messages = [];
    let isStreaming = false;
    let selectedSystemPrompt = '';
    let reasoningContent = ''; // To store reasoning content

    function loadPrompts() {
        GetPrompts().then(prompts => {
            systemPromptSelectList.innerHTML = '';
            const defaultOption = document.createElement('div');
            defaultOption.textContent = 'Default';
            defaultOption.setAttribute('data-value', 'default'); // Add data-value
            defaultOption.addEventListener('click', () => {
                systemPromptSelectInput.value = 'Default';
                selectedSystemPrompt = '';
                customSystemPrompt.value = '';
                systemPromptSelectList.classList.add('select-hide');
                // If there's an active session, update its prompt
                if (currentSessionId) {
                    runtime.LogInfo(`DEBUG: app.js: Updating system prompt for session ${currentSessionId} to 'Default' (empty string).`);
                    UpdateChatSystemPrompt(currentSessionId, selectedSystemPrompt).catch(err => {
                        console.error("Error updating system prompt for session:", err);
                    });
                }
            });
            systemPromptSelectList.appendChild(defaultOption);
            prompts.forEach(prompt => {
                const option = document.createElement('div');
                option.textContent = prompt;
                option.setAttribute('data-value', prompt); // Add data-value
                option.addEventListener('click', () => {
                    systemPromptSelectInput.value = prompt;
                    GetPrompt(prompt).then(promptContent => {
                        selectedSystemPrompt = promptContent;
                        customSystemPrompt.value = promptContent;
                        // If there's an active session, update its prompt
                        if (currentSessionId) {
                            runtime.LogInfo(`DEBUG: app.js: Updating system prompt for session ${currentSessionId} to prompt '${prompt}'.`);
                            UpdateChatSystemPrompt(currentSessionId, selectedSystemPrompt).catch(err => {
                                console.error("Error updating system prompt for session:", err);
                            });
                        }
                    });
                    systemPromptSelectList.classList.add('select-hide');
                });
                systemPromptSelectList.appendChild(option);
            });
        });
    }

    // Event listeners for custom system prompt dropdown
    systemPromptSelectInput.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent document click from immediately closing
        themeSelectList.classList.add('select-hide'); // Close other dropdowns
        document.getElementById('chatModelSelectList').classList.add('select-hide');
        systemPromptSelectList.classList.toggle('select-hide');
    });

    // Event listeners for custom theme dropdown
    themeSelectInput.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent document click from immediately closing
        systemPromptSelectList.classList.add('select-hide'); // Close other dropdowns
        document.getElementById('chatModelSelectList').classList.add('select-hide');
        themeSelectList.classList.toggle('select-hide');
    });

    // Event listener for theme options
    themeSelectList.querySelectorAll('div').forEach(option => {
        option.addEventListener('click', () => {
            const themeValue = option.getAttribute('data-value');
            const themeText = option.textContent;

            themeSelectInput.value = themeText;
            selectedThemeValue.value = themeValue; // Update hidden input
            applyTheme(themeValue);
            themeSelectList.classList.add('select-hide');
            saveAllSettings(); // <-- THE FIX: Save settings when theme is changed
        });
    });


    document.addEventListener('click', (e) => {
        // Close system prompt dropdown if click outside
        const systemPromptSelect = document.querySelector('.chat-header .custom-select');
        if (systemPromptSelect && !systemPromptSelect.contains(e.target)) {
            systemPromptSelectList.classList.add('select-hide');
        }

        // Close theme dropdown if click outside
        const themeSelect = document.querySelector('.sidebar-container.right .custom-select:last-of-type'); // More specific selector for theme dropdown
        if (themeSelect && !themeSelect.contains(e.target)) {
            themeSelectList.classList.add('select-hide');
        }

        // Close chat model dropdown if click outside
        const chatModelSelect = document.querySelector('.sidebar-container.right .custom-select:first-of-type'); // More specific selector for chat model dropdown
        if (chatModelSelect && !chatModelSelect.contains(e.target)) {
            document.getElementById('chatModelSelectList').classList.add('select-hide');
        }
    });

    function renderMessages() {
        chatWindow.innerHTML = '';
        messages.forEach(message => {
            addMessageToChatWindow(message.role, message.content);
        });
        if (typeof hljs !== 'undefined') {
            chatWindow.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
            addCopyButtonsToCodeBlocks(chatWindow);
        } else {
            runtime.LogError("ERROR: hljs.highlightAll() called in renderMessages but hljs is not defined.");
        }
    }

    function addMessageToChatWindow(sender, messageContent) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender);

        if (sender === 'assistant') {
            let thought = '';
            const thinkTagMatch = /<think>(.*?)<\/think>/s.exec(messageContent);
            if (thinkTagMatch && thinkTagMatch[1]) {
                thought = thinkTagMatch[1].trim();
                messageContent = messageContent.replace(/<think>.*?<\/think>/s, '').trim();
            }

            if (thought) {
                updateThinkingProcess(messageElement, thought);
            }

            const mainContentContainer = document.createElement('div');
            mainContentContainer.classList.add('main-content-container');
            mainContentContainer.innerHTML = marked.parse(messageContent);
            messageElement.appendChild(mainContentContainer);

        } else {
            messageElement.textContent = messageContent;
        }

        chatWindow.appendChild(messageElement);
        if (sender === 'assistant') {
            addCopyButtonsToCodeBlocks(messageElement);
            mermaid.run({
                nodes: messageElement.querySelectorAll('.mermaid')
            });
        }
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return messageElement;
    }

    function loadSessions() {
        LoadChatSessions().then(sessions => {
            chatSessionList.innerHTML = '';
            sessions = sessions || []; // Ensure sessions is an array

            // Populate the session list in the UI
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
                                localStorage.removeItem('currentSessionId');
                                messages = [];
                                renderMessages();
                            }
                            loadSessions(); // Reload sessions to select a new one or create one
                        });
                    } else {
                        switchSession(sessionId, false); // Explicitly not forced
                    }
                });
                chatSessionList.appendChild(sessionButton);
            });

            // --- REVISED LOGIC TO BE THE SINGLE SOURCE OF TRUTH FOR SESSION SELECTION ---
            const sessionIds = sessions.map(s => s.id);
            // Re-read from localStorage to have the most up-to-date value.
            let sessionFromLocalStorage = localStorage.getItem('currentSessionId') ? parseInt(localStorage.getItem('currentSessionId'), 10) : null;

            let targetSessionId = null;

            // 1. Check if the session from localStorage is valid
            if (sessionFromLocalStorage !== null && sessionIds.includes(sessionFromLocalStorage)) {
                targetSessionId = sessionFromLocalStorage;
            }
            // 2. If not, check if there are other sessions to fall back to
            else if (sessions.length > 0) {
                targetSessionId = sessions[0].id;
                console.log(`Session ${sessionFromLocalStorage} was invalid or null. Falling back to first available session: ${targetSessionId}`);
            }

            // 3. Take action
            if (targetSessionId !== null) {
                // On initial load or after a delete, we always want to ensure the session is fully loaded, so we force it.
                switchSession(targetSessionId, true);
            } else {
                // 4. If no sessions exist at all, create a new one.
                console.log("No sessions available. Creating a new chat.");
                // Use a timeout to allow the DOM to update before clicking.
                setTimeout(() => document.getElementById('newChatButton').click(), 0);
            }
        });
    }

    function switchSession(sessionId, force = false) {
        console.log(`DEBUG: switchSession called for session ID: ${sessionId}, force: ${force}`);
        if (isStreaming) {
            console.log("Cannot switch session while streaming.");
            return;
        }
        // If not forced, don't reload an already active session.
        if (!force && currentSessionId === sessionId) {
            console.log("Session already active, and not forced. No action taken.");
            return;
        }
        currentSessionId = sessionId;
        localStorage.setItem('currentSessionId', currentSessionId);
        console.log("Switching to session:", currentSessionId);

        console.log("DEBUG: Calling LoadChatHistory for session:", currentSessionId);
        LoadChatHistory(currentSessionId).then(history => {
            console.log("DEBUG: LoadChatHistory promise resolved. Received history from backend:", history);
            if (history) {
                messages = history.map(m => ({
                    role: m.role,
                    content: m.content
                }));
                console.log("DEBUG: Mapped messages:", messages);
            } else {
                messages = [];
                console.log("DEBUG: History is null or undefined, clearing messages.");
            }
            renderMessages();
            loadArtifactsForCurrentSession();
        }).catch(error => {
            console.error("DEBUG: Error loading chat history:", error);
            messages = [];
            renderMessages();
            loadArtifactsForCurrentSession();
        });
        updateActiveSessionButton();
        updateChatInputState();
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
        updateChatInputState();
    }

    function updateChatInputState() {
        if (currentSessionId === null) {
            messageInput.disabled = true;
            messageInput.placeholder = 'Please select a chat session.';
        } else {
            messageInput.disabled = false;
            messageInput.placeholder = 'Type your message...';
        }
    }

    async function handleSendMessage() { // Made async to await IsLLMLoaded
        if (isStreaming) return;
        const userMessageContent = messageInput.value.trim();
        if (userMessageContent === '' || currentSessionId === null) {
            return;
        }

        // --- NEW: Check if LLM is loaded before sending message ---
        const llmLoaded = await IsLLMLoaded();
        if (!llmLoaded) {
            console.warn("LLM model is not loaded. Please load a model first.");
            addMessageToChatWindow('system', 'Please load an LLM model first before sending messages.');
            return; // Prevent sending message if LLM is not loaded
        }
        // --- END NEW CHECK ---

        const contentToSend = userMessageContent; // System prompt is handled in Go backend

        const userMessage = {
            role: 'user',
            rawContent: userMessageContent
        };
        messages.push({ role: 'user', content: userMessageContent });
        addMessageToChatWindow('user', userMessageContent);
        messageInput.value = '';

        isStreaming = true;
        reasoningContent = ''; // Reset reasoning content
        sendButton.style.display = 'none';
        stopButton.style.display = 'block';

        let assistantResponse = '';
        messages.push({ role: 'assistant', content: '' });
        addMessageToChatWindow('assistant', ''); // Create the bubble upfront

        sendMessage(currentSessionId, contentToSend).catch(error => {
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

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    stopButton.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentSessionId) {
            StopStream(currentSessionId);
        }
    });

    newChatButton.addEventListener('click', (e) => {
        e.preventDefault();
        // Pass the selectedSystemPrompt to the NewChat function
        NewChat(selectedSystemPrompt).then((newId) => {
            switchSession(newId);
            loadSessions();
        }).catch(error => {
            console.error("Error creating new chat:", error);
        });
    });

    let debounceTimer;
    const DEBOUNCE_DELAY_MS = 30;

    // Listener for reasoning content
    EventsOn("reasoning-stream", function(data) {
        if (isStreaming) {
            let lastMessageBubble = document.querySelector('.message.assistant:last-child');
            if (lastMessageBubble) {
                updateThinkingProcess(lastMessageBubble, data, true); // true for append
            }
        }
    });

    EventsOn("chat-stream", function(data) {
        if (data === null) {
            clearTimeout(debounceTimer);
            updateAssistantMessageUI(messages[messages.length - 1].content);
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
        messages[messages.length - 1].content = assistantResponse;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            updateAssistantMessageUI(assistantResponse);
        }, DEBOUNCE_DELAY_MS);
    });

    EventsOn("sessionNameUpdated", (data) => {
        const { sessionID, newName } = data;
        const sessionButton = document.querySelector(`#chatSessionList button[data-session-id='${sessionID}']`);
        if (sessionButton) {
            sessionButton.textContent = newName;
        }
    });

    EventsOn("token-stats", (data) => {
        const tokenCounter = document.getElementById('token-counter');
        if (tokenCounter) {
            tokenCounter.textContent = `Tokens/sec: ${data.tps.toFixed(2)}`;
        }
    });

    EventsOn("session-token-total", (data) => {
        if (data.sessionID === currentSessionId) {
            const sessionTokenTotal = document.getElementById('session-token-total');
            if (sessionTokenTotal) {
                sessionTokenTotal.textContent = `Total Tokens: ${data.total}`;
            }
        }
    });

    function updateThinkingProcess(messageElement, thought, append = false) {
        let detailsElement = messageElement.querySelector('.thought-block');

        // Create the details element if it doesn't exist
        if (!detailsElement) {
            detailsElement = document.createElement('details');
            detailsElement.classList.add('thought-block');
            const summaryElement = document.createElement('summary');
            summaryElement.classList.add('thought-summary');
            summaryElement.innerHTML = '<span class="inline-block mr-2">💡</span>Thinking Process';
            const contentElement = document.createElement('p');
            contentElement.classList.add('thought-content');
            detailsElement.appendChild(summaryElement);
            detailsElement.appendChild(contentElement);

            // Prepend the thought block to the message element to ensure it appears first
            messageElement.insertBefore(detailsElement, messageElement.firstChild);
        }

        // Update the content of the thought block
        const contentElement = detailsElement.querySelector('.thought-content');
        if (contentElement) {
            if (append) {
                contentElement.textContent += thought;
            } else {
                contentElement.textContent = thought;
            }
        }
    }

    function updateAssistantMessageUI(currentFullResponse) {
        let lastMessageBubble = document.querySelector('.message.assistant:last-child');
        if (!lastMessageBubble) {
            console.error("updateAssistantMessageUI called but no assistant message bubble found.");
            return;
        }

        // Find or create a container for the main content
        let mainContentContainer = lastMessageBubble.querySelector('.main-content-container');
        if (!mainContentContainer) {
            mainContentContainer = document.createElement('div');
            mainContentContainer.classList.add('main-content-container');
            lastMessageBubble.appendChild(mainContentContainer);
        }

        // Handle <think> tags for backward compatibility
        const thinkTagMatch = /<think>(.*?)<\/think>/s.exec(currentFullResponse);
        if (thinkTagMatch && thinkTagMatch[1]) {
            const thought = thinkTagMatch[1].trim();
            currentFullResponse = currentFullResponse.replace(/<think>.*?<\/think>/s, '').trim();
            // If we find a think tag, we should display it, but only if a streamed thought-block doesn't already exist.
            if (!lastMessageBubble.querySelector('.thought-block')) {
                 updateThinkingProcess(lastMessageBubble, thought);
            }
        }

        mainContentContainer.innerHTML = marked.parse(currentFullResponse);

        if (typeof hljs !== 'undefined') {
            mainContentContainer.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
            addCopyButtonsToCodeBlocks(mainContentContainer);
        } else {
            console.warn("highlight.js not available, code blocks will not be highlighted.");
        }

        mermaid.run({
            nodes: mainContentContainer.querySelectorAll('.mermaid')
        });

        scrollToBottom();
    }

    function addCopyButtonsToCodeBlocks(container) {
        container.querySelectorAll('pre').forEach(preElement => {
            if (preElement.parentNode.classList.contains('code-block-wrapper')) {
                return;
            }

            const wrapper = document.createElement('div');
            wrapper.classList.add('code-block-wrapper');
            preElement.parentNode.insertBefore(wrapper, preElement);
            wrapper.appendChild(preElement);

            const copyButton = document.createElement('button');
            copyButton.classList.add('copy-code-button');
            copyButton.textContent = 'Copy';
            wrapper.appendChild(copyButton);

            copyButton.addEventListener('click', () => {
                const codeToCopy = preElement.textContent;
                runtime.ClipboardSetText(codeToCopy).then(() => {
                    copyButton.textContent = 'Copied!';
                    setTimeout(() => {
                        copyButton.textContent = 'Copy';
                    }, 2000);
                });
            });
        });

        container.querySelectorAll('.mermaid-container .copy-code-button').forEach(copyButton => {
            copyButton.addEventListener('click', () => {
                const mermaidCode = copyButton.previousElementSibling.textContent;
                runtime.ClipboardSetText(mermaidCode).then(() => {
                    copyButton.textContent = 'Copied!';
                    setTimeout(() => {
                        copyButton.textContent = 'Copy';
                    }, 2000);
                });
            });
        });
    }

    function scrollToBottom() {
        const chatWindow = document.querySelector('.messages-container');
        if (chatWindow) {
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    }


    // Initial setup
    loadSessions(); // This will now handle the initial session loading and selection.
    loadPrompts();
    loadSettingsAndApplyTheme(); // Call the new load function
    mcpManager.initialize().then(() => {
        renderMcpServers();
        mcpManager.addEventListener('state-change', () => {
            renderMcpServers();
        });
    });
    setupArtifactEventListeners(); // <--- NEW: Setup artifact event listeners on DOMContentLoaded

    const settingsToggleButton = document.getElementById('settingsToggleButton');
    const mcpManagerButton = document.getElementById('mcpManagerButton');
    const toggleDebugButton = document.getElementById('toggleDebugButton');
    const rightSidebar = document.querySelector('.sidebar-container.right');
    const artifactsPanel = document.getElementById('artifactsPanel');
    const toggleArtifactsPanelButton = document.getElementById('toggleArtifactsPanel');

    // --- NEW: Upload Artifact Button and File Input ---
    const uploadArtifactButton = document.getElementById('uploadArtifactButton');
    const fileUploadInput = document.getElementById('fileUploadInput');

    if (uploadArtifactButton && fileUploadInput) {
        uploadArtifactButton.addEventListener('click', () => {
            fileUploadInput.click(); // Programmatically click the hidden file input
        });

        fileUploadInput.addEventListener('change', handleFileUpload); // Attach the new handleFileUpload function
    } else {
        // Fallback message if elements are not found, assuming addMessageToChatWindow is safe to call
        addMessageToChatWindow('system', "ERROR: File upload UI elements not found. Please check index.html.");
    }
    // --- END NEW: Upload Artifact Button and File Input ---


    if (settingsToggleButton && rightSidebar) {
        settingsToggleButton.addEventListener('click', () => {
            rightSidebar.classList.toggle('sidebar-hidden');
        });
    }

    if (mcpManagerButton) {
        mcpManagerButton.addEventListener('click', createMcpManagerArtifact);
    }

    const llamaUpdaterButton = document.getElementById('llamaUpdaterButton');
    if (llamaUpdaterButton) {
        llamaUpdaterButton.addEventListener('click', createLlamaUpdaterArtifact);
    }

    if (toggleLogViewButton) {
        toggleLogViewButton.addEventListener('click', () => {
            if (currentSessionId) {
                AddArtifact(String(currentSessionId), ArtifactType.LOG_VIEW, "LLM Server Log", "");
            } else {
                addMessageToChatWindow('system', 'Please select a session before enabling the log view.');
            }
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

    // Event listener for chat model select input to handle fuzzy search
    document.getElementById('chatModelSelectInput').addEventListener('input', (e) => {
        const query = e.target.value;
        const chatModelSelectList = document.getElementById('chatModelSelectList');

        runtime.LogInfo(`DEBUG: app.js: Fuzzy search input query: '${query}'`);

        if (query && fuse) { // Use the fuse instance from settings.js
            const results = fuse.search(query);
            runtime.LogInfo(`DEBUG: app.js: Fuzzy search results count for query '${query}': ${results.length}`);

            const items = results.map(result => result.item);
            chatModelSelectList.innerHTML = '';
            items.forEach(item => {
                const option = document.createElement('div');
                option.textContent = item.name;
                option.setAttribute('data-path', item.path);
                option.addEventListener('click', () => handleModelSelection(item.name, item.path)); // Use handleModelSelection from settings.js
                chatModelSelectList.appendChild(option);
            });
            chatModelSelectList.classList.remove('select-hide');
        } else {
            chatModelSelectList.classList.add('select-hide');
        }
    });

    // Event listener for chat model select input to open/close
    document.getElementById('chatModelSelectInput').addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent document click from immediately closing
        systemPromptSelectList.classList.add('select-hide'); // Close other dropdowns
        themeSelectList.classList.add('select-hide');
        document.getElementById('chatModelSelectList').classList.toggle('select-hide');
    });


    // Event listeners for saving settings (including theme)
    document.getElementById('llamaPathInput').addEventListener('change', saveAllSettings);
    document.getElementById('modelPathInput').addEventListener('change', () => {
        saveAllSettings().then(() => {
            loadSettingsAndApplyTheme();
        });
    });
    document.getElementById('chatModelArgs').addEventListener('change', saveAllSettings);

    document.getElementById('launchLLMButton').addEventListener('click', launchLLM);

    // initFuzzySearch([]) is no longer needed here as it's handled by loadSettingsAndApplyTheme

    document.getElementById('artifactsContent').addEventListener('click', async (e) => {
        if (e.target.id === 'fetchLlamaReleases') {
            handleFetchLlamaReleases();
        } else if (e.target.classList.contains('download-llama-release')) {
            const button = e.target;
            const assetUrl = button.dataset.url;
            const assetName = button.dataset.name;
            const tagName = button.dataset.tag;
            handleDownloadLlamaRelease(assetUrl, assetName, tagName, button);
        }
    });
});

// --- NEW: File Upload Handling Function ---
async function handleFileUpload(event) {
    const files = event.target.files;
    if (files.length === 0) {
        return;
    }

    const file = files[0];

    const reader = new FileReader();

    reader.onload = async (e) => {
        const base64Content = e.target.result.split(',')[1]; // Get base64 part
        let artifactType = ArtifactType.TOOL_NOTIFICATION; // Default to notification for unknown types

        if (file.type.startsWith('image/')) {
            artifactType = ArtifactType.IMAGE;
        } else if (file.type.startsWith('video/')) {
            artifactType = ArtifactType.VIDEO;
        }
        // You can add more type checks here if needed

        if (currentSessionId !== null) { // Ensure a session is active
            try {
                const artifact = await AddArtifact(String(currentSessionId), artifactType, file.name, base64Content);
                // The 'artifactAdded' event from Go will trigger handleArtifactAdded()
            } catch (error) {
                console.error("ERROR: Error uploading artifact via AddArtifact:", error);
                addMessageToChatWindow('system', `ERROR: Failed to upload file to backend: ${error.message || error}`);
            }
        } else {
            addMessageToChatWindow('system', 'WARN: No current chat session. Please start a chat session before uploading files.');
        }
        event.target.value = ''; // Clear the input so same file can be selected again (important!)
    };

    reader.onerror = (e) => {
        console.error("ERROR: FileReader error:", e);
        addMessageToChatWindow('system', `ERROR: Error reading file: ${e.message || e}`);
    };

    reader.readAsDataURL(file); // Read the file as a data URL (base64)
}

async function createMcpManagerArtifact() {
    if (currentSessionId === null) {
        addMessageToChatWindow('system', 'WARN: No current chat session. Please start a chat session before opening the MCP manager.');
        return;
    }

    // Check if an MCP manager artifact already exists
    const mcpManagerExists = artifacts.some(a => a.type === ArtifactType.MCP_MANAGER);
    if (mcpManagerExists) {
        addMessageToChatWindow('system', 'INFO: MCP manager is already open.');
        return;
    }

    try {
        await AddArtifact(String(currentSessionId), ArtifactType.MCP_MANAGER, "MCP Manager", "");
    } catch (error) {
        console.error("ERROR: Error creating MCP manager artifact:", error);
        addMessageToChatWindow('system', `ERROR: Failed to create MCP manager artifact: ${error.message || error}`);
    }
}

async function createLlamaUpdaterArtifact() {
    if (currentSessionId === null) {
        addMessageToChatWindow('system', 'WARN: No current chat session. Please start a chat session before opening the Llama.cpp updater.');
        return;
    }

    const llamaUpdaterExists = artifacts.some(a => a.type === ArtifactType.LLAMA_UPDATER);
    if (llamaUpdaterExists) {
        addMessageToChatWindow('system', 'INFO: Llama.cpp updater is already open.');
        return;
    }

    try {
        await AddArtifact(String(currentSessionId), ArtifactType.LLAMA_UPDATER, "Llama.cpp Updater", "");
    } catch (error) {
        console.error("ERROR: Error creating Llama.cpp updater artifact:", error);
        addMessageToChatWindow('system', `ERROR: Failed to create Llama.cpp updater artifact: ${error.message || error}`);
    }
}

async function renderMcpServers() {
    const serverList = document.querySelector('.mcp-server-list');
    if (!serverList) return;

    // Add settings sliders to the top of the MCP manager
    serverList.innerHTML = `
        <div class="mcp-settings">
            <h4>Tool Usage Settings</h4>
            <div class="setting-item">
                <label for="toolCallIterationsSlider">Max Tool Iterations: <span id="toolCallIterationsValue">5</span></label>
                <input type="range" id="toolCallIterationsSlider" min="1" max="10" value="5" class="slider">
            </div>
            <div class="setting-item">
                <label for="toolCallCooldownSlider">Tool Cooldown (s): <span id="toolCallCooldownValue">0</span></label>
                <input type="range" id="toolCallCooldownSlider" min="0" max="60" value="0" class="slider">
            </div>
        </div>
    `;

    // --- NEW: Add event listeners for sliders ---
    const iterationsSlider = document.getElementById('toolCallIterationsSlider');
    const iterationsValue = document.getElementById('toolCallIterationsValue');
    if (iterationsSlider && iterationsValue) {
        iterationsSlider.addEventListener('input', () => {
            iterationsValue.textContent = iterationsSlider.value;
            saveAllSettings(); // Save on change
        });
    }

    const cooldownSlider = document.getElementById('toolCallCooldownSlider');
    const cooldownValue = document.getElementById('toolCallCooldownValue');
    if (cooldownSlider && cooldownValue) {
        cooldownSlider.addEventListener('input', () => {
            cooldownValue.textContent = cooldownSlider.value;
            saveAllSettings(); // Save on change
        });
    }
    // --- END NEW ---

    // Reload the settings to populate the sliders correctly
    loadSettingsAndApplyTheme();


    try {
        const servers = mcpManager.servers;

        if (!servers || Object.keys(servers).length === 0) {
            serverList.innerHTML = '<p>No MCP servers found in mcp.json.</p>';
            return;
        }

        for (const serverName in servers) {
            const server = servers[serverName];
            const connectionState = mcpManager.getConnectionState(serverName);
            const serverItem = document.createElement('div');
            serverItem.classList.add('mcp-server-item');

            let statusIndicator;
            switch (connectionState.status) {
                case MCP_CONNECTION_STATUS.CONNECTED:
                    statusIndicator = '<span class="status-indicator connected"></span>';
                    break;
                case MCP_CONNECTION_STATUS.DISCONNECTED:
                    statusIndicator = '<span class="status-indicator disconnected"></span>';
                    break;
                case MCP_CONNECTION_STATUS.CONNECTING:
                    statusIndicator = '<span class="status-indicator connecting"></span>';
                    break;
                case MCP_CONNECTION_STATUS.ERROR:
                    statusIndicator = '<span class="status-indicator error"></span>';
                    break;
            }

            serverItem.innerHTML = `
                <div class="mcp-server-details">
                    <h3>${serverName}</h3>
                    <p class="status">${statusIndicator} ${connectionState.status}</p>
                    ${connectionState.error ? `<p class="error-message">${connectionState.error.message}</p>` : ''}
                </div>
                <button class="button" data-server-name="${serverName}" ${connectionState.status === MCP_CONNECTION_STATUS.CONNECTING ? 'disabled' : ''}>
                    ${connectionState.status === MCP_CONNECTION_STATUS.CONNECTED ? 'Disconnect' : 'Connect'}
                </button>
            `;
            serverList.appendChild(serverItem);

            const button = serverItem.querySelector(`button[data-server-name="${serverName}"]`);
            button.addEventListener('click', async () => {
                if (connectionState.status === MCP_CONNECTION_STATUS.CONNECTED) {
                    await mcpManager.disconnect(serverName);
                } else {
                    await mcpManager.connect(serverName);
                }
            });
        }
    } catch (error) {
        console.error("Error loading MCP servers:", error);
        serverList.innerHTML = '<p>Error loading MCP servers.</p>';
    }
}
// --- END NEW: File Upload Handling Function ---

// --- Llama.cpp Updater Functions ---

async function handleFetchLlamaReleases() {
    const contentDiv = document.getElementById('llama-updater-content');
    if (!contentDiv) return;

    contentDiv.innerHTML = '<p>Fetching releases...</p>';

    try {
        const releases = await window.go.main.App.FetchLlamaCppReleases();
        if (!releases || releases.length === 0) {
            contentDiv.innerHTML = '<p>No recent llama.cpp releases found.</p>';
            return;
        }

        let releasesHtml = '<ul>';
        releases.forEach(release => {
            releasesHtml += `<li><strong>${release.name}</strong> (${release.tag_name})<ul>`;
            release.assets.forEach(asset => {
                releasesHtml += `
                    <li>
                        ${asset.name} (${asset.human_size})
                        <button class="download-llama-release" data-url="${asset.browser_download_url}" data-name="${asset.name}" data-tag="${release.tag_name}">
                            Download
                        </button>
                    </li>`;
            });
            releasesHtml += '</ul></li>';
        });
        releasesHtml += '</ul>';
        contentDiv.innerHTML = releasesHtml;

    } catch (error) {
        console.error("Error fetching llama.cpp releases:", error);
        contentDiv.innerHTML = `<p class="error-message">Error fetching releases: ${error}</p>`;
    }
}

function handleDownloadLlamaRelease(assetUrl, assetName, tagName, button) {
    button.disabled = true;
    button.textContent = 'Downloading...';

    const progress = document.createElement('div');
    progress.classList.add('download-progress');
    progress.innerHTML = `
        <div class="progress-bar-container">
            <div class="progress-bar"></div>
        </div>
        <span class="progress-text"></span>
    `;
    button.parentElement.appendChild(progress);

    window.go.main.App.DownloadLlamaCppAsset(assetUrl, assetName, tagName);
}

function setupLlamaDownloadListeners() {
    runtime.EventsOn("llama-cpp-download-progress", (progress) => {
        const progressBar = document.querySelector('.download-progress .progress-bar');
        const progressText = document.querySelector('.download-progress .progress-text');
        if (progressBar && progressText) {
            const percentage = progress.total > 0 ? (progress.downloaded / progress.total) * 100 : 0;
            progressBar.style.width = `${percentage}%`;
            progressText.textContent = `${progress.human_downloaded} / ${progress.human_total}`;
        }
    });

    runtime.EventsOn("llama-cpp-download-complete", (newPath) => {
        const contentDiv = document.getElementById('llama-updater-content');
        if (contentDiv) {
            contentDiv.innerHTML = `<p class="success-message">Llama.cpp downloaded and extracted to:<br>${newPath}</p>`;
        }
        // Also update the settings input field if it's on the screen
        const llamaPathInput = document.getElementById('llamaPathInput');
        if (llamaPathInput) {
            llamaPathInput.value = newPath;
        }
    });

    runtime.EventsOn("llama-cpp-download-error", (errorMessage) => {
        const contentDiv = document.getElementById('llama-updater-content');
        if (contentDiv) {
            contentDiv.innerHTML += `<p class="error-message">Download failed: ${errorMessage}</p>`;
        }
    });
}

// Call this once when the app loads
setupLlamaDownloadListeners();
