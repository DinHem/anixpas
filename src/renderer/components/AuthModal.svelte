<script>
  /**
   * Вход и регистрация Anixart.
   *
   * Три состояния: вход, регистрация (логин + почта + пароль) и подтверждение
   * почты кодом из письма. Токен в renderer не попадает — его хранит main.
   */
  import Icon from './Icon.svelte';
  import { bridge } from '../lib/bridge.js';

  /** @type {{ onClose: () => void, onSuccess: (profile: any) => void }} */
  let { onClose, onSuccess } = $props();

  /** @type {'login'|'signup'|'verify'|'restore'|'restoreVerify'} */
  let mode = $state('login');

  let login = $state('');
  let email = $state('');
  let password = $state('');
  let repeat = $state('');
  let code = $state('');

  /** @type {{hash: string, email: string, login: string, password: string}|null} */
  let pending = $state(null);
  /** @type {string[]} */
  let suggested = $state([]);

  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let showPassword = $state(false);

  /** Восстановление пароля: данные, hash и новый пароль. */
  /** @type {{data: string, hash: string, password: string}|null} */
  let recovery = $state(null);
  /** Через сколько секунд можно запросить код заново. */
  let resendIn = $state(0);

  /** Понятные тексты вместо кодов. */
  const MESSAGES = {
    bad_credentials: 'Неверный логин или пароль',
    bad_login: 'Логин не подходит: 3–20 символов, буквы, цифры, дефис',
    bad_email: 'Проверьте адрес почты',
    bad_password: 'Пароль слишком короткий — минимум 6 символов',
    login_taken: 'Такой логин уже занят',
    bad_code: 'Код не подошёл — проверьте письмо или запросите новый',
    not_found: 'Аккаунт с таким логином или почтой не найден',
    network: 'Нет связи с Anixart. Проверьте интернет',
    empty_response: 'Сервер не ответил. Попробуйте позже',
    bad_response: 'Неожиданный ответ сервера',
    no_token: 'Сервер не выдал токен',
    secure_storage_unavailable: 'Системное хранилище паролей недоступно — вход невозможен',
    invalid_args: 'Проверьте введённые данные',
  };

  /** @param {string} value */
  function message(value) {
    if (value && value.startsWith('code_')) return `Сервер отклонил запрос (${value.slice(5)})`;
    return MESSAGES[value] || 'Не получилось. Попробуйте ещё раз';
  }

  function switchMode(next) {
    mode = next;
    error = '';
    notice = '';
    suggested = [];
  }

  async function submitLogin() {
    if (busy) return;
    error = '';

    const value = login.trim();
    if (!value || !password) {
      error = 'Заполните логин и пароль';
      return;
    }

    busy = true;
    try {
      const profile = await bridge.auth.login(value, password);
      password = '';
      onSuccess(profile);
    } catch (err) {
      error = message(err && err.code ? err.code : 'unknown');
    } finally {
      busy = false;
    }
  }

  async function submitSignup() {
    if (busy) return;
    error = '';
    notice = '';
    suggested = [];

    const name = login.trim();
    const mail = email.trim();

    if (name.length < 3) {
      error = MESSAGES.bad_login;
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(mail)) {
      error = MESSAGES.bad_email;
      return;
    }
    if (password.length < 6) {
      error = MESSAGES.bad_password;
      return;
    }
    if (password !== repeat) {
      error = 'Пароли не совпадают';
      return;
    }

    busy = true;
    try {
      const result = await bridge.auth.signUp(name, mail, password);

      if (!result || result.ok !== true) {
        error = message(result && result.error);
        suggested = (result && result.suggested) || [];
        return;
      }

      pending = { hash: result.hash || '', email: mail, login: name, password };
      code = '';
      email = '';
      notice = `Код отправлен на ${mail}`;
      mode = 'verify';
    } catch (err) {
      error = message(err && err.code ? err.code : 'unknown');
    } finally {
      busy = false;
    }
  }

  async function submitVerify() {
    if (busy || !pending) return;
    error = '';
    notice = '';

    const value = code.trim();
    if (!/^\d{3,10}$/.test(value)) {
      error = 'Код — это цифры из письма';
      return;
    }

    busy = true;
    try {
      const result = await bridge.auth.verify({
        login: pending.login,
        email: pending.email,
        password: pending.password,
        hash: pending.hash,
        code: value,
      });

      if (!result || result.ok !== true) {
        error = message(result && result.error);
        return;
      }

      pending = null;
      password = '';
      onSuccess(result.profile);
    } catch (err) {
      error = message(err && err.code ? err.code : 'unknown');
    } finally {
      busy = false;
    }
  }

  /** Повторная отправка кода: та же заявка, письмо новое. */
  async function resend() {
    if (busy || !pending) return;
    error = '';
    busy = true;

    try {
      const result = await bridge.auth.signUp(pending.login, pending.email, pending.password);
      if (!result || result.ok !== true) {
        error = message(result && result.error);
        return;
      }
      pending = { ...pending, hash: result.hash || pending.hash };
      notice = 'Код отправлен повторно';
    } catch (err) {
      error = message(err && err.code ? err.code : 'unknown');
    } finally {
      busy = false;
    }
  }

  /** Отсчёт до возможности запросить код заново. */
  function startResendTimer(seconds) {
    const total = Number(seconds) || 0;
    if (total <= 0) {
      resendIn = 0;
      return;
    }

    resendIn = Math.min(total, 120);
    const timer = setInterval(() => {
      resendIn -= 1;
      if (resendIn <= 0) clearInterval(timer);
    }, 1000);
  }

  async function submitRestore() {
    if (busy) return;
    error = '';
    notice = '';
    suggested = [];

    const value = login.trim();
    if (!value) {
      error = 'Введите логин или почту';
      return;
    }

    busy = true;
    try {
      const result = await bridge.auth.restore(value);

      if (!result || result.ok !== true) {
        error = message(result && result.error);
        return;
      }

      recovery = { data: value, hash: result.hash || '', password: '' };
      code = '';
      password = '';
      repeat = '';
      notice = 'Код для восстановления отправлен на почту';
      startResendTimer(result.resendAfter);
      mode = 'restoreVerify';
    } catch (err) {
      error = message(err && err.code ? err.code : 'unknown');
    } finally {
      busy = false;
    }
  }

  async function submitRestoreVerify() {
    if (busy || !recovery) return;
    error = '';
    notice = '';

    const value = code.trim();
    if (!/^\d{3,10}$/.test(value)) {
      error = 'Код — это цифры из письма';
      return;
    }
    if (password.length < 6) {
      error = MESSAGES.bad_password;
      return;
    }
    if (password !== repeat) {
      error = 'Пароли не совпадают';
      return;
    }

    busy = true;
    try {
      const result = await bridge.auth.restoreVerify({
        data: recovery.data,
        password,
        hash: recovery.hash,
        code: value,
      });

      if (!result || result.ok !== true) {
        error = message(result && result.error);
        return;
      }

      recovery = null;
      password = '';
      repeat = '';
      onSuccess(result.profile);
    } catch (err) {
      error = message(err && err.code ? err.code : 'unknown');
    } finally {
      busy = false;
    }
  }

  async function resendRestore() {
    if (busy || !recovery || resendIn > 0) return;
    error = '';
    notice = '';

    if (password.length < 6) {
      error = 'Сначала придумайте новый пароль — он нужен для повторной отправки';
      return;
    }

    busy = true;
    try {
      const result = await bridge.auth.restoreResend({
        data: recovery.data,
        password,
        hash: recovery.hash,
      });

      if (!result || result.ok !== true) {
        error = message(result && result.error);
        return;
      }

      recovery = { ...recovery, hash: result.hash || recovery.hash };
      notice = 'Код отправлен повторно';
      startResendTimer(result.resendAfter);
    } catch (err) {
      error = message(err && err.code ? err.code : 'unknown');
    } finally {
      busy = false;
    }
  }

  /** @param {string} value */
  function pickSuggested(value) {
    login = value;
    suggested = [];
    error = '';
  }
