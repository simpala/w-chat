<div class="chat-sessions-pane">
  <h2>Chat Sessions</h2>
  <ul>
    <li>Session 1</li>
    <li>Session 2</li>
    <li>Session 3</li>
  </ul>
</div>

<style>
  .chat-sessions-pane {
    width: calc(100vw / 6);
    height: 100vh;
    background-color: var(--color-canvas-inset);
    color: var(--color-fg-default);
    padding: 1rem;
    border-right: 1px solid var(--color-border-default);
  }

  ul {
    list-style: none;
    padding: 0;
  }

  li {
    padding: 0.5rem;
    cursor: pointer;
    border-bottom: 1px solid var(--color-border-default);
  }

  li:hover {
    background-color: var(--color-neutral-muted);
  }
</style>
