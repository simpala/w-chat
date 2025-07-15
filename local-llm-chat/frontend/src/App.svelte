<script>
  import Settings from './Settings.svelte';
  import ChatSessions from './ChatSessions.svelte';
  let showSettings = false;

  let messages = [
    {id: 1, text: 'Hello!', sender: 'bot'},
    {id: 2, text: 'Hi there!', sender: 'user'},
    {id: 3, text: 'How can I help you today?', sender: 'bot'},
  ];
  let newMessage = '';

  function sendMessage() {
    if (newMessage.trim() !== '') {
      messages = [...messages, {id: Date.now(), text: newMessage, sender: 'user'}];
      newMessage = '';
    }
  }
</script>

<main class:settings-open={showSettings}>
  <ChatSessions />
  <div class="chat-container">
    <div class="header">
      <i class="fas fa-cog" on:click={() => showSettings = !showSettings}></i>
    </div>
    <div class="message-list">
      {#each messages as message (message.id)}
        <div class="message" class:user={message.sender === 'user'} class:bot={message.sender === 'bot'}>
          {message.text}
        </div>
      {/each}
    </div>
    <div class="input-area">
      <i class="fas fa-paperclip"></i>
      <input type="text" bind:value={newMessage} on:keydown={(e) => e.key === 'Enter' && sendMessage()}/>
      <button on:click={sendMessage}>Send</button>
    </div>
  </div>
  <div class="settings-container">
    <Settings />
  </div>
</main>

<style>
  main {
    display: flex;
    background-color: var(--color-canvas-default);
    color: var(--color-fg-default);
    overflow: hidden;
    height: 100vh;
  }

  .chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .message-list {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
  }

  .message {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    margin-bottom: 0.5rem;
    max-width: 70%;
  }

  .message.user {
    background-color: var(--color-accent-emphasis);
    color: var(--color-fg-default);
    align-self: flex-end;
  }

  .message.bot {
    background-color: var(--color-neutral-subtle);
    color: var(--color-fg-default);
    align-self: flex-start;
  }

  .input-area {
    display: flex;
    padding: 1rem;
    border-top: 1px solid var(--color-border-default);
  }

  .input-area input {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid var(--color-border-default);
    border-radius: 0.5rem;
    background-color: var(--color-canvas-inset);
    color: var(--color-fg-default);
  }

  .input-area button {
    margin-left: 1rem;
    padding: 0.5rem 1rem;
    border: none;
    background-color: var(--color-accent-emphasis);
    color: var(--color-fg-default);
    border-radius: 0.5rem;
    cursor: pointer;
  }

  .header {
    display: flex;
    justify-content: flex-end;
    padding: 0.5rem;
    border-bottom: 1px solid var(--color-border-default);
  }

  .fa-cog {
    cursor: pointer;
    margin: 0.5rem;
  }

  .fa-paperclip {
    cursor: pointer;
    margin-right: 1rem;
    align-self: center;
  }

  .settings-container {
    width: 0;
    transition: width 0.3s ease-in-out;
    background-color: var(--color-canvas-inset);
    height: 100vh;
    overflow: hidden;
  }

  main.settings-open .settings-container {
    width: calc(100vw / 8);
  }

</style>
