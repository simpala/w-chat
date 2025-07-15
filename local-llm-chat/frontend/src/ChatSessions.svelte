<script>
  let sessions = [
    {id: 1, name: 'Session 1'},
    {id: 2, name: 'Session 2'},
    {id: 3, name: 'Session 3'},
  ];
  let showNewSessionInput = false;
  let newSessionName = '';

  function createNewSession() {
    if (newSessionName) {
      sessions = [...sessions, {id: Date.now(), name: newSessionName}];
      newSessionName = '';
      showNewSessionInput = false;
    }
  }

  function deleteSession(id) {
    sessions = sessions.filter(session => session.id !== id);
  }
</script>

<div class="chat-sessions-pane">
  <div class="header">
    <button on:click={() => showNewSessionInput = !showNewSessionInput}>New Chat</button>
  </div>
  {#if showNewSessionInput}
    <div class="new-session-input">
      <input type="text" bind:value={newSessionName} placeholder="Enter session name" on:keydown={(e) => e.key === 'Enter' && createNewSession()}/>
      <button on:click={createNewSession}>Create</button>
    </div>
  {/if}
  <ul>
    {#each sessions as session (session.id)}
      <li>
        <span>{session.name}</span>
        <i class="fas fa-trash" on:click={() => deleteSession(session.id)}></i>
      </li>
    {/each}
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

  .header {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 1rem;
  }

  button {
    background-color: var(--color-accent-emphasis);
    color: var(--color-fg-default);
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    cursor: pointer;
  }

  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .fa-trash {
    cursor: pointer;
  }

  .new-session-input {
    display: flex;
    margin-bottom: 1rem;
  }

  .new-session-input input {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid var(--color-border-default);
    border-radius: 0.5rem;
    background-color: var(--color-canvas-inset);
    color: var(--color-fg-default);
  }

  .new-session-input button {
    margin-left: 1rem;
    padding: 0.5rem 1rem;
    border: none;
    background-color: var(--color-accent-emphasis);
    color: var(--color-fg-default);
    border-radius: 0.5rem;
    cursor: pointer;
  }
</style>
