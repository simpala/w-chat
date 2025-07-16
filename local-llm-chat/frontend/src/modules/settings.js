import {
    GetModels,
    LoadSettings,
    SaveSettings
} from '../../wailsjs/go/main/App';
import Fuse from 'fuse.js';

export let fuse;

export function initFuzzySearch(data) {
    const options = {
        keys: ['name'],
        includeScore: true,
        threshold: 0.2,
    };
    fuse = new Fuse(data, options);
    window.runtime.LogInfo("Fuzzy search initialized with data:", data);
}

export async function handleModelSelection(modelName, modelPath) {
    document.getElementById('chatModelSelectInput').value = modelName;
    document.getElementById('selectedModelPath').value = modelPath;
    document.getElementById('chatModelSelectList').classList.add('select-hide');

    window.runtime.LogInfo("Attempting to load settings for model selection...");
    const settingsStr = await LoadSettings();
    window.runtime.LogInfo("Settings loaded for model selection:", settingsStr);
    const settings = JSON.parse(settingsStr) || {};

    document.getElementById('chatModelArgs').value = (settings.model_args && settings.model_args[modelName]) || '';

    await saveSettings();
}

export function populateModelList(models) {
    const chatModelSelectList = document.getElementById('chatModelSelectList');
    chatModelSelectList.innerHTML = '';
    models.forEach(model => {
        const modelName = model.split('/').pop();
        const option = document.createElement('div');
        option.textContent = modelName;
        option.setAttribute('data-path', model);
        option.addEventListener('click', () => handleModelSelection(modelName, model));
        chatModelSelectList.appendChild(option);
    });
    window.runtime.LogInfo("Model list populated with:", models.length, "models.");
}

export async function saveSettings() {
    const selectedModel = document.getElementById('chatModelSelectInput').value;

    try {
        window.runtime.LogInfo("Attempting to load settings for saving...");
        const settingsStr = await LoadSettings();
        window.runtime.LogInfo("Settings loaded for saving:", settingsStr);
        const settings = JSON.parse(settingsStr) || {};
        if (!settings.model_args) {
            settings.model_args = {};
        }

        settings.llama_cpp_dir = document.getElementById('llamaPathInput').value;
        settings.models_dir = document.getElementById('modelPathInput').value;
        settings.selected_model = selectedModel;
        settings.model_args[selectedModel] = document.getElementById('chatModelArgs').value;

        window.runtime.LogInfo("Attempting to save settings:", settings);
        await SaveSettings(JSON.stringify(settings));
        window.runtime.LogInfo("Settings saved successfully.");
    } catch (error) {
        window.runtime.LogInfo("Error saving settings:", error);
    }
}

export async function loadSettings() {
    try {
        window.runtime.LogInfo("Attempting to load settings from Go backend...");
        const settingsStr = await LoadSettings();
        window.runtime.LogInfo("Settings loaded:", settingsStr);
        if (settingsStr) {
            const settings = JSON.parse(settingsStr);
            document.getElementById('llamaPathInput').value = settings.llama_cpp_dir || '';
            document.getElementById('modelPathInput').value = settings.models_dir || '';
            document.getElementById('chatModelSelectInput').value = settings.selected_model || '';
            if (settings.selected_model) {
                document.getElementById('selectedModelPath').value = settings.selected_model;
            }
            if (settings.model_args && settings.selected_model) {
                document.getElementById('chatModelArgs').value = settings.model_args[settings.selected_model] || '';
            }
            if (settings.models_dir) {
                try {
                    window.runtime.LogInfo("Attempting to get models from Go backend...");
                    const models = await GetModels();
                    window.runtime.LogInfo("Models received:", models);
                    populateModelList(models);
                    initFuzzySearch(models.map(model => ({
                        name: model.split('/').pop(),
                        path: model
                    })));
                } catch (error) {
                    window.runtime.LogInfo("Error getting models:", error);
                }
            }
        }
    } catch (error) {
        window.runtime.LogInfo("Error loading settings:", error);
    }
}