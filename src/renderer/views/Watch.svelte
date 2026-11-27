<script>
  /**
   * Двухпанельный выбор серий: слева озвучки, справа серии.
   * Учитывает прогресс просмотра (docs/00-decisions.md §9).
   */
  import { onMount } from 'svelte';
  import { bridge } from '../lib/bridge.js';
  import { formatCompact, plural } from '../lib/format.js';
  import Player from './Player.svelte';
  import Icon from '../components/Icon.svelte';

  /** @type {{ releaseId: number, onBack: () => void, autoPlay?: boolean }} */
  let { releaseId, onBack, autoPlay = false } = $props();

  /** @type {any|null} */
  let release = $state(null);
  /** @type {any[]} */
  let dubbers = $state([]);
  /** @type {any[]} */
  let sources = $state([]);
  /** @type {any[]} */
  let episodes = $state([]);

  let activeDubber = $state(null);
  let activeSource = $state(null);
  /** @type {'all'|'voice'|'sub'} */
  let filter = $state('all');
  let error = $state('');
  let loading = $state(true);

  /** Прогресс по релизу: { episodes: { "1": {time, duration, completed} } } */
  let progress = $state(null);

  /** Серия, открытая в плеере, и позиция старта. */
  /** @type {any|null} */
  let playerEp = $state(null);
  let playerStart = $state(0);

  /** Серия, для которой спрашиваем «продолжить или сначала». */
  /** @type {any|null} */
  let promptEp = $state(null);
  let promptAt = $state(0);

  let filtered = $derived(
    dubbers.filter((d) => {
      if (filter === 'voice') return !d.isSub;
      if (filter === 'sub') return d.isSub;
      return true;
    })
  );

  /** @param {number} seconds */
  function time(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(s / 60);
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  }

  /** Ключ истории: озвучка + серия (разные озвучки — разные тайминги). */
  /** @param {number} position */
  function episodeKey(position) {
    const dubberId = activeDubber?.id;
    const sourceId = activeSource?.id;
    return dubberId && sourceId ? `${dubberId}:${sourceId}:${position}` : null;
  }

  /** Информация о серии из истории. */
  /** @param {number} position */
  function episodeInfo(position) {
    const key = episodeKey(position);
    return key ? (progress?.episodes?.[key] ?? null) : null;
  }

  /** Подпись под серией: «Просмотрено до 15:14». */
  /** @param {number} position */
  function episodeNote(position) {
    const info = episodeInfo(position);
    if (!info) return '';

    const watched = !info.completed && info.time >= 15 && info.duration > 0;
    return watched ? `Просмотрено до ${time(info.time)}` : '';
  }

  onMount(async () => {
    try {
      release = await bridge.release(releaseId);
      progress = await bridge.progress.get(releaseId);
      dubbers = await bridge.dubbers(releaseId);

      // Если есть история — открываем ту озвучку, на которой остановились.
      const remembered =
        progress?.lastDubberId && dubbers.find((d) => d.id === progress.lastDubberId);
      const first = remembered || dubbers.find((d) => d.episodesCount > 0) || dubbers[0];
      if (first) await selectDubber(first);

      // Отладочный вход: сразу открыть первую серию (съёмка и проверки плеера).
      if (autoPlay) {
        const ep = episodes.find((e) => e.url);
        if (ep) play(ep, 0);
      }
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  /** @param {any} dubber */
  async function selectDubber(dubber) {
    activeDubber = dubber;
    activeSource = null;
    sources = [];
    episodes = [];
    error = '';

    try {
      sources = await bridge.sources(releaseId, dubber.id);

      // Если для этой озвучки есть сохранённый источник — открываем его.
      const remembered =
        progress?.lastSourceId && sources.find((s) => s.id === progress.lastSourceId);

      if (remembered) await selectSource(remembered);
      else if (sources.length) await selectSource(sources[0]);
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    }
  }

  /** @param {any} source */
  async function selectSource(source) {
    activeSource = source;
    episodes = [];
    error = '';

    try {
      episodes = await bridge.episodes(releaseId, activeDubber.id, source.id);
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    }
  }

  /** Клик по серии: если есть прогресс — спрашиваем, иначе играем сразу. */
  /** @param {any} ep */
  async function choose(ep) {
    if (!ep || !ep.url) return;

    try {
      const state = await bridge.progress.state(
        releaseId,
        activeDubber.id,
        activeSource.id,
        ep.position
      );
      if (state && state.resumeAt) {
        promptEp = ep;
        promptAt = state.resumeAt;
        return;
      }
    } catch {
      // История недоступна — просто играем.
    }

    play(ep, 0);
  }

  /**
   * @param {any} ep
   * @param {number} startAt
   */
  function play(ep, startAt) {
    promptEp = null;
    playerStart = startAt;
    playerEp = ep;
  }

  /** Соседняя серия для переключения в плеере. */
  /** @param {number} delta */
  function step(delta) {
    if (!playerEp) return;
    const idx = episodes.findIndex((e) => e.position === playerEp.position);
    const next = episodes[idx + delta];
    if (next && next.url) {
      playerStart = 0;
      playerEp = next;
    }
  }

  /** @param {any} ep */
  function metaFor(ep) {
    return {
      title: release?.title || '',
      poster: release?.poster || '',
      dubberId: activeDubber?.id,
      sourceId: activeSource?.id,
      position: ep?.position,
    };
  }
</script>

<div class="release-head">
  <button class="back-link" onclick={onBack}>
    <Icon name="back" size={17} />
    к описанию
  </button>
  {#if release}
    <span class="meta dim">{release.title}</span>
  {/if}
</div>

{#if error}
  <p class="err">{error}</p>
{/if}

{#if loading}
  <p class="meta dim">Загрузка…</p>
{:else if playerEp}
  {#key playerEp.position}
    <Player
      releaseId={releaseId}
      sourceId={activeSource?.id}
      position={playerEp.position}
      title={`${release?.title || ''} · ${playerEp.name || 'Серия ' + playerEp.position}`}
      startAt={playerStart}
      meta={metaFor(playerEp)}
      onClose={() => {
        playerEp = null;
        bridge.progress.get(releaseId).then((p) => (progress = p)).catch(() => {});
      }}
      onPrev={episodes.some((e) => e.position < playerEp.position) ? () => step(-1) : null}
      onNext={episodes.some((e) => e.position > playerEp.position) ? () => step(1) : null}
    />
  {/key}
{:else}
  <div class="watch-layout">
    <!-- ПАНЕЛЬ ОЗВУЧЕК -->
    <div class="voice-panel">
      <div class="panel-head">
        <h3>Озвучки</h3>
        <div class="segmented">
          <button class:active={filter === 'all'} onclick={() => (filter = 'all')}>Все</button>
          <button class:active={filter === 'voice'} onclick={() => (filter = 'voice')}>Озвучки</button>
          <button class:active={filter === 'sub'} onclick={() => (filter = 'sub')}>Субтитры</button>
        </div>
      </div>

      <div class="voice-list">
        {#each filtered as dubber (dubber.id)}
          <button
            class="voice-item"
            class:active={activeDubber?.id === dubber.id}
            onclick={() => selectDubber(dubber)}
          >
            <div class="voice-icon">
              {#if dubber.icon}
                <img src={dubber.icon} alt="" loading="lazy" referrerpolicy="no-referrer" />
              {:else}
                <span class="meta dim">♪</span>
              {/if}
            </div>
            <div class="voice-body">
              <div class="voice-name">
                {dubber.name}
                {#if dubber.isSub}<span class="tag">субтитры</span>{/if}
              </div>
              <div class="meta dim">
                {dubber.episodesCount}
                {plural(dubber.episodesCount, ['эпизод', 'эпизода', 'эпизодов'])}
              </div>
            </div>
            <div class="voice-views meta dim">👁 {formatCompact(dubber.viewCount)}</div>
          </button>
        {/each}
      </div>
    </div>

    <!-- ПАНЕЛЬ СЕРИЙ -->
    <div class="episode-panel">
      <div class="panel-head">
        <h3>
          {activeDubber ? activeDubber.name : 'Серии'}
          {#if activeSource}<span class="meta dim">· Источник {activeSource.name}</span>{/if}
        </h3>
        {#if sources.length > 1}
          <div class="segmented">
            {#each sources as source (source.id)}
              <button
                class:active={activeSource?.id === source.id}
                onclick={() => selectSource(source)}
              >
                {source.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if episodes.length === 0}
        <p class="meta dim">Серий нет — выберите другую озвучку.</p>
      {:else}
        <ul class="episode-list">
          {#each episodes as ep (ep.position)}
            {@const info = episodeInfo(ep.position)}
            {@const note = episodeNote(ep.position)}
            <li>
              <button class="episode-row" disabled={!ep.url} onclick={() => choose(ep)}>
                <span class="episode-name">
                  {ep.name || `Серия ${ep.position}`}
                  {#if note}<span class="episode-note">{note}</span>{/if}
                </span>
                {#if info}
                  <span class="episode-check" title="Просмотрено"><Icon name="check" size={14} stroke={2.2} /></span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<!-- Диалог выбора при наличии прогресса -->
{#if promptEp}
  <div class="modal-backdrop" role="presentation" onclick={() => (promptEp = null)}>
    <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <h3>{promptEp.name || `Серия ${promptEp.position}`}</h3>
      <p class="meta">Вы остановились на {time(promptAt)}</p>
      <div class="modal-actions">
        <button class="primary" onclick={() => play(promptEp, promptAt)}>
          Продолжить с {time(promptAt)}
        </button>
        <button onclick={() => play(promptEp, 0)}>Начать сначала</button>
      </div>
    </div>
  </div>
{/if}
