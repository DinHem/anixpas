<script>
  /**
   * Каталог с вкладками.
   *
   * Верхний уровень — страна: Аниме (Япония) / Дунхуа (Китай).
   * Второй уровень — статус или категория релиза.
   * Соответствия проверены запросами: docs/api-scout.md §17.
   */
  import { onMount } from 'svelte';
  import { bridge } from '../lib/bridge.js';
  import { formatGrade, formatPremiere, formatSnippet, formatEpisodesShort, formatClock } from '../lib/format.js';
  import ReleaseMenu from '../components/ReleaseMenu.svelte';
  import Icon from '../components/Icon.svelte';
  import VirtualGrid from '../components/VirtualGrid.svelte';
  import ReleaseCard from '../components/ReleaseCard.svelte';
  import { collectFresh } from '../lib/collect.js';
  import { listLabel, listClass } from '../lib/lists.js';

  /** @type {{ onOpen: (id: number) => void, onContinue: (id: number) => void, refreshKey?: number }} */
  let { onOpen, onContinue, refreshKey = 0 , patch = null } = $props();

  /** Вкладки по стране. */
  const COUNTRIES = [
    { id: 'anime', label: 'Аниме', country: 'Япония' },
    { id: 'donghua', label: 'Дунхуа', country: 'Китай' },
  ];

  /** Вкладки внутри страны. */
  const TABS = [
    { id: 'latest', label: 'Последнее', filter: {} },
    { id: 'ongoing', label: 'Онгоинги', filter: { status_id: 2 } },
    { id: 'announced', label: 'Анонсы', filter: { status_id: 3 } },
    { id: 'completed', label: 'Завершённые', filter: { status_id: 1 } },
    { id: 'films', label: 'Фильмы', filter: { category_id: 2 } },
    { id: 'ova', label: 'OVA', filter: { category_id: 3 } },
  ];

  let country = $state('anime');
  let tab = $state('latest');

  /** @type {any[]} */
  let items = $state([]);
  let page = $state(0);
  let loading = $state(false);
  let error = $state('');
  let exhausted = $state(false);
  /** @type {'grid'|'list'} */
  let mode = $state('grid');
  /** @type {any|null} */
  let lastWatched = $state(null);
  /** Плашка «Продолжить просмотр» закрыта человеком: ключ — тайтл + серия. */
  let continueHidden = $state('');
  /** Показывать кнопку «наверх», когда прокрутили далеко. */
  let showUp = $state(false);

  /** @type {HTMLElement|null} */
  let sentinel = $state(null);

  /** Релиз, для которого открыто меню списков. */
  /** @type {any|null} */
  let menuItem = $state(null);

  /** @param {any} item @param {number|null} status @param {boolean} favorite */
  function applyMenuChange(item, status, favorite) {
    // Правим объект в списке, а не копию: меню можно вызвать несколько раз подряд.
    const entry = items.find((i) => i.id === item.id) || item;
    entry.listStatus = status;
    entry.isFavorite = favorite;
  }

  // Карточка тайтла могла изменить список — подхватываем без перезагрузки.
  $effect(() => {
    if (!patch) return;
    const entry = items.find((i) => i.id === patch.id);
    if (entry) {
      entry.listStatus = patch.listStatus;
      entry.isFavorite = patch.isFavorite;
    }
  });

  /** Собирает фильтр из выбранных вкладок. */
  function currentFilter() {
    const countryDef = COUNTRIES.find((c) => c.id === country) || COUNTRIES[0];
    const tabDef = TABS.find((t) => t.id === tab) || TABS[0];
    return { sort: 0, ...tabDef.filter, country: countryDef.country };
  }

  /**
   * Идущая загрузка. Нужна, чтобы параллельные вызовы (прокрутка + монтирование)
   * ждали одну и ту же страницу, а не выходили сразу с пустым списком.
   * @type {Promise<void>|null}
   */
  let pendingLoad = null;

  async function load(force = false) {
    if (pendingLoad) return pendingLoad;
    if (exhausted) return;

    loading = true;
    error = '';

    pendingLoad = (async () => {
      try {
        // Страницы могут целиком состоять из дублей — collectFresh шагает дальше.
        const result = await collectFresh({
          page,
          knownIds: new Set(items.map((i) => i.id)),
          fetchPage: (p) => bridge.catalog(p, currentFilter(), force && p === page),
        });

        if (result.fresh.length > 0) items = [...items, ...result.fresh];
        page = result.page;
        exhausted = result.exhausted;
      } catch (err) {
        error = err && err.message ? err.message : String(err);
      }
    })();

    try {
      await pendingLoad;
    } finally {
      pendingLoad = null;
      loading = false;
    }

    // На большом окне контент может не заполнить экран: наблюдатель не выстрелит,
    // потому что низ списка и так в зоне видимости. Догружаем сами.
    if (!exhausted && needsMore()) setTimeout(() => load(), 200);
  }

  /** Низ списка в пределах экрана (с запасом на будущий скролл). */
  function needsMore() {
    if (!sentinel) return false;
    const rect = sentinel.getBoundingClientRect();
    return rect.top < window.innerHeight + 400;
  }

  /** Смена вкладки: сбрасываем список и грузим заново. */
  async function switchTo(next) {
    if (next.country && next.country !== country) {
      country = next.country;
      bridge.settings.set('catalogCountry', country).catch(() => {});
    }
    if (next.tab && next.tab !== tab) {
      tab = next.tab;
      bridge.settings.set('catalogTab', tab).catch(() => {});
    }

    items = [];
    page = 0;
    exhausted = false;
    error = '';

    // Смена вкладки — всегда свежие данные, мимо кэша.
    await load(true);
  }

  /**
   * Перечитывает «продолжить просмотр». Каталог живёт в DOM постоянно, поэтому
   * без этого плашка обновлялась бы только при запуске приложения.
   */
  async function refreshContinue() {
    try {
      lastWatched = await bridge.progress.last();
    } catch {
      /* прогресса нет — плашки не будет */
    }
  }

  /** Ключ «этот тайтл + эта серия»: после новой серии плашка вернётся. */
  const continueKey = $derived(
    lastWatched ? `${lastWatched.releaseId}:${lastWatched.lastPosition}` : ''
  );

  function hideContinue() {
    continueHidden = continueKey;
    bridge.settings.set('continueHidden', continueKey).catch(() => {});
  }

  function scrollToTop() {
    const scroller = document.querySelector('.main');
    if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** @param {'grid'|'list'} next */
  function setMode(next) {
    mode = next;
    bridge.settings.set('catalogMode', next).catch(() => {});
  }

  onMount(async () => {
    try {
      const saved = await bridge.settings.all();
      if (saved.catalogMode === 'list' || saved.catalogMode === 'grid') mode = saved.catalogMode;
      if (COUNTRIES.some((c) => c.id === saved.catalogCountry)) country = saved.catalogCountry;
      if (TABS.some((t) => t.id === saved.catalogTab)) tab = saved.catalogTab;
      if (typeof saved.continueHidden === 'string') continueHidden = saved.continueHidden;
    } catch {
      /* значения по умолчанию */
    }

    await refreshContinue();

    await load();

    console.log(
      '[checks] ' +
        JSON.stringify([
          ['каталог загружен через IPC', items.length > 0],
          ['подписи моделей корректны', Boolean(items[0] && typeof items[0].title === 'string')],
        ])
    );

    // Постеры и работоспособность прокрутки.
    setTimeout(() => {
      // Каталог может быть и сеткой, и списком — проверяем оба варианта.
      const imgs = [...document.querySelectorAll('.poster img, .row-poster img')];
      const scroller = document.querySelector('.main');
      let moved = false;
      if (scroller) {
        scroller.scrollTop = 600;
        moved = scroller.scrollTop > 0;
        scroller.scrollTop = 0;
      }
      console.log(
        '[checks] ' +
          JSON.stringify([
            ['постеры отрисовываются', imgs.some((i) => i.naturalWidth > 0)],
            ['скролл прокручивается', moved],
          ])
      );
    }, 2500);
  });

  /** Перезагрузка первой страницы при возврате в раздел. */
  let lastRefresh = refreshKey;
  $effect(() => {
    if (refreshKey === lastRefresh) return;
    lastRefresh = refreshKey;

    (async () => {
      // Смотрели серию и вернулись — плашка должна показать именно её.
      refreshContinue();

      try {
        const fresh = await bridge.catalog(0, currentFilter(), true);
        const known = new Set(fresh.map((i) => i.id));

        // Обновляем уже загруженные элементы, не теряя прокрутку.
        items = items.map((old) => fresh.find((n) => n.id === old.id) || old);
        for (const item of fresh) {
          if (!known.has(item.id) && !items.some((i) => i.id === item.id)) items = [...items, item];
        }
      } catch {
        /* обновление фоновое */
      }
    })();
  });

  // Подгрузка при подходе к низу.
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
      // Кнопка «наверх» появляется после примерно двух экранов.
      showUp = scroller.scrollTop > 900;
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 600) load();
    };

    onScroll();

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  });
</script>

