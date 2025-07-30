// modules/settings.js

import {
    GetModels,
    LoadSettings as GoLoadSettings, // Alias to avoid conflict with local loadSettings
    SaveSettings as GoSaveSettings // Alias to avoid conflict with local saveSettings
} from '../../wailsjs/go/main/App';
import Fuse from 'fuse.js';
import * as runtime from '../../wailsjs/runtime'; // Import runtime for logging
import { getModelName } from './path-utils.js';

export let fuse;
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

export function initFuzzySearch(data) {
    const options = {
        keys: ['name'],
        includeScore: true,
        threshold: 0.2,
    };
    fuse = new Fuse(data, options);
    runtime.LogInfo("DEBUG: settings.js: Fuzzy search initialized with data:", data);
    runtime.LogInfo("DEBUG: settings.js: Fuzzy search data (first 5 items):", data.slice(0, 5)); // Log a slice to avoid huge output
    runtime.LogInfo("DEBUG: settings.js: Fuzzy search options:", options);
}

// Renamed from handleModelSelection to be more specific, now calls saveAllSettings
export async function handleModelSelection(modelName, modelPath) {
    runtime.LogInfo(`DEBUG: settings.js: Handling model selection: ${modelName}, Path: ${modelPath}`);
    document.getElementById('chatModelSelectInput').value = modelName; // Set the displayed name
    document.getElementById('selectedModelPath').value = modelPath; // Set the hidden full path
    document.getElementById('chatModelSelectList').classList.add('select-hide');

    // Update currentSettings with the new selection
    currentSettings.selected_model = modelPath;

    // Load the arguments for the newly selected model
    const modelArgsInput = document.getElementById('chatModelArgs');
    if (currentSettings.model_settings && currentSettings.model_settings[modelPath]) {
        modelArgsInput.value = currentSettings.model_settings[modelPath].args || '';
        runtime.LogInfo(`DEBUG: settings.js: Loaded args for ${modelName}: "${modelArgsInput.value}"`);
    } else {
        modelArgsInput.value = ''; // Clear args if none are saved for this model
        runtime.LogInfo(`DEBUG: settings.js: No args found for ${modelName}, clearing input.`);
    }

    // Save the change of the selected model
    await saveAllSettings();
    runtime.LogInfo("DEBUG: settings.js: Model selection saved.");
}


export async function populateModelList(models) {
    const chatModelSelectList = document.getElementById('chatModelSelectList');
    chatModelSelectList.innerHTML = '';
    models.forEach(model => {
        const modelName = getModelName(model);
        const option = document.createElement('div');
        option.textContent = modelName;
        option.setAttribute('data-path', model);
        option.addEventListener('click', () => handleModelSelection(modelName, model));
        chatModelSelectList.appendChild(option);
    });
    runtime.LogInfo("DEBUG: settings.js: Model list populated with:", models.length, "models.");
}

export async function saveAllSettings() {
    runtime.LogInfo("DEBUG: settings.js: saveAllSettings started.");

    currentSettings.llama_cpp_dir = document.getElementById('llamaPathInput').value;
    currentSettings.models_dir = document.getElementById('modelPathInput').value;
    currentSettings.selected_model = document.getElementById('selectedModelPath').value;

    const currentModelPath = document.getElementById('selectedModelPath').value;
    if (currentModelPath) {
        if (!currentSettings.model_settings) {
            currentSettings.model_settings = {};
        }
        if (!currentSettings.model_settings[currentModelPath]) {
            currentSettings.model_settings[currentModelPath] = {};
        }
        currentSettings.model_settings[currentModelPath].args = document.getElementById('chatModelArgs').value;
        runtime.LogInfo(`DEBUG: settings.js: Staged args for ${currentModelPath}: "${currentSettings.model_settings[currentModelPath].args}"`);
    }

    currentSettings.theme = document.body.dataset.theme || 'default';
    runtime.LogInfo("DEBUG: settings.js: Settings object before saving:", currentSettings);

    try {
        await GoSaveSettings(JSON.stringify(currentSettings));
        runtime.LogInfo("DEBUG: settings.js: Settings saved successfully to Go backend.");
    } catch (error) {
        runtime.LogError("ERROR: settings.js: Error saving settings to Go backend:", error);
    }
    runtime.LogInfo("DEBUG: settings.js: saveAllSettings finished.");
}

