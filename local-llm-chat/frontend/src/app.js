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
    IsLLMLoaded // <--- NEW: Import IsLLMLoaded
} from '../wailsjs/go/main/App';
import {
    EventsOn
} from '../wailsjs/runtime';
import * as runtime from '../wailsjs/runtime';

// Define currentSettings globally
let currentSettings = {};

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

    let currentSessionId = localStorage.getItem('currentSessionId') || null;
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
            hljs.highlightAll();
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
        }).catch(error => {
            console.error("DEBUG: Error loading chat history:", error);
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
            hljs.highlightAll();
        } else {
            console.warn("highlight.js not available, code blocks will not be highlighted.");
        }

        scrollToBottom();
    }

    // Initial setup
    loadSessions();
    if (currentSessionId) {
        switchSession(parseInt(currentSessionId));
    }
    loadPrompts();
    loadSettingsAndApplyTheme(); // Call the new load function

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
