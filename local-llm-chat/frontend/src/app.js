console.log("app.js loaded");
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

    let currentSessionId = localStorage.getItem('currentSessionId') || null;
    let messages = [];
    let isStreaming = false;

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
        LoadChatHistory(currentSessionId).then(history => {
            console.log("Received history from backend:", history);
            if (history) {
                messages = history.map(m => ({
                    role: m.Role,
                    content: m.Content
                }));
                console.log("Mapped messages:", messages);
            } else {
                messages = [];
                console.log("History is null or undefined, clearing messages.");
            }
            renderMessages();
            updateActiveSessionButton();
        }).catch(error => {
            console.error("Error loading chat history:", error);
        });
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
        const messageContent = messageInput.value.trim();
        if (messageContent === '' || currentSessionId === null) {
            return;
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

    EventsOn("chat-stream", function(data) {
        if (data === null) {
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

        lastMessageBubble.innerHTML = '';
        const parsedParts = parseStreamedContent(assistantResponse);
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
        scrollToBottom();
    });

    // Initial setup
    loadSessions();
    if (currentSessionId) {
        switchSession(parseInt(currentSessionId));
    }
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
