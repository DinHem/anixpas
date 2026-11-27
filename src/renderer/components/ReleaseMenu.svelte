<script>
  /**
   * Меню списков релиза: добавление в списки и избранное.
   * Открывается кнопкой на карточке или на странице тайтла.
   */
  import { bridge } from '../lib/bridge.js';
  import Icon from './Icon.svelte';
  import { LISTS, listLabel, listClass } from '../lib/lists.js';

  /**
   * @type {{
   *   releaseId: number,
   *   current: number|null,
   *   isFavorite: boolean,
   *   onChange: (status: number|null, favorite: boolean) => void,
   *   onClose: () => void,
   * }}
   */
  let { releaseId, current, isFavorite, onChange, onClose } = $props();

  let status = $state(current);
  let favorite = $state(isFavorite);
  let busy = $state(false);
  let error = $state('');

  /** @param {number} next */
  async function chooseList(next) {
    if (busy) return;
    busy = true;
    error = '';

    // Повторный клик по тому же списку — убираем из списков.
    const target = status === next ? 0 : next;

    try {
      await bridge.setListStatus(releaseId, target);
      status = target === 0 ? null : target;
      onChange(status, favorite);
    } catch {
      error = 'Не удалось изменить список';
    } finally {
      busy = false;
    }
  }

  async function toggleFavorite() {
    if (busy) return;
    busy = true;
    error = '';

    try {
      await bridge.setFavorite(releaseId, !favorite);
      favorite = !favorite;
      onChange(status, favorite);
    } catch {
      error = 'Не удалось изменить избранное';
    } finally {
      busy = false;
    }
  }
</script>

<div class="menu-backdrop" role="presentation" onclick={onClose}>
  <div class="list-menu" role="dialog" onclick={(e) => e.stopPropagation()}>
    <button class="menu-item" onclick={toggleFavorite} disabled={busy}>
      <span class="menu-icon"><Icon name={favorite ? 'star-filled' : 'star'} size={16} /></span>
      {favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
    </button>

    <div class="menu-sep"></div>

    {#each LISTS as list (list.status)}
      <button
        class="menu-item {list.className}"
        class:active={status === list.status}
        onclick={() => chooseList(list.status)}
        disabled={busy}
      >
        <span class="menu-icon">
          {#if status === list.status}<Icon name="check" size={15} stroke={2.2} />{/if}
        </span>
        {list.label}
      </button>
    {/each}

    {#if status !== null}
      <div class="menu-sep"></div>
      <button class="menu-item danger" onclick={() => chooseList(status)} disabled={busy}>
        <span class="menu-icon"><Icon name="close" size={15} stroke={2} /></span>
        Убрать из списков
      </button>
    {/if}

    {#if error}
      <p class="err">{error}</p>
    {/if}
  </div>
</div>
