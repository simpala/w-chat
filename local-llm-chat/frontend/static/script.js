const sendButton = document.getElementById('sendButton');
const messageInput = document.getElementById('messageInput');
const messagesContainer = document.querySelector('.messages-container');
const newChatButton = document.getElementById('newChatButton');
const launchLLMButton = document.getElementById('launchLLMButton');
const launchEmbedButton = document.getElementById('launchEmbedButton');
const llamaPathInput = document.getElementById('llamaPathInput');
const modelPathInput = document.getElementById('modelPathInput');
const chatModelSelect = document.getElementById('chatModelSelect');
const chatModelArgs = document.getElementById('chatModelArgs');
const embeddingModelSelect = document.getElementById('embeddingModelSelect');
const embeddingModelArgs = document.getElementById('embeddingModelArgs');
const ragEnabledCheckbox = document.getElementById('ragEnabled');
const ragElements = document.querySelectorAll('.rag-element');
const speculativeEnabledCheckbox = document.getElementById('speculativeEnabled');
const speculativeElements = document.querySelectorAll('.speculative-element');
const speculativeMainModelSelect = document.getElementById('speculativeMainModelSelect');
const speculativeDraftModelSelect = document.getElementById('speculativeDraftModelSelect');
const speculativeModelArgs = document.getElementById('speculativeModelArgs');
const launchSpeculativeButton = document.getElementById('launchSpeculativeButton');
const systemPromptSelect = document.getElementById('systemPromptSelect');
const customSystemPrompt = document.getElementById('customSystemPrompt'); // Now a textarea
// const systemPromptName = document.getElementById('systemPromptName'); // Removed
const chunkSizeSlider = document.getElementById('chunkSizeSlider');
const streamingEnabledCheckbox = document.getElementById('streamingEnabled');
const sliderContainer = document.querySelector('.slider-container');
const chatSessionList = document.getElementById('chatSessionList');
const newSessionNameInput = document.getElementById('newSessionName');
const commandsButton = document.getElementById('commandsButton');
const usePreprocessorCheckbox = document.getElementById('usePreprocessor');
const dedicatedAgentEnabledCheckbox = document.getElementById('dedicatedAgentEnabled');
const agentElements = document.querySelectorAll('.agent-element');
const agentModelSelect = document.getElementById('agentModelSelect');
const agentModelArgs = document.getElementById('agentModelArgs');
const launchAgentButton = document.getElementById('launchAgentButton');

// Artifact Upload Elements
const fileUploadInput = document.getElementById('fileUploadInput');
const uploadArtifactButton = document.getElementById('uploadArtifactButton');

// New elements for sidebar toggle
const settingsToggleButton = document.getElementById('settingsToggleButton');
const rightSidebar = document.querySelector('.sidebar-container.right');

let isGenerating = false;
let isNamingSession = false; // New state variable

function updateMessageInputPlaceholder() {
    const messageInput = document.getElementById('messageInput');
    if (isNamingSession) {
        messageInput.placeholder = 'Type chat session name...';
    } else {
        messageInput.placeholder = 'Type your message...';
    }
}

let controller = null;
let savingConfig = false;
let currentAiMessageElement = null;
window.appConfigPorts = {}; // Global store for port configurations
let allPromptsContent = {}; // Global variable to store all prompt contents

