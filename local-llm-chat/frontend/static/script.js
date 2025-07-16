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