<div class="catalog-head">
  <div class="tabs">
    {#each COUNTRIES as c (c.id)}
      <button
        class="tab"
        class:active={country === c.id}
        onclick={() => switchTo({ country: c.id })}
      >
        {c.label}
      </button>
    {/each}
  </div>

  <div class="head-right">
    <div class="viewtoggle">
      <button
        class:active={mode === 'grid'}
        onclick={() => setMode('grid')}
        title="Сетка"
        aria-label="Сетка"
      >
        <Icon name="grid" size={17} />
      </button>
      <button
        class:active={mode === 'list'}
        onclick={() => setMode('list')}
        title="Список"
        aria-label="Список"
      >
        <Icon name="list" size={17} />
      </button>
    </div>
  </div>
</div>

<div class="subtabs">
  {#each TABS as t (t.id)}
    <button
      class="subtab"
      class:active={tab === t.id}
      onclick={() => switchTo({ tab: t.id })}
    >
      {t.label}
    </button>
  {/each}
</div>

<div class="scrollarea">
  {#if lastWatched && continueHidden !== continueKey}
    <div class="continue-wrap">
      <button class="continue-card" onclick={() => onContinue(lastWatched.releaseId)}>
        <div class="continue-poster">
          {#if lastWatched.poster}
            <img src={lastWatched.poster} alt="" referrerpolicy="no-referrer" />
          {/if}
        </div>
        <div class="continue-body">
          <div class="continue-label">Продолжить просмотр</div>
          <div class="continue-title">{lastWatched.title || 'Без названия'}</div>
          <div class="continue-meta">
            {lastWatched.lastPosition} серия
            {#if lastWatched.lastTime}
              · {formatClock(lastWatched.lastTime)}
            {/if}
          </div>
        </div>
        <div class="continue-play"><Icon name="play" size={18} /></div>
      </button>

      <button class="continue-close" title="Скрыть до следующей серии" onclick={hideContinue}>
        <Icon name="close" size={15} stroke={2.2} />
      </button>
    </div>
  {/if}

  {#if error}
    <p class="err">{error}</p>
  {/if}

  {#if mode === 'grid'}
    <VirtualGrid items={items}>
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
      {#each items as item (item.id)}
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
    {:else if exhausted}
      <span class="meta dim">загружено: {items.length} · больше нет</span>
    {:else}
      <span class="meta dim">загружено: {items.length}</span>
    {/if}
  </div>
</div>

{#if showUp}
  <button class="scroll-up" title="Наверх" aria-label="Наверх" onclick={scrollToTop}>
    <Icon name="chevron-down" size={18} stroke={2} class="scroll-up-icon" />
  </button>
{/if}

{#if menuItem}
  <ReleaseMenu
    releaseId={menuItem.id}
    current={menuItem.listStatus ?? null}
    isFavorite={Boolean(menuItem.isFavorite)}
    onChange={(status, favorite) => applyMenuChange(menuItem, status, favorite)}
    onClose={() => (menuItem = null)}
  />
{/if}
