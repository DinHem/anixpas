<script>
  import Icon from './Icon.svelte';
  /**
   * Панель фильтров — как в оригинальном приложении: сетка полей в две-три колонки.
   *
   * Все поля проверены живыми запросами (docs/api-scout.md §27.3): годы, длительность
   * эпизода, возрастной рейтинг, режим жанров.
   */

  /**
   * @type {{
   *   values: any,
   *   options: { genres: string[], sources: string[], types: any[] },
   *   onApply: (values: any) => void,
   *   onClose: () => void,
   * }}
   */
  let { values, options, onApply, onClose } = $props();

  const SORTS = [
    { id: 0, label: 'По дате обновления' },
    { id: 1, label: 'По рейтингу' },
    { id: 3, label: 'По популярности' },
  ];

  const CATEGORIES = [
    { id: null, label: 'Неважно' },
    { id: 1, label: 'Сериал' },
    { id: 2, label: 'Фильм' },
    { id: 3, label: 'OVA' },
  ];

  const STATUSES = [
    { id: null, label: 'Неважно' },
    { id: 2, label: 'Онгоинг' },
    { id: 1, label: 'Завершён' },
    { id: 3, label: 'Анонс' },
  ];

  const COUNTRIES = [
    { id: '', label: 'Неважно' },
    { id: 'Япония', label: 'Япония' },
    { id: 'Китай', label: 'Китай' },
    { id: 'Корея', label: 'Корея' },
  ];

  const SEASONS = [
    { id: null, label: 'Неважно' },
    { id: 0, label: 'Зима' },
    { id: 1, label: 'Весна' },
    { id: 2, label: 'Лето' },
    { id: 3, label: 'Осень' },
  ];

  /** Диапазоны эпизодов и длительности — как в оригинале, без ручного ввода. */
  const EPISODES = [
    { id: null, label: 'Неважно' },
    { id: 1, label: '1–12' },
    { id: 2, label: '13–25' },
    { id: 3, label: '26–100' },
    { id: 4, label: '100+' },
  ];

  const DURATIONS = [
    { id: null, label: 'Неважно' },
    { id: 1, label: 'до 10 мин' },
    { id: 2, label: '11–30 мин' },
    { id: 3, label: '30+ мин' },
  ];

  const AGES = [
    { id: 2, label: '6+' },
    { id: 3, label: '12+' },
    { id: 4, label: '16+' },
    { id: 5, label: '18+' },
  ];

  /** @param {any} value */
  const episodesRange = (value) => {
    if (value === 1) return { from: 1, to: 12 };
    if (value === 2) return { from: 13, to: 25 };
    if (value === 3) return { from: 26, to: 100 };
    if (value === 4) return { from: 100 };
    return {};
  };

  const durationRange = (value) => {
    if (value === 1) return { from: 1, to: 10 };
    if (value === 2) return { from: 11, to: 30 };
    if (value === 3) return { from: 31 };
    return {};
  };

  /** Обратное преобразование: из числовых границ в выбранный диапазон. */
  function episodesChoice(from, to) {
    if (from === 1 && to === 12) return 1;
    if (from === 13 && to === 25) return 2;
    if (from === 26 && to === 100) return 3;
    if (from === 100 && !to) return 4;
    return null;
  }

  function durationChoice(from, to) {
    if (from === 1 && to === 10) return 1;
    if (from === 11 && to === 30) return 2;
    if (from === 31 && !to) return 3;
    return null;
  }

  let draft = $state({
    sort: values.sort ?? 0,
    categoryId: values.category_id ?? null,
    statusId: values.status_id ?? null,
    country: values.country || '',
    season: values.season ?? null,
    genres: [...(values.genres || [])],
    genresMode: Number.isInteger(values.genresMode) ? values.genresMode : 0,
    studio: values.studio || '',
    source: values.source || '',
    types: [...(values.types || [])],
    ageRatings: [...(values.ageRatings || [])],
    episodes: episodesChoice(values.episodesFrom, values.episodesTo),
    duration: durationChoice(values.durationFrom, values.durationTo),
    startYear: values.startYear ?? null,
    endYear: values.endYear ?? null,
  });

  /** @param {string[]} list @param {string} value */
  function toggle(list, value) {
    const index = list.indexOf(value);
    if (index >= 0) list.splice(index, 1);
    else list.push(value);
  }

  /** @param {number[]} list @param {number} value */
  function toggleNumber(list, value) {
    const index = list.indexOf(value);
    if (index >= 0) list.splice(index, 1);
    else list.push(value);
  }

  /** Приводит черновик к чистому виду перед отправкой. */
  function buildResult() {
    const eps = episodesRange(draft.episodes);
    const dur = durationRange(draft.duration);

    return {
      sort: draft.sort,
      category_id: draft.categoryId,
      status_id: draft.statusId,
      country: draft.country || undefined,
      season: draft.season ?? undefined,
      genres: draft.genres,
      genresMode: draft.genresMode,
      studio: draft.studio.trim() || undefined,
      source: draft.source || undefined,
      types: draft.types,
      ageRatings: draft.ageRatings,
      episodesFrom: eps.from,
      episodesTo: eps.to,
      durationFrom: dur.from,
      durationTo: dur.to,
      startYear: Number.isInteger(draft.startYear) ? draft.startYear : undefined,
      endYear: Number.isInteger(draft.endYear) ? draft.endYear : undefined,
    };
  }

  function reset() {
    draft = {
      sort: 0,
      categoryId: null,
      statusId: null,
      country: '',
      season: null,
      genres: [],
      genresMode: 0,
      studio: '',
      source: '',
      types: [],
      ageRatings: [],
      episodes: null,
      duration: null,
      startYear: null,
      endYear: null,
    };
  }

  /** Сколько фильтров активно — для счётчика на кнопке. */
  let activeCount = $derived(
    draft.genres.length +
      draft.types.length +
      draft.ageRatings.length +
      (draft.studio.trim() ? 1 : 0) +
      (draft.source ? 1 : 0) +
      (draft.season !== null ? 1 : 0) +
      (draft.categoryId !== null ? 1 : 0) +
      (draft.statusId !== null ? 1 : 0) +
      (draft.country ? 1 : 0) +
      (draft.episodes !== null ? 1 : 0) +
      (draft.duration !== null ? 1 : 0) +
      (draft.startYear !== null || draft.endYear !== null ? 1 : 0)
  );