export async function loadSettingsAndApplyTheme() {
    runtime.LogInfo("DEBUG: settings.js: loadSettingsAndApplyTheme started.");
    try {
        const settingsJson = await GoLoadSettings();
        runtime.LogInfo("DEBUG: settings.js: Raw settingsJson received from GoLoadSettings:", settingsJson);

        if (settingsJson) {
            try {
                currentSettings = JSON.parse(settingsJson);
                runtime.LogInfo("DEBUG: settings.js: Parsed currentSettings object:", currentSettings);
            } catch (parseError) {
                runtime.LogError("ERROR: settings.js: Error parsing settings JSON:", parseError);
                currentSettings = {};
            }
        } else {
            runtime.LogWarning("WARN: settings.js: GoLoadSettings returned empty or null settingsJson. Initializing with default.");
            currentSettings = {};
        }

        if (!currentSettings.model_settings) {
            currentSettings.model_settings = {};
        }

        const savedTheme = currentSettings.theme || 'default';
        runtime.LogInfo("DEBUG: settings.js: Saved theme from settings: " + savedTheme);
        applyTheme(savedTheme);

        const themeSelectInput = document.getElementById('themeSelectInput');
        const selectedThemeValue = document.getElementById('selectedThemeValue');
        const themeOptionElement = document.querySelector(`#themeSelectList div[data-value="${savedTheme}"]`);
        if (themeSelectInput && selectedThemeValue && themeOptionElement) {
            themeSelectInput.value = themeOptionElement.textContent;
            selectedThemeValue.value = savedTheme;
            runtime.LogInfo(`DEBUG: settings.js: Theme dropdown set to: ${themeOptionElement.textContent} (${savedTheme})`);
        } else {
            runtime.LogWarning("WARN: settings.js: Theme UI elements not found or theme option not found for:", savedTheme);
        }

        document.getElementById('llamaPathInput').value = currentSettings.llama_cpp_dir || '';
        document.getElementById('modelPathInput').value = currentSettings.models_dir || '';

        const chatModelSelectInput = document.getElementById('chatModelSelectInput');
        const selectedModelPathHidden = document.getElementById('selectedModelPath');
        if (chatModelSelectInput && selectedModelPathHidden) {
            if (currentSettings.selected_model) {
                selectedModelPathHidden.value = currentSettings.selected_model;
                chatModelSelectInput.value = getModelName(currentSettings.selected_model);
                runtime.LogInfo(`DEBUG: settings.js: Selected Model UI set to: ${chatModelSelectInput.value} (Path: ${selectedModelPathHidden.value})`);
            } else {
                chatModelSelectInput.value = 'Select Model...';
                selectedModelPathHidden.value = '';
                runtime.LogInfo("DEBUG: settings.js: Selected Model UI cleared.");
            }
        } else {
            runtime.LogWarning("WARN: settings.js: Model UI elements not found (chatModelSelectInput or selectedModelPath).");
        }

        const modelArgsInput = document.getElementById('chatModelArgs');
        if (modelArgsInput) {
            const selectedModelFullPath = currentSettings.selected_model;
            const modelSettings = currentSettings.model_settings;
            if (modelSettings && selectedModelFullPath && modelSettings[selectedModelFullPath]) {
                modelArgsInput.value = modelSettings[selectedModelFullPath].args || '';
                runtime.LogInfo(`DEBUG: settings.js: chatModelArgs set for ${selectedModelFullPath}: ${modelArgsInput.value}`);
            } else {
                modelArgsInput.value = '';
                runtime.LogInfo(`DEBUG: settings.js: chatModelArgs cleared as no settings found for ${selectedModelFullPath}.`);
            }
        } else {
            runtime.LogWarning("WARN: settings.js: chatModelArgs element not found.");
        }

        if (currentSettings.models_dir) {
            try {
                const models = await GetModels();
                runtime.LogInfo("DEBUG: settings.js: Models received from Go for fuzzy search:", models);
                populateModelList(models);
                initFuzzySearch(models.map(p => ({
                    name: getModelName(p),
                    path: p
                })));
            } catch (error) {
                runtime.LogError("ERROR: settings.js: Error getting models from Go backend:", error);
            }
        } else {
            runtime.LogInfo("DEBUG: settings.js: Models directory not set, skipping model list population.");
            initFuzzySearch([]);
        }
    } catch (error) {
        runtime.LogError("ERROR: settings.js: Top-level error in loadSettingsAndApplyTheme:", error);
        applyTheme('default');
        currentSettings = {};
    }
    runtime.LogInfo("DEBUG: settings.js: loadSettingsAndApplyTheme finished.");
}