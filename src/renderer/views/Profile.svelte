<script>
  /** Свой профиль: шапка и статистика. */
  import { onMount } from 'svelte';
  import { bridge } from '../lib/bridge.js';
  import { formatCount } from '../lib/format.js';
  import Icon from '../components/Icon.svelte';
  import { LISTS, listClass } from '../lib/lists.js';

  /** @type {{ auth: any, onLogin: () => void, onOpenLists: () => void, onOpenVotes: () => void }} */
  let { auth, onLogin, onOpenLists, onOpenRelease, onOpenVotes } = $props();

  /** @type {any|null} */
  let profile = $state(null);
  let loading = $state(true);
  let error = $state('');
  /** @type {any[]} */
  let history = $state([]);


  /** Сумма по всем спискам — для полосы. */
  let listsTotal = $derived(
    profile
      ? profile.lists.watching +
        profile.lists.planned +
        profile.lists.completed +
        profile.lists.holdOn +
        profile.lists.dropped
      : 0
  );

  /** @param {number} value @param {number} total */
  function share(value, total) {
    if (!total) return 0;
    return (value / total) * 100;
  }

  /** Дата регистрации: «9 февр. 2021». */
  /** @param {number} unixSeconds */
  function formatDate(unixSeconds) {
    if (!unixSeconds) return '';
    return new Date(unixSeconds * 1000).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  /** Время просмотра: секунды → «124 дня 2 часа». */
  /** @param {number} minutes — API отдаёт минуты */
  function formatWatchTime(minutes) {
    if (!minutes) return '0 минут';
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;

    if (days > 0) {
      return `≈ ${days} ${plural(days, ['день', 'дня', 'дней'])}${restHours ? ` ${restHours} ч` : ''}`;
    }
    if (hours > 0) return `${hours} ч`;
    return `${minutes} мин`;
  }

  /** @param {number} n @param {string[]} forms */
  function plural(n, forms) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last > 1 && last < 5) return forms[1];
    if (last === 1) return forms[0];
    return forms[2];
  }

  /** Значения списков в порядке для полосы и легенды. */
  let listValues = $derived(
    profile
      ? [
          { label: 'Смотрю', value: profile.lists.watching, cls: 'status-1' },
          { label: 'В планах', value: profile.lists.planned, cls: 'status-2' },
          { label: 'Просмотрено', value: profile.lists.completed, cls: 'status-3' },
          { label: 'Отложено', value: profile.lists.holdOn, cls: 'status-4' },
          { label: 'Брошено', value: profile.lists.dropped, cls: 'status-5' },
        ]
      : []
  );

  let loadedFor = null;
  /** Сколько всего оценок — для счётчика у ссылки. */
  let votesTotal = $state(0);

  async function loadProfile() {
    if (!auth?.authorized) {
      profile = null;
      history = [];
      votesTotal = 0;
      loading = false;
      return;
    }

    loading = true;
    error = '';

    try {
      profile = await bridge.myProfile(true);
      const h = await bridge.history(0).catch(() => ({ items: [] }));
      history = h.items || [];

      // Оценки тянем отдельно и не роняем профиль, если запрос не удался.
      const votes = await bridge.votes(profile.id, 0, 1).catch(() => ({ total: 0 }));
      votesTotal = votes.total || 0;
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadedFor = auth?.profile?.id ?? null;
    loadProfile();
  });

  // Сменился аккаунт — данные надо перечитать.
  $effect(() => {
    const id = auth?.profile?.id ?? null;
    if (id === loadedFor) return;
    loadedFor = id;
    loadProfile();
  });
</script>

{#if !auth?.authorized}
  <div class="catalog-head">
    <h2>Профиль</h2>
  </div>
  <div class="empty-state">
    <p>Здесь будет ваша статистика — она хранится в аккаунте AniXart.</p>
    <button class="primary" onclick={onLogin}>Войти в аккаунт</button>
  </div>
{:else if loading}
  <p class="meta dim">Загрузка профиля…</p>
{:else if error}
  <p class="err">{error}</p>
{:else if profile}
  <header class="profile-head">
    <div class="profile-avatar">
      {#if profile.avatar}
        <img src={profile.avatar} alt="" referrerpolicy="no-referrer" />
      {:else}
        <Icon name="user" size={28} />
      {/if}
    </div>

    <div class="profile-main">
      <h1 class="profile-login">
        {profile.login}
        {#if profile.badge && profile.badge.image}
          <img class="profile-badge" src={profile.badge.image} alt={profile.badge.name} referrerpolicy="no-referrer" />
        {/if}
      </h1>

      {#if profile.registerDate}
        <div class="meta">на проекте с {formatDate(profile.registerDate)}</div>
      {/if}

      {#if profile.status}
        <p class="profile-status">{profile.status}</p>
      {/if}

      {#if profile.friends > 0}
        <div class="meta">{profile.friends} {plural(profile.friends, ['друг', 'друга', 'друзей'])}</div>
      {/if}
    </div>
  </header>

  <section class="section-block">
    <h3>Статистика</h3>

    <div class="lists">
      <div class="lists-head">
        <span>В списках</span>
        <span class="meta dim">{formatCount(listsTotal)}</span>
      </div>

      <div class="lists-bar">
        {#each listValues as item (item.cls)}
          <span class="seg {item.cls}" style="width:{share(item.value, listsTotal)}%"></span>
        {/each}
      </div>

      <div class="lists-legend">
        {#each listValues as item (item.cls)}
          <span>
            <i class="dot {item.cls}"></i>
            {item.label} <b>{formatCount(item.value)}</b>
          </span>
        {/each}
      </div>
    </div>

    <div class="profile-stats">
      <div class="stat-card">
        <div class="stat-value">{formatCount(profile.watchedEpisodes)}</div>
        <div class="stat-label">серий просмотрено</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{formatWatchTime(profile.watchedMinutes)}</div>
        <div class="stat-label">время просмотра</div>
      </div>
    </div>

    <button class="btn-list" onclick={onOpenLists}>Все списки</button>

    <button class="btn-list votes-link" onclick={onOpenVotes}>
      <Icon name="star" size={16} />
      Мои оценки
      {#if votesTotal > 0}<span class="meta dim">{votesTotal}</span>{/if}
    </button>
  </section>

  {#if history.length > 0}
    <section class="section-block">
      <h3>Просмотрено недавно</h3>
      <div class="reco">
        {#each history.slice(0, 12) as item (item.id)}
          <button class="reco-card" onclick={() => onOpenRelease(item.id)}>
            <div class="reco-poster">
              {#if item.poster}
                <img src={item.poster} alt="" loading="lazy" referrerpolicy="no-referrer" />
              {/if}
            </div>
            <div class="reco-title">{item.title}</div>
            <div class="reco-meta">
              {#if item.lastEpisode}{item.lastEpisode} серия{/if}
            </div>
          </button>
        {/each}
      </div>
    </section>
  {/if}
{/if}
