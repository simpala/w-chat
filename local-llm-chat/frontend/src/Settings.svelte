<div class="settings-pane">
  <h2>Settings</h2>
  <p>Some settings will go here.</p>
</div>

<style>
  .settings-pane {
    position: fixed;
    top: 0;
    left: 0;
    width: calc(100vw / 8);
    height: 100%;
    background-color: #f0f0f0;
    padding: 1rem;
    box-shadow: 2px 0 5px rgba(0, 0, 0, 0.1);
    transform: translateX(-100%);
    transition: transform 0.3s ease-in-out;
  }

  .settings-pane.open {
    transform: translateX(0);
  }
</style>