</script>

<div class="modal-backdrop auth-backdrop" role="presentation" onclick={onClose}>
  <div class="auth-card" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <div class="auth-brand">
      <span class="auth-logo"><Icon name="play" size={20} stroke={0} /></span>
      <span class="auth-brand-name">AnixPas</span>
      <button class="auth-close" title="Закрыть" onclick={onClose}>
        <Icon name="close" size={16} stroke={2.2} />
      </button>
    </div>

    {#if mode === 'login'}
      <h3 class="auth-title">С возвращением</h3>
      <p class="auth-sub">Войдите, чтобы продолжить</p>

      <form
        class="auth-form"
        onsubmit={(e) => {
          e.preventDefault();
          submitLogin();
        }}
      >
        <label class="auth-field">
          <span>Почта или никнейм</span>
          <input
            type="text"
            bind:value={login}
            autocomplete="username"
            placeholder="DinHem"
            disabled={busy}
          />
        </label>

        <label class="auth-field">
          <span>Пароль</span>
          <div class="auth-password">
            <input
              type={showPassword ? 'text' : 'password'}
              bind:value={password}
              autocomplete="current-password"
              placeholder="••••••••"
              disabled={busy}
            />
            <button
              type="button"
              class="auth-eye"
              title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              onclick={() => (showPassword = !showPassword)}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} stroke={1.8} />
            </button>
          </div>
        </label>

        {#if error}
          <p class="auth-error">{error}</p>
        {/if}

        <div class="auth-links">
          <button
            type="button"
            class="auth-link"
            onclick={() => switchMode('restore')}
          >
            Забыли пароль? Восстановить
          </button>
        </div>

        <button type="submit" class="auth-submit" disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </button>

        <p class="auth-switch">
          Нет профиля?
          <button type="button" class="auth-link" onclick={() => switchMode('signup')}>
            Регистрация
          </button>
        </p>

        <button type="button" class="auth-skip" onclick={onClose} disabled={busy}>
          Продолжить без входа
        </button>
      </form>
    {:else if mode === 'signup'}
      <h3 class="auth-title">Регистрация</h3>
      <p class="auth-sub">Логин, почта и пароль — код подтверждения придёт на почту</p>

      <form
        class="auth-form"
        onsubmit={(e) => {
          e.preventDefault();
          submitSignup();
        }}
      >
        <label class="auth-field">
          <span>Логин</span>
          <input
            type="text"
            bind:value={login}
            autocomplete="username"
            placeholder="3–20 символов"
            disabled={busy}
          />
        </label>

        <label class="auth-field">
          <span>Почта</span>
          <input
            type="email"
            bind:value={email}
            autocomplete="email"
            placeholder="name@example.com"
            disabled={busy}
          />
        </label>

        <div class="auth-field-row">
          <label class="auth-field">
            <span>Пароль</span>
            <div class="auth-password">
              <input
                type={showPassword ? 'text' : 'password'}
                bind:value={password}
                autocomplete="new-password"
                placeholder="минимум 6"
                disabled={busy}
              />
              <button
                type="button"
                class="auth-eye"
                title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                onclick={() => (showPassword = !showPassword)}
              >
                <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} stroke={1.8} />
              </button>
            </div>
          </label>

          <label class="auth-field">
            <span>Ещё раз</span>
            <input
              type={showPassword ? 'text' : 'password'}
              bind:value={repeat}
              autocomplete="new-password"
              placeholder="повторите"
              disabled={busy}
            />
          </label>
        </div>

        {#if error}
          <p class="auth-error">{error}</p>
        {/if}

        {#if suggested.length}
          <div class="auth-suggest">
            <span class="auth-suggest-label">Свободные варианты</span>
            <div class="auth-suggest-list">
              {#each suggested as value}
                <button type="button" class="auth-chip" onclick={() => pickSuggested(value)}>
                  {value}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <button type="submit" class="auth-submit" disabled={busy}>
          {busy ? 'Отправляю…' : 'Зарегистрироваться'}
        </button>

        <p class="auth-switch">
          Уже есть аккаунт?
          <button type="button" class="auth-link" onclick={() => switchMode('login')}>
            Войти
          </button>
        </p>
      </form>
    {:else if mode === 'restore'}
      <h3 class="auth-title">Восстановление пароля</h3>
      <p class="auth-sub">Укажите логин или почту — пришлём код для смены пароля</p>

      <form
        class="auth-form"
        onsubmit={(e) => {
          e.preventDefault();
          submitRestore();
        }}
      >
        <label class="auth-field">
          <span>Логин или почта</span>
          <input
            type="text"
            bind:value={login}
            autocomplete="username"
            placeholder="DinHem или name@example.com"
            disabled={busy}
          />
        </label>

        {#if error}
          <p class="auth-error">{error}</p>
        {/if}

        <button type="submit" class="auth-submit" disabled={busy}>
          {busy ? 'Отправляю…' : 'Отправить код'}
        </button>

        <p class="auth-switch">
          Вспомнили пароль?
          <button type="button" class="auth-link" onclick={() => switchMode('login')}>Войти</button>
        </p>
      </form>
    {:else if mode === 'restoreVerify'}
      <h3 class="auth-title">Новый пароль</h3>
      <p class="auth-sub">
        Код из письма и новый пароль для аккаунта {recovery ? recovery.data : ''}
      </p>

      <form
        class="auth-form"
        onsubmit={(e) => {
          e.preventDefault();
          submitRestoreVerify();
        }}
      >
        <label class="auth-field">
          <span>Код из письма</span>
          <input
            type="text"
            inputmode="numeric"
            bind:value={code}
            placeholder="0000"
            maxlength="10"
            disabled={busy}
          />
        </label>

        <div class="auth-field-row">
          <label class="auth-field">
            <span>Новый пароль</span>
            <div class="auth-password">
              <input
                type={showPassword ? 'text' : 'password'}
                bind:value={password}
                autocomplete="new-password"
                placeholder="минимум 6"
                disabled={busy}
              />
              <button
                type="button"
                class="auth-eye"
                title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                onclick={() => (showPassword = !showPassword)}
              >
                <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} stroke={1.8} />
              </button>
            </div>
          </label>

          <label class="auth-field">
            <span>Ещё раз</span>
            <input
              type={showPassword ? 'text' : 'password'}
              bind:value={repeat}
              autocomplete="new-password"
              placeholder="повторите"
              disabled={busy}
            />
          </label>
        </div>

        {#if notice}
          <p class="auth-notice">{notice}</p>
        {/if}

        {#if error}
          <p class="auth-error">{error}</p>
        {/if}

        <button type="submit" class="auth-submit" disabled={busy}>
          {busy ? 'Проверяю…' : 'Сменить пароль и войти'}
        </button>

        <div class="auth-links">
          <button
            type="button"
            class="auth-link"
            onclick={resendRestore}
            disabled={busy || resendIn > 0}
          >
            {resendIn > 0 ? `Отправить код заново через ${resendIn} с` : 'Отправить код заново'}
          </button>
          <button type="button" class="auth-link" onclick={() => switchMode('restore')} disabled={busy}>
            Изменить данные
          </button>
        </div>
      </form>
    {:else}
      <h3 class="auth-title">Подтвердите почту</h3>
      <p class="auth-sub">
        Введите код из письма. Если письма нет — проверьте «Спам» или запросите новый.
      </p>

      <form
        class="auth-form"
        onsubmit={(e) => {
          e.preventDefault();
          submitVerify();
        }}
      >
        <label class="auth-field">
          <span>Код из письма</span>
          <input
            type="text"
            inputmode="numeric"
            bind:value={code}
            placeholder="000000"
            maxlength="10"
            disabled={busy}
          />
        </label>

        {#if notice}
          <p class="auth-notice">{notice}</p>
        {/if}

        {#if error}
          <p class="auth-error">{error}</p>
        {/if}

        <button type="submit" class="auth-submit" disabled={busy}>
          {busy ? 'Проверяю…' : 'Подтвердить'}
        </button>

        <div class="auth-links">
          <button type="button" class="auth-link" onclick={resend} disabled={busy}>
            Отправить код заново
          </button>
          <button type="button" class="auth-link" onclick={() => switchMode('signup')} disabled={busy}>
            Изменить данные
          </button>
        </div>
      </form>
    {/if}

    <p class="auth-legal">
      Продолжая, вы принимаете условия Anixart. Приложение не хранит пароль —
      только токен в защищённом хранилище системы.
    </p>
  </div>
</div>
