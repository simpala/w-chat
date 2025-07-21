// app.js

console.log("DEBUG: Main app.js file loaded.");
import {
    initFuzzySearch,
    handleModelSelection,
    fuse
} from './modules/settings.js'; // Assuming settings.js handles fuzzy search, etc.

import {
    launchLLM
} from './modules/llm.js';
import {
    getMcpServers,
    toggleMcpConnection,
    getMcpConnectionState,
    connectAllMcp,
    disconnectAllMcp,
    loadMcpConnectionStates
} from './modules/mcp.js';
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

// Define currentSettings globally
let currentSettings = {};
let currentSessionId = localStorage.getItem('currentSessionId') ? parseInt(localStorage.getItem('currentSessionId'), 10) : null; // Ensure this is accessible globally and parsed as int


// --- NEW: Artifact Type Constants (Mirroring Go) ---
export const ArtifactType = {
    IMAGE: "IMAGE",
    VIDEO: "VIDEO",
    TOOL_NOTIFICATION: "TOOL_NOTIFICATION",
    MCP_MANAGER: "MCP_MANAGER",
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
            if (confirm(`Are you sure you want to delete artifact: ${artifact.metadata.file_name || artifact.id}?`)) {
                await DeleteArtifact(artifactID); // Call Go backend
            }
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
            mcpManagerDiv.innerHTML = `
                <div class="mcp-manager">
                    <div class="mcp-master-controls">
                        <label class="switch">
                            <input type="checkbox" id="mcpMasterToggle">
                            <span class="slider round"></span>
                        </label>
                        <label for="mcpMasterToggle">Connect/Disconnect All</label>
                    </div>
                    <div class="mcp-server-list"></div>
                </div>
            `;
            artifactItem.appendChild(mcpManagerDiv);
            renderMcpServers();
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


// Function to apply the theme
export function applyTheme(themeName) {
    console.log("DEBUG: applyTheme called with:", themeName);
    const body = document.body;
    // Remove all existing theme classes
    body.className = body.className.split(' ').filter(c => !c.startsWith('theme-')).join(' ');

    if (themeName && themeName !== 'default') {
        body.classList.add(`theme-${themeName}`);
    }
    body.dataset.theme = themeName; // Store the active theme name in a data attribute
    console.log("DEBUG: Body classes after applyTheme:", body.className);
    console.log("DEBUG: Body data-theme after applyTheme:", body.dataset.theme);
}

// Modified loadSettings to handle theme
async function loadSettingsAndApplyTheme() {
    console.log("DEBUG: Frontend: loadSettingsAndApplyTheme started.");
    try {
        const settingsJson = await GoLoadSettings(); // This should return the JSON string from Go
        console.log("DEBUG: Frontend: Raw settingsJson received from GoLoadSettings:", settingsJson);

        currentSettings = JSON.parse(settingsJson); // This parses the snake_case JSON into a JS object
        console.log("DEBUG: Frontend: Parsed currentSettings object:", currentSettings);


        // Apply theme on load - Use snake_case
        const savedTheme = currentSettings.theme || 'default';
        console.log("DEBUG: Frontend: Saved theme from settings:", savedTheme);
        applyTheme(savedTheme);

        // Set the custom theme dropdown's displayed value and hidden value
        const themeSelectInput = document.getElementById('themeSelectInput');
        const selectedThemeValue = document.getElementById('selectedThemeValue');
        // Find the correct option element based on data-value
        const themeOptionElement = document.querySelector(`#themeSelectList div[data-value="${savedTheme}"]`);
        if (themeSelectInput && selectedThemeValue && themeOptionElement) {
            themeSelectInput.value = themeOptionElement.textContent; // Display text
            selectedThemeValue.value = savedTheme; // Hidden value
            console.log(`DEBUG: Frontend: Theme dropdown set to: ${themeOptionElement.textContent} (${savedTheme})`);
        } else {
            console.warn("WARN: Frontend: Theme UI elements not found or theme option not found for:", savedTheme);
            if (!themeSelectInput) console.warn("themeSelectInput not found.");
            if (!selectedThemeValue) console.warn("selectedThemeValue not found.");
            if (!themeOptionElement) console.warn(`themeOptionElement not found for data-value="${savedTheme}".`);
        }


        // Populate your existing settings fields - Use snake_case
        document.getElementById('llamaPathInput').value = currentSettings.llama_cpp_dir || '';
        document.getElementById('modelPathInput').value = currentSettings.models_dir || '';
        document.getElementById('selectedModelPath').value = currentSettings.selected_model || '';
        document.getElementById('chatModelSelectInput').value = currentSettings.selected_model ? currentSettings.selected_model.split('/').pop() : 'Select Model...';

        // More robust handling for ModelArgs - Use snake_case
        const modelArgsInput = document.getElementById('chatModelArgs');
        if (modelArgsInput) {
            const selectedModel = currentSettings.selected_model;
            const modelArgs = currentSettings.model_args;
            if (modelArgs && selectedModel && modelArgs[selectedModel] !== undefined) {
                modelArgsInput.value = modelArgs[selectedModel];
                console.log(`DEBUG: Frontend: chatModelArgs set for ${selectedModel}: ${modelArgs[selectedModel]}`);
            } else {
                modelArgsInput.value = '';
                console.log(`DEBUG: Frontend: chatModelArgs cleared or not found for ${selectedModel}. ModelArgs:`, modelArgs);
            }
        } else {
            console.warn("WARN: Frontend: chatModelArgs element not found.");
        }


        // Update model list for fuzzy search
        const models = await window.go.main.App.GetModels(); // Assuming GetModels exists
        initFuzzySearch(models.map(p => ({ name: p.split('/').pop(), path: p })));
        console.log("DEBUG: Frontend: Models loaded for fuzzy search.");

    } catch (error) {
        console.error("ERROR: Frontend: Error loading settings and applying theme:", error);
        applyTheme('default'); // Fallback to default theme on error
    }
    console.log("DEBUG: Frontend: loadSettingsAndApplyTheme finished.");
}

// Modified saveSettings to handle theme
async function saveAllSettings() {
    console.log("DEBUG: Frontend: saveAllSettings started.");
    // Populate currentSettings with values from UI - Use snake_case
    currentSettings.llama_cpp_dir = document.getElementById('llamaPathInput').value;
    currentSettings.models_dir = document.getElementById('modelPathInput').value;
    currentSettings.selected_model = document.getElementById('selectedModelPath').value;

    if (!currentSettings.model_args) { // Use snake_case
        currentSettings.model_args = {};
    }
    const currentModelPath = document.getElementById('selectedModelPath').value;
    if (currentModelPath) {
        currentSettings.model_args[currentModelPath] = document.getElementById('chatModelArgs').value; // Use snake_case
    }

    // Save the current theme from the body's data-theme attribute - Use snake_case
    currentSettings.theme = document.body.dataset.theme || 'default';
    console.log("DEBUG: Frontend: Settings object before saving:", currentSettings);

    try {
        await GoSaveSettings(JSON.stringify(currentSettings)); // Use aliased Go function
        console.log("DEBUG: Frontend: Settings saved successfully.");
    } catch (error) {
        console.error("ERROR: Frontend: Error saving settings:", error);
    }
    console.log("DEBUG: Frontend: saveAllSettings finished.");
}


document.addEventListener('DOMContentLoaded', () => {
    console.log("DEBUG: DOMContentLoaded event fired.");
    runtime.LogInfo("DEBUG: Frontend DOMContentLoaded event fired, attempting to log via Go runtime.");

    if (typeof marked !== 'undefined') {
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
            applyTheme(themeValue); // Apply the theme
            saveAllSettings(); // Save theme preference immediately
            themeSelectList.classList.add('select-hide'); // Hide dropdown
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
        if (sender === 'assistant') {
            addCopyButtonsToCodeBlocks(messageElement);
        }
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
        console.log("DEBUG: switchSession function entered. Session ID:", sessionId);
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
            loadArtifactsForCurrentSession(); // <--- NEW: Load artifacts when switching sessions
        }).catch(error => {
            console.error("DEBUG: Error loading chat history:", error);
            messages = [];
            renderMessages();
            loadArtifactsForCurrentSession(); // <--- NEW: Load artifacts even if chat history fails
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
        sendButton.style.display = 'none';
        stopButton.style.display = 'block';

        let assistantResponse = '';
        messages.push({ role: 'assistant', content: '' });

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

    function updateAssistantMessageUI(currentFullResponse) {
        let lastMessageBubble = document.querySelector('.message.assistant:last-child');
        if (!lastMessageBubble) {
            console.error("updateAssistantMessageUI called but no assistant message bubble found.");
            return;
        }

        lastMessageBubble.innerHTML = '';
        const parsedParts = parseStreamedContent(currentFullResponse);

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
            lastMessageBubble.appendChild(partContainer);
        });

        if (typeof hljs !== 'undefined') {
            lastMessageBubble.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
            addCopyButtonsToCodeBlocks(lastMessageBubble);
        } else {
            console.warn("highlight.js not available, code blocks will not be highlighted.");
        }

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
    }

    function scrollToBottom() {
        const chatWindow = document.querySelector('.messages-container');
        if (chatWindow) {
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    }


    // Initial setup
    loadSessions();
    if (currentSessionId) {
        switchSession(parseInt(currentSessionId));
    }
    loadPrompts();
    loadSettingsAndApplyTheme(); // Call the new load function
    loadMcpConnectionStates(); // Load MCP connection states
    setupArtifactEventListeners(); // <--- NEW: Setup artifact event listeners on DOMContentLoaded

    const settingsToggleButton = document.getElementById('settingsToggleButton');
    const mcpManagerButton = document.getElementById('mcpManagerButton');
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
    document.getElementById('modelPathInput').addEventListener('change', saveAllSettings);
    // Note: handleModelSelection now calls saveAllSettings internally
    document.getElementById('chatModelArgs').addEventListener('change', saveAllSettings);

    document.getElementById('launchLLMButton').addEventListener('click', launchLLM);

    // initFuzzySearch([]) is no longer needed here as it's handled by loadSettingsAndApplyTheme
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

async function renderMcpServers() {
    const serverList = document.querySelector('.mcp-server-list');
    if (!serverList) return;

    serverList.innerHTML = '';

    try {
        const servers = await getMcpServers();

        if (!servers || Object.keys(servers).length === 0) {
            serverList.innerHTML = '<p>No MCP servers found in mcp.json.</p>';
            return;
        }

        for (const serverName in servers) {
            const server = servers[serverName];
            const serverItem = document.createElement('div');
            serverItem.classList.add('mcp-server-item');
            serverItem.innerHTML = `
                <div class="mcp-server-details">
                    <h3>${serverName}</h3>
                    <p>${server.description}</p>
                </div>
                <label class="switch">
                    <input type="checkbox" data-server-name="${serverName}" ${getMcpConnectionState(serverName) ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            `;
            serverList.appendChild(serverItem);

            const toggle = serverItem.querySelector(`input[data-server-name="${serverName}"]`);
            toggle.addEventListener('change', async () => {
                await toggleMcpConnection(serverName, server);
                renderMcpServers();
            });
        }

        const masterToggle = document.getElementById('mcpMasterToggle');
        if (masterToggle) {
            const allConnected = Object.values(servers).every(server => getMcpConnectionState(server.name));
            masterToggle.checked = allConnected;

            masterToggle.addEventListener('change', async (event) => {
                if (event.target.checked) {
                    await connectAllMcp();
                } else {
                    await disconnectAllMcp();
                }
                renderMcpServers();
            });
        }
    } catch (error) {
        console.error("Error loading MCP servers:", error);
        serverList.innerHTML = '<p>Error loading MCP servers.</p>';
    }
}
// --- END NEW: File Upload Handling Function ---