async function sendMessage() {
    if (isGenerating) {
        console.log('Stop button pressed');
        if (controller) {
            controller.abort();
        }
        return;
    }

    const message = messageInput.value.trim();
    if (message === '' && !isGenerating) return;
    if (isGenerating && message !== '') {
        return;
    }

    if (isNamingSession) {
        if (message === '') {
            showNotification('Session name cannot be empty.');
            return;
        }
        try {
            const response = await fetch('/new-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionName: message }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to create new session: ${errorText}`);
            }

            const data = await response.json();
            if (data.appConfig) {
                updateUIFromConfig(data.appConfig);
            }
            showNotification(`New Session Created: "${message}"`);
            isNamingSession = false; // Switch to chat mode
            updateMessageInputPlaceholder();
            messageInput.value = ''; // Clear the input after naming
            messageInput.focus();
            return; // Stop here, don't send to LLM
        } catch (error) {
            console.error(error);
            showNotification(`Error: ${error.message}`);
            return; // Stop if session creation fails
        }
    }

    // Normal chat message flow starts here
    isGenerating = true;
    sendButton.textContent = 'Stop';
    sendButton.disabled = false;

    const messageElement = document.createElement('p');
    messageElement.classList.add('message', 'user');
    messageElement.innerHTML = renderMarkdown(message);
    messagesContainer.appendChild(messageElement);
    messageInput.value = '';
    messageInput.focus();

    currentAiMessageElement = document.createElement('p');
    currentAiMessageElement.classList.add('message', 'ai');
    messagesContainer.appendChild(currentAiMessageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    const currentMessageProcessedCodeBlockIndices = new Set();

    try {
        controller = new AbortController();
        const response = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: message }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, Response: ${errorText}`);
        }

        let aiText = '';
        const reader = response.body.getReader();
        let jsonBuffer = ''; // Buffer for accumulating JSON data

        while (true) {
            if (!isGenerating && controller && controller.signal.aborted) {
                if (currentAiMessageElement) {
                    currentAiMessageElement.innerHTML = renderMarkdown(aiText + "\n\n*Message generation stopped by user.*");
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
                break;
            }
            const { done, value } = await reader.read();
            if (done) break;

            if (!isGenerating) {
                 if (currentAiMessageElement) {
                    currentAiMessageElement.innerHTML = renderMarkdown(aiText + "\n\n*Message generation stopped by user.*");
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                 }
                 break;
            }

            const chunk = new TextDecoder().decode(value);
            jsonBuffer += chunk;

            // Iteratively process JSON objects from the beginning of jsonBuffer
            let processedThisPass = true;
            while (processedThisPass && jsonBuffer.length > 0) {
                processedThisPass = false;
                jsonBuffer = jsonBuffer.trimStart();

                if (!jsonBuffer.startsWith('{')) {
                    break;
                }

                let balance = 0;
                let endJsonIndex = -1;
                let inString = false;
                for (let i = 0; i < jsonBuffer.length; i++) {
                    const char = jsonBuffer[i];
                    if (char === '\\"' && i + 1 < jsonBuffer.length) { // More robust escaped quote check
                        i++;
                        continue;
                    }
                    if (char === '"') {
                        inString = !inString;
                    }
                    if (!inString) {
                        if (char === '{') balance++;
                        else if (char === '}') balance--;
                    }
                    if (balance === 0 && char === '}' && i > 0) {
                        endJsonIndex = i;
                        break;
                    }
                }

                if (endJsonIndex !== -1) {
                    const potentialJsonString = jsonBuffer.substring(0, endJsonIndex + 1);
                    try {
                        const eventData = JSON.parse(potentialJsonString);

                        if (eventData.type === 'multi_task_plan_proposal' && eventData.plan_id) {
                            console.log("Received multi_task_plan_proposal (iterative parse):", eventData);
                            displayMultiTaskPlanProposal(eventData);
                        } else if (eventData.type === 'delegation_event' && eventData.data) {
                            console.log("Received delegation_event (iterative parse):", eventData);
                            addArtifactToPanel('delegation', eventData.data, `Delegation to ${eventData.data.mcp_alias}`);
                        } else if (eventData.type === 'multi_task_status' && eventData.plan_id) {
                            console.log("Received multi_task_status (iterative parse):", eventData);
                            handleMultiTaskStatusUpdate(eventData);
                        } else if (eventData.type === 'interaction_complete') {
                            console.log("Received interaction_complete (iterative parse) for plan_id:", eventData.plan_id);
                            // DO NOT abort controller. Consume message and continue listening for LLM summary.
                            // jsonBuffer = jsonBuffer.substring(potentialJsonString.length); // This will be done below
                            // processedThisPass = true; // This will be set below
                            // No break here, let it fall through to common buffer consumption.
                        } else if (eventData.delegate_to_agent) {
                            console.log("Ignoring raw LLM delegation signal (iterative parse):", potentialJsonString);
                        } else {
                            console.warn("Unhandled JSON type in iterative parse, not adding to aiText:", eventData.type, eventData);
                        }

                        jsonBuffer = jsonBuffer.substring(potentialJsonString.length);
                        processedThisPass = true;
                        // continue; // Continue the inner `while(processedThisPass)` loop
                    } catch (e) {
                        console.warn("Iterative JSON parse failed on segment:", potentialJsonString.substring(0,200), "Error:", e);
                        break;
                    }
                } else {
                    // No complete JSON object found at the start of the buffer (e.g., it's incomplete)
                    break;
                }
            } // End of inner `while(processedThisPass)` iterative parsing loop

            // Fallback to newline-based processing for any remaining part of jsonBuffer
            // or if iterative parsing didn't consume anything (e.g. buffer was plain text).
            let newlineIndex;
            while ((newlineIndex = jsonBuffer.indexOf('\n')) !== -1) {
                const line = jsonBuffer.substring(0, newlineIndex).trim();
                jsonBuffer = jsonBuffer.substring(newlineIndex + 1);

                if (line) { // Process non-empty lines
                    try {
                        const eventData = JSON.parse(line);
                        if (eventData.type === 'delegation_event' && eventData.data) {
                            addArtifactToPanel('delegation', eventData.data, `Delegation to ${eventData.data.mcp_alias}`);
                        } else if (eventData.type === 'multi_task_plan_proposal' && eventData.plan_id) {
                            console.log("Received multi_task_plan_proposal (newline delimited):", eventData);
                            displayMultiTaskPlanProposal(eventData);
                        } else if (eventData.type === 'multi_task_status' && eventData.plan_id) {
                            console.log("Received multi_task_status (newline delimited):", eventData);
                            handleMultiTaskStatusUpdate(eventData);
                        } else if (eventData.delegate_to_agent) {
                            console.log("Ignoring raw LLM delegation signal for chat display:", line);
                        } else if (eventData.type === 'interaction_complete') {
                            console.log("Received interaction_complete (newline delimited) for plan_id:", eventData.plan_id);
                            // DO NOT abort controller. Consume message and continue listening.
                            // No 'break' here either, the line is consumed, loop continues if more lines.
                        } else {
                            aiText += JSON.stringify(eventData) + '\n';
                        }
                    } catch (e) {
                        aiText += line + '\n';
                    }
                }
            }
            // Update AI message with processed text
            if (currentAiMessageElement) {
                currentAiMessageElement.innerHTML = renderMarkdown(aiText, currentMessageProcessedCodeBlockIndices, false);
            }
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        // After the loop, process any remaining data in jsonBuffer (if it wasn't newline-terminated)
        if (jsonBuffer.trim()) {
            try {
                const eventData = JSON.parse(jsonBuffer.trim());
                 if (eventData.type === 'delegation_event' && eventData.data) {
                    addArtifactToPanel('delegation', eventData.data, `Delegation to ${eventData.data.mcp_alias}`);
                } else if (eventData.type === 'multi_task_plan_proposal' && eventData.plan_id) {
                    console.log("Received multi_task_plan_proposal (final buffer):", eventData);
                    displayMultiTaskPlanProposal(eventData);
                } else if (eventData.type === 'multi_task_status' && eventData.plan_id) {
                    console.log("Received multi_task_status (final buffer):", eventData);
                    handleMultiTaskStatusUpdate(eventData);
                } else if (eventData.delegate_to_agent) {
                     console.log("Ignoring raw LLM delegation signal for chat display (final buffer):", jsonBuffer.trim());
                } else {
                    aiText += JSON.stringify(eventData); // Or handle as needed
                }
            } catch (e) {
                // Remaining data is plain text
                aiText += jsonBuffer;
            }
        }

        if (currentAiMessageElement) {
            currentAiMessageElement.innerHTML = renderMarkdown(aiText, currentMessageProcessedCodeBlockIndices, true); // Final render
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            if (error.message === 'Interaction complete signal received') {
                console.log('Fetch aborted due to interaction_complete signal. UI will be reset by finally block.');
                // Explicitly do nothing to the UI here; finally block handles reset.
            } else {
                // This is likely a user-initiated abort (e.g., clicking the "Stop" button)
                console.log('Fetch aborted by user (AbortError caught).');

                let finalUserStopMessage = "*Message generation stopped by user.*";
                if (currentAiMessageElement) {
                    // Check if the message isn't already there to prevent duplicates
                    if (!currentAiMessageElement.innerHTML.includes(finalUserStopMessage)) {
                        const existingContent = currentAiMessageElement.querySelector('.code-block-wrapper pre code, p')?.innerText || currentAiMessageElement.innerText;
                        currentAiMessageElement.innerHTML = renderMarkdown(existingContent.replace(/\n\n\*Message generation stopped by user\.\*$/, '') + "\n\n" + finalUserStopMessage, null, true);
                    }
                } else if (!isNamingSession) {
                    // Only create a new message element if one doesn't exist AND not in session naming mode
                    const tempAiMessageElement = document.createElement('p');
                    tempAiMessageElement.classList.add('message', 'ai');
                    tempAiMessageElement.innerHTML = renderMarkdown(finalUserStopMessage, null, true);
                    if (messagesContainer) messagesContainer.appendChild(tempAiMessageElement);
                }
            }

            // Common scrolling logic for aborts if not naming session and container exists
            if (!isNamingSession && messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        } else { // Not an AbortError
            console.error('Chat fetch error:', error);
            if (currentAiMessageElement) {
                currentAiMessageElement.innerHTML = renderMarkdown(`*Error: ${error.message}*`, null, true);
            } else {
                const errorMsgElement = document.createElement('p');
                errorMsgElement.classList.add('message', 'ai');
                errorMsgElement.innerHTML = renderMarkdown(`*Error: ${error.message}*`, null, true);
                messagesContainer.appendChild(errorMsgElement);
            }
        }
    } finally {
        isGenerating = false;
        sendButton.textContent = 'Send';
        sendButton.disabled = false;
        controller = null;
        currentAiMessageElement = null;
        messageInput.focus();
    }
}


commandsButton.addEventListener('click', () => {
    window.location.href = '/static/commands.html';
});

if (settingsToggleButton && rightSidebar) {
    settingsToggleButton.addEventListener('click', () => {
        rightSidebar.classList.toggle('sidebar-hidden');
    });
}


function showNotification(message) {
    const notification = document.createElement('div');
    notification.classList.add('notification');
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        if (notification && notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

function updateSelectOptions(selectElement, options, defaultSelect) {
    selectElement.innerHTML = '';
        options.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.text = option;
        selectElement.add(opt);
    });
    if (defaultSelect) {
        selectElement.value = defaultSelect;
   }
}

function updateRagUI() {
    ragElements.forEach(element => element.classList.toggle('show', ragEnabledCheckbox.checked));
}

function updateSpeculativeUI() {
    speculativeElements.forEach(element => element.classList.toggle('show', speculativeEnabledCheckbox.checked));
}

function updateAgentUI() {
    agentElements.forEach(element => element.classList.toggle('show', dedicatedAgentEnabledCheckbox.checked));
}

function renderSessionButtons(sessions, selectedSession) {
    chatSessionList.innerHTML = '';
    for (const key in sessions) {
        const button = document.createElement('button');
        button.textContent = sessions[key];
        button.dataset.sessionId = key;
        if (key == selectedSession) {
            button.classList.add('selected');
        }
        button.addEventListener('click', () => {
            const allButtons = document.querySelectorAll('#chatSessionList button');
            allButtons.forEach(btn => btn.classList.remove('selected'));
            button.classList.add('selected');
            loadSession(key);
        });
        chatSessionList.appendChild(button);
    }
}

async function deleteSession(sessionId) {
    try {
        const response = await fetch('/save-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ deleteSession: sessionId }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, Response: ${errorText}`);
        }
        populateConfig();
        showNotification('Session Deleted');
    } catch (error) {
        console.error(error);
        showNotification(`Error: ${error.message}`);
    }
}

