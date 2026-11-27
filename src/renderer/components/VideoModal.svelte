<script>
  /**
   * Все видео релиза в одном окне поверх карточки.
   *
   * Категории приходят из `video_banners` карточки, сами ролики — из
   * /video/release/{id}/{page}. Грузим все страницы один раз: у больших
   * релизов их 3–5, дальше показываем секции по категориям без сети.
   */
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { bridge } from '../lib/bridge.js';

  /**
   * @type {{
   *   releaseId: number,
   *   releaseTitle?: string,
   *   banners: { id: number, name: string, image: string }[],
   *   initialCategory?: number|null,
   *   onClose: () => void,
   * }}
   */
  let { releaseId, releaseTitle = '', banners = [], initialCategory = null, onClose } = $props();

  /** @type {any[]} */
  let videos = $state([]);
  let loading = $state(true);
  let error = $state('');
  /** null — «Все». */
  let activeCategory = $state(initialCategory);

  /** Больше 10 страниц не тянем: 250 роликов — за глаза. */
  const MAX_PAGES = 10;

  const sections = $derived.by(() => {
    /** @type {{ id: number, name: string, items: any[] }[]} */
    const groups = [];

    for (const video of videos) {
      let group = groups.find((g) => g.id === video.categoryId);
      if (!group) {
        group = { id: video.categoryId, name: video.category, items: [] };
        groups.push(group);
      }
      group.items.push(video);
    }

    // Порядок секций — как у категорий на карточке (Трейлеры → Опенинги → …).
    const order = new Map(banners.map((banner, index) => [banner.id, index]));
    groups.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

    if (activeCategory === null) return groups;
    return groups.filter((g) => g.id === activeCategory);
  });

  async function load() {
    try {
      let page = 0;
      while (page < MAX_PAGES) {
        const res = await bridge.videos(releaseId, page);
        if (!res.items.length) break;

        const known = new Set(videos.map((v) => v.id));
        const fresh = res.items.filter((v) => !known.has(v.id));
        videos = [...videos, ...fresh];

        page += 1;
        if (videos.length >= res.total) break;
      }
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  /** @param {any} video */
  function openVideo(video) {
    if (!video || !video.url) return;
    bridge.openExternal(video.url).catch(() => {});
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  }

  onMount(load);
</script>

<svelte:window onkeydown={onKeydown} />

<div class="video-modal-backdrop" role="presentation" onclick={onClose}>
  <div
    class="video-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Видео релиза"
    onclick={(e) => e.stopPropagation()}
  >
    <header class="video-modal-head">
      <div>
        <h3>Видео</h3>
        {#if releaseTitle}<p class="meta dim">{releaseTitle}</p>{/if}
      </div>
      <button class="pbtn close" onclick={onClose} title="Закрыть" aria-label="Закрыть">
        <Icon name="close" size={16} stroke={2} />
      </button>
    </header>

    <div class="video-chips">
      <button
        class="filter-chip"
        class:active={activeCategory === null}
        onclick={() => (activeCategory = null)}
      >
        Все
        <span class="meta dim">{videos.length}</span>
      </button>
      {#each banners as banner (banner.id)}
        <button
          class="filter-chip"
          class:active={activeCategory === banner.id}
          onclick={() => (activeCategory = banner.id)}
        >
          {banner.name}
          <span class="meta dim">{videos.filter((v) => v.categoryId === banner.id).length}</span>
        </button>
      {/each}
    </div>

    <div class="video-modal-body">
      {#if loading}
        <div class="video-modal-state">Загрузка…</div>
      {:else if error}
        <p class="err">{error}</p>
      {:else if videos.length === 0}
        <div class="video-modal-state">У этого релиза пока нет видео.</div>
      {:else}
        {#each sections as section (section.id)}
          <section class="video-section">
            <h4>{section.name}</h4>
            <ul class="video-list">
              {#each section.items as video (video.id)}
                <li>
                  <button class="video-row" onclick={() => openVideo(video)} title={video.title}>
                    <span class="video-row-thumb">
                      {#if video.image}
                        <img
                          src={video.image}
                          alt=""
                          loading="lazy"
                          referrerpolicy="no-referrer"
                          onerror={(e) => (e.currentTarget.style.display = 'none')}
                        />
                      {/if}
                      <span class="video-row-play"><Icon name="play" size={14} /></span>
                    </span>
                    <span class="video-row-body">
                      <span class="video-row-title">{video.title || section.name}</span>
                      <span class="video-row-meta">
                        {section.name}{#if video.favorites}{' · '}★ {video.favorites}{/if}{#if video.hosting}{' · '}{video.hosting}{/if}
                      </span>
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      {/if}
    </div>
  </div>
</div>
