<script>
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
</div>

<style>
  .settings-pane {
    width: 100%;
    height: 100%;
    background-color: var(--color-canvas-inset);
    color: var(--color-fg-default);
    padding: 1rem;
  }
</style>