</script>

<div class="filter-backdrop" role="presentation" onclick={onClose}>
  <aside class="filter-panel wide" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <header class="filter-head">
      <h2>Фильтры</h2>
      <div class="filter-head-actions">
        <button class="linkbtn" onclick={reset}>Сбросить</button>
        <button class="primary" onclick={() => onApply(buildResult())}>
          Применить{activeCount ? ` (${activeCount})` : ''}
        </button>
        <button class="pbtn" onclick={onClose} title="Закрыть">
          <Icon name="close" size={16} stroke={2.2} />
        </button>
      </div>
    </header>

    <div class="filter-body grid">
      <label class="field">
        <span>Сортировка</span>
        <select bind:value={draft.sort}>
          {#each SORTS as s (s.id)}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>Категория</span>
        <select bind:value={draft.categoryId}>
          {#each CATEGORIES as c (String(c.id))}
            <option value={c.id}>{c.label}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>Статус</span>
        <select bind:value={draft.statusId}>
          {#each STATUSES as s (String(s.id))}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>Страна</span>
        <select bind:value={draft.country}>
          {#each COUNTRIES as c (c.id)}
            <option value={c.id}>{c.label}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>Сезон</span>
        <select bind:value={draft.season}>
          {#each SEASONS as s (String(s.id))}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>Эпизодов</span>
        <select bind:value={draft.episodes}>
          {#each EPISODES as e (String(e.id))}
            <option value={e.id}>{e.label}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>Длительность эпизода</span>
        <select bind:value={draft.duration}>
          {#each DURATIONS as d (String(d.id))}
            <option value={d.id}>{d.label}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>Студия</span>
        <input type="text" placeholder="Например, Pierrot" bind:value={draft.studio} />
      </label>

      <label class="field">
        <span>Первоисточник</span>
        <select bind:value={draft.source}>
          <option value="">Неважно</option>
          {#each options.sources as s (s)}
            <option value={s}>{s}</option>
          {/each}
        </select>
      </label>

      <div class="field span-2">
        <span>Годы</span>
        <div class="field-row">
          <input
            type="number"
            min="1940"
            max="2100"
            placeholder="с 2018"
            bind:value={draft.startYear}
          />
          <input
            type="number"
            min="1940"
            max="2100"
            placeholder="по 2027"
            bind:value={draft.endYear}
          />
        </div>
      </div>

      <div class="field span-2">
        <span>Возрастное ограничение</span>
        <div class="chips">
          {#each AGES as age (age.id)}
            <button
              type="button"
              class="chip"
              class:active={draft.ageRatings.includes(age.id)}
              onclick={() => toggleNumber(draft.ageRatings, age.id)}
            >
              {age.label}
            </button>
          {/each}
        </div>
      </div>

      {#if options.genres.length}
        <div class="field span-all">
          <span>Жанры</span>
          <div class="genres-head">
            <p class="hint">
              {draft.genresMode === 1
                ? 'Покажем релизы без выбранных жанров'
                : 'Покажем релизы со всеми выбранными жанрами'}
            </p>
            <button
              type="button"
              class="linkbtn"
              onclick={() => (draft.genresMode = draft.genresMode === 1 ? 0 : 1)}
            >
              {draft.genresMode === 1 ? 'Исключить жанры' : 'Только эти жанры'}
            </button>
          </div>
          <div class="checkbox-list">
            {#each options.genres as genre (genre)}
              <label class="cb">
                <input
                  type="checkbox"
                  checked={draft.genres.includes(genre)}
                  onchange={() => toggle(draft.genres, genre)}
                />
                {genre}
              </label>
            {/each}
          </div>
        </div>
      {/if}

      {#if options.types.length}
        <div class="field span-all">
          <span>Озвучки</span>
          <div class="checkbox-list">
            {#each options.types as t (t.id)}
              <label class="cb">
                <input
                  type="checkbox"
                  checked={draft.types.includes(t.id)}
                  onchange={() => toggleNumber(draft.types, t.id)}
                />
                {t.name}
                {#if t.isSub}<span class="meta dim">суб</span>{/if}
              </label>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </aside>
</div>
