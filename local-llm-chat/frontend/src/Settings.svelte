<script>
  import { onMount } from 'svelte';
  import { GetModels, LoadConfig, SaveConfig } from '../wailsjs/go/main/App';

  let llamaCppDir = '';
  let modelsDir = '';
  let selectedModel = '';
  let models = [];
  let filteredModels = [];
  let modelSearch = '';

  onMount(async () => {
    const config = await LoadConfig();
    llamaCppDir = config.llama_cpp_dir || '';
    modelsDir = config.models_dir || '';
    selectedModel = config.selected_model || '';
    await loadModels();
  });

  async function loadModels() {
    if (modelsDir) {
      try {
        models = await GetModels();
        filterModels();
      } catch (error) {
        console.error('Error loading models:', error);
      }
    }
  }

  function filterModels() {
    if (modelSearch) {
      filteredModels = models.filter((model) =>
        model.toLowerCase().includes(modelSearch.toLowerCase())
      );
    } else {
      filteredModels = [];
    }
  }

  function selectModel(model) {
    selectedModel = model;
    modelSearch = '';
    filterModels();
    saveSettings();
  }

  async function saveSettings() {
    const config = {
      llama_cpp_dir: llamaCppDir,
      models_dir: modelsDir,
      selected_model: selectedModel,
    };
    await SaveConfig(config);
  }

  function changeTheme(event) {
    document.documentElement.setAttribute('data-theme', event.target.value);
  }
</script>

<div class="settings-pane">
  <h2>Settings</h2>
  <div class="setting">
    <label for="theme-select">Theme</label>
    <select id="theme-select" on:change={changeTheme}>
      <option value="github-dark">GitHub Dark</option>
      <option value="light">Light</option>
      <option value="dracula">Dracula</option>
    </select>
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
    <input
      id="model-select"
      type="text"
      bind:value={modelSearch}
      on:input={filterModels}
      placeholder="Search for a model..."
    />
    {#if filteredModels.length > 0}
      <ul class="model-dropdown">
        {#each filteredModels as model}
          <li on:click={() => selectModel(model)}>{model}</li>
        {/each}
      </ul>
    {/if}
    {#if selectedModel}
      <p>Selected: {selectedModel}</p>
    {/if}
  </div>
</div>

<style>
  .settings-pane {
    width: 100%;
    height: 100%;
    background-color: var(--color-canvas-inset);
    color: var(--color-fg-default);
    padding: 1rem;
  }

  .setting {
    margin-bottom: 1rem;
  }

  .model-dropdown {
    list-style: none;
    padding: 0;
    margin: 0;
    border: 1px solid var(--color-border-default);
    border-radius: 0.5rem;
    max-height: 200px;
    overflow-y: auto;
  }

  .model-dropdown li {
    padding: 0.5rem;
    cursor: pointer;
  }

  .model-dropdown li:hover {
    background-color: var(--color-neutral-subtle);
  }
</style>
