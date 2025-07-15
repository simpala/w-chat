<script>
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

<main>
  <div class="chat-container">
    <div class="message-list">
      {#each messages as message (message.id)}
        <div class="message" class:user={message.sender === 'user'} class:bot={message.sender === 'bot'}>
          {message.text}
        </div>
      {/each}
    </div>
    <div class="input-area">
      <input type="text" bind:value={newMessage} on:keydown={(e) => e.key === 'Enter' && sendMessage()}/>
      <button on:click={sendMessage}>Send</button>
    </div>
  </div>
</main>

<style>
  .chat-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
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
    background-color: #007bff;
    color: white;
    align-self: flex-end;
  }

  .message.bot {
    background-color: #f0f0f0;
    color: black;
    align-self: flex-start;
  }

  .input-area {
    display: flex;
    padding: 1rem;
    border-top: 1px solid #ccc;
  }

  .input-area input {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 0.5rem;
  }

  .input-area button {
    margin-left: 1rem;
    padding: 0.5rem 1rem;
    border: none;
    background-color: #007bff;
    color: white;
    border-radius: 0.5rem;
    cursor: pointer;
  }
</style>
