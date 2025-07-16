import {
    initFuzzySearch,
    loadSettings,
    saveSettings,
    handleModelSelection,
    populateModelList,
    fuse
} from './modules/settings.js';
import { launchLLM } from './modules/llm.js';
import { NewChat, LoadChatSessions } from '../wailsjs/go/main/App';

document.addEventListener('DOMContentLoaded', () => {
    const newChatButton = document.getElementById('newChatButton');
    const chatSessionList = document.getElementById('chatSessionList');

    function loadSessions() {
        LoadChatSessions().then(sessions => {
            chatSessionList.innerHTML = '';
            sessions.forEach(session => {
                const sessionButton = document.createElement('button');
                sessionButton.textContent = session.name;
                sessionButton.dataset.sessionId = session.id;
                chatSessionList.appendChild(sessionButton);
            });
        });
    }

    newChatButton.addEventListener('click', () => {
        NewChat().then(() => {
            loadSessions();
        });
    });

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

    // Event listener for the model select input to filter the list
    document.getElementById('chatModelSelectInput').addEventListener('input', (e) => {
        const query = e.target.value;
        window.runtime.LogInfo("Fuzzy search query:", query);
        const chatModelSelectList = document.getElementById('chatModelSelectList');
        if (query) {
            const results = fuse.search(query);
            window.runtime.LogInfo("Fuzzy search results:", results);
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

    // Event listener to hide the dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const chatModelSelect = document.querySelector('.custom-select');
        if (!chatModelSelect.contains(e.target)) {
            document.getElementById('chatModelSelectList').classList.add('select-hide');
        }
    });

    // Event listener to show the dropdown when clicking inside
    document.getElementById('chatModelSelectInput').addEventListener('click', () => {
        document.getElementById('chatModelSelectList').classList.remove('select-hide');
    });

    // Event listeners for settings inputs
    document.getElementById('llamaPathInput').addEventListener('change', saveSettings);
    document.getElementById('modelPathInput').addEventListener('change', saveSettings);
    document.getElementById('chatModelArgs').addEventListener('change', saveSettings);

    document.getElementById('launchLLMButton').addEventListener('click', launchLLM);

    // Initialize fuzzy search and load settings on page load
    window.runtime.LogInfo("Initializing fuzzy search and loading settings on DOMContentLoaded.");
    initFuzzySearch([]);
    loadSettings();
});