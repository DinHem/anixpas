<script>
  /** Модальное окно входа в Anixart. */
  import { bridge } from '../lib/bridge.js';

  /** @type {{ onClose: () => void, onSuccess: (profile: any) => void }} */
  let { onClose, onSuccess } = $props();

  let login = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state('');
  let showPassword = $state(false);

  /** Понятные тексты вместо кодов. */
  const MESSAGES = {
    bad_credentials: 'Неверный логин или пароль',
    network: 'Нет связи с Anixart. Проверьте интернет',
    empty_response: 'Сервер не ответил. Попробуйте позже',
    bad_response: 'Неожиданный ответ сервера',
    no_token: 'Сервер не выдал токен',
    secure_storage_unavailable:
      'Системное хранилище паролей недоступно — вход невозможен',
    invalid_args: 'Проверьте логин и пароль',
  };

  async function submit() {
    if (loading) return;

    error = '';
    const value = login.trim();

    if (!value || !password) {
      error = 'Заполните логин и пароль';
      return;
    }

    loading = true;

    try {
      const profile = await bridge.auth.login(value, password);
      // Пароль в памяти не держим.
      password = '';
      onSuccess(profile);
    } catch (err) {
      const code = err && err.code ? err.code : 'unknown';
      error = MESSAGES[code] || `Не удалось войти (${code})`;
    } finally {
      loading = false;
    }
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={onClose}>
  <div class="modal auth-modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <h3>Вход в Anixart</h3>
    <p class="meta">Логин и пароль от аккаунта Anixart. Токен хранится в защищённом хранилище системы.</p>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label class="field">
        <span>Логин</span>
        <input type="text" bind:value={login} autocomplete="username" disabled={loading} />
      </label>

      <label class="field">
        <span>Пароль</span>
        <div class="password-row">
          <input
            type={showPassword ? 'text' : 'password'}
            bind:value={password}
            autocomplete="current-password"
            disabled={loading}
          />
          <button
            type="button"
            class="pbtn"
            onclick={() => (showPassword = !showPassword)}
            title={showPassword ? 'Скрыть' : 'Показать'}
          >
            {showPassword ? '🙈' : '👁'}
          </button>
        </div>
      </label>

      {#if error}
        <p class="err">{error}</p>
      {/if}

      <div class="modal-actions">
        <button type="submit" class="primary" disabled={loading}>
          {loading ? 'Вход…' : 'Войти'}
        </button>
        <button type="button" onclick={onClose} disabled={loading}>Отмена</button>
      </div>
    </form>
  </div>
</div>
