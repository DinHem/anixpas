<script>
  /**
   * «Что нового»: изменения доступной версии и история прошлых релизов.
   *
   * Заметки текущей версии приходят в манифесте обновления, история — из GitHub
   * (main тянет её с кэшем на час). Модалка открывается и без обновления —
   * из «Статуса», чтобы историю можно было посмотреть в любой момент.
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

  const currentBlocks = $derived(
    state.available ? parseNotes(state.available.notes) : []
  );

  /** История без версии, которая и так показана сверху. */
  const pastReleases = $derived(
    state.history
      .filter((item) => !state.available || item.version !== state.available.version)
      .map((item) => ({ ...item, blocks: parseNotes(item.notes) }))
  );

  function close() {
    setShowNotes(false);
  }

  async function startDownload() {
    close();
    await downloadUpdate();
  }

  /** @param {string} iso */
  function dateLabel(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
</script>

<div class="update-modal-backdrop" role="presentation" onclick={close}>
  <div class="update-modal" role="dialog" aria-label="Что нового" onclick={(e) => e.stopPropagation()}>
    <div class="update-modal-head">
      <div>
        <h3>{state.available ? 'Что нового' : 'История изменений'}</h3>
        <span class="update-modal-version">
          {#if state.available}
            Версия {state.available.version}
          {:else}
            Все выпущенные версии
          {/if}
        </span>
      </div>
      <button class="update-close" title="Закрыть" onclick={close}>
        <Icon name="close" size={16} stroke={2.2} />
      </button>
    </div>

    <div class="update-modal-body">
      {#if state.available}
        {#each currentBlocks as block}
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

        {#if currentBlocks.length === 0}
          <p class="update-modal-text">Заметки к этой версии не указаны.</p>
        {/if}
      {/if}

      {#if state.historyLoading && pastReleases.length === 0}
        <p class="update-modal-text dim">Загружаю историю…</p>
      {/if}

      {#if state.historyError && pastReleases.length === 0}
        <p class="update-modal-text dim">История недоступна: нет связи с GitHub.</p>
      {/if}

      {#if pastReleases.length}
        <h4 class="update-modal-section update-modal-history-title">Прошлые версии</h4>

        {#each pastReleases as release}
          <details class="update-release">
            <summary>
              <span class="update-release-version">{release.version}</span>
              <span class="update-release-date">{dateLabel(release.publishedAt)}</span>
            </summary>

            <div class="update-release-body">
              {#each release.blocks as block}
                {#if block.type === 'heading'}
                  <h5 class="update-modal-section">{block.text}</h5>
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

              {#if release.blocks.length === 0}
                <p class="update-modal-text dim">Без описания.</p>
              {/if}
            </div>
          </details>
        {/each}
      {/if}
    </div>

    <div class="update-modal-foot">
      <button class="update-ghost" onclick={() => { dismissUpdate(); close(); }}>
        {state.available ? 'Позже' : 'Закрыть'}
      </button>
      {#if state.available}
        <button class="primary" onclick={startDownload}>
          {state.ready ? 'Скачано' : 'Скачать обновление'}
        </button>
      {/if}
    </div>
  </div>
</div>
