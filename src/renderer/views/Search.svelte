<script>
  /**
   * Поиск и подбор по фильтрам.
   *
   * Три состояния экрана:
   *  - пустой вход: большая строка, последние запросы, жанры, популярное и топ;
   *  - поиск по названию (API фильтры при запросе не применяет);
   *  - подбор по фильтрам (пустой запрос + выбранные условия).
   */
  import { onMount } from 'svelte';
  import { bridge } from '../lib/bridge.js';
  import { formatGrade, formatPremiere, formatSnippet, formatEpisodesShort } from '../lib/format.js';
  import FilterPanel from '../components/FilterPanel.svelte';
  import ReleaseMenu from '../components/ReleaseMenu.svelte';
  import Icon from '../components/Icon.svelte';
  import ReleaseCard from '../components/ReleaseCard.svelte';
  import VirtualGrid from '../components/VirtualGrid.svelte';
  import { collectFresh } from '../lib/collect.js';
  import { listLabel, listClass } from '../lib/lists.js';

  /** @type {{ onOpen: (id: number) => void }} */
  let { onOpen, patch = null } = $props();

  /** Сколько последних запросов помним. */
  const HISTORY_LIMIT = 8;
  /** Живой поиск: не раньше третьего символа и с паузой после ввода. */
  const LIVE_MIN_CHARS = 3;
  const LIVE_DELAY = 450;
  /** Сколько тайтлов в блоках «Популярное» и «Топ». */
  const DISCOVER_LIMIT = 12;

  let query = $state('');
  /** @type {ReturnType<typeof setTimeout>|null} */
  let liveTimer = null;
  /** Запрос, который уже искали — чтобы не повторять его же. */
  let lastQuery = '';
  /** @type {any[]} */
  let results = $state([]);
  /** Вид выдачи: сетка как в каталоге или подробный список. */
  let view = $state('grid');
  let page = $state(0);
  let loading = $state(false);
  let exhausted = $state(false);
  let error = $state('');
  /** Показывали ли уже что-то. */
  let searched = $state(false);
  /** Режим: 'search' — по названию, 'filter' — подбор. */
  let mode = $state('search');

  let filters = $state({ sort: 0 });
  let showFilters = $state(false);
  /** @type {{ genres: string[], sources: string[], types: any[] }} */
  let filterOptions = $state({ genres: [], sources: [], types: [] });
  let optionsLoaded = $state(false);

  /** Последние запросы (локально, в settings.json). */
  /** @type {string[]} */
  let history = $state([]);
  /** Витрина пустого экрана. */
  /** @type {{ popular: any[], top: any[] }} */
  let discover = $state({ popular: [], top: [] });
  /** Жанры для быстрых чипсов. */
  /** @type {string[]} */
  let quickGenres = $state([]);
  let discoverLoading = $state(true);

  /** @type {HTMLElement|null} */
  let sentinel = $state(null);
  /** @type {HTMLInputElement|null} */
  let inputEl = $state(null);

  /** Релиз, для которого открыто меню списков. */
  /** @type {any|null} */
  let menuItem = $state(null);

  /** Сколько фильтров активно. */
  let activeFilters = $derived(
    (filters.genres || []).length +
      (filters.types || []).length +
      (filters.studio ? 1 : 0) +
      (filters.source ? 1 : 0) +
      (filters.season !== undefined ? 1 : 0) +
      (filters.episodesFrom !== undefined || filters.episodesTo !== undefined ? 1 : 0) +
      (filters.category_id !== undefined && filters.category_id !== null ? 1 : 0) +
      (filters.status_id !== undefined && filters.status_id !== null ? 1 : 0) +
      (filters.country ? 1 : 0) +
      (filters.ageRatings || []).length +
      (filters.durationFrom !== undefined || filters.durationTo !== undefined ? 1 : 0) +
      (filters.startYear !== undefined || filters.endYear !== undefined ? 1 : 0)
  );

  async function load(force = false) {
    if (loading || exhausted) return;
    loading = true;
    error = '';

    // Запоминаем, под какой запрос грузим: если текст успел измениться,
    // этот ответ уже не нужен.
    const requested = mode === 'filter' ? '' : query.trim();

    try {
      const result = await collectFresh({
        page,
        knownIds: new Set(results.map((i) => i.id)),
        fetchPage: (p) =>
          mode === 'filter'
            ? bridge.catalog(p, filters, force && p === page)
            : bridge.search(requested, p, force && p === page),
      });

      if (mode === 'search' && query.trim() !== requested) return;

      if (result.fresh.length > 0) results = [...results, ...result.fresh];
      page = result.page;
      exhausted = result.exhausted;
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    } finally {
      loading = false;
    }

    // Экран не заполнен — наблюдатель не выстрелит, догружаем сами.
    if (searched && !exhausted && needsMore()) setTimeout(() => load(), 200);
  }

  /** Низ списка в пределах экрана. */
  function needsMore() {
    if (!sentinel) return false;
    return sentinel.getBoundingClientRect().top < window.innerHeight + 400;
  }

  /** @param {string} value */
  function pushHistory(value) {
    const text = value.trim();
    if (!text) return;
    const next = [text, ...history.filter((h) => h.toLowerCase() !== text.toLowerCase())].slice(
      0,
      HISTORY_LIMIT
    );
    history = next;
    bridge.settings.set('searchHistory', next).catch(() => {});
  }

  /** @param {string} [value] */
  // Карточка тайтла могла изменить список — подхватываем без перезагрузки.
  $effect(() => {
    if (!patch) return;
    const all = [...results, ...discover.popular, ...discover.top];
    const entry = all.find((i) => i.id === patch.id);
    if (entry) {
      entry.listStatus = patch.listStatus;
      entry.isFavorite = patch.isFavorite;
    }
  });

  /** @param {string} [value] @param {{push?: boolean}} [options] */
  async function startSearch(value = query, options = {}) {
    const text = value.trim();
    if (!text) return;

    query = text;
    lastQuery = text;
    // Живой поиск историю не засоряет: туда попадает только явный запрос.
    if (options.push !== false) pushHistory(text);

    mode = 'search';
    results = [];
    page = 0;
    exhausted = false;
    searched = true;

    await load(true);
  }

  /**
   * Живой поиск: через 450 мс после последнего символа уходит запрос.
   * Короче трёх символов не ищем — незачем дёргать API на «на».
   */
  function scheduleLiveSearch() {
    if (liveTimer) clearTimeout(liveTimer);

    const text = query.trim();

    if (text.length < LIVE_MIN_CHARS) {
      // Стерли до одного-двух символов — возвращаемся к витрине.
      if (searched && mode === 'search') {
        searched = false;
        mode = 'filter';
        results = [];
        page = 0;
        exhausted = false;
        error = '';
        lastQuery = '';
      }
      return;
    }

    liveTimer = setTimeout(() => {
      liveTimer = null;
      if (text === lastQuery) return;
      startSearch(text, { push: false });
    }, LIVE_DELAY);
  }

  /** Быстрый подбор по одному жанру — без открытия панели. */
  /** @param {string} genre */
  async function searchGenre(genre) {
    filters = { sort: 0, genres: [genre] };
    query = '';
    mode = 'filter';
    results = [];
    page = 0;
    exhausted = false;
    searched = true;
    await load(true);
  }

  async function openFilters() {
    showFilters = true;
    if (optionsLoaded) return;

    try {
      filterOptions = await bridge.filterOptions();
      optionsLoaded = true;
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    }
  }

  /** @param {any} next */
  async function applyFilters(next) {
    filters = next;
    showFilters = false;
    results = [];
    page = 0;
    exhausted = false;
    error = '';
    searched = true;

    // С запросом фильтры API не применяет — сообщаем честно.
    if (query.trim()) {
      mode = 'search';
      await load();
      return;
    }

    mode = 'filter';
    await load(true);
  }

  function loadMore() {
    load();
  }

  function reset() {
    query = '';
    filters = { sort: 0 };
    results = [];
    page = 0;
    searched = false;
    exhausted = false;
    error = '';
    inputEl?.focus({ preventScroll: true });
  }

  /** @param {string} value */
  function removeHistory(value) {
    const next = history.filter((h) => h !== value);
    history = next;
    bridge.settings.set('searchHistory', next).catch(() => {});
  }

  /** @param {string} next */
  function setView(next) {
    view = next;
    bridge.settings.set('searchView', next).catch(() => {});
  }

  function clearHistory() {
    history = [];
    bridge.settings.set('searchHistory', []).catch(() => {});
  }

  /** Витрина: что посмотреть, когда ещё ничего не введено. */
  async function loadDiscover() {
    discoverLoading = true;
    try {
      const [popular, top] = await Promise.all([
        bridge.catalog(0, { sort: 3, country: 'Япония' }, false),
        bridge.catalog(0, { sort: 1, country: 'Япония' }, false),
      ]);
      discover = {
        popular: popular.slice(0, DISCOVER_LIMIT),
        top: top.slice(0, DISCOVER_LIMIT),
      };
    } catch {
      /* витрина не критична: экран работает и без неё */
    } finally {
      discoverLoading = false;
    }

    try {
      const options = optionsLoaded ? filterOptions : await bridge.filterOptions();
      filterOptions = options;
      optionsLoaded = true;
      quickGenres = options.genres.slice(0, 12);
    } catch {
      quickGenres = [];
    }
  }

  onMount(() => {
    bridge.settings
      .all()
      .then((saved) => {
        if (Array.isArray(saved.searchHistory)) history = saved.searchHistory.slice(0, HISTORY_LIMIT);
        if (saved.searchView === 'list' || saved.searchView === 'grid') view = saved.searchView;
      })
      .catch(() => {});

    loadDiscover();
    // preventScroll: иначе фокус при монтировании прокручивает экран вниз.
    inputEl?.focus({ preventScroll: true });
  });

  // Подгрузка при подходе к низу.
  $effect(() => {
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && searched) loadMore();
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
      if (!searched) return;
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 600) load();
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  });
</script>

