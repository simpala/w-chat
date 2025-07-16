import {
    LaunchLLM as GoLaunchLLM
} from '../../wailsjs/go/main/App';

export async function launchLLM() {
    const llamaPath = document.getElementById('llamaPathInput').value;
    const modelPath = document.getElementById('selectedModelPath').value;
    const cleanedModelPath = modelPath.replace(/^"|"$/g, ''); // Remove existing quotes
    const modelArgs = document.getElementById('chatModelArgs').value;

    if (!llamaPath || !modelPath) {
        alert('Please select a Llama.cpp directory and a model.');
        return;
    }

    const command = `${llamaPath}/llama-server -m ${cleanedModelPath} ${modelArgs}`;
    try {
        window.runtime.LogInfo("Attempting to launch LLM with command:", command);
        const result = await GoLaunchLLM(command);
        window.runtime.LogInfo("LLM launch result:", result);
        alert(result);
    } catch (error) {
        window.runtime.LogInfo("Failed to launch LLM server:", error);
        alert(`Failed to launch LLM server: ${error}`);
    }
}