async function loadSession(sessionId) {
    try {
        const response = await fetch('/load-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sessionId: sessionId }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, Response: ${errorText}`);
        }
        const data = await response.json();
        if (data.selectedChatSession) {
            renderSessionButtons(data.appConfig.chatSessions, data.selectedChatSession);
        }
        messagesContainer.innerHTML = ''; // Clear existing messages
        artifactsContent.innerHTML = ''; // Clear existing artifacts

        if (data.messages) {
            data.messages.forEach(message => {
                const messageElement = document.createElement('p');
                messageElement.classList.add('message', message.role);
                if (message.role === 'user') {
                    messageElement.textContent = message.content;
                } else {
                    messageElement.innerHTML = renderMarkdown(message.content);
                }
                messagesContainer.appendChild(messageElement);
            });
        }

        if (data.artifacts && Array.isArray(data.artifacts)) {
            for (const artifact of data.artifacts) {
                if (artifact.artifact_type === 'image' || artifact.artifact_type === 'video') {
                    addArtifactToPanel(artifact.artifact_type, artifact.artifact_path, artifact.artifact_name);
                } else if (artifact.artifact_type === 'code') {
                    try {
                        const codeResponse = await fetch(`/api/v1/artifacts/get_content?path=${encodeURIComponent(artifact.artifact_path)}`);
                        if (codeResponse.ok) {
                            const codeContent = await codeResponse.text();
                            addArtifactToPanel('code', codeContent, artifact.artifact_name);
                        } else {
                            console.error(`Failed to fetch code artifact: ${artifact.artifact_name}, status: ${codeResponse.status}`);
                        }
                    } catch (error) {
                        console.error(`Error fetching code artifact: ${error.message}`);
                    }
                }
            }
        }
        showNotification('Session Loaded');
    } catch (error) {
        console.error(error);
        showNotification(`Error: ${error.message}`);
    }
}

function updateUIFromConfig(config) {
    if (config.chatSessions) {
        renderSessionButtons(config.chatSessions, config.selectedChatSession);
    }
    if (config.selectedChatModel && config.chatModelArgs) {
        const chatModelName = config.selectedChatModel.split(/[\\/]/).pop().replace('.gguf', '');
        chatModelArgs.value = config.chatModelArgs[chatModelName] || '';
    }
    if (config.selectedSpeculativeMainModel) {
        speculativeMainModelSelect.value = config.selectedSpeculativeMainModel;
    }
    if (config.selectedSpeculativeDraftModel && config.speculativeModelArgs) {
        const speculativeModelName = config.selectedSpeculativeDraftModel ? config.selectedSpeculativeDraftModel.split(/[\\/]/).pop().replace('.gguf', '') : '';
        speculativeModelArgs.value = config.speculativeModelArgs[speculativeModelName] || '';
    }
    if (config.selectedEmbeddingModel && config.embeddingModelArgs) {
        const embeddingModelName = config.selectedEmbeddingModel.split(/[\\/]/).pop().replace('.gguf', '');
        embeddingModelArgs.value = config.embeddingModelArgs[embeddingModelName] || '';
    }
    if (config.usePreprocessor !== undefined) {
        usePreprocessorCheckbox.checked = config.usePreprocessor;
    }
}

async function populateConfig() {
    if (savingConfig) return;
    try {
        const response = await fetch('/api/config', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, Response: ${errorText}`);
        }
        const data = await response.json();
        const config = data.appConfig;

        // Store port configurations globally
        window.appConfigPorts = {
            httpPort: config.httpPort,
            artifactsPort: config.artifactsPort,
            embedPort: config.embedPort,
            agentPort: config.agentPort,
            webUiPort: config.webUiPort // Store it, though may not be used by this main UI
        };

        if (config.llamaServerPath) {
            llamaPathInput.value = config.llamaServerPath;
        }
        if (config.modelFolder) {
            modelPathInput.value = config.modelFolder;
        }
        if (config.selectedChatModel && config.chatModelArgs) {
            const chatModelName = config.selectedChatModel.split(/[\\/]/).pop().replace('.gguf', '');
            chatModelArgs.value = config.chatModelArgs[chatModelName] || '';
            chatModelSelect.value = config.selectedChatModel;
        }
        if (config.selectedSpeculativeMainModel) {
            speculativeMainModelSelect.value = config.selectedSpeculativeMainModel;
        }
        if (config.selectedSpeculativeDraftModel) {
            speculativeDraftModelSelect.value = config.selectedSpeculativeDraftModel;
        }
        if (config.speculativeModelArgs) {
            const speculativeModelName = config.selectedSpeculativeDraftModel ? config.selectedSpeculativeDraftModel.split(/[\\/]/).pop().replace('.gguf', '') : '';
            speculativeModelArgs.value = config.speculativeModelArgs[speculativeModelName] || '';
        }
        if (config.selectedEmbeddingModel && config.embeddingModelArgs) {
            const embeddingModelName = config.selectedEmbeddingModel.split(/[\\/]/).pop().replace('.gguf', '');
            embeddingModelArgs.value = config.embeddingModelArgs[embeddingModelName] || '';
            embeddingModelSelect.value = config.selectedEmbeddingModel;
        }
        if (config.ragEnabled !== undefined) {
            ragEnabledCheckbox.checked = config.ragEnabled;
        }
        if (config.speculativeEnabled !== undefined) {
            speculativeEnabledCheckbox.checked = config.speculativeEnabled;
        }
        if (config.chunkSize !== undefined) {
            chunkSizeSlider.value = config.chunkSize;
        }
        if (config.streamingEnabled !== undefined) {
            streamingEnabledCheckbox.checked = config.streamingEnabled;
        }
        if (config.usePreprocessor !== undefined) {
            usePreprocessorCheckbox.checked = config.usePreprocessor;
        }
        if (config.dedicatedAgentEnabled !== undefined) {
            dedicatedAgentEnabledCheckbox.checked = config.dedicatedAgentEnabled;
        }
        if (config.selectedAgentModel && config.agentModelArgs) {
            const agentModelName = config.selectedAgentModel.split(/[\\/]/).pop().replace('.gguf', '');
            agentModelArgs.value = config.agentModelArgs[agentModelName] || '';
            agentModelSelect.value = config.selectedAgentModel;
        }
        updateSliderUI();
        updateUIFromConfig(config);
        if (Object.keys(config.chatSessions).length === 0) {
            // If no sessions exist, create a default one
            await createDefaultSession();
        } else if (config.selectedChatSession) {
            loadSession(config.selectedChatSession);
            isNamingSession = false; // A session is selected, so we are in chat mode
        } else {
            // This case should ideally not be hit if createDefaultSession works, but as a fallback:
            isNamingSession = true; // No session selected, so we are in naming mode
        }
        updateMessageInputPlaceholder();

        // Store all prompts content
        if (data.promptsContent) {
            allPromptsContent = data.promptsContent;
        } else {
            allPromptsContent = {}; // Initialize if not provided
            console.warn("Prompts content map not received from backend.");
        }

        // Updated logic for populating system prompt display
        if (data.prompts && data.prompts.length > 0) {
            updateSelectOptions(systemPromptSelect, data.prompts, config.selectedSystemPrompt || 'default');
        } else {
            // Ensure 'default' is always an option, even if no prompts are found from files
            const defaultOptions = ['default'];
            if (data.prompts && !data.prompts.includes('default')) {
                 // This case should ideally be handled by server ensuring 'default' is always in `data.prompts`
            }
            updateSelectOptions(systemPromptSelect, defaultOptions, 'default');
        }

        // Set the customSystemPrompt textarea content using data.selectedPrompt.
        // data.selectedPrompt is the content of the *currently active* prompt.
        if (data.selectedPrompt !== undefined && data.selectedPrompt !== null) {
            customSystemPrompt.value = data.selectedPrompt;
        } else {
            // Fallback if data.selectedPrompt is not available.
            // Try to get 'default' content from allPromptsContent or use a hardcoded default.
            customSystemPrompt.value = allPromptsContent['default'] || 'You are a helpful assistant.';
        }

    } catch (error) {
        console.error('Error in populateConfig:', error);
        showNotification(`Error: ${error.message}`);
    } finally {
        modelPathInput.dispatchEvent(new Event('input'));
        updateRagUI();
        updateSpeculativeUI();
        updateAgentUI();
    }
}

async function createDefaultSession() {
    try {
        const defaultSessionName = "Default Chat";
        const response = await fetch('/new-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionName: defaultSessionName }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create default session: ${errorText}`);
        }

        const data = await response.json();
        if (data.appConfig) {
            updateUIFromConfig(data.appConfig);
            // Ensure the newly created default session is selected and loaded
            if (data.appConfig.selectedChatSession) {
                loadSession(data.appConfig.selectedChatSession);
                isNamingSession = false; // Now in chat mode
                updateMessageInputPlaceholder();
            }
        }
        showNotification(`Default session "${defaultSessionName}" created.`);
    } catch (error) {
        console.error('Error creating default session:', error);
        showNotification(`Error creating default session: ${error.message}`);
    }
}

// fallbackCopyTextToClipboard function removed as it's no longer needed.

sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
    }
});



newChatButton.addEventListener('click', () => {
    // Clear the visual state
    messagesContainer.innerHTML = '';
    artifactsContent.innerHTML = '';

    // Deselect any currently selected session button
    const allButtons = document.querySelectorAll('#chatSessionList button');
    allButtons.forEach(btn => btn.classList.remove('selected'));

    isNamingSession = true; // Enter session naming mode
    updateMessageInputPlaceholder();
    showNotification('Please type a name for your new chat session.');
    messageInput.focus();
});

launchLLMButton.addEventListener('click', async () => {
    try {
        const launchConfig = {
            llamaServerPath: llamaPathInput.value,
            modelFolder: modelPathInput.value,
            selectedChatModel: chatModelSelect.value,
            chatModelArgs: chatModelSelect.value ? { [chatModelSelect.value.split(/[\\/]/).pop().replace('.gguf', '')]: chatModelArgs.value } : {},
            httpPort: window.appConfigPorts.httpPort || '8081', // Use configured port, fallback if needed
            speculative: false,
        };
        const response = await fetch('/start-llm', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(launchConfig),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, Response: ${errorText}`);
        }
        const aiMessage = document.createElement('p');
        aiMessage.classList.add('message', 'ai');
        aiMessage.textContent = 'LLM Model Launching...';
        messagesContainer.appendChild(aiMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (error) {
        const aiMessage = document.createElement('p');
        aiMessage.classList.add('message', 'ai');
        aiMessage.textContent = `Error: ${error.message}`;
        messagesContainer.appendChild(aiMessage);
    }
});

launchEmbedButton.addEventListener('click', async () => {
    try {
        const launchConfig = {
            llamaServerPath: llamaPathInput.value,
            modelFolder: modelPathInput.value,
            selectedEmbeddingModel: embeddingModelSelect.value,
            embeddingModelArgs: embeddingModelSelect.value ? { [embeddingModelSelect.value.split(/[\\/]/).pop().replace('.gguf', '')]: embeddingModelArgs.value } : {},
            embedPort: window.appConfigPorts.embedPort || '8085', // Use configured port, fallback if needed
        };
        const response = await fetch('/start-embed', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(launchConfig),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, Response: ${errorText}`);
        }
        const aiMessage = document.createElement('p');
        aiMessage.classList.add('message', 'ai');
        aiMessage.textContent = 'Embedding Model Launching...';
        messagesContainer.appendChild(aiMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (error) {
        const aiMessage = document.createElement('p');
        aiMessage.classList.add('message', 'ai');
        aiMessage.textContent = `Error: ${error.message}`;
        messagesContainer.appendChild(aiMessage);
    }
});

let saveTimer;
function saveConfig(config) {
    if (saveTimer) {
        clearTimeout(saveTimer);
    }
    savingConfig = true;
    saveTimer = setTimeout(async () => {
        try {
            const response = await fetch('/save-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(config),
            });
            if (response.ok) {
                if (!savingConfig) {
                   // populateConfig();
                }
            } else {
                const errorText = await response.text();
                showNotification(`Error saving config: ${errorText}`);
            }
        } catch (error) {
            showNotification(`Error: ${error.message}`);
        } finally {
            savingConfig = false;
        }
    }, 500);
}

