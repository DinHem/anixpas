<script>
  /** Экран проверки окружения и политик безопасности. */
  import { onMount } from 'svelte';
  import { bridge } from '../lib/bridge.js';
  import Icon from '../components/Icon.svelte';
  import { updateState, checkForUpdates, setShowNotes, showUpdate } from '../lib/updates.svelte.js';

  const upd = updateState();

  /** @type {{ onBack: () => void }} */
  let { onBack } = $props();

  /** @type {Array<{label: string, detail: string, passed: boolean}>} */
  let checks = $state([]);
  /** @type {Record<string, string>} */
  let info = $state({});

  onMount(async () => {
    /** @type {Array<{label: string, detail: string, passed: boolean}>} */
    const results = [];
    const add = (label, passed, detail) => results.push({ label, passed, detail });

    const api = window.anixpas;

    add(
      'Node.js недоступен в renderer',
      typeof require === 'undefined' && typeof module === 'undefined',
      'require/module должны быть undefined при contextIsolation + sandbox'
    );

    add(
      'contextBridge на месте',
      typeof api === 'object' && api !== null,
      'window.anixpas предоставлен preload-скриптом'
    );

    add(
      'Узкий API: нет прямого ipcRenderer',
      typeof api === 'object' && api !== null && !('ipcRenderer' in api) && !('invoke' in api),
      'renderer не может вызвать произвольный канал'
    );

    try {
      const data = await bridge.appInfo();
      info = {
        Версия: data.version,
        Electron: data.electron,
        Chrome: data.chrome,
        Node: data.node,
        Платформа: data.platform,
        Сборка: data.packaged ? 'релизная' : 'разработка',
      };
      add('IPC-канал app:info отвечает', true, 'запрос прошёл через contextBridge');
    } catch (err) {
      add('IPC-канал app:info отвечает', false, String(err && err.message));
    }

    try {
      await fetch('https://api-s.anixsekai.com/release/1');
      add('Сеть из renderer заблокирована', false, 'запрос прошёл — CSP connect-src не работает');
    } catch {
      add("Сеть из renderer заблокирована", true, "connect-src 'self' отсекает прямые запросы");
    }

    checks = results;
  });
</script>

<section>
  <div class="foot">
    <button class="back-link" onclick={onBack}>
      <Icon name="back" size={17} />
      назад
    </button>
  </div>
  <h2>Окружение</h2>
  {#each Object.entries(info) as [key, value]}
    <div class="row">
      <span class="key">{key}</span>
      <span class="val">{value}</span>
    </div>
  {/each}
</section>

<section>
  <h2>Обновления</h2>
  <div class="row">
    <span class="key">Версия</span>
    <span class="val">{upd.current || info['Версия'] || '—'}</span>
  </div>
  <div class="row">
    <span class="key">Последняя проверка</span>
    <span class="val">
      {upd.lastChecked
        ? new Date(upd.lastChecked).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
        : 'ещё не проверяли'}
    </span>
  </div>

  {#if upd.available}
    <div class="check">
      <span class="badge ok">NEW</span>
      <div>
        Доступна версия {upd.available.version}
        <br />
        <small>Текущая: {upd.current}</small>
      </div>
    </div>
    <div class="update-status-actions">
      <button class="update-ghost" onclick={() => setShowNotes(true)}>Что нового</button>
      {#if upd.hidden}
        <button class="update-ghost" onclick={showUpdate}>Показать плашку</button>
      {/if}
    </div>
  {:else if upd.checked && !upd.error}
    <div class="check">
      <span class="badge ok">OK</span>
      <div>
        Установлена последняя версия — {upd.current}
        <br />
        <small>Новых версий на сервере обновлений нет</small>
      </div>
    </div>
  {:else if upd.error === 'signature'}
    <p class="err">Подпись манифеста не совпала — обновление отклонено.</p>
  {:else if upd.error}
    <p class="meta dim">Не удалось проверить: нет связи с сервером обновлений.</p>
  {/if}

  <button class="primary" onclick={() => checkForUpdates()} disabled={upd.checking}>
    {upd.checking ? 'Проверяю…' : 'Проверить обновления'}
  </button>

  <button class="update-ghost" onclick={() => setShowNotes(true)}>
    История изменений
  </button>
</section>

<section>
  <h2>Безопасность</h2>
  {#each checks as item}
    <div class="check">
      <span class="badge {item.passed ? 'ok' : 'fail'}">{item.passed ? 'OK' : 'FAIL'}</span>
      <div>
        {item.label}
        <br />
        <small>{item.detail}</small>
      </div>
    </div>
  {/each}
</section>
