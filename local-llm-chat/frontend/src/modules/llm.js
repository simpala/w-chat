import {
    LaunchLLM as GoLaunchLLM,
    HealthCheck,
    ShutdownLLM
} from '../../wailsjs/go/main/App';

export async function launchLLM() {
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const modelName = document.getElementById('chatModelSelectInput').value;

    messageInput.placeholder = `${modelName} loading...`;
    messageInput.classList.add('loading-placeholder');
    sendButton.disabled = true;

    try {
        const status = await HealthCheck();
        if (status === 'ok') {
            await ShutdownLLM();
            // Wait a bit for the server to shut down
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    } catch (error) {
        // Server is not running, which is fine
    }

    const llamaPath = document.getElementById('llamaPathInput').value;
    const modelPath = document.getElementById('selectedModelPath').value;
    const cleanedModelPath = modelPath.replace(/^"|"$/g, ''); // Remove existing quotes
    const modelArgs = document.getElementById('chatModelArgs').value;

    if (!llamaPath || !modelPath) {
        alert('Please select a Llama.cpp directory and a model.');
        messageInput.placeholder = "no model loaded...";
        messageInput.classList.remove('loading-placeholder');
        return;
    }

    const command = `${llamaPath}/llama-server -m ${cleanedModelPath} ${modelArgs}`;
    try {
        window.runtime.LogInfo("Attempting to launch LLM with command:", command);
        await GoLaunchLLM(command);

        const healthCheckInterval = setInterval(async () => {
            try {
                const status = await HealthCheck();
                if (status === 'ok') {
                    clearInterval(healthCheckInterval);
                    messageInput.placeholder = `type your message to ${modelName}`;
                    sendButton.disabled = false;
                    messageInput.classList.remove('loading-placeholder');
                }
            } catch (error) {
                // Keep polling
            }
        }, 1000);

    } catch (error) {
        window.runtime.LogInfo("Failed to launch LLM server:", error);
        alert(`Failed to launch LLM server: ${error}`);
        messageInput.placeholder = "no model loaded...";
        messageInput.classList.remove('loading-placeholder');
    }
}