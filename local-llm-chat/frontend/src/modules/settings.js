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

export function applyTheme(themeName) {
    console.log("DEBUG: applyTheme called with:", themeName);
    const body = document.body;
    body.className = body.className.split(' ').filter(c => !c.startsWith('theme-')).join(' ');

    if (themeName && themeName !== 'default') {
        body.classList.add(`theme-${themeName}`);
    }
    body.dataset.theme = themeName;
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
    const harmonyCheckbox = document.getElementById('harmonyToolsCheckbox'); // Get checkbox
    if (currentSettings.model_settings && currentSettings.model_settings[modelPath]) {
        modelArgsInput.value = currentSettings.model_settings[modelPath].args || '';
        // NEW: Load the harmony tools setting
        harmonyCheckbox.checked = currentSettings.model_settings[modelPath].use_harmony_tools || false;
        runtime.LogInfo(`DEBUG: settings.js: Loaded args for ${modelName}: "${modelArgsInput.value}"`);
        runtime.LogInfo(`DEBUG: settings.js: Loaded harmony setting for ${modelName}: ${harmonyCheckbox.checked}`);
    } else {
        modelArgsInput.value = ''; // Clear args if none are saved for this model
        harmonyCheckbox.checked = false; // Uncheck for new/unsaved model
        runtime.LogInfo(`DEBUG: settings.js: No settings found for ${modelName}, clearing inputs.`);
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
    currentSettings.selected_model = document.getElementById('selectedModelPath').value; // Get the full path from hidden input

    // Before saving, update the settings for the currently selected model
    const currentModelPath = document.getElementById('selectedModelPath').value;
    if (currentModelPath) {
        // Ensure the model_settings object exists
        if (!currentSettings.model_settings) {
            currentSettings.model_settings = {};
        }
        // Ensure the entry for the current model exists
        if (!currentSettings.model_settings[currentModelPath]) {
            currentSettings.model_settings[currentModelPath] = {};
        }
        // Save the arguments
        currentSettings.model_settings[currentModelPath].args = document.getElementById('chatModelArgs').value;
        currentSettings.model_settings[currentModelPath].use_harmony_tools = document.getElementById('harmonyToolsCheckbox').checked;
        runtime.LogInfo(`DEBUG: settings.js: Staged args for ${currentModelPath}: "${currentSettings.model_settings[currentModelPath].args}"`);
        runtime.LogInfo(`DEBUG: settings.js: Staged harmony setting for ${currentModelPath}: ${currentSettings.model_settings[currentModelPath].use_harmony_tools}`);
    }

    // Save the current theme from the body's data-theme attribute
    currentSettings.theme = document.body.dataset.theme || 'default';

    // --- NEW: Save Tool Usage Sliders ---
    const iterationsSlider = document.getElementById('toolCallIterationsSlider');
    if (iterationsSlider) {
        currentSettings.tool_call_iterations = parseInt(iterationsSlider.value, 10);
    }

    const cooldownSlider = document.getElementById('toolCallCooldownSlider');
    if (cooldownSlider) {
        currentSettings.tool_call_cooldown = parseInt(cooldownSlider.value, 10);
    }
    // --- END NEW ---

    runtime.LogInfo("DEBUG: settings.js: Settings object before saving:", currentSettings);

    return GoSaveSettings(JSON.stringify(currentSettings))
        .then(() => {
            runtime.LogInfo("DEBUG: settings.js: Settings saved successfully to Go backend.");
        })
        .catch(error => {
            runtime.LogError("ERROR: settings.js: Error saving settings to Go backend:", error);
        });
}

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
        // Ensure model_settings exists to prevent errors later
        if (!currentSettings.model_settings) {
            currentSettings.model_settings = {};
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


        // More robust handling for model_settings
        const modelArgsInput = document.getElementById('chatModelArgs');
        const harmonyCheckbox = document.getElementById('harmonyToolsCheckbox'); // Get checkbox
        if (modelArgsInput && harmonyCheckbox) {
            const selectedModelFullPath = currentSettings.selected_model;
            const modelSettings = currentSettings.model_settings;
            if (modelSettings && selectedModelFullPath && modelSettings[selectedModelFullPath]) {
                modelArgsInput.value = modelSettings[selectedModelFullPath].args || '';
                // NEW: Load the harmony tools setting
                harmonyCheckbox.checked = modelSettings[selectedModelFullPath].use_harmony_tools || false;
                runtime.LogInfo(`DEBUG: settings.js: chatModelArgs set for ${selectedModelFullPath}: ${modelArgsInput.value}`);
                runtime.LogInfo(`DEBUG: settings.js: harmonyCheckbox set for ${selectedModelFullPath}: ${harmonyCheckbox.checked}`);
            } else {
                modelArgsInput.value = '';
                harmonyCheckbox.checked = false;
                runtime.LogInfo(`DEBUG: settings.js: chatModelArgs and harmonyCheckbox cleared as no settings found for ${selectedModelFullPath}.`);
            }
        } else {
            runtime.LogWarning("WARN: settings.js: chatModelArgs or harmonyToolsCheckbox element not found.");
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

        // --- NEW: Populate Tool Usage Sliders ---
        // Note: These elements only exist when the MCP manager artifact is rendered.
        // This function is called on startup, so we check for their existence.
        const iterationsSlider = document.getElementById('toolCallIterationsSlider');
        const iterationsValue = document.getElementById('toolCallIterationsValue');
        const cooldownSlider = document.getElementById('toolCallCooldownSlider');
        const cooldownValue = document.getElementById('toolCallCooldownValue');

        if (iterationsSlider && iterationsValue) {
            iterationsSlider.value = currentSettings.tool_call_iterations || 5;
            iterationsValue.textContent = iterationsSlider.value;
        }
        if (cooldownSlider && cooldownValue) {
            cooldownSlider.value = currentSettings.tool_call_cooldown || 0;
            cooldownValue.textContent = cooldownSlider.value;
        }
        // --- END NEW ---

    } catch (error) {
        runtime.LogError("ERROR: settings.js: Top-level error in loadSettingsAndApplyTheme:", error);
        applyTheme('default'); // Fallback to default theme on error
        currentSettings = {}; // Reset settings to avoid issues
    }
    runtime.LogInfo("DEBUG: settings.js: loadSettingsAndApplyTheme finished.");
}