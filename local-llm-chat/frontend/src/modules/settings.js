// modules/settings.js

import {
    GetModels,
    LoadSettings as GoLoadSettings, // Alias to avoid conflict with local loadSettings
    SaveSettings as GoSaveSettings // Alias to avoid conflict with local saveSettings
} from '../../wailsjs/go/main/App';
import Fuse from 'fuse.js';
import * as runtime from '../../wailsjs/runtime'; // Import runtime for logging
import { getModelName } from './path-utils.js';
import { applyTheme } from '../app'; // Import applyTheme from app.js


export let fuse;
// Define currentSettings globally within this module
let currentSettings = {};

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

    // Update currentSettings and save
    if (!currentSettings.model_args) {
        currentSettings.model_args = {};
    }
    currentSettings.selected_model = modelPath; // Store the full path as selected_model
    // The chatModelArgs will be updated when loadSettingsAndApplyTheme is called or upon manual change
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

// Consolidated save function (formerly saveSettings in settings.js and saveAllSettings in app.js)
export async function saveAllSettings() {
    runtime.LogInfo("DEBUG: settings.js: saveAllSettings started.");

    currentSettings.llama_cpp_dir = document.getElementById('llamaPathInput').value;
    currentSettings.models_dir = document.getElementById('modelPathInput').value;
    currentSettings.selected_model = document.getElementById('selectedModelPath').value; // Get the full path from hidden input

    if (!currentSettings.model_args) {
        currentSettings.model_args = {};
    }
    const currentModelPath = document.getElementById('selectedModelPath').value; // Use the full path as the key
    if (currentModelPath) {
        currentSettings.model_args[currentModelPath] = document.getElementById('chatModelArgs').value;
    }

    // Save the current theme from the body's data-theme attribute
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


// Consolidated load function (formerly loadSettingsAndApplyTheme in app.js and loadSettings in settings.js)
export async function loadSettingsAndApplyTheme() {
    runtime.LogInfo("DEBUG: settings.js: loadSettingsAndApplyTheme started.");
    try {
        const settingsJson = await GoLoadSettings(); // This waits for Go to return the string
        runtime.LogInfo("DEBUG: settings.js: Raw settingsJson received from GoLoadSettings:", settingsJson);

        if (settingsJson) {
            try {
                currentSettings = JSON.parse(settingsJson);
                runtime.LogInfo("DEBUG: settings.js: Parsed currentSettings object:", currentSettings);
            } catch (parseError) {
                runtime.LogError("ERROR: settings.js: Error parsing settings JSON:", parseError);
                currentSettings = {}; // Fallback to empty object on parse error
            }
        } else {
            runtime.LogWarning("WARN: settings.js: GoLoadSettings returned empty or null settingsJson. Initializing with default.");
            currentSettings = {}; // Initialize as empty if no JSON returned
        }
        // Ensure ModelArgs exists to prevent errors later
        if (!currentSettings.model_args) {
            currentSettings.model_args = {};
        }


        // Apply theme on load
        const savedTheme = currentSettings.theme || 'default';
        runtime.LogInfo("DEBUG: settings.js: Saved theme from settings: " + savedTheme);
        applyTheme(savedTheme);

        // Set the custom theme dropdown's displayed value and hidden value
        const themeSelectInput = document.getElementById('themeSelectInput');
        const selectedThemeValue = document.getElementById('selectedThemeValue');
        const themeOptionElement = document.querySelector(`#themeSelectList div[data-value="${savedTheme}"]`);
        if (themeSelectInput && selectedThemeValue && themeOptionElement) {
            themeSelectInput.value = themeOptionElement.textContent;
            selectedThemeValue.value = savedTheme;
            runtime.LogInfo(`DEBUG: settings.js: Theme dropdown set to: ${themeOptionElement.textContent} (${savedTheme})`);
        } else {
            runtime.LogWarning("WARN: settings.js: Theme UI elements not found or theme option not found for:", savedTheme);
            if (!themeSelectInput) runtime.LogWarning("themeSelectInput not found.");
            if (!selectedThemeValue) runtime.LogWarning("selectedThemeValue not found.");
            if (!themeOptionElement) runtime.LogWarning(`themeOptionElement not found for data-value="${savedTheme}".`);
        }

        // Populate your existing settings fields
        document.getElementById('llamaPathInput').value = currentSettings.llama_cpp_dir || '';
        document.getElementById('modelPathInput').value = currentSettings.models_dir || '';

        // Handle selected model display and path
        const chatModelSelectInput = document.getElementById('chatModelSelectInput');
        const selectedModelPathHidden = document.getElementById('selectedModelPath');
        if (chatModelSelectInput && selectedModelPathHidden) {
            if (currentSettings.selected_model) {
                // Set the hidden input with the full path
                selectedModelPathHidden.value = currentSettings.selected_model;
                // Set the display input with just the model name (last part of the path)
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


        // More robust handling for ModelArgs
        const modelArgsInput = document.getElementById('chatModelArgs');
        if (modelArgsInput) {
            // Use the full path as the key for model_args
            const selectedModelFullPath = currentSettings.selected_model;
            const modelArgs = currentSettings.model_args;
            if (modelArgs && selectedModelFullPath && modelArgs[selectedModelFullPath] !== undefined) {
                modelArgsInput.value = modelArgs[selectedModelFullPath];
                runtime.LogInfo(`DEBUG: settings.js: chatModelArgs set for ${selectedModelFullPath}: ${modelArgs[selectedModelFullPath]}`);
            } else {
                modelArgsInput.value = '';
                runtime.LogInfo(`DEBUG: settings.js: chatModelArgs cleared or not found for ${selectedModelFullPath}. ModelArgs:`, modelArgs);
            }
        } else {
            runtime.LogWarning("WARN: settings.js: chatModelArgs element not found.");
        }

        runtime.LogInfo(`DEBUG: settings.js: Value of currentSettings.llama_cpp_dir: '${currentSettings.llama_cpp_dir}'`);
        runtime.LogInfo(`DEBUG: settings.js: Value of currentSettings.models_dir: '${currentSettings.models_dir}'`);

        // Update model list for fuzzy search
        if (currentSettings.models_dir) {
            try {
                const models = await GetModels(); // Get models from Go backend
                runtime.LogInfo("DEBUG: settings.js: Models received from Go for fuzzy search:", models);
                populateModelList(models); // Populate the custom dropdown
                initFuzzySearch(models.map(p => ({
                    name: getModelName(p),
                    path: p
                })));
            } catch (error) {
                runtime.LogError("ERROR: settings.js: Error getting models from Go backend:", error);
            }
        } else {
            runtime.LogInfo("DEBUG: settings.js: Models directory not set, skipping model list population.");
            initFuzzySearch([]); // Initialize fuzzy search with empty data if no models directory
        }

    } catch (error) {
        runtime.LogError("ERROR: settings.js: Top-level error in loadSettingsAndApplyTheme:", error);
        applyTheme('default'); // Fallback to default theme on error
        currentSettings = {}; // Reset settings to avoid issues
    }
    runtime.LogInfo("DEBUG: settings.js: loadSettingsAndApplyTheme finished.");
}