modelPathInput.addEventListener('input', async () => {
    try {
        const response = await fetch('/find-models', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ modelFolder: modelPathInput.value }),
        });
        if (response.ok) {
            const data = await response.json();
            let selectedSpeculativeMainModel = speculativeMainModelSelect.value;
            let selectedSpeculativeDraftModel = speculativeDraftModelSelect.value;
            let selectedAgentModel = agentModelSelect.value;
            if (data.modelFiles) {
                updateSelectOptions(chatModelSelect, data.modelFiles, chatModelSelect.value);
                updateSelectOptions(embeddingModelSelect, data.modelFiles, embeddingModelSelect.value);
                updateSelectOptions(speculativeMainModelSelect, data.modelFiles, selectedSpeculativeMainModel);
                updateSelectOptions(speculativeDraftModelSelect, data.modelFiles, selectedSpeculativeDraftModel);
                updateSelectOptions(agentModelSelect, data.modelFiles, selectedAgentModel);
            }
        } else {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, Response: ${errorText}`);
        }
        saveConfig({ modelFolder: modelPathInput.value });
    } catch (error) {
        showNotification(`Error: ${error.message}`);
    }
});

chatModelSelect.addEventListener('change', async () => {
    const selectedModel = chatModelSelect.value;
    const modelArgs = await fetchModelArgs(selectedModel);
    chatModelArgs.value = modelArgs || '';
    saveConfig({ selectedChatModel: selectedModel, chatModelArgs: { [selectedModel.split(/[\\/]/).pop().replace('.gguf', '')]: chatModelArgs.value } });
});

async function fetchModelArgs(modelName) {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('Failed to fetch config');
        const data = await response.json();
        const modelKey = modelName.split(/[\\/]/).pop().replace('.gguf', '');
        return data.appConfig.chatModelArgs[modelKey] || '';
    } catch (error) {
        console.error('Error fetching model args:', error);
        return '';
    }
}

embeddingModelSelect.addEventListener('change', async () => {
    saveConfig({ selectedEmbeddingModel: embeddingModelSelect.value });
});

speculativeMainModelSelect.addEventListener('change', async () => {
    saveConfig({ selectedSpeculativeMainModel: speculativeMainModelSelect.value });
});

speculativeDraftModelSelect.addEventListener('change', async () => {
    saveConfig({ selectedSpeculativeDraftModel: speculativeDraftModelSelect.value });
});

llamaPathInput.addEventListener('input', async () => {
    saveConfig({ llamaServerPath: llamaPathInput.value });
});

chatModelArgs.addEventListener('input', async () => {
    saveConfig({ chatModelArgs: chatModelSelect.value ? { [chatModelSelect.value.split(/[\\/]/).pop().replace('.gguf', '')]: chatModelArgs.value } : {} });
});

speculativeModelArgs.addEventListener('input', async () => {
    saveConfig({ speculativeModelArgs: speculativeDraftModelSelect.value ? { [speculativeDraftModelSelect.value.split(/[\\/]/).pop().replace('.gguf', '')]: speculativeModelArgs.value } : {} });
});

embeddingModelArgs.addEventListener('input', async () => {
    saveConfig({ embeddingModelArgs: embeddingModelSelect.value ? { [embeddingModelSelect.value.split(/[\\/]/).pop().replace('.gguf', '')]: embeddingModelArgs.value } : {} });
});

agentModelSelect.addEventListener('change', async () => {
    saveConfig({ selectedAgentModel: agentModelSelect.value });
});

agentModelArgs.addEventListener('input', async () => {
    saveConfig({ agentModelArgs: agentModelSelect.value ? { [agentModelSelect.value.split(/[\\/]/).pop().replace('.gguf', '')]: agentModelArgs.value } : {} });
});

ragEnabledCheckbox.addEventListener('change', async () => {
    saveConfig({
        ragEnabled: ragEnabledCheckbox.checked,
        selectedChatModel: chatModelSelect.value,
        selectedEmbeddingModel: embeddingModelSelect.value
    });
    updateRagUI();
});

speculativeEnabledCheckbox.addEventListener('change', async () => {
    saveConfig({ speculativeEnabled: speculativeEnabledCheckbox.checked });
    updateSpeculativeUI();
});

usePreprocessorCheckbox.addEventListener('change', async () => {
    saveConfig({ usePreprocessor: usePreprocessorCheckbox.checked });
});

dedicatedAgentEnabledCheckbox.addEventListener('change', async () => {
    saveConfig({ dedicatedAgentEnabled: dedicatedAgentEnabledCheckbox.checked });
    updateAgentUI();
});

systemPromptSelect.addEventListener('change', async () => {
    const selectedPromptName = systemPromptSelect.value;

    try {
        if (allPromptsContent && allPromptsContent.hasOwnProperty(selectedPromptName)) {
            customSystemPrompt.value = allPromptsContent[selectedPromptName];
        } else if (selectedPromptName === 'default') {
            customSystemPrompt.value = allPromptsContent['default'] || 'You are a helpful assistant.';
        } else {
            customSystemPrompt.value = 'Prompt content not found.';
            console.warn(`Content for prompt '${selectedPromptName}' not found in allPromptsContent.`);
        }
        saveConfig({ selectedSystemPrompt: selectedPromptName });
        showNotification('System prompt selection changed.');

    } catch (error) {
        console.error('Error in systemPromptSelect change:', error);
        showNotification(`Error updating prompt selection: ${error.message}`);
    }
});

function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

const debouncedCustomPromptSave = debounce(async () => {
    const currentContent = customSystemPrompt.value;
    saveConfig({
        selectedSystemPrompt: "default",
        systemPrompt: currentContent
    });
    if (systemPromptSelect.value !== "default") {
        systemPromptSelect.value = "default";
    }
    if (allPromptsContent) {
        allPromptsContent['default'] = currentContent;
    }
    showNotification('Custom system prompt saved.');
}, 500);

customSystemPrompt.addEventListener('input', debouncedCustomPromptSave);

launchAgentButton.addEventListener('click', async () => {
    try {
        const launchConfig = {
            llamaServerPath: llamaPathInput.value,
            modelFolder: modelPathInput.value,
            selectedAgentModel: agentModelSelect.value,
            agentModelArgs: agentModelSelect.value ? { [agentModelSelect.value.split(/[\\/]/).pop().replace('.gguf', '')]: agentModelArgs.value } : {},
            agentPort: window.appConfigPorts.agentPort || '8082', // Use configured port, fallback if needed
        };
        const response = await fetch('/start-agent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(launchConfig),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, Response: ${errorText}`);
        }
        const aiMessage = document.createElement('p');
        aiMessage.classList.add('message', 'ai');
        aiMessage.textContent = 'Agent Model Launching...';
        messagesContainer.appendChild(aiMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (error) {
        const aiMessage = document.createElement('p');
        aiMessage.classList.add('message', 'ai');
        aiMessage.textContent = `Error: ${error.message}`;
        messagesContainer.appendChild(aiMessage);
    }
});

