<script>
  /**
   * Плашка обновления и модалка «Что нового».
   *
   * Плашка появляется сама, когда манифест подписан и версия новее текущей.
   * Закрыли крестиком — состояние не теряется: обновление доступно в «Статусе»,
   * а на пункте меню горит точка.
   */
  import Icon from './Icon.svelte';
  import UpdateModal from './UpdateModal.svelte';
  import { parseNotes, previewItems } from '../lib/changelog.js';
  import {
    updateState,
    downloadUpdate,
    installUpdate,
    dismissUpdate,
    setShowNotes,
  } from '../lib/updates.svelte.js';

  const state = updateState();
  const preview = $derived(
    parseNotes(state.available ? state.available.notes : '').length
      ? previewItems(parseNotes(state.available.notes), 3)
      : []
  );

  /** Размер для подписи: «18,4 МБ». */
  function sizeLabel(bytes) {
    const mb = Number(bytes) / 1024 / 1024;
    return mb >= 1 ? `${mb.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ` : '';
  }

  const visible = $derived(
    (state.available && !state.hidden) || (state.message && !state.hidden)
  );
</script>

{#if visible}
  <div class="update-toast" role="status">
    <div class="update-head">
      <span class="update-title">
        {#if state.ready}
          Обновление готово
        {:else if state.available}
          Доступна версия {state.available.version}
        {:else}
          Обновлений нет
        {/if}
      </span>
      <button class="update-close" title="Скрыть" onclick={dismissUpdate}>
        <Icon name="close" size={14} stroke={2.2} />
      </button>
    </div>

    {#if state.message}
      <span class="update-meta">{state.message}</span>
    {:else if state.available}
      {#if preview.length && !state.downloading && !state.ready}
        <ul class="update-preview">
          {#each preview as item}
            <li>{item}</li>
          {/each}
        </ul>
      {/if}

      {#if state.downloading}
        <div class="update-bar">
          <div class="update-bar-fill" style="width:{state.percent}%"></div>
        </div>
        <span class="update-meta">Скачиваю… {state.percent}%</span>
      {:else if state.ready}
        <span class="update-meta">Приложение закроется и установит новую версию.</span>
        <button class="primary update-action" onclick={installUpdate}>Перезапустить</button>
      {:else}
        <div class="update-row">
          <span class="update-meta">
            {state.current} → {state.available.version}
            {#if sizeLabel(state.available.size)}· {sizeLabel(state.available.size)}{/if}
          </span>
        </div>
        <div class="update-actions">
          <button class="update-ghost" onclick={() => setShowNotes(true)}>Что нового</button>
          <button class="primary update-action" onclick={downloadUpdate}>Скачать</button>
        </div>
      {/if}
    {/if}

    {#if state.error === 'timeout'}
      <span class="update-error">
        Скачивание прервалось: сервер слишком долго не отвечал. Попробуйте ещё раз —
        докачка начнётся заново.
      </span>
    {:else if state.error === 'network'}
      <span class="update-error">Связь оборвалась во время скачивания. Проверьте соединение.</span>
    {:else if state.error === 'checksum'}
      <span class="update-error">Файл скачался с ошибкой — обновление отклонено.</span>
    {:else if state.error === 'download'}
      <span class="update-error">Не удалось скачать. Проверьте сеть и попробуйте снова.</span>
    {:else if state.error === 'install'}
      <span class="update-error">Не удалось запустить установщик.</span>
    {:else if state.error === 'signature'}
      <span class="update-error">Подпись обновления не совпала — обновление отклонено.</span>
    {:else if state.error === 'offline'}
      <span class="update-error">Нет связи с сервером обновлений.</span>
    {/if}
  </div>
{/if}

{#if state.showNotes}
  <UpdateModal />
{/if}
