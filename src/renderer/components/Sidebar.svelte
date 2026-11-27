<script>
  /** Боковое меню. На ПК заменяет нижнюю навигацию мобильного приложения. */
  import Icon from './Icon.svelte';
  import { updateState } from '../lib/updates.svelte.js';

  const upd = updateState();

  /**
   * @type {{
   *   view: string,
   *   auth: any,
   *   onNavigate: (view: string) => void,
   *   onLogin: () => void,
   *   onLogout: () => void,
   * }}
   */
  let { view, auth, onNavigate, onLogin, onLogout, onProfile } = $props();

  const items = [
    { id: 'catalog', label: 'Каталог', icon: 'catalog' },
    { id: 'search', label: 'Поиск', icon: 'search' },
    { id: 'bookmarks', label: 'Закладки', icon: 'bookmark' },
    { id: 'status', label: 'Статус', icon: 'info' },
  ];
</script>

<aside class="sidebar">
  <div class="brand">
    <svg class="logo" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <defs>
        <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d9cbf2" />
          <stop offset="1" stop-color="#8f7ec9" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="26" height="26" rx="8" fill="url(#brandGrad)" />
      <path d="M10.5 8.2v9.6l7.6-4.8z" fill="#14131a" />
    </svg>
    <span class="brand-name">AnixPas</span>
  </div>

  <nav>
    {#each items as item (item.id)}
      <button
        class="navitem"
        class:active={view === item.id}
        onclick={() => onNavigate(item.id)}
        title={item.label}
      >
        <Icon name={item.icon} size={18} />
        {item.label}
        {#if item.id === 'status' && upd.available}
          <span class="nav-dot" title="Доступно обновление"></span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="sidebar-foot">
    {#if auth?.authorized && auth.profile}
      <button class="account" onclick={onProfile} title="Мой профиль">
        <div class="account-avatar">
          {#if auth.profile.avatar}
            <img src={auth.profile.avatar} alt="" referrerpolicy="no-referrer" />
          {:else}
            <Icon name="user" size={16} />
          {/if}
        </div>
        <div class="account-body">
          <div class="account-name">{auth.profile.login}</div>
          <span class="meta dim">профиль</span>
        </div>
      </button>

      <button class="linkbtn small logout" onclick={onLogout}>
        <Icon name="logout" size={15} />
        Выйти
      </button>
    {:else}
      <button class="account login" onclick={onLogin}>
        <span class="account-avatar empty"><Icon name="user" size={16} /></span>
        <span class="account-body">
          <span class="account-name">Войти</span>
          <span class="meta dim">аккаунт Anixart</span>
        </span>
      </button>
    {/if}
  </div>
</aside>
