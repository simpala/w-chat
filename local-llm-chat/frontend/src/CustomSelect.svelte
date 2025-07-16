<script>
  import { createEventDispatcher } from 'svelte';

  export let items = [];
  export let value = null;

  let open = false;
  const dispatch = createEventDispatcher();

  function select(item) {
    value = item;
    open = false;
    dispatch('select', item);
  }
</script>

<div class="custom-select" on:click={() => open = !open} on:keydown={() => {}}>
  <div class="selected-item">
    {value ? value.label : 'Select...'}
    <i class="fas fa-chevron-down"></i>
  </div>
  {#if open}
    <div class="items">
      {#each items as item (item.value)}
        <div class="item" on:click={() => select(item)} on:keydown={() => {}}>
          {item.label}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .custom-select {
    position: relative;
    width: 100%;
    cursor: pointer;
  }

  .selected-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem;
    border: 1px solid var(--color-border-default);
    border-radius: 0.5rem;
    background-color: var(--color-canvas-inset);
    color: var(--color-fg-default);
  }

  .items {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 1;
    border: 1px solid var(--color-border-default);
    border-radius: 0.5rem;
    background-color: var(--color-canvas-inset);
    max-height: 150px;
    overflow-y: auto;
  }

  .item {
    padding: 0.5rem;
    color: var(--color-fg-default);
  }

  .item:hover {
    background-color: var(--color-neutral-subtle);
  }
</style>