<div class="catalog-head">
  <h2>{mode === 'filter' && searched ? 'Подбор по фильтрам' : 'Поиск'}</h2>

  <div class="head-right">
    {#if results.length > 0}
      <div class="viewtoggle">
        <button
          class:active={view === 'grid'}
          onclick={() => setView('grid')}
          title="Сетка"
          aria-label="Сетка"
        >
          <Icon name="grid" size={17} />
        </button>
        <button
          class:active={view === 'list'}
          onclick={() => setView('list')}
          title="Список"
          aria-label="Список"
        >
          <Icon name="list" size={17} />
        </button>
      </div>
    {/if}

    <button class="filter-btn" class:active={activeFilters > 0} onclick={openFilters}>
      <Icon name="filter" size={16} />
      Фильтры{activeFilters > 0 ? ` (${activeFilters})` : ''}
    </button>
    {#if searched}
      <button onclick={reset}>Сбросить</button>
    {/if}
  </div>
</div>

<div class="searchfield big">
  <span class="field-icon"><Icon name="search" size={20} /></span>
  <input
    type="text"
    bind:this={inputEl}
    placeholder={searched ? 'Название аниме…' : 'Что посмотрим? Например, «Наруто»'}
    bind:value={query}
    oninput={() => scheduleLiveSearch()}
    onkeydown={(e) => {
      if (e.key === 'Enter') startSearch();
      if (e.key === 'Escape') reset();
    }}
  />
  <button class="primary" onclick={() => startSearch()} disabled={loading}>
    {loading && searched ? 'Поиск…' : 'Найти'}
  </button>
</div>

{#if !searched}
  <!-- Пустой вход: чем заняться, пока ничего не введено. -->
  {#if history.length > 0}
    <div class="quick-row">
      <span class="quick-label">Последние</span>
      <div class="chips">
        {#each history as value (value)}
          <button class="chip" onclick={() => startSearch(value)}>
            <Icon name="clock" size={13} />
            {value}
            <span
              class="chip-x"
              role="button"
              tabindex="0"
              aria-label="Убрать из истории"
              onclick={(e) => {
                e.stopPropagation();
                removeHistory(value);
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  removeHistory(value);
                }
              }}
            >
              <Icon name="close" size={12} stroke={2} />
            </span>
          </button>
        {/each}
        <button class="chip ghost" onclick={clearHistory}>Очистить</button>
      </div>
    </div>
  {/if}

  {#if quickGenres.length > 0}
    <div class="quick-row">
      <span class="quick-label">Жанры</span>
      <div class="chips">
        {#each quickGenres as genre (genre)}
          <button class="chip" onclick={() => searchGenre(genre)}>{genre}</button>
        {/each}
        <button class="chip ghost" onclick={openFilters}>Все жанры…</button>
      </div>
    </div>
  {/if}

  {#if discoverLoading}
    <div class="grid discover-grid">
      {#each Array.from({ length: 12 }) as _, i (i)}
        <div class="skeleton-card" aria-hidden="true">
          <div class="skeleton skeleton-poster"></div>
          <div class="skeleton skeleton-line"></div>
        </div>
      {/each}
    </div>
  {:else}
    {#each [{ title: 'Популярное сейчас', items: discover.popular }, { title: 'Топ по рейтингу', items: discover.top }] as block (block.title)}
      {#if block.items.length > 0}
        <section class="discover">
          <div class="discover-head">
            <h3>{block.title}</h3>
          </div>
          <div class="grid">
            {#each block.items as item (item.id)}
              <ReleaseCard {item} onOpen={onOpen} />
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  {/if}
{/if}

{#if searched && query.trim() && activeFilters > 0}
  <p class="hint">
    Поиск по названию фильтры не учитывает — очистите строку, чтобы подбирать по фильтрам.
  </p>
{/if}

{#if error}
  <p class="err">{error}</p>
{/if}

{#if searched && results.length === 0 && !loading}
  <div class="empty-state">
    <p>Ничего не нашлось. Попробуйте другое название или подбор по фильтрам.</p>
    <button class="primary" onclick={reset}>Сбросить</button>
  </div>
{/if}

{#if results.length > 0}
  <div class="head-right result-count">
    <span class="meta dim">найдено: {results.length}</span>
  </div>

  {#if view === 'grid'}
    <VirtualGrid items={results}>
      {#snippet item(entry)}
        <ReleaseCard
          item={entry}
          onOpen={onOpen}
          onMenu={() => (menuItem = entry)}
          badge={entry.listStatus
            ? { label: listLabel(entry.listStatus), cls: listClass(entry.listStatus) }
            : null}
        />
      {/snippet}
    </VirtualGrid>
  {:else}
    <ul class="rows">
      {#each results as item (item.id)}
        <li>
          <button class="row" onclick={() => onOpen(item.id)}>
            <div class="row-poster">
              {#if item.poster}
                <img src={item.poster} alt="" loading="lazy" referrerpolicy="no-referrer" />
              {/if}
              {#if item.listStatus}
                <span class="poster-badge {listClass(item.listStatus)}">{listLabel(item.listStatus)}</span>
              {/if}
            </div>
            <div class="row-body">
              <div class="row-title">{item.title}</div>
              <div class="row-meta">
                {#if item.status === 'Анонс'}
                  <span>{formatPremiere(item)}</span>
                {:else}
                  {#if item.episodesTotal || item.episodesReleased}
                    <span>{formatEpisodesShort(item.episodesReleased, item.episodesTotal)}</span>
                  {/if}
                  {#if item.grade}
                    <span class="row-grade">{formatGrade(item.grade)}<span class="row-star">★</span></span>
                  {/if}
                {/if}
              </div>
              {#if item.genres.length}
                <div class="row-genres">{item.genres.join(' · ')}</div>
              {/if}
              {#if item.description}
                <div class="row-desc">{formatSnippet(item.description)}</div>
              {/if}
            </div>
          </button>

          <button class="row-menu" title="В список" onclick={() => (menuItem = item)}>
            <Icon name="more" size={16} stroke={2.4} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="foot" bind:this={sentinel}>
    {#if loading}
      <span class="meta dim">Загрузка…</span>
    {:else if exhausted && results.length > 0}
      <span class="meta dim">найдено: {results.length} · больше нет</span>
    {/if}
  </div>
{/if}

{#if showFilters}
  <FilterPanel
    values={filters}
    options={filterOptions}
    onApply={applyFilters}
    onClose={() => (showFilters = false)}
  />
{/if}

{#if menuItem}
  <ReleaseMenu
    releaseId={menuItem.id}
    current={menuItem.listStatus ?? null}
    isFavorite={Boolean(menuItem.isFavorite)}
    onChange={(status, favorite) => {
      // Правим объект в результатах, а не копию: меню можно вызывать повторно.
      const entry =
        results.find((i) => i.id === menuItem.id) ||
        discover.popular.find((i) => i.id === menuItem.id) ||
        discover.top.find((i) => i.id === menuItem.id) ||
        menuItem;
      entry.listStatus = status;
      entry.isFavorite = favorite;
    }}
    onClose={() => (menuItem = null)}
  />
{/if}
