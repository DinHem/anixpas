<script>
  /**
   * Панель фильтров каталога.
   *
   * Страна, статус и категория живут на вкладках каталога — здесь их нет,
   * чтобы не дублировать. Тут всё остальное, что реально поддерживает API
   * (docs/api-scout.md §18).
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

  const SEASONS = [
    { id: null, label: 'Неважно' },
    { id: 0, label: 'Зима' },
    { id: 1, label: 'Весна' },
    { id: 2, label: 'Лето' },
    { id: 3, label: 'Осень' },
  ];

  let draft = $state({
    sort: values.sort ?? 0,
    genres: [...(values.genres || [])],
    studio: values.studio || '',
    source: values.source || '',
    season: values.season ?? null,
    episodesFrom: values.episodesFrom ?? null,
    episodesTo: values.episodesTo ?? null,
    types: [...(values.types || [])],
  });

  /** @param {string[]} list @param {string} value */
  function toggle(list, value) {
    const index = list.indexOf(value);
    if (index >= 0) list.splice(index, 1);
    else list.push(value);
  }

  /** Приводит черновик к чистому виду перед отправкой. */
  function buildResult() {
    return {
      sort: draft.sort,
      genres: draft.genres,
      studio: draft.studio.trim() || undefined,
      source: draft.source || undefined,
      season: draft.season ?? undefined,
      episodesFrom: Number.isInteger(draft.episodesFrom) ? draft.episodesFrom : undefined,
      episodesTo: Number.isInteger(draft.episodesTo) ? draft.episodesTo : undefined,
      types: draft.types,
    };
  }

  function reset() {
    draft = {
      sort: 0,
      genres: [],
      studio: '',
      source: '',
      season: null,
      episodesFrom: null,
      episodesTo: null,
      types: [],
    };
  }

  /** Сколько фильтров активно — для счётчика на кнопке. */
  let activeCount = $derived(
    draft.genres.length +
      draft.types.length +
      (draft.studio.trim() ? 1 : 0) +
      (draft.source ? 1 : 0) +
      (draft.season !== null ? 1 : 0) +
      (draft.episodesFrom !== null || draft.episodesTo !== null ? 1 : 0)
  );
</script>

<div class="filter-backdrop" role="presentation" onclick={onClose}>
  <aside class="filter-panel" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <header class="filter-head">
      <h2>Фильтр</h2>
      <button class="pbtn" onclick={onClose} title="Закрыть">✕</button>
    </header>

    <div class="filter-body">
      <label class="field">
        <span>Сортировка</span>
        <select bind:value={draft.sort}>
          {#each SORTS as s (s.id)}
            <option value={s.id}>{s.label}</option>
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

      <label class="field">
        <span>Сезон</span>
        <select bind:value={draft.season}>
          {#each SEASONS as s (String(s.id))}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
      </label>

      <div class="field-row">
        <label class="field">
          <span>Эпизодов от</span>
          <input type="number" min="0" max="5000" bind:value={draft.episodesFrom} />
        </label>
        <label class="field">
          <span>до</span>
          <input type="number" min="0" max="5000" bind:value={draft.episodesTo} />
        </label>
      </div>

      {#if options.genres.length}
        <div class="field">
          <span>Жанры</span>
          <p class="hint">Покажем релизы со <b>всеми</b> выбранными жанрами — так работает API.</p>
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
        <div class="field">
          <span>Озвучки</span>
          <div class="checkbox-list">
            {#each options.types as t (t.id)}
              <label class="cb">
                <input
                  type="checkbox"
                  checked={draft.types.includes(t.id)}
                  onchange={() => toggle(draft.types, t.id)}
                />
                {t.name}
                {#if t.isSub}<span class="meta dim">суб</span>{/if}
              </label>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <footer class="filter-foot">
      <button onclick={reset}>Сбросить</button>
      <button class="primary" onclick={() => onApply(buildResult())}>
        Применить{activeCount ? ` (${activeCount})` : ''}
      </button>
    </footer>
  </aside>
</div>
