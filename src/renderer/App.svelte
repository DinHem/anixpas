<script>
  import { onMount, tick } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Catalog from './views/Catalog.svelte';
  import Release from './views/Release.svelte';
  import Search from './views/Search.svelte';
  import Watch from './views/Watch.svelte';
  import Status from './views/Status.svelte';
  import AuthModal from './components/AuthModal.svelte';
  import Bookmarks from './views/Bookmarks.svelte';
  import Profile from './views/Profile.svelte';
  import Votes from './views/Votes.svelte';
  import UpdateBanner from './components/UpdateBanner.svelte';
  import { checkForUpdates } from './lib/updates.svelte.js';
  import { bridge } from './lib/bridge.js';

  /** @type {'catalog'|'search'|'bookmarks'|'profile'|'status'|'release'|'watch'} */
  let view = $state('catalog');
  let releaseId = $state(0);
  /** Отладочный автозапуск первой серии (#player:id). */
  let autoPlay = $state(false);
  /** Откуда пришли в карточку — чтобы «назад» вернул туда же. */
  let previousView = $state('catalog');

  /** Сохранённые позиции прокрутки для экранов, которые остаются в памяти. */
  let catalogScroll = 0;
  let searchScroll = 0;

  /** @type {HTMLElement|null} */
  let mainEl = null;

  /** Состояние аккаунта: { authorized, profile }. */
  let auth = $state({ authorized: false, profile: null });
  let showAuth = $state(false);
  /** Счётчик принудительного обновления каталога при возврате. */
  let catalogRefresh = $state(0);
  /** Последнее изменение списка из карточки: его подхватывают keepalive-экраны. */
  /** @type {{id:number, listStatus:number|null, isFavorite:boolean, seq:number}|null} */
  let listPatch = $state(null);

  /** @param {HTMLElement|null} el */
  function rememberScroll(el) {
    if (!el) return;
    if (view === 'catalog') catalogScroll = el.scrollTop;
    else if (view === 'search') searchScroll = el.scrollTop;
  }

  /** Восстанавливает прокрутку после перерисовки. */
  async function restoreScroll() {
    await tick();
    if (!mainEl) return;
    if (view === 'catalog') mainEl.scrollTop = catalogScroll;
    else if (view === 'search') mainEl.scrollTop = searchScroll;
    else mainEl.scrollTop = 0;
  }

  /** @param {string} next */
  async function navigate(next) {
    rememberScroll(mainEl);
    if (next === 'catalog' && view !== 'catalog') catalogRefresh += 1;
    view = next;
    await restoreScroll();
  }

  /** @param {number} id @param {number|null} status @param {boolean} favorite */
  function applyListChange(id, status, favorite) {
    listPatch = { id, listStatus: status, isFavorite: favorite, seq: (listPatch ? listPatch.seq : 0) + 1 };
  }

  /** @param {number} id */
  async function openRelease(id) {
    rememberScroll(mainEl);
    previousView = view === 'release' ? previousView : view;
    releaseId = id;
    view = 'release';
    await restoreScroll();
  }

  async function goBack() {
    // В карточке прокрутка своя — возвращаемся к сохранённой позиции списка.
    view = previousView;
    if (view === 'catalog') catalogRefresh += 1;
    await restoreScroll();
  }

  /** Открыть сразу выбор серий (плашка «Продолжить просмотр»). */
  /** @param {number} id */
  async function openWatch(id) {
    rememberScroll(mainEl);
    releaseId = id;
    previousView = 'catalog';
    view = 'watch';
    await restoreScroll();
  }

  // Отладочный вход по hash: index.html#watch:1000, #release:609, #search, #profile.
  // Нужен для съёмки экранов и проверок без прокликивания каталога.
  onMount(() => {
    bridge.auth
      .status()
      .then((value) => (auth = value))
      .catch(() => {});
    const hash = (location.hash || '').replace(/^#/, '');
    const match = /^(watch|release|player):(\d+)$/.exec(hash);
    if (match) {
      releaseId = Number(match[2]);
      view = match[1] === 'release' ? 'release' : 'watch';
      autoPlay = match[1] === 'player';
    } else if (hash === 'auth') {
      showAuth = true;
    } else if (['search', 'profile', 'bookmarks', 'status'].includes(hash)) {
      view = hash;
    }

    // Обновления проверяем фоном: через 3 с после запуска и дальше раз в 6 часов.
    setTimeout(() => checkForUpdates(true), 3000);
    const timer = setInterval(() => checkForUpdates(true), 6 * 60 * 60 * 1000);

    // Отладка: location.hash = 'auth' открывает экран входа.
    const onHash = () => {
      if (location.hash === '#auth') showAuth = true;
    };
    window.addEventListener('hashchange', onHash);

    return () => {
      clearInterval(timer);
      window.removeEventListener('hashchange', onHash);
    };
  });
  /** @param {any} profile */
  function handleLogin(profile) {
    auth = { authorized: true, profile };
    showAuth = false;
  }

  async function handleLogout() {
    try {
      await bridge.auth.logout();
    } catch {
      /* всё равно сбрасываем локально */
    }
    auth = { authorized: false, profile: null };
  }
</script>

<div class="app">
  <Sidebar
    {view}
    {auth}
    onNavigate={navigate}
    onLogin={() => (showAuth = true)}
    onLogout={handleLogout}
    onProfile={() => navigate('profile')}
  />

  {#if showAuth}
    <AuthModal onClose={() => (showAuth = false)} onSuccess={handleLogin} />
  {/if}

  <main
    class="main"
    class:full={view === 'watch'}
    class:narrow={view === 'release' || view === 'profile'}
    bind:this={mainEl}
  >
    <!--
      Каталог и поиск остаются в DOM всегда: иначе при возврате из карточки
      компонент создаётся заново, теряет загруженные данные и прокрутку.
    -->
    <div class="keepalive" class:inactive={view !== 'catalog'}>
      <Catalog
        onOpen={openRelease}
        onContinue={openWatch}
        refreshKey={catalogRefresh}
        patch={listPatch}
      />
    </div>

    <div class="keepalive" class:inactive={view !== 'search'}>
      <Search onOpen={openRelease} patch={listPatch} />
    </div>

    {#if view === 'profile'}
      <Profile
        {auth}
        onLogin={() => (showAuth = true)}
        onOpenLists={() => navigate('bookmarks')}
        onOpenVotes={() => navigate('votes')}
        onOpenRelease={openRelease}
      />
    {:else if view === 'votes'}
      <Votes
        {auth}
        onBack={() => navigate('profile')}
        onOpen={openRelease}
        onLogin={() => (showAuth = true)}
      />
    {:else if view === 'bookmarks'}
      <Bookmarks {auth} onOpen={openRelease} onLogin={() => (showAuth = true)} />
    {:else if view === 'status'}
      <Status onBack={() => navigate('catalog')} />
    {:else if view === 'release'}
      <!--
        key: переход из карточки в карточку (рекомендации, франшиза) меняет только id,
        без пересоздания компонент оставался на старом тайтле.
      -->
      {#key releaseId}
        <Release
          id={releaseId}
          onBack={goBack}
          onWatch={() => navigate('watch')}
          onOpen={openRelease}
          onListChange={applyListChange}
        />
      {/key}
    {:else if view === 'watch'}
      <Watch
        releaseId={releaseId}
        autoPlay={autoPlay}
        onBack={() => {
          view = previousView === 'catalog' ? 'catalog' : 'release';
          restoreScroll();
        }}
      />
    {/if}
  </main>

  <UpdateBanner />
</div>