launchSpeculativeButton.addEventListener('click', async () => {
    try {
        const launchConfig = {
            llamaServerPath: llamaPathInput.value,
            modelFolder: modelPathInput.value,
            selectedChatModel: speculativeMainModelSelect.value,
            selectedSpeculativeDraftModel: speculativeDraftModelSelect.value,
            chatModelArgs: speculativeDraftModelSelect.value ? { [speculativeDraftModelSelect.value.split(/[\\/]/).pop().replace('.gguf', '')]: speculativeModelArgs.value } : {},
            httpPort: window.appConfigPorts.httpPort || '8081', // Use configured port, fallback if needed
            speculative: true,
        };
        const response = await fetch('/start-llm', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(launchConfig),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, Response: ${errorText}`);
        }
        const aiMessage = document.createElement('p');
        aiMessage.classList.add('message', 'ai');
        aiMessage.textContent = 'Speculative Model Launching...';
        messagesContainer.appendChild(aiMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (error) {
        const aiMessage = document.createElement('p');
        aiMessage.classList.add('message', 'ai');
        aiMessage.textContent = `Error: ${error.message}`;
        messagesContainer.appendChild(aiMessage);
    }
});

chunkSizeSlider.addEventListener('input', () => {
    saveConfig({ chunkSize: parseInt(chunkSizeSlider.value, 10) });
});

function updateSliderUI() {
    sliderContainer.classList.toggle('hidden', !streamingEnabledCheckbox.checked);
}

streamingEnabledCheckbox.addEventListener('change', async () => {
    saveConfig({ streamingEnabled: streamingEnabledCheckbox.checked });
    updateSliderUI();
});

window.addEventListener('DOMContentLoaded', () => {
    populateConfig();
    updateMessageInputPlaceholder(); // Set initial placeholder

    chatSessionList.addEventListener('mousedown', function (event) {
        if (event.ctrlKey && event.button === 0) {
            const target = event.target.closest('button');
            if (target) {
                deleteSession(target.dataset.sessionId);
                event.preventDefault();
            }
        }
    });

    setInterval(pollForNewArtifacts, 5000); // Poll every 5 seconds
});

// --- BEGIN ARTIFACT PANEL CODE ---

// Artifacts Panel Elements (ensure these IDs match your HTML)
const artifactsPanel = document.getElementById('artifactsPanel');
const artifactsContent = document.getElementById('artifactsContent');
const toggleArtifactsPanelButton = document.getElementById('toggleArtifactsPanel');

// Toggle Artifacts Panel
if (toggleArtifactsPanelButton && artifactsPanel) {
    toggleArtifactsPanelButton.addEventListener('click', () => {
        console.log("Artifacts toggle button clicked");
        artifactsPanel.classList.toggle('collapsed');
        if (artifactsPanel.classList.contains('collapsed')) {
            toggleArtifactsPanelButton.textContent = '«'; // Open symbol
            toggleArtifactsPanelButton.title = 'Show Artifacts';
        } else {
            toggleArtifactsPanelButton.textContent = '»'; // Close symbol
            toggleArtifactsPanelButton.title = 'Hide Artifacts';
        }
    });
    // Set initial state of the button text based on if panel starts collapsed (optional)
    if (artifactsPanel.classList.contains('collapsed')) {
        toggleArtifactsPanelButton.textContent = '«';
        toggleArtifactsPanelButton.title = 'Show Artifacts';
    } else {
        toggleArtifactsPanelButton.textContent = '»';
        toggleArtifactsPanelButton.title = 'Hide Artifacts';
    }
}

/**
 * Adds an artifact to the artifacts panel.
 * @param {string} type - The type of artifact ('image', 'video', 'code').
 * @param {string} data - The data for the artifact (URL for image/video, code string for code).
 * @param {string} [name] - Optional name or title for the artifact (e.g., filename).
 */
function addArtifactToPanel(type, data, name = '') {
    if (!artifactsContent) {
        console.error('Artifacts content area not found.');
        return;
    }

    const artifactWrapper = document.createElement('div');
    artifactWrapper.classList.add('artifact-item');

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'x';
    deleteButton.classList.add('delete-artifact-button');
    deleteButton.onclick = () => deleteArtifact(name, type, artifactWrapper);
    artifactWrapper.appendChild(deleteButton);

    if (name) {
        const nameElement = document.createElement('p');
        nameElement.textContent = name;
        nameElement.style.fontWeight = 'bold';
        artifactWrapper.appendChild(nameElement);
    }

    let artifactPortToUse = window.appConfigPorts && window.appConfigPorts.artifactsPort ? window.appConfigPorts.artifactsPort : '8083'; // Fallback just in case

    let artifactUrl = data;
    // Check if data is a relative path (starts with '/') and not an absolute URL (doesn't start with http/https/://)
    if (typeof data === 'string' && data.startsWith('/') && !data.startsWith('//') && !data.toLowerCase().startsWith('http')) {
        artifactUrl = `${window.location.protocol}//${window.location.hostname}:${artifactPortToUse}${data}`;
    }

    if (type === 'image') {
        const img = document.createElement('img');
        console.log(`[Debug] Setting image src to: ${artifactUrl}`); // Log the potentially modified URL
        img.src = artifactUrl;
        img.alt = name || 'Image artifact';
        artifactWrapper.appendChild(img);
    } else if (type === 'video') {
        const video = document.createElement('video');
        console.log(`[Debug] Setting video src to: ${artifactUrl}`); // Log the potentially modified URL
        video.src = artifactUrl;
        video.controls = true;
        artifactWrapper.appendChild(video);
    } else if (type === 'code') {
        const codeBlockContainer = document.createElement('div');
        codeBlockContainer.classList.add('code-artifact'); // Use specific class for artifact panel styling

        const codeHeader = document.createElement('div');
        codeHeader.classList.add('code-artifact-header');

        const nameElement = document.createElement('p');
        nameElement.textContent = name;
        nameElement.style.fontWeight = 'bold';
        codeHeader.appendChild(nameElement);

        const copyButton = document.createElement('button');
        copyButton.textContent = 'Copy';
        copyButton.classList.add('copy-code-button');
        copyButton.onclick = () => {
            navigator.clipboard.writeText(data).then(() => {
                showNotification('Copied to clipboard!');
            }).catch(err => {
                console.error('Failed to copy: ', err);
                showNotification('Failed to copy code.');
            });
        };
        codeHeader.appendChild(copyButton);

        codeBlockContainer.appendChild(codeHeader);

        const pre = document.createElement('pre');
        const code = document.createElement('code');
        // Attempt to detect language from name (e.g., file extension)
        const langMatch = name.match(/\.([a-z]+)$/);
        if (langMatch && langMatch[1]) {
            code.className = `language-${langMatch[1]}`;
        }
        code.textContent = data;
        pre.appendChild(code);
        codeBlockContainer.appendChild(pre);

        artifactWrapper.appendChild(codeBlockContainer);
        hljs.highlightElement(code); // Apply highlighting
    } else if (type === 'delegation') {
        const delegationContainer = document.createElement('div');
        delegationContainer.classList.add('delegation-artifact');

        const title = document.createElement('strong');
        title.textContent = 'Agent Delegation:';
        delegationContainer.appendChild(title);

        const aliasElement = document.createElement('p');
        aliasElement.innerHTML = `<strong>Agent Alias:</strong> ${data.mcp_alias || 'N/A'}`;
        delegationContainer.appendChild(aliasElement);

        const taskElement = document.createElement('p');
        taskElement.innerHTML = `<strong>Task:</strong> ${data.task || 'N/A'}`;
        delegationContainer.appendChild(taskElement);

        artifactWrapper.appendChild(delegationContainer);
    } else if (type === 'multi_task_plan_proposal') {
        // data here is the full planArtifact object from the server
        const planProposalContainer = document.createElement('div');
        planProposalContainer.classList.add('multi-task-plan-proposal-artifact');
        planProposalContainer.dataset.planId = data.plan_id; // Store plan_id for later

        const titleElement = document.createElement('h4');
        titleElement.textContent = data.plan_name || 'Proposed Workflow';
        planProposalContainer.appendChild(titleElement);

        const markdownContentDiv = document.createElement('div');
        markdownContentDiv.innerHTML = marked.parse(data.markdown || 'No plan steps provided.');
        planProposalContainer.appendChild(markdownContentDiv);

        const buttonContainer = document.createElement('div');
        buttonContainer.classList.add('plan-buttons');

        const confirmButton = document.createElement('button');
        confirmButton.textContent = 'Confirm';
        confirmButton.classList.add('confirm-plan-button');
        confirmButton.onclick = () => sendPlanConfirmation(data.plan_id, true, planProposalContainer);
        buttonContainer.appendChild(confirmButton);

        const denyButton = document.createElement('button');
        denyButton.textContent = 'Deny';
        denyButton.classList.add('deny-plan-button');
        denyButton.onclick = () => sendPlanConfirmation(data.plan_id, false, planProposalContainer);
        buttonContainer.appendChild(denyButton);

        planProposalContainer.appendChild(buttonContainer);
        artifactWrapper.appendChild(planProposalContainer);
        // No delete button for proposals, they are transient until actioned.
        // We can remove the default delete button if it was added by addArtifactToPanel structure.
        // Or ensure this new content is added instead of inside a generic wrapper that gets a delete button.
        // For now, the outer delete button will be there from addArtifactToPanel structure.
        // This might be okay, or we might want to prevent it.
        // For now, let's remove the default delete button if it was added by addArtifactToPanel
        if (artifactWrapper.firstChild && artifactWrapper.firstChild.classList && artifactWrapper.firstChild.classList.contains('delete-artifact-button')) {
            artifactWrapper.removeChild(artifactWrapper.firstChild);
        }


    } else {
        console.warn('Unknown artifact type:', type);
        const unknown = document.createElement('p');
        unknown.textContent = `Unknown artifact type: ${name || data}`;
        artifactWrapper.appendChild(unknown);
    }

    artifactsContent.appendChild(artifactWrapper);
    artifactsContent.scrollTop = artifactsContent.scrollHeight; // Scroll to the new artifact

    // Ensure panel is visible when artifact is added
    if (artifactsPanel && artifactsPanel.classList.contains('collapsed')) {
        artifactsPanel.classList.remove('collapsed');
        if (toggleArtifactsPanelButton) {
            toggleArtifactsPanelButton.textContent = 'Hide';
        }
    }
}


/**
 * Handles the display of a multi-task plan proposal in the artifacts panel.
 * @param {object} planArtifact - The plan artifact object from the server.
 * Contains plan_id, plan_name, markdown, etc.
 */
function displayMultiTaskPlanProposal(planArtifact) {
    let multiTaskContainer = artifactsContent.querySelector('.multi-task-artifacts');
    if (!multiTaskContainer) {
        multiTaskContainer = document.createElement('div');
        multiTaskContainer.classList.add('multi-task-artifacts');
        artifactsContent.appendChild(multiTaskContainer);
    }

    const artifactWrapper = document.createElement('div');
    artifactWrapper.classList.add('multi-task-artifact');
    artifactWrapper.dataset.planId = planArtifact.plan_id;

    const titleElement = document.createElement('h4');
    titleElement.textContent = planArtifact.plan_name || 'Proposed Workflow';
    artifactWrapper.appendChild(titleElement);

    const markdownContentDiv = document.createElement('div');
    markdownContentDiv.innerHTML = marked.parse(planArtifact.markdown || 'No plan steps provided.');
    artifactWrapper.appendChild(markdownContentDiv);

    const buttonContainer = document.createElement('div');
    buttonContainer.classList.add('plan-buttons');

    const confirmButton = document.createElement('button');
    confirmButton.textContent = 'Confirm';
    confirmButton.classList.add('confirm-plan-button');
    confirmButton.onclick = () => sendPlanConfirmation(planArtifact.plan_id, true, artifactWrapper);
    buttonContainer.appendChild(confirmButton);

    const denyButton = document.createElement('button');
    denyButton.textContent = 'Deny';
    denyButton.classList.add('deny-plan-button');
    denyButton.onclick = () => sendPlanConfirmation(planArtifact.plan_id, false, artifactWrapper);
    buttonContainer.appendChild(denyButton);

    artifactWrapper.appendChild(buttonContainer);
    multiTaskContainer.appendChild(artifactWrapper);

    // Scroll to the new artifact
    multiTaskContainer.scrollTop = multiTaskContainer.scrollHeight;
}

/**
 * Handles incoming multi-task status updates from the server.
 * @param {object} statusData - The status data object from the server.
 * Contains plan_id, task_id (optional), status, message, is_error, final_output (optional).
 */
function handleMultiTaskStatusUpdate(statusData) {
    const multiTaskContainer = artifactsContent.querySelector('.multi-task-artifacts');
    if (!multiTaskContainer) return;

    const planContainer = multiTaskContainer.querySelector(`.multi-task-artifact[data-plan-id="${statusData.plan_id}"]`);
    if (!planContainer) {
        // If the original proposal container isn't there, maybe show a notification
        // or create a new simple artifact item for the status.
        const statusMessage = `Plan ${statusData.plan_id}: ${statusData.message}`;
        showNotification(statusMessage); // General notification
        console.log("Multi-task status update for a plan not currently in artifact panel:", statusData);
        return;
    }

    let statusDisplayArea = planContainer.querySelector('.plan-status-messages');
    if (!statusDisplayArea) {
        statusDisplayArea = document.createElement('div');
        statusDisplayArea.classList.add('plan-status-messages');
        // Insert after title and markdown, before buttons (if buttons still exist)
        const buttonContainer = planContainer.querySelector('.plan-buttons');
        if (buttonContainer) {
            planContainer.insertBefore(statusDisplayArea, buttonContainer);
        } else {
            planContainer.appendChild(statusDisplayArea);
        }
    }

    const statusLine = document.createElement('p');
    statusLine.classList.add('status-line');
    if (statusData.is_error) {
        statusLine.classList.add('error-message');
    } else if (statusData.status === 'completed') {
         statusLine.classList.add('success-message');
    }

    let text = `[${new Date().toLocaleTimeString()}] `;
    if (statusData.task_id) {
        text += `Task (${statusData.task_id}): `;
    }
    text += `${statusData.message}`;
    statusLine.textContent = text;

    // Prepend new status, so latest is at the top of this plan's status messages
    statusDisplayArea.insertBefore(statusLine, statusDisplayArea.firstChild);


    // If plan is completed or fully errored, might want to change the main display
    if (statusData.status === 'completed' || (statusData.status === 'error' && !statusData.task_id)) {
        const buttonContainer = planContainer.querySelector('.plan-buttons');
        if (buttonContainer) {
            buttonContainer.innerHTML = ''; // Clear confirm/deny buttons
            const finalStatusMsg = document.createElement('p');
            finalStatusMsg.textContent = `Plan ${statusData.status}: ${statusData.message}`;
            finalStatusMsg.style.fontWeight = 'bold';
            if (statusData.is_error) finalStatusMsg.style.color = 'red'; else finalStatusMsg.style.color = 'green';
            buttonContainer.appendChild(finalStatusMsg);

            if (statusData.status === 'completed' && statusData.final_output) {
                const outputHeader = document.createElement('strong');
                outputHeader.textContent = "Final Output:";
                buttonContainer.appendChild(outputHeader);
                const outputPre = document.createElement('pre');
                outputPre.style.maxHeight = '150px'; // Make it scrollable
                outputPre.style.overflow = 'auto';
                outputPre.style.backgroundColor = '#f5f5f5';
                outputPre.style.border = '1px solid #ccc';
                outputPre.style.padding = '5px';
                outputPre.textContent = JSON.stringify(statusData.final_output, null, 2);
                buttonContainer.appendChild(outputPre);
            }
        }
    }
}


/**
 * Sends the confirmation or denial of a multi-task plan to the server.
 * @param {string} planID - The ID of the plan.
 * @param {boolean} confirmed - True if confirmed, false if denied.
 * @param {HTMLElement} planContainerElement - The DOM element containing the plan proposal, for UI updates.
 */
async function sendPlanConfirmation(planID, confirmed, planContainerElement) {
    console.log(`Plan ${planID} ${confirmed ? 'confirmed' : 'denied'}. Sending to server...`);

    try {
        const response = await fetch('/confirm-multi-task', { // Ensure this endpoint is created on the server
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: "multi_task_confirmation",
                plan_id: planID,
                confirmed: confirmed
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${errorText}`);
        }

        const result = await response.json();
        if (result.success) {
            showNotification(`Plan ${confirmed ? 'confirmed' : 'denied'}. Status: ${result.message}`);
            // Update UI: Disable buttons and show status
            const buttons = planContainerElement.querySelectorAll('.plan-buttons button');
            buttons.forEach(button => button.disabled = true);

            const statusMessage = document.createElement('p');
            statusMessage.textContent = `Plan ${confirmed ? 'Confirmed & Started' : 'Denied'}. ${result.message || ''}`;
            statusMessage.style.fontWeight = 'bold';
            if (!confirmed) statusMessage.style.color = 'red';

            const buttonContainer = planContainerElement.querySelector('.plan-buttons');
            if (buttonContainer) {
                 buttonContainer.innerHTML = ''; // Clear buttons
                 buttonContainer.appendChild(statusMessage);
            } else { // Fallback if button container not found
                planContainerElement.appendChild(statusMessage);
            }

        } else {
            showNotification(`Failed to ${confirmed ? 'confirm' : 'deny'} plan: ${result.message}`);
        }
    } catch (error) {
        console.error('Error sending plan confirmation:', error);
        showNotification(`Error: ${error.message}`);
    }
}


// New renderMarkdown function
function renderMarkdown(text, processedCodeBlockIndicesSet = null, finalRender = false) {
    // Corrected regex: removed the erroneous space after \.
    const imageRegex = /!\[(.*?)\]\((.*?\.(?:png|jpg|jpeg|gif|bmp|webp))\)/gi;
    const videoRegex = /!\[(.*?)\]\((.*?\.(?:mp4|webm|ogg))\)/gi;
    const CODE_BLOCK_LINE_THRESHOLD = 15;

    let processedText = text;

    processedText = processedText.replace(imageRegex, (match, alt, src) => {
        addArtifactToPanel('image', src, alt || src.split('/').pop());
        return `*Image displayed in artifacts panel: ${alt || src.split('/').pop()}*`;
    });

    processedText = processedText.replace(videoRegex, (match, alt, src) => {
        addArtifactToPanel('video', src, alt || src.split('/').pop());
        return `*Video displayed in artifacts panel: ${alt || src.split('/').pop()}*`;
    });

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = marked.parse(processedText);

    tempDiv.querySelectorAll('pre').forEach((preElement, index) => { // Added index parameter
        const codeElement = preElement.querySelector('code');
        if (codeElement) {
            const codeText = codeElement.innerText;
            const lineCount = codeText.split('\n').length;

            // Check if this code block (by index) has already been artifacted in the current stream
            if (processedCodeBlockIndicesSet && processedCodeBlockIndicesSet.has(index)) {
                const placeholder = document.createElement('p');
                placeholder.classList.add('italic-small');
                placeholder.textContent = `*Large code block moved to artifacts panel.*`;
                if (preElement.parentNode) {
                    preElement.parentNode.replaceChild(placeholder, preElement);
                }
            } else if (lineCount > CODE_BLOCK_LINE_THRESHOLD) {
                if (finalRender) { // Only move to artifact on the final render pass
                    let languageName = '';
                    const languageClass = codeElement.className.match(/language-(\S+)/);
                    if (languageClass && languageClass[1]) {
                        languageName = languageClass[1];
                    }
                    addArtifactToPanel('code', codeText, `Code Block (${languageName || 'text'})`);

                    if (processedCodeBlockIndicesSet) {
                        processedCodeBlockIndicesSet.add(index); // Add index to the Set
                    }

                    const placeholder = document.createElement('p');
                    placeholder.classList.add('italic-small');
                    placeholder.textContent = `*Large code block moved to artifacts panel.*`;
                    if (preElement.parentNode) {
                        preElement.parentNode.replaceChild(placeholder, preElement);
                    }
                } else {
                    // If it's not the final render, just highlight and display in chat
                    const wrapper = document.createElement('div');
                    wrapper.classList.add('code-block-wrapper');
                    if (preElement.parentNode) {
                        preElement.parentNode.insertBefore(wrapper, preElement);
                        wrapper.appendChild(preElement);
                        hljs.highlightElement(codeElement);
                    }
                }
            } else {
                const wrapper = document.createElement('div');
                wrapper.classList.add('code-block-wrapper');
                if (preElement.parentNode) {
                    preElement.parentNode.insertBefore(wrapper, preElement);
                    wrapper.appendChild(preElement);
                    hljs.highlightElement(codeElement);
                }
            }
        }
    });

    tempDiv.querySelectorAll('code').forEach(el => {
        if (!el.closest('pre') && !el.closest('.code-artifact')) {
            if (document.body.contains(el)) { // Check if element is still in DOM
                hljs.highlightElement(el);
            }
        }
    });
    return tempDiv.innerHTML;
}

// --- BEGIN ARTIFACT UPLOAD CODE ---
if (uploadArtifactButton && fileUploadInput) {
    uploadArtifactButton.addEventListener('click', () => {
        fileUploadInput.click(); // Trigger the hidden file input
    });

    fileUploadInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        // Basic validation (can be expanded)
        const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'video/mp4', 'video/webm', 'video/ogg'];
        if (!allowedTypes.includes(file.type)) {
            showNotification(`Unsupported file type: ${file.type}. Please upload images or videos.`);
            fileUploadInput.value = ''; // Clear the input
            return;
        }

        const formData = new FormData();
        formData.append('artifactFile', file); // 'artifactFile' should match the name expected by backend

        try {
            const response = await fetch('/upload-artifact', {
                method: 'POST',
                body: formData,
                // Headers are not explicitly set for 'Content-Type' when using FormData;
                // the browser sets it to 'multipart/form-data' with the correct boundary.
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Upload failed: ${errorText}`);
            }

            const result = await response.json();

            if (result.success && result.artifact_path && result.artifact_name) {
                // Construct markdown and send message
                const markdown = `![${result.artifact_name}](${result.artifact_path})`;
                messageInput.value = markdown; // Put markdown in input
                sendMessage(); // Send it - this will also trigger renderMarkdown and add to panel
                showNotification(`Uploaded ${result.artifact_name}`);
            } else {
                throw new Error('Upload response was not successful or missing data.');
            }

        } catch (error) {
            console.error('Error uploading artifact:', error);
            showNotification(`Error uploading artifact: ${error.message}`);
        } finally {
            fileUploadInput.value = ''; // Clear the input for the next upload
        }
    });
}
// --- END ARTIFACT UPLOAD CODE ---

