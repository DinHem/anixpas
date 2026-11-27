<script>
  /**
   * Мои оценки: сетка оценённых тайтлов с фильтром по звёздам.
   *
   * Значения sort проверены на живом аккаунте: 1 — все, 3 — 5★, 4 — 4★,
   * 5 — 3★, 6 — 2★, 7 — 1★ (см. docs/api-scout.md §25).
   */
  import { onMount } from 'svelte';
  import { bridge } from '../lib/bridge.js';
  import { formatGrade } from '../lib/format.js';
  import { collectFresh } from '../lib/collect.js';
  import Icon from '../components/Icon.svelte';
  import VirtualGrid from '../components/VirtualGrid.svelte';
  import ReleaseCard from '../components/ReleaseCard.svelte';
  import ReleaseMenu from '../components/ReleaseMenu.svelte';

  /** @type {{ auth: any, onBack: () => void, onOpen: (id: number) => void, onLogin: () => void }} */
  let { auth, onBack, onOpen, onLogin } = $props();

  const SORTS = [
    { sort: 1, label: 'Все' },
    { sort: 3, label: '5★', stars: 5 },
    { sort: 4, label: '4★', stars: 4 },
    { sort: 5, label: '3★', stars: 3 },
    { sort: 6, label: '2★', stars: 2 },
    { sort: 7, label: '1★', stars: 1 },
  ];

  let sort = $state(1);
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

  let profileId = $derived(auth?.profile?.id || 0);

  async function load() {
    if (loading || exhausted || !profileId) return;
    loading = true;
    error = '';

    try {
      const result = await collectFresh({
        page,
        knownIds: new Set(items.map((i) => i.id)),
        fetchPage: async (p) => {
          const res = await bridge.votes(profileId, p, sort);
          total = res.total;
          return res.items;
        },
      });

      if (result.fresh.length > 0) items = [...items, ...result.fresh];
      page = result.page;
      exhausted = result.exhausted;
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    } finally {
      loading = false;
    }

    if (!exhausted && needsMore()) setTimeout(() => load(), 200);
  }

  function needsMore() {
    if (!sentinel) return false;
    return sentinel.getBoundingClientRect().top < window.innerHeight + 400;
  }

  /** @param {number} next */
  async function switchSort(next) {
    if (next === sort) return;
    sort = next;
    items = [];
    page = 0;
    exhausted = false;
    total = 0;
    error = '';
    await load();
  }

  onMount(() => {
    if (profileId) load();
  });

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
</script>

{#if !auth?.authorized}
  <div class="empty-state">
    <p>Оценки хранятся в аккаунте Anixart.</p>
    <button class="primary" onclick={onLogin}>Войти в аккаунт</button>
  </div>
{:else}
  <div class="catalog-head">
    <div class="head-left">
      <button class="back-link" onclick={onBack}>
        <Icon name="back" size={17} />
        в профиль
      </button>
      <h2>Мои оценки</h2>
      {#if total}<span class="meta dim">{total}</span>{/if}
    </div>
  </div>

  <div class="subtabs">
    {#each SORTS as option (option.sort)}
      <button
        class="subtab"
        class:active={sort === option.sort}
        onclick={() => switchSort(option.sort)}
      >
        {option.label}
      </button>
    {/each}
  </div>

  {#if error}
    <p class="err">{error}</p>
  {/if}

  {#if !loading && items.length === 0 && !error}
    <div class="empty-state">
      <p>
        {sort === 1
          ? 'Ты пока не оценил ни одного тайтла.'
          : 'Нет оценок на эту звезду.'}
      </p>
    </div>
  {/if}

  <VirtualGrid items={items}>
    {#snippet item(entry)}
      <ReleaseCard
        item={entry}
        onOpen={onOpen}
        onMenu={() => (menuItem = entry)}
        vote={entry.myVote}
      />
    {/snippet}
  </VirtualGrid>

  {#if menuItem}
    <ReleaseMenu
      releaseId={menuItem.id}
      current={menuItem.listStatus ?? null}
      isFavorite={Boolean(menuItem.isFavorite)}
      onChange={(next, favorite) => {
        menuItem.listStatus = next;
        menuItem.isFavorite = favorite;
        menuItem = null;
      }}
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
