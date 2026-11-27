<script>
  /** Закладки пользователя: пять списков. */
  import { onMount } from 'svelte';
  import { bridge } from '../lib/bridge.js';
  import { collectFresh } from '../lib/collect.js';
  import { listLabel, listClass } from '../lib/lists.js';
  import VirtualGrid from '../components/VirtualGrid.svelte';
  import ReleaseCard from '../components/ReleaseCard.svelte';
  import ReleaseMenu from '../components/ReleaseMenu.svelte';

  /** @type {{ auth: any, onOpen: (id: number) => void, onLogin: () => void }} */
  let { auth, onOpen, onLogin } = $props();

  const LISTS = [
    { status: 0, label: 'Избранное' },
    { status: 1, label: 'Смотрю' },
    { status: 2, label: 'В планах' },
    { status: 3, label: 'Завершено' },
    { status: 4, label: 'Отложено' },
    { status: 5, label: 'Брошено' },
  ];

  let status = $state(0);
  /** @type {any[]} */
  let items = $state([]);
  let page = $state(0);
  let total = $state(0);
  let loading = $state(false);
  let exhausted = $state(false);
  let error = $state('');
  /** @type {HTMLElement|null} */
  let sentinel = $state(null);
  /** Релиз, для которого открыто меню списков. */
  /** @type {any|null} */
  let menuItem = $state(null);

  async function load() {
    if (loading || exhausted) return;
    loading = true;
    error = '';

    try {
      const result = await collectFresh({
        page,
        knownIds: new Set(items.map((i) => i.id)),
        fetchPage: async (p) => {
          // Статус 0 — избранное: отдельный путь API.
          const res =
            status === 0 ? await bridge.favorites(p) : await bridge.bookmarks(status, p);
          total = res.total;
          return res.items;
        },
      });

      if (result.fresh.length > 0) items = [...items, ...result.fresh];
      page = result.page;
      exhausted = result.exhausted;
    } catch (err) {
      error =
        err && err.code === 'unauthorized'
          ? 'Нужен вход в аккаунт'
          : err && err.message
            ? err.message
            : String(err);
    } finally {
      loading = false;
    }

    // Экран не заполнен — наблюдатель не выстрелит, догружаем сами.
    if (!exhausted && needsMore()) setTimeout(() => load(), 200);
  }

  /** Низ списка в пределах экрана. */
  function needsMore() {
    if (!sentinel) return false;
    return sentinel.getBoundingClientRect().top < window.innerHeight + 400;
  }

  /** @param {number} next */
  async function switchList(next) {
    if (next === status) return;
    status = next;
    items = [];
    page = 0;
    total = 0;
    exhausted = false;
    error = '';
    await load();
  }

  /**
   * После смены списка карточка может уйти из текущей вкладки:
   * сняли со списка или перевели в другой. Убираем её сразу, без перезагрузки.
   */
  /** @param {number|null} next @param {boolean} favorite */
  function applyMenuChange(next, favorite) {
    const id = menuItem.id;
    menuItem = null;

    const stays = status === 0 ? favorite : next === status;
    if (!stays) {
      items = items.filter((i) => i.id !== id);
      total = Math.max(0, total - 1);
      return;
    }

    const entry = items.find((i) => i.id === id);
    if (entry) {
      entry.listStatus = next;
      entry.isFavorite = favorite;
    }
  }

  onMount(() => {
    if (auth?.authorized) load();
  });

  // Перезагрузка, если вошли уже находясь в разделе.
  $effect(() => {
    if (auth?.authorized && items.length === 0 && !loading && !error) load();
  });

  // Подгрузка при подходе к низу — кнопка «Загрузить ещё» больше не нужна.
  $effect(() => {
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) load();
      },
      { rootMargin: '400px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  // Страховка для окна, в котором наблюдатель не сработал: обычный скролл.
  $effect(() => {
    const scroller = document.querySelector('.main');
    if (!scroller) return;

    const onScroll = () => {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 600) load();
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  });
</script>

{#if !auth?.authorized}
  <div class="catalog-head">
    <h2>Закладки</h2>
  </div>

  <div class="empty-state">
    <p>Закладки хранятся в аккаунте Anixart.</p>
    <button class="primary" onclick={onLogin}>Войти в аккаунт</button>
  </div>
{:else}
  <div class="catalog-head">
    <h2>Закладки</h2>
    {#if total}
      <span class="meta dim">{total}</span>
    {/if}
  </div>

  <div class="subtabs">
    {#each LISTS as list (list.status)}
      <button
        class="subtab"
        class:active={status === list.status}
        onclick={() => switchList(list.status)}
      >
        {list.label}
      </button>
    {/each}
  </div>

  {#if error}
    <p class="err">{error}</p>
  {/if}

  {#if !loading && items.length === 0 && !error}
    <div class="empty-state">
      <p>
        {status === 0
          ? 'В избранном пока пусто.'
          : `В списке «${listLabel(status)}» пока пусто.`}
      </p>
    </div>
  {/if}

  {#if loading && items.length === 0}
    <div class="grid">
      {#each Array.from({ length: 12 }) as _, i (i)}
        <div class="skeleton-card" aria-hidden="true">
          <div class="skeleton skeleton-poster"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>
      {/each}
    </div>
  {:else}
    <VirtualGrid items={items}>
      {#snippet item(entry)}
        <ReleaseCard
          item={entry}
          onOpen={onOpen}
          onMenu={() => (menuItem = entry)}
          badge={status === 0
            ? entry.listStatus
              ? { label: listLabel(entry.listStatus), cls: listClass(entry.listStatus) }
              : { label: 'Избранное', cls: 'favorite-badge' }
            : { label: listLabel(status), cls: listClass(status) }}
        />
      {/snippet}
    </VirtualGrid>
  {/if}

  {#if menuItem}
    <ReleaseMenu
      releaseId={menuItem.id}
      current={menuItem.listStatus ?? null}
      isFavorite={Boolean(menuItem.isFavorite)}
      onChange={(next, favorite) => applyMenuChange(next, favorite)}
      onClose={() => (menuItem = null)}
    />
  {/if}

  <div class="foot" bind:this={sentinel}>
    {#if loading}
      <span class="meta dim">Загрузка…</span>
    {:else if exhausted && items.length > 0}
      <span class="meta dim">загружено: {items.length}</span>
    {/if}
  </div>
{/if}