async function deleteArtifact(artifactName, artifactType, artifactElement) {
    try {
        const response = await fetch('/delete-artifact', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                artifact_name: artifactName,
                artifact_type: artifactType
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to delete artifact: ${errorText}`);
        }

        const result = await response.json();
        if (result.success) {
            artifactElement.remove();
            showNotification(`Artifact "${artifactName}" deleted.`);
        } else {
            throw new Error(result.error || 'Unknown error from server.');
        }
    } catch (error) {
        console.error('Error deleting artifact:', error);
        showNotification(`Error: ${error.message}`);
    }
}

async function pollForNewArtifacts() {
    try {
        const response = await fetch('/list-artifacts');
        if (!response.ok) {
            if (response.status !== 404) {
                const errorText = await response.text();
                console.error(`Failed to list artifacts: ${errorText}`);
            }
            return;
        }

        let artifactNames = await response.json(); //this is where the polling is bugging

        if (!artifactNames) {
            artifactNames = []; // Ensure it's an array even if null
        }

        if (!Array.isArray(artifactNames)) {
            console.error('pollForNewArtifacts: response is not an array', artifactNames);
            return;
        }

        const existingArtifacts = new Set();
        document.querySelectorAll('.artifact-item').forEach(item => {
            const nameElement = item.querySelector('p');
            if (nameElement) {
                existingArtifacts.add(nameElement.textContent);
            }
        });

        const selectedSessionButton = document.querySelector('#chatSessionList button.selected');
        if (!selectedSessionButton) return; // No active session
        const sessionId = selectedSessionButton.dataset.sessionId;

        for (const name in artifactNames) {
            if (!existingArtifacts.has(name)) {
                const ext = name.split('.').pop().toLowerCase();
                let type = 'file';
                if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext)) {
                    type = 'image';
                } else if (['mp4', 'webm', 'ogg'].includes(ext)) {
                    type = 'video';
                }

                if (type !== 'file') {
                    const artifactPortToUse = window.appConfigPorts.artifactsPort || '8083';
                    const artifactPath = `${window.location.protocol}//${window.location.hostname}:${artifactPortToUse}/artifacts/${sessionId}/${name}`;
                    addArtifactToPanel(type, artifactPath, name);
                }
            }
        }
    } catch (error) {
        console.error('Error polling for new artifacts:', error);
    }
}

// --- END ARTIFACT PANEL CODE ---

[end of local-llm-chat/frontend/static/script.js]
