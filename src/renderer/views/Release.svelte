<script>
  /**
   * Страница тайтла. Двухколоночная раскладка:
   * слева — постер, кнопка «Смотреть», метрики, жанры, подробности;
   * справа — название, описание, кадры.
   */
  import { onMount } from 'svelte';
  import { bridge } from '../lib/bridge.js';
  import Comments from '../components/Comments.svelte';
  import ReleaseMenu from '../components/ReleaseMenu.svelte';
  import VideoModal from '../components/VideoModal.svelte';
  import Icon from '../components/Icon.svelte';
  import { listLabel, listClass } from '../lib/lists.js';
  import { formatGrade, formatCount, formatDuration, formatBytes, plural, formatAgeRating } from '../lib/format.js';

  /** @type {{ id: number, onBack: () => void, onWatch: (id: number) => void, onOpen: (id: number) => void }} */
  let { id, onBack, onWatch, onOpen, onListChange = null } = $props();

  /** @type {any|null} */
  let release = $state(null);
  let loading = $state(true);
  let error = $state('');
  let expanded = $state(false);

  /** @type {{ libriaId: number, torrents: any[] } | null} */
  let torrents = $state(null);
  let torrentsLoading = $state(true);
  let torrentsError = $state('');
  let saving = $state('');
  let notice = $state('');
  let showListMenu = $state(false);

  /** Видео релиза: категории с обложками + общее число. */
  /** @type {any[]} */
  let videoBanners = $state([]);
  let videoTotal = $state(0);
  /** Модалка со всеми видео: null — закрыта, число — начальная категория. */
  let videoModal = $state(null);
  /** Франшиза: связанные тайтлы. */
  /** @type {any[]} */
  let relatedItems = $state([]);
  let relatedTotal = $state(0);
  let relatedOpen = $state(false);
  let relatedLoading = $state(false);

  /** Сезоны Anixart: 1 зима, 2 весна, 3 лето, 4 осень (сверено по датам выхода). */
  const SEASONS = { 1: 'зима', 2: 'весна', 3: 'лето', 4: 'осень' };

  /** @param {number} season @param {string} year */
  function seasonLabel(season, year) {
    const name = SEASONS[season];
    if (!name) return year || '';
    return year ? `${name} ${year}` : name;
  }

  /** С заглавной — для блока «Подробности». */
  /** @param {number} season @param {string} year */
  function seasonCap(season, year) {
    const text = seasonLabel(season, year);
    return text ? text[0].toUpperCase() + text.slice(1) : '';
  }

  onMount(async () => {
    loading = true;
    error = '';
    // Торренты грузим параллельно и не блокируем карточку.
    bridge.torrents
      .list(id)
      .then((value) => (torrents = value))
      .catch((err) => (torrentsError = err && err.message ? err.message : String(err)))
      .finally(() => (torrentsLoading = false));

    try {
      release = await bridge.release(id);
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    } finally {
      loading = false;
    }

    // Видео и франшиза не блокируют карточку: грузим после релиза.
    loadVideos();
    loadRelatedPreview();
  });

  async function loadVideos() {
    // Обложки категорий уже пришли в карточке; берём только их и общее число.
    videoBanners = release?.videoBanners || [];
    try {
      const res = await bridge.videos(id, 0);
      videoTotal = res.total;
      // Если баннеров нет — собираем категории из самих роликов.
      if (videoBanners.length === 0 && res.items.length) {
        const seen = new Map();
        for (const video of res.items) {
          if (!seen.has(video.categoryId)) {
            seen.set(video.categoryId, {
              id: video.categoryId,
              name: video.category,
              image: video.image,
            });
          }
        }
        videoBanners = [...seen.values()];
      }
    } catch {
      /* нет видео — не ошибка */
    }
  }

  async function loadRelatedPreview() {
    // /related/ принимает id группы («франшизы»), а не id релиза.
    const groupId = release?.related?.id;
    if (!groupId) return;

    try {
      const res = await bridge.related(groupId, 0);
      relatedItems = res.items;
      relatedTotal = res.total;
    } catch {
      /* франшизы может не быть */
    }
  }

  /** «Все N»: догружаем остальные страницы франшизы. */
  async function toggleRelated() {
    if (relatedOpen) {
      relatedOpen = false;
      return;
    }

    relatedOpen = true;
    if (relatedItems.length >= relatedTotal || relatedLoading) return;

    const groupId = release?.related?.id;
    if (!groupId) return;

    relatedLoading = true;
    try {
      let page = 1;
      while (relatedItems.length < relatedTotal && page < 6) {
        const res = await bridge.related(groupId, page);
        if (!res.items.length) break;

        const known = new Set(relatedItems.map((i) => i.id));
        relatedItems = [...relatedItems, ...res.items.filter((i) => !known.has(i.id))];
        page += 1;
      }
    } catch {
      /* показываем то, что есть */
    } finally {
      relatedLoading = false;
    }
  }

  /** @param {number|null} categoryId */
  function openVideoModal(categoryId) {
    videoModal = categoryId ?? 0;
  }

  /** «Вы здесь» и окно из трёх частей вокруг текущего тайтла. */
  const franchiseWindow = $derived.by(() => {
    if (relatedItems.length <= 3) return relatedItems;

    const index = relatedItems.findIndex((item) => item.id === release?.id);
    if (index === -1) return relatedItems.slice(0, 3);

    const start = Math.min(Math.max(index - 1, 0), relatedItems.length - 3);
    return relatedItems.slice(start, start + 3);
  });

  const COVER_LIMIT = 320;

  /** Процент от общего числа. */
  /** @param {number} value @param {number} total */
  function share(value, total) {
    if (!total) return 0;
    return Math.round((value / total) * 100);
  }

  /** Сумма голосов по всем оценкам. */
  let votesTotal = $derived(
    release ? release.voteHistogram.reduce((sum, n) => sum + n, 0) : 0
  );

  /** Сумма по всем спискам. */
  let listsTotal = $derived(
    release
      ? release.lists.watching +
        release.lists.planned +
        release.lists.holdOn +
        release.lists.dropped +
        release.lists.completed
      : 0
  );

  /** @param {any} torrent */
  async function saveTorrent(torrent) {
    saving = torrent.hash;
    torrentsError = '';
    try {
      const res = await bridge.torrents.save(torrent.hash, torrent.filename);
      if (res && res.saved) {
        notice = `Сохранено: ${res.path}`;
        setTimeout(() => (notice = ''), 6000);
      }
    } catch (err) {
      torrentsError = err && err.message ? err.message : String(err);
    } finally {
      saving = '';
    }
  }
