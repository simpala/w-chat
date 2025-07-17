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
    StopStream
} from '../wailsjs/go/main/App';
import {
    EventsOn
} from '../wailsjs/runtime';
import * as runtime from '../wailsjs/runtime';

document.addEventListener('DOMContentLoaded', () => {
    const newChatButton = document.getElementById('newChatButton');
    const chatSessionList = document.getElementById('chatSessionList');
    const sendButton = document.getElementById('sendButton');
    const messageInput = document.getElementById('messageInput');
    const stopButton = document.getElementById('stopButton');
    const chatWindow = document.querySelector('.messages-container');

    let currentSessionId = null;
    let messages = [];

    function renderMessages() {
        chatWindow.innerHTML = '';
        messages.forEach(message => {
            addMessageToChatWindow(message.role, message.content);
        });
    }

    function addMessageToChatWindow(sender, messageContent) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender);

        if (sender === 'assistant') {
            const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
            let lastIndex = 0;
            let match;

            while ((match = thinkRegex.exec(messageContent)) !== null) {
                // Add text before the <think> tag
                if (match.index > lastIndex) {
                    const textNode = document.createTextNode(messageContent.substring(lastIndex, match.index));
                    messageElement.appendChild(textNode);
                }

                // Add the <think> tag content in its own container
                const thinkElement = document.createElement('div');
                thinkElement.classList.add('thought');
                thinkElement.textContent = match[1];
                messageElement.appendChild(thinkElement);

                lastIndex = thinkRegex.lastIndex;
            }

            // Add any remaining text after the last <think> tag
            if (lastIndex < messageContent.length) {
                const textNode = document.createTextNode(messageContent.substring(lastIndex));
                messageElement.appendChild(textNode);
            }
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
                        if (e.ctrlKey) {
                            const sessionId = parseInt(sessionButton.dataset.sessionId);
                            DeleteChatSession(sessionId).then(() => {
                                loadSessions();
                            });
                        } else {
                            currentSessionId = parseInt(sessionButton.dataset.sessionId);
                            console.log("Loading history for session:", currentSessionId);
                            LoadChatHistory(currentSessionId).then(history => {
                                console.log("History loaded:", history);
                                messages = history.map(m => ({ role: m.Role, content: m.Content }));
                                renderMessages();
                            }).catch(error => {
                                console.error("Error loading chat history:", error);
                            });
                        }
                    });
                    chatSessionList.appendChild(sessionButton);
                });
            }
        });
    }

    function handleSendMessage() {
        const messageContent = messageInput.value.trim();
        if (messageContent === '' || currentSessionId === null) {
            return;
        }

        messages.push({ role: 'user', content: messageContent });
        renderMessages();
        messageInput.value = '';

        sendButton.style.display = 'none';
        stopButton.style.display = 'block';

        let assistantResponse = '';
        messages.push({ role: 'assistant', content: '' });

        const offStream = EventsOn("chat-stream", function(data) {
            if (data === null) {
                sendButton.style.display = 'block';
                stopButton.style.display = 'none';
                offStream();
                return;
            }
            assistantResponse += data;
            messages[messages.length - 1].content = assistantResponse;
            renderMessages();
        });

        sendMessage(currentSessionId, messageContent).catch(error => {
            console.error("Error sending message:", error);
            messages.pop(); // Remove the empty assistant message
            messages.push({ role: 'error', content: 'Failed to send message.' });
            renderMessages();
            sendButton.style.display = 'block';
            stopButton.style.display = 'none';
            offStream();
        });
    }

    sendButton.addEventListener('click', (e) => {
        e.preventDefault();
        handleSendMessage();
    });

    stopButton.addEventListener('click', (e) => {
        e.preventDefault();
        StopStream();
    });

    newChatButton.addEventListener('click', (e) => {
        e.preventDefault();
        NewChat().then((newId) => {
            currentSessionId = newId;
            messages = [];
            renderMessages();
            loadSessions();
        }).catch(error => {
            console.error("Error creating new chat:", error);
        });
    });

    // Initial setup
    loadSessions();
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
