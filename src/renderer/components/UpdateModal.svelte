<script>
  /**
   * «Что нового»: полный список изменений версии из манифеста обновления.
   *
   * Заметки приходят обычным текстом из CHANGELOG.md — разбираем их на заголовки
   * и пункты, чтобы читалось как список, а не как полотно.
   */
  import Icon from './Icon.svelte';
  import { parseNotes } from '../lib/changelog.js';
  import {
    updateState,
    downloadUpdate,
    setShowNotes,
    dismissUpdate,
  } from '../lib/updates.svelte.js';

  const state = updateState();
  const blocks = $derived(parseNotes(state.available ? state.available.notes : ''));

  function close() {
    setShowNotes(false);
  }

  async function startDownload() {
    close();
    await downloadUpdate();
  }
</script>

<div
  class="update-modal-backdrop"
  role="presentation"
  onclick={close}
>
  <div class="update-modal" role="dialog" aria-label="Что нового" onclick={(e) => e.stopPropagation()}>
    <div class="update-modal-head">
      <div>
        <h3>Что нового</h3>
        <span class="update-modal-version">Версия {state.available?.version}</span>
      </div>
      <button class="update-close" title="Закрыть" onclick={close}>
        <Icon name="close" size={16} stroke={2.2} />
      </button>
    </div>

    <div class="update-modal-body">
      {#each blocks as block}
        {#if block.type === 'heading'}
          <h4 class="update-modal-section">{block.text}</h4>
        {:else if block.type === 'items'}
          <ul class="update-modal-list">
            {#each block.items as item}
              <li>{item}</li>
            {/each}
          </ul>
        {:else}
          <p class="update-modal-text">{block.text}</p>
        {/if}
      {/each}

      {#if blocks.length === 0}
        <p class="update-modal-text">Заметки к этой версии не указаны.</p>
      {/if}
    </div>

    <div class="update-modal-foot">
      <button class="update-ghost" onclick={() => { dismissUpdate(); close(); }}>Позже</button>
      <button class="primary" onclick={startDownload}>
        {state.ready ? 'Скачано' : 'Скачать обновление'}
      </button>
    </div>
  </div>
</div>
