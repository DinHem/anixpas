<script>
  /**
   * Плеер на hls.js.
   *
   * Ссылки на поток запрашиваются у main по идентификаторам —
   * renderer никогда не передаёт URL сам.
   */
  import { onMount, onDestroy } from 'svelte';
  import Hls from 'hls.js';
  import { bridge } from '../lib/bridge.js';
  import Icon from '../components/Icon.svelte';

  /** @type {{ releaseId: number, sourceId: number, position: number, title: string, startAt?: number, meta?: any, onClose: () => void, onPrev?: (() => void)|null, onNext?: (() => void)|null }} */
  let { releaseId, sourceId, position, title, startAt = 0, meta = {}, onClose, onPrev, onNext } = $props();

  /** @type {HTMLVideoElement} */
  let video;
  /** @type {any} */
  let hls = null;

  let loading = $state(true);
  let error = $state('');
  let playing = $state(false);
  let current = $state(0);
  let duration = $state(0);
  let volume = $state(1);
  let muted = $state(false);
  /** @type {Record<string,string>} */
  let qualities = $state({});
  let activeQuality = $state('');
  let sourceName = $state('');
  let showControls = $state(true);
  /** Окно в полноэкранном режиме — плеер растягивается на всё окно. */
  let isFullscreen = $state(false);
  /** @type {null | (() => void)} */
  let unsubFullscreen = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let progressTimer = null;

  /** Таймкоды пропуска: { opening: {start,stop}|null, ending: {...}|null } */
  let skip = $state(null);
  /** Скорость воспроизведения — из настроек (загружается в onMount). */
  let rate = $state(1);
  /** Автопропуск — из настроек. */
  let autoSkip = $state(false);

  /** Обратный отсчёт до автопропуска, секунды. null — отсчёт не идёт. */
  let countdown = $state(null);
  /** @type {ReturnType<typeof setInterval>|null} */
  let countdownTimer = null;
  /** Диапазон, для которого уже сработал автопропуск. */
  let autoSkipDoneFor = null;

  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  /** Кнопка ручной перемотки вперёд, секунды. */
  const JUMP_FORWARD = 85;
  /** Задержка автопропуска. */
  const AUTOSKIP_DELAY = 5;

    function changeRate(value) {
    const next = Number(value);
    rate = next;
    if (video) video.playbackRate = next;
    // Сохраняем в main: localStorage в file:// ненадёжен.
    bridge.settings.set('playerRate', next).catch(() => {});
  }

  function toggleAutoSkip() {
    autoSkip = !autoSkip;
    if (!autoSkip) cancelCountdown();
    bridge.settings.set('autoSkip', autoSkip).catch(() => {});
  }

  /** @param {number} seconds */
  function time(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  /** @param {number} seconds */
  function percent(seconds) {
    if (!duration) return 0;
    return Math.min(100, Math.max(0, (seconds / duration) * 100));
  }

  /** Диапазон вставки, в которой мы находимся сейчас. */
  function currentRange() {
    const inRange = (r) => r && current >= r.start && current < r.stop - 1;
    if (skip?.opening && inRange(skip.opening)) return { kind: 'opening', ...skip.opening };
    if (skip?.ending && inRange(skip.ending)) return { kind: 'ending', ...skip.ending };
    return null;
  }

  /** Какая кнопка пропуска доступна прямо сейчас. */
  let activeSkip = $derived.by(() => {
    const range = currentRange();
    if (!range) return null;
    return {
      label: range.kind === 'opening' ? 'Пропустить опенинг' : 'Пропустить эндинг',
      target: range.stop,
    };
  });

  function doSkip() {
    const range = currentRange();
    if (!range || !video) return;
    cancelCountdown();
    autoSkipDoneFor = range;
    video.currentTime = range.stop;
    current = range.stop;
  }

  function cancelCountdown() {
    countdown = null;
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  /** Запускает отсчёт автопропуска для текущей вставки. */
  function startCountdown() {
    const range = currentRange();
    if (!range) return;
    if (autoSkipDoneFor && autoSkipDoneFor.start === range.start) return;
    if (countdownTimer) return;

    countdown = AUTOSKIP_DELAY;
    countdownTimer = setInterval(() => {
      if (!currentRange()) {
        cancelCountdown();
        return;
      }
      countdown -= 1;
      if (countdown <= 0) {
        cancelCountdown();
        doSkip();
      }
    }, 1000);
  }

  function handleTimeUpdate() {
    if (!video) return;
    current = video.currentTime;

    const range = currentRange();

    // Вышли из вставки — сбрасываем всё, чтобы в следующий раз сработало снова.
    if (!range) {
      if (countdown !== null) cancelCountdown();
      if (autoSkipDoneFor) autoSkipDoneFor = null;
      return;
    }

    if (autoSkip && countdown === null && !(autoSkipDoneFor && autoSkipDoneFor.start === range.start)) {
      startCountdown();
    }
  }

  /**
   * Перемотка вперёд от текущей позиции.
   * @param {number} seconds
   */
  function jumpForward(seconds) {
    if (!video) return;
    const max = Number.isFinite(video.duration) ? video.duration - 1 : current + seconds;
    const target = Math.min(current + seconds, max);
    video.currentTime = target;
    current = target;
  }

  /**
 * Загружает поток указанного качества.
 * При переключении качества источник перезагружается, поэтому позицию
 * и состояние воспроизведения сохраняем и восстанавливаем вручную.
 *
 * @param {string} quality
 * @param {boolean} [restore] — восстанавливать ли позицию (первый запуск — нет)
 */
  function loadQuality(quality, restore = true) {
    const url = qualities[quality];
    if (!url || !video) return;

    const resumeAt = restore ? video.currentTime : Number(startAt) || 0;
    const wasPlaying = restore ? !video.paused : true;

    activeQuality = quality;

    if (hls) {
      hls.destroy();
      hls = null;
    }

    if (Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30, enableWorker: true });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        console.log('[player] hls error:', data.type, data.details);

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          error = 'Ошибка сети при загрузке потока';
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          error = 'Поток не воспроизводится';
          hls.destroy();
          hls = null;
        }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else {
      error = 'Встроенный движок не поддерживает HLS';
      return;
    }

    // Ждём метаданные нового источника — и только потом возвращаем позицию.
    video.addEventListener(
      'loadedmetadata',
      () => {
        duration = video.duration || 0;
        video.playbackRate = rate;

        if (resumeAt > 1) {
          video.currentTime = resumeAt;
          current = resumeAt;
          console.log(`[player] позиция восстановлена: ${resumeAt.toFixed(1)} с`);
        }

        if (wasPlaying) {
          video.play().catch(() => {
            /* автозапуск может быть заблокирован */
          });
        }
      },
      { once: true }
    );
  }

  /** Озвучка нужна и при сохранении в onDestroy. */
  const dubberId = meta && meta.dubberId;
  const dubberSourceId = meta && meta.sourceId;

  onMount(async () => {
    // Окно может выйти из полноэкранного режима по Esc — синхронизируем состояние.
    unsubFullscreen = bridge.onFullscreenChange((value) => {
      isFullscreen = value;
    });

    window.addEventListener('keydown', onKeyDown);

    // Настройки читаем до загрузки потока: скорость применяется сразу.
    try {
      const saved = await bridge.settings.all();
      if (RATES.includes(Number(saved.playerRate))) rate = Number(saved.playerRate);
      autoSkip = Boolean(saved.autoSkip);
    } catch {
      /* используем значения по умолчанию */
    }

    // Записываем просмотр на сервер (если авторизован).
    if (dubberSourceId) {
      bridge.addHistory(releaseId, dubberSourceId, position).catch(() => {});
    }

    // Факт открытия = «просмотрено» (docs/00-decisions.md §9.1).
    if (dubberId && dubberSourceId) {
      bridge.progress
        .markOpened(releaseId, dubberId, dubberSourceId, position, meta)
        .catch(() => {});
    }

    // Сохраняем позицию раз в 5 секунд — не на каждый тик.
    progressTimer = setInterval(() => {
      if (!video || video.paused) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      if (dubberId && dubberSourceId) {
        bridge.progress
          .save(
            releaseId,
            dubberId,
            dubberSourceId,
            position,
            video.currentTime,
            video.duration,
            meta
          )
          .catch(() => {});
      }
    }, 5000);

    try {
      const res = await bridge.stream(releaseId, sourceId, position);
      qualities = res.qualities;
      sourceName = res.source;
      skip = res.skip ?? null;

      // Libria отдаёт полноценный 1080p — берём лучшее доступное.
      // У Kodik 1080p тяжелее и чаще буферизуется, там разумнее 720p.
      const preferred =
        res.source === 'Libria' || res.source === 'Liberty'
          ? res.best
          : res.qualities['720']
            ? '720'
            : res.best;
      console.log(
        `[player] источник ${res.source}, доступно: ${Object.keys(res.qualities).join('/')}, выбрано: ${preferred}`
      );

      if (!preferred) {
        error = 'Для этой серии нет доступного потока';
        return;
      }
      loadQuality(preferred, false);
    } catch (err) {
      console.log('[player] ошибка резолва:', err && err.message);
      error = err && err.code === 'not_found' ? 'Поток не найден' : 'Не удалось загрузить поток';
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    if (hls) hls.destroy();
    if (hideTimer) clearTimeout(hideTimer);
    cancelCountdown();
    if (typeof unsubFullscreen === 'function') unsubFullscreen();
    window.removeEventListener('keydown', onKeyDown);

    // Финальное сохранение позиции перед закрытием.
    if (progressTimer) clearInterval(progressTimer);
    // Досмотрел — отмечаем серию просмотренной на сервере.
    if (
      dubberSourceId &&
      video &&
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      video.currentTime >= video.duration * 0.9
    ) {
      bridge.markWatched(releaseId, dubberSourceId, position).catch(() => {});
    }

    if (dubberId && dubberSourceId && video && Number.isFinite(video.duration) && video.duration > 0) {
      bridge.progress
        .save(
          releaseId,
          dubberId,
          dubberSourceId,
          position,
          video.currentTime,
          video.duration,
          meta
        )
        .catch(() => {});
    }
  });

  function togglePlay() {
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  /** @param {Event & { currentTarget: HTMLInputElement }} event */
  function seek(event) {
    const value = Number(event.currentTarget.value);
    if (video && Number.isFinite(video.duration)) video.currentTime = value;
    current = value;
  }

  /** @param {Event & { currentTarget: HTMLInputElement }} event */
  function setVolume(event) {
    const value = Number(event.currentTarget.value);
    volume = value;
    muted = value === 0;
    if (video) {
      video.volume = value;
      video.muted = value === 0;
    }
  }

  /** @param {number} delta секунды */
  function seekBy(delta) {
    if (!video) return;
    const max = Number.isFinite(video.duration) ? video.duration - 0.5 : current + delta;
    const target = Math.min(Math.max(0, current + delta), max);
    video.currentTime = target;
    current = target;
    poke();
  }

  /** @param {number} delta доля громкости */
  function changeVolume(delta) {
    const next = Math.min(1, Math.max(0, volume + delta));
    volume = next;
    muted = next === 0;
    if (video) {
      video.volume = next;
      video.muted = next === 0;
    }
    poke();
  }

  function toggleMute() {
    if (!video) return;
    muted = !muted;
    video.muted = muted;
  }

  /**
   * Полный экран — через окно Electron, а не браузерный API:
   * в десктоп-приложении это надёжнее и не зависит от настроек Chromium.
   */
  async function toggleFullscreen() {
    try {
      await bridge.toggleFullscreen();
    } catch {
      // Запасной путь, если IPC недоступен.
      const el = video?.closest('.player');
      if (!el) return;
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      else await el.requestFullscreen().catch(() => {});
    }
  }

  /**
   * Горячие клавиши плеера.
   * Не перехватываем ввод, когда фокус в поле или списке.
   * @param {KeyboardEvent} event
   */
  function onKeyDown(event) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    // Модификаторы не трогаем — там системные сочетания.
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    // event.code, а не event.key: иначе на русской раскладке F даёт «а», M — «ь».
    switch (event.code) {
      case 'Space':
      case 'KeyK':
        togglePlay();
        break;
      case 'ArrowLeft':
        seekBy(-5);
        break;
      case 'ArrowRight':
        seekBy(5);
        break;
      case 'ArrowUp':
        changeVolume(0.05);
        break;
      case 'ArrowDown':
        changeVolume(-0.05);
        break;
      case 'KeyF':
        toggleFullscreen();
        break;
      case 'KeyM':
        toggleMute();
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  let hideTimer = null;

  /** Открыть текущий поток во внешнем плеере (mpv/VLC). */
  async function openExternal() {
    const url = qualities[activeQuality];
    if (!url) return;

    try {
      const res = await bridge.openExternalPlayer(url);
      if (!res || !res.opened) {
        // Плеер не найден — копируем ссылку, чтобы вставить вручную.
        await navigator.clipboard.writeText(url).catch(() => {});
        hint = 'Внешний плеер не найден. Ссылка скопирована.';
      } else {
        hint = `Открыто в ${res.player}`;
      }
    } catch {
      hint = 'Не удалось открыть внешний плеер';
    }

    setTimeout(() => (hint = ''), 4000);
  }

  let hint = $state('');

  function poke() {
    showControls = true;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (playing) showControls = false;
    }, 2600);
  }
</script>

<div
  class="player"
  class:hidecursor={!showControls}
  class:is-fullscreen={isFullscreen}
  role="application"
  onmousemove={poke}
  onmouseleave={() => playing && (showControls = false)}
>
  <video
    bind:this={video}
    class="player-video"
    onplay={() => { playing = true; poke(); }}
    onpause={() => { playing = false; showControls = true; }}
    ontimeupdate={handleTimeUpdate}
    ondurationchange={() => (duration = video.duration || 0)}
    onended={() => { playing = false; onNext?.(); }}
    onclick={togglePlay}
    ondblclick={toggleFullscreen}
  ></video>

  {#if loading}
    <div class="player-overlay"><span class="spinner"></span></div>
  {/if}

  {#if error}
    <div class="player-overlay">
      <div class="player-error">
        <p>{error}</p>
        <button onclick={onClose}>Закрыть</button>
      </div>
    </div>
  {/if}

  <!-- Центральные кнопки, как в оригинальном приложении -->
  {#if !loading && !error}
    <div class="center-controls" class:visible={showControls || !playing}>
      <button
        class="cbtn"
        onclick={(e) => { e.stopPropagation(); onPrev?.(); }}
        disabled={!onPrev}
        title="Предыдущая серия"
      >
        <Icon name="prev" size={22} stroke={1.8} />
      </button>
      <button class="cbtn cbtn-main" onclick={togglePlay} title={playing ? 'Пауза' : 'Играть'}>
        <Icon name={playing ? 'pause' : 'play'} size={26} stroke={2} />
      </button>
      <button
        class="cbtn"
        onclick={(e) => { e.stopPropagation(); onNext?.(); }}
        disabled={!onNext}
        title="Следующая серия"
      >
        <Icon name="next" size={22} stroke={1.8} />
      </button>
    </div>
  {/if}

  <div class="player-top" class:visible={showControls}>
    <button class="pbtn" onclick={onClose} title="Назад"><Icon name="back" size={18} /></button>
    <span class="player-title">{title}</span>
    <button
      class="pbtn autoskip"
      class:on={autoSkip}
      onclick={toggleAutoSkip}
      title={autoSkip ? 'Автопропуск включён' : 'Автопропуск выключен'}
    >
      <Icon name="next" size={15} />
      авто
    </button>
    <span class="player-source">{sourceName}</span>
  </div>

  {#if activeSkip}
    <button class="skipbtn" class:visible={showControls} onclick={doSkip}>
      {#if countdown !== null}
        Пропуск через {countdown}…
      {:else}
        {activeSkip.label} →
      {/if}
    </button>
  {/if}

  {#if hint}
    <div class="player-hint">{hint}</div>
  {/if}

  <div class="player-controls" class:visible={showControls}>
    <div class="seek-wrap">
      <input
        class="seek"
        type="range"
        min="0"
        max={duration || 0}
        step="1"
        value={current}
        oninput={seek}
      />
      {#if skip?.opening}
        <span
          class="mark opening"
          style="left:{percent(skip.opening.start)}%; width:{percent(skip.opening.stop) -
            percent(skip.opening.start)}%"
        ></span>
      {/if}
      {#if skip?.ending}
        <span
          class="mark ending"
          style="left:{percent(skip.ending.start)}%; width:{percent(skip.ending.stop) -
            percent(skip.ending.start)}%"
        ></span>
      {/if}
    </div>

    <div class="controls-row">
      <span class="player-time">{time(current)} / {time(duration)}</span>

      {#if !skip?.opening}
        <button
          class="pbtn jump"
          onclick={() => jumpForward(JUMP_FORWARD)}
          title="Перемотать вперёд на 1:25"
        >
          +1:25
        </button>
      {/if}

      <div class="volume">
        <button class="pbtn" onclick={toggleMute} title="Звук">
          <Icon name={muted ? 'mute' : 'volume'} size={18} />
        </button>
        <input type="range" min="0" max="1" step="0.05" value={volume} oninput={setVolume} />
      </div>

      <select
        class="quality"
        value={String(rate)}
        onchange={(e) => changeRate(e.currentTarget.value)}
        title="Скорость"
      >
        {#each RATES as r (r)}
          <option value={String(r)}>{r}×</option>
        {/each}
      </select>

      {#if Object.keys(qualities).length > 1}
        <select
          class="quality"
          value={activeQuality}
          onchange={(e) => loadQuality(e.currentTarget.value)}
          title="Качество"
        >
          {#each Object.keys(qualities) as q (q)}
            <option value={q}>{q}p</option>
          {/each}
        </select>
      {/if}

      <button class="pbtn" onclick={openExternal} title="Открыть во внешнем плеере">
        <Icon name="external" size={17} />
      </button>
      <button class="pbtn" onclick={toggleFullscreen} title="На весь экран">
        <Icon name="fullscreen" size={17} />
      </button>
    </div>
  </div>
</div>