</script>

<div class="release-head">
  <button class="back-link" onclick={onBack}>
    <Icon name="back" size={17} />
    назад
  </button>
</div>

{#if error}
  <p class="err">{error}</p>
{/if}

{#if showListMenu}
  <ReleaseMenu
    releaseId={release.id}
    current={release.listStatus ?? null}
    isFavorite={Boolean(release.isFavorite)}
    onChange={(status, favorite) => {
      release.listStatus = status;
      release.isFavorite = favorite;
      showListMenu = false;
      // Списки на других экранах должны узнать об изменении, они живут в DOM.
      if (onListChange) onListChange(release.id, status, favorite);
    }}
    onClose={() => (showListMenu = false)}
  />
{/if}

{#if loading}
  <p class="meta dim">Загрузка…</p>
{:else if release}
  <div class="release-layout">
    <!-- ЛЕВАЯ КОЛОНКА -->
    <div class="col-left">
      <div class="poster-big">
        {#if release.poster}
          <img src={release.poster} alt="" referrerpolicy="no-referrer" />
        {/if}
      </div>

      <button class="btn-watch" onclick={() => onWatch(release.id)}>
        <Icon name="play" size={18} />
        Смотреть
      </button>

      <button
        class="btn-list {release.listStatus ? listClass(release.listStatus) : ''}"
        onclick={() => (showListMenu = true)}
      >
        {#if release.listStatus}
          В списке: {listLabel(release.listStatus)}
        {:else}
          + В список
        {/if}
      </button>

      <div class="metrics">
        <div class="metric">
          <div class="metric-value">{formatGrade(release.grade)} ★</div>
          <div class="metric-label">{formatCount(release.votes)} оценок</div>
        </div>
        <div class="metric">
          <div class="metric-value">
            {release.episodesReleased}{#if release.episodesTotal}{' из '}{release.episodesTotal}{/if}
          </div>
          <div class="metric-label">
            {plural(release.episodesTotal || release.episodesReleased, ['эпизод', 'эпизода', 'эпизодов'])}
            {#if release.duration}· по {formatDuration(release.duration)}{/if}
          </div>
        </div>
        <div class="metric">
          <div class="metric-value">{release.status || '—'}</div>
          <div class="metric-label">
            {release.category || ''}
            {#if release.season || release.year}{' · '}{seasonLabel(release.season, release.year)}{/if}
          </div>
        </div>
      </div>

      {#if release.genres.length}
        <div class="chips">
          {#each release.genres as genre (genre)}
            <span class="chip">{genre}</span>
          {/each}
        </div>
      {/if}

      <div class="details">
        <h3>Подробности</h3>
        {#if release.country}
          <div class="row-info"><span class="meta">Страна</span><span>{release.country}</span></div>
        {/if}
        {#if release.studio}
          <div class="row-info"><span class="meta">Студия</span><span>{release.studio}</span></div>
        {/if}
        {#if release.director}
          <div class="row-info"><span class="meta">Режиссёр</span><span>{release.director}</span></div>
        {/if}
        {#if release.source}
          <div class="row-info"><span class="meta">Первоисточник</span><span>{release.source}</span></div>
        {/if}
        {#if release.season || release.year}
          <div class="row-info">
            <span class="meta">Сезон</span>
            <span>{seasonCap(release.season, release.year)}</span>
          </div>
        {/if}
        {#if release.releaseDate}
          <div class="row-info"><span class="meta">Выход</span><span>{release.releaseDate}</span></div>
        {/if}
        {#if formatAgeRating(release.ageRating)}
          <div class="row-info"><span class="meta">Возраст</span><span>{formatAgeRating(release.ageRating)}</span></div>
        {/if}
      </div>

      {#if torrentsLoading}
        <div class="details"><span class="meta dim">Ищем торренты…</span></div>
      {:else if torrents && torrents.torrents.length > 0}
        <div class="details">
          <h3>Торренты <span class="meta dim">{torrents.torrents.length}</span></h3>
          {#if torrentsError}<p class="err">{torrentsError}</p>{/if}
          {#each torrents.torrents as t (t.hash)}
            <div class="torrent-row">
              <div class="torrent-info">
                <div class="torrent-quality">
                  {t.quality || t.type || '—'}
                  {#if t.codec}<span class="meta dim">· {t.codec}</span>{/if}
                </div>
                <div class="meta dim">
                  {formatBytes(t.size)} · {t.seeders}
                  {plural(t.seeders, ['сид', 'сида', 'сидов'])}
                </div>
              </div>
              <button
                class="torrent-save"
                disabled={saving === t.hash}
                onclick={() => saveTorrent(t)}
                title="Скачать .torrent"
              >
                {#if saving === t.hash}
                  <Icon name="spinner" size={16} />
                {:else}
                  <Icon name="download" size={16} />
                {/if}
              </button>
            </div>
          {/each}
          {#if notice}<p class="meta dim">{notice}</p>{/if}
        </div>
      {/if}
    </div>

    <!-- ПРАВАЯ КОЛОНКА -->
    <div class="col-right">
      <h1 class="release-title">
        {release.title}
        {#if release.isAdult}<span class="age">18+</span>{/if}
      </h1>
      {#if release.titleOriginal}
        <div class="original">{release.titleOriginal}</div>
      {/if}

      {#if release.description}
        <p class="desc" class:clamped={!expanded}>
          {release.description}
        </p>
        {#if release.description.length > COVER_LIMIT}
          <button class="linkbtn" onclick={() => (expanded = !expanded)}>
            {expanded ? 'Свернуть' : 'Читать дальше'}
          </button>
        {/if}
      {/if}

      {#if release.screenshots.length}
        <div class="section-block">
          <h3>Кадры <span class="meta dim">{release.screenshots.length}</span></h3>
          <div class="covers">
            {#each release.screenshots as shot (shot)}
              <img src={shot} alt="" loading="lazy" referrerpolicy="no-referrer" />
            {/each}
          </div>
        </div>
      {/if}

      {#if videoBanners.length}
        <div class="section-block">
          <div class="section-head">
            <h3>Видео <span class="meta dim">{videoTotal || ''}</span></h3>
            <button class="linkbtn" onclick={() => openVideoModal(null)}>Показать все</button>
          </div>

          <div class="video-tiles">
            {#each videoBanners as banner (banner.id)}
              <button
                class="video-tile"
                onclick={() => openVideoModal(banner.id)}
                title={`Все: ${banner.name}`}
              >
                {#if banner.image}
                  <img
                    src={banner.image}
                    alt=""
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    onerror={(e) => (e.currentTarget.style.display = 'none')}
                  />
                {/if}
                <span class="video-tile-veil"></span>
                <span class="video-tile-play"><Icon name="play" size={14} /></span>
                <span class="video-tile-name">{banner.name}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if relatedItems.length}
        <div class="section-block">
          <div class="section-head">
            <h3>
              Франшиза
              <span class="franchise-count">{relatedTotal}</span>
            </h3>
          </div>

          <div class="franchise-panel">
            <ul class="franchise-list">
              {#each (relatedOpen ? relatedItems : franchiseWindow) as item (item.id)}
                {@const here = item.id === release.id}
                <li class="franchise-item" class:current={here}>
                  <span class="franchise-dot"></span>
                  <button class="franchise-row" onclick={() => onOpen(item.id)}>
                    <span class="franchise-poster">
                      {#if item.poster}
                        <img src={item.poster} alt="" loading="lazy" referrerpolicy="no-referrer" />
                      {/if}
                    </span>
                    <span class="franchise-body">
                      <span class="franchise-title">{item.title}</span>
                      <span class="franchise-meta">
                        {item.category || 'Тайтл'}{#if item.year}{' · '}{item.year}{/if}{#if here}{' · Вы здесь'}{/if}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={16} class="franchise-chevron" />
                  </button>
                </li>
              {/each}
            </ul>

            {#if relatedTotal > 3}
              <button class="franchise-more" onclick={toggleRelated} disabled={relatedLoading}>
                <span>
                  {relatedOpen
                    ? 'Свернуть'
                    : relatedLoading
                      ? 'Загрузка…'
                      : `Все ${relatedTotal} частей`}
                </span>
                <Icon
                  name={relatedOpen ? 'chevron-down' : 'chevron-right'}
                  size={16}
                  stroke={1.8}
                />
              </button>
            {/if}
          </div>
        </div>
      {/if}

      {#if votesTotal > 0}
        <div class="section-block">
          <h3>Оценки и списки</h3>

          <div class="ratings">
            <div class="rating-big">
              <div class="rating-value">{formatGrade(release.grade)}</div>
              <div class="meta dim">{formatCount(release.votes)} оценок</div>
            </div>

            <div class="histogram">
              {#each [5, 4, 3, 2, 1] as star (star)}
                {@const count = release.voteHistogram[star - 1]}
                <div class="hist-row">
                  <span class="hist-star">{star}</span>
                  <div class="hist-track">
                    <div class="hist-fill" style="width:{share(count, votesTotal)}%"></div>
                  </div>
                  <span class="hist-count meta dim">{share(count, votesTotal)}%</span>
                </div>
              {/each}
            </div>
          </div>

          <div class="your-vote">
            <span class="meta">Ваша оценка</span>
            <div class="stars">
              {#each [1, 2, 3, 4, 5] as star (star)}
                <button
                  class="star"
                  class:on={release.yourVote >= star}
                  title={release.yourVote === star ? 'Снять оценку' : `Оценить на ${star}`}
                  onclick={async () => {
                    const next = release.yourVote === star ? 0 : star;
                    try {
                      await bridge.setVote(release.id, next);
                      release.yourVote = next || null;
                    } catch {
                      /* оценка не поставилась — молча */
                    }
                  }}
                >
                  <Icon name={release.yourVote >= star ? 'star-filled' : 'star'} size={18} />
                </button>
              {/each}
            </div>
          </div>

          {#if listsTotal > 0}
            <div class="lists">
              <div class="lists-head">
                <span>В списках у людей</span>
                <span class="meta dim">{formatCount(listsTotal)}</span>
              </div>

              <div class="lists-bar">
                <span class="seg watching" style="width:{share(release.lists.watching, listsTotal)}%"></span>
                <span class="seg planned" style="width:{share(release.lists.planned, listsTotal)}%"></span>
                <span class="seg hold" style="width:{share(release.lists.holdOn, listsTotal)}%"></span>
                <span class="seg dropped" style="width:{share(release.lists.dropped, listsTotal)}%"></span>
              </div>

              <div class="lists-legend">
                <span><i class="dot watching"></i>Смотрю {formatCount(release.lists.watching)}</span>
                <span><i class="dot planned"></i>В планах {formatCount(release.lists.planned)}</span>
                <span><i class="dot hold"></i>Отложено {formatCount(release.lists.holdOn)}</span>
                <span><i class="dot dropped"></i>Брошено {formatCount(release.lists.dropped)}</span>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      {#if release.recommendations.length > 0}
        <div class="section-block">
          <h3>Рекомендуем также</h3>
          <div class="reco">
            {#each release.recommendations as rec (rec.id)}
              <button class="reco-card" onclick={() => onOpen(rec.id)}>
                <div class="reco-poster">
                  {#if rec.poster}
                    <img src={rec.poster} alt="" loading="lazy" referrerpolicy="no-referrer" />
                  {/if}
                </div>
                <div class="reco-title">{rec.title}</div>
                <div class="reco-meta">
                  {#if rec.grade}★ {formatGrade(rec.grade)}{/if}
                  {#if rec.category}· {rec.category}{/if}
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if release.commentCount > 0}
        <Comments releaseId={release.id} initialCount={release.commentCount} />
      {/if}
    </div>
  </div>
{/if}

{#if videoModal !== null && release}
  <VideoModal
    releaseId={release.id}
    releaseTitle={release.title}
    banners={videoBanners}
    initialCategory={videoModal === 0 ? null : videoModal}
    onClose={() => (videoModal = null)}
  />
{/if}
