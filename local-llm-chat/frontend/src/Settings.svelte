<script>
  import { onMount } from 'svelte';
  import CustomSelect from './CustomSelect.svelte';
  import { GetModels, LoadConfig, SaveConfig } from '../wailsjs/go/main/App';

  let llamaCppDir = '';
  let modelsDir = '';
  let selectedModel = null;
  let models = [];

  onMount(async () => {
    const config = await LoadConfig();
    if (config) {
      llamaCppDir = config.llama_cpp_dir || '';
      modelsDir = config.models_dir || '';
      if (config.selected_model) {
        selectedModel = {
          value: config.selected_model,
          label: config.selected_model.split('/').pop(),
        };
      }
    }
    await loadModels();
  });

  async function loadModels() {
    if (modelsDir) {
      try {
        console.log('Loading models from:', modelsDir);
        const modelPaths = await GetModels();
        console.log('Loaded model paths:', modelPaths);
        models = modelPaths.map((path) => ({
          value: path,
          label: path.split('/').pop(),
        }));
        console.log('Formatted models:', models);
      } catch (error) {
        console.error('Error loading models:', error);
      }
    }
  }

  async function handleModelSelect(event) {
    if (event.detail) {
      selectedModel = event.detail;
      await saveSettings();
    }
  }

  function handleThemeSelect(event) {
    if (event.detail) {
      document.documentElement.setAttribute('data-theme', event.detail.value);
    }
  }

  async function saveSettings() {
    const config = {
      llama_cpp_dir: llamaCppDir,
      models_dir: modelsDir,
      selected_model: selectedModel ? selectedModel.value : '',
    };
    console.log('Saving config:', config);
    await SaveConfig(config);
  }
</script>

<div class="settings-pane">
  <h2>Settings</h2>
  <div class="setting">
    <label for="theme-select">Theme</label>
    <CustomSelect
      id="theme-select"
      items={[
        { value: 'github-dark', label: 'GitHub Dark' },
        { value: 'light', label: 'Light' },
        { value: 'dracula', label: 'Dracula' },
      ]}
      on:select={handleThemeSelect}
    />
  </div>
  <div class="setting">
    <label for="llama-cpp-dir">Llama.cpp Directory</label>
    <input
      id="llama-cpp-dir"
      type="text"
      bind:value={llamaCppDir}
      on:blur={saveSettings}
    />
  </div>
  <div class="setting">
    <label for="models-dir">Models Directory</label>
    <input
      id="models-dir"
      type="text"
      bind:value={modelsDir}
      on:blur={() => {
        saveSettings();
        loadModels();
      }}
    />
  </div>
  <div class="setting">
    <label for="model-select">Select Model</label>
    <CustomSelect
      id="model-select"
      items={models}
      bind:value={selectedModel}
      on:select={handleModelSelect}
    />
  </div>
</div>

<style>
  .settings-pane {
    width: 100%;
    height: 100%;
    background-color: var(--color-canvas-inset);
    color: var(--color-fg-default);
    padding: 1rem;
    word-wrap: break-word;
  }

  .setting {
    margin-bottom: 1rem;
  }

  input[type="text"] {
    background-color: var(--color-canvas-inset);
    color: var(--color-fg-default);
    border: 1px solid var(--color-border-default);
    border-radius: 0.5rem;
    padding: 0.5rem;
    width: 100%;
  }

  :global(.themed) {
    --sv-input-bg: var(--color-canvas-inset);
    --sv-input-border: 1px solid var(--color-border-default);
    --sv-input-color: var(--color-fg-default);
    --sv-item-bg: var(--color-canvas-inset);
    --sv-item-color: var(--color-fg-default);
    --sv-item-hover-bg: var(--color-neutral-subtle);
    --sv-item-hover-color: var(--color-fg-default);
    --sv-list-bg: var(--color-canvas-inset);
    --sv-list-border: 1px solid var(--color-border-default);
    --sv-placeholder-color: var(--color-fg-subtle);
    --sv-clear-color: var(--color-fg-muted);
    --sv-clear-hover-color: var(--color-fg-default);
    --sv-indicator-color: var(--color-fg-muted);
    --sv-indicator-hover-color: var(--color-fg-default);
  }
</style>
