// This file provides a conceptual example of how to interact with the Go ArtifactService
// from the Wails frontend using TypeScript.

// 1. Import the generated Go bindings from Wails.
// These are automatically created when you build your Wails application.
import * as GoArtifacts from '../../wailsjs/go/artifacts/ArtifactService';
import * as GoRuntime from '../../wailsjs/runtime/runtime';

// Assume 'currentSessionID' is available in the frontend's state.
const currentSessionID = "default-session-123";

// --- DOM Ready / Component Mounted ---

// This function should be called when the frontend application is ready.
// e.g., inside a DOMContentLoaded event listener or a UI framework's
// `mounted` or `useEffect` lifecycle hook.
function onFrontendReady() {
    console.log("Frontend is ready. Setting up artifact listeners and loading initial artifacts.");

    // Setup listeners for events from the Go backend.
    setupArtifactEventListeners();

    // Load all persistent artifacts that already exist for this session.
    loadInitialArtifacts();
}

// --- Function to Load Initial Artifacts ---

async function loadInitialArtifacts() {
    const artifactsPanel = document.getElementById('artifacts-panel');
    if (!artifactsPanel) {
        console.error("Artifact panel element not found!");
        return;
    }

    try {
        console.log(`Requesting initial persistent artifacts for session: ${currentSessionID}`);
        // 2. Call the Go method to get the list of persistent artifacts.
        const persistentArtifacts = await GoArtifacts.ListArtifacts(currentSessionID);

        console.log(`Received ${persistentArtifacts.length} initial artifacts.`);
        // Clear the panel before adding new items.
        artifactsPanel.innerHTML = '';
        for (const artifact of persistentArtifacts) {
            const artifactElement = createArtifactElement(artifact);
            if (artifactElement) {
                artifactsPanel.appendChild(artifactElement);
            }
        }
    } catch (error) {
        console.error("Error loading initial artifacts:", error);
    }
}

// --- Event Listeners for Real-Time Updates ---

function setupArtifactEventListeners() {
    // 3. Listen for the 'newArtifactAdded' event from Go.
    // The event carries the ID of the new artifact.
    GoRuntime.EventsOn("newArtifactAdded", async (artifactID: string) => {
        console.log(`Received new artifact event for ID: ${artifactID}`);
        try {
            // Fetch the full artifact details from the backend.
            const artifact = await GoArtifacts.GetArtifact(artifactID);
            if (artifact) {
                const artifactsPanel = document.getElementById('artifacts-panel');
                const artifactElement = createArtifactElement(artifact);
                if (artifactsPanel && artifactElement) {
                    artifactsPanel.appendChild(artifactElement);
                    // Optional: scroll to the new artifact.
                    artifactElement.scrollIntoView({ behavior: 'smooth' });
                }
            }
        } catch (error) {
            console.error(`Error fetching details for new artifact ${artifactID}:`, error);
        }
    });

    // 4. Listen for the 'artifactDeleted' event from Go.
    GoRuntime.EventsOn("artifactDeleted", (artifactID: string) => {
        console.log(`Received delete event for artifact ID: ${artifactID}`);
        const elementToRemove = document.getElementById(`artifact-${artifactID}`);
        if (elementToRemove) {
            elementToRemove.remove();
        }
    });
}

// --- DOM Manipulation ---

// Creates the appropriate HTML element for a given artifact.
function createArtifactElement(artifact: GoArtifacts.Artifact): HTMLElement | null {
    const container = document.createElement('div');
    container.id = `artifact-${artifact.id}`;
    container.className = `artifact-container artifact-type-${artifact.type.toLowerCase()}`;

    let contentElement: HTMLElement;

    // 5. Render the artifact based on its type.
    switch (artifact.type) {
        case "IMAGE":
            contentElement = document.createElement('img');
            // Wails allows direct file access via 'file://' scheme.
            contentElement.src = `file://${artifact.contentPath}`;
            contentElement.alt = "Generated Image Artifact";
            break;

        case "VIDEO":
            contentElement = document.createElement('video');
            (contentElement as HTMLVideoElement).src = `file://${artifact.contentPath}`;
            (contentElement as HTMLVideoElement).controls = true;
            break;

        case "TOOL_NOTIFICATION":
            contentElement = document.createElement('p');
            contentElement.className = 'tool-notification';
            // Assumes the message is stored in metadata.
            contentElement.textContent = artifact.metadata['message'] || 'Tool notification';
            break;

        default:
            console.warn(`Unknown artifact type: ${artifact.type}`);
            contentElement = document.createElement('p');
            contentElement.textContent = `Unsupported artifact type: ${artifact.type}`;
            break;
    }
    container.appendChild(contentElement);

    // 6. Add a delete button to every artifact.
    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.className = 'delete-button';
    deleteButton.onclick = () => {
        // Call the Go backend method to delete the artifact.
        GoArtifacts.DeleteArtifact(artifact.id)
            .catch(err => console.error(`Failed to delete artifact ${artifact.id}:`, err));
    };
    container.appendChild(deleteButton);

    return container;
}

// --- Example Usage ---
// This would be triggered by your application's initialization logic.
document.addEventListener('DOMContentLoaded', onFrontendReady);
