'use strict';

/**
 * Авторизация Anixart.
 *
 * Токен хранится ТОЛЬКО в safeStorage (на Windows — DPAPI).
 * В файлы, логи и renderer токен не попадает: renderer знает лишь,
 * авторизован ли пользователь и как его зовут.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const { request } = require('./net/http.js');
const { USER_AGENT, resolveHost } = require('./api/hosts-resolver.js');

/** Имя файла с зашифрованным токеном. */
const TOKEN_FILE = 'auth.bin';

/** Данные профиля рядом с токеном (не секретны, но нужны для шапки). */
const PROFILE_FILE = 'auth-profile.json';

/** @type {{ token: string|null, profile: any|null }} */
let state = { token: null, profile: null };
let loaded = false;

/**
 * Зашифрованный токен требует доступного хранилища.
 * @returns {boolean}
 */
function isSecureStorageAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function tokenPath() {
  return path.join(app.getPath('userData'), TOKEN_FILE);
}

function profilePath() {
  return path.join(app.getPath('userData'), PROFILE_FILE);
}

/**
 * Читает токен и профиль с диска.
 * @returns {Promise<void>}
 */
async function load() {
  if (loaded) return;
  loaded = true;

  try {
    const encrypted = await fs.readFile(tokenPath());
    if (isSecureStorageAvailable()) {
      const decrypted = safeStorage.decryptString(encrypted);
      if (typeof decrypted === 'string' && decrypted.length) state.token = decrypted;
    }
  } catch {
    // Нет файла или расшифровка не удалась — просто не авторизованы.
  }

  try {
    const raw = await fs.readFile(profilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') state.profile = parsed;
  } catch {
    /* профиля нет */
  }
}

/** Сохраняет токен и профиль. */
async function persist() {
  try {
    if (state.token && isSecureStorageAvailable()) {
      const encrypted = safeStorage.encryptString(state.token);
      await fs.writeFile(tokenPath(), encrypted);
    } else {
      await fs.unlink(tokenPath()).catch(() => {});
    }
  } catch {
    /* не смогли сохранить — работаем в памяти */
  }

  try {
    if (state.profile) {
      await fs.writeFile(profilePath(), JSON.stringify(state.profile), 'utf8');
    } else {
      await fs.unlink(profilePath()).catch(() => {});
    }
  } catch {
    /* не критично */
  }
}

/**
 * Тело ответа signIn приводит к безопасному виду.
 * @param {any} raw
 */
function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: Number(raw.id) || 0,
    login: typeof raw.login === 'string' ? raw.login : '',
    avatar: typeof raw.avatar === 'string' && raw.avatar.startsWith('https://') ? raw.avatar : '',
  };
}

/**
 * Вход по логину и паролю.
 *
 * Важно: API принимает ТОЛЬКО form-urlencoded — на JSON отвечает пустым телом.
 *
 * @param {string} login
 * @param {string} password
 * @returns {Promise<{ ok: boolean, error?: string, profile?: any }>}
 */
async function login(login, password) {
  await load();

  if (!isSecureStorageAvailable()) {
    return { ok: false, error: 'secure_storage_unavailable' };
  }

  const host = await resolveHost();
  const body = new URLSearchParams({ login, password }).toString();

  let res;
  try {
    res = await request(`${host}/auth/signIn`, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'API-Version': 'v2',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      timeoutMs: 20_000,
      maxBytes: 512 * 1024,
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (!res.text.trim()) return { ok: false, error: 'empty_response' };

  let json;
  try {
    json = JSON.parse(res.text);
  } catch {
    return { ok: false, error: 'bad_response' };
  }

  // Код 2 — неверный логин или пароль.
  if (json.code !== 0) {
    return { ok: false, error: json.code === 2 ? 'bad_credentials' : `code_${json.code}` };
  }

  const token = json.profileToken && json.profileToken.token;
  if (typeof token !== 'string' || !token) {
    return { ok: false, error: 'no_token' };
  }

  state.token = token;
  state.profile = sanitizeProfile(json.profile);
  await persist();

  // Данные теперь персонализированные — старый кэш не подходит.
  require('./cache.js').setUserScope(state.profile ? state.profile.id : null);

  return { ok: true, profile: state.profile };
}

/** Выход: стирает токен с диска. */
async function logout() {
  await load();
  state = { token: null, profile: null };
  await persist();

  require('./cache.js').setUserScope(null);
  return { ok: true };
}

/**
 * Текущий токен для запросов. Не отдавать наружу в renderer.
 * @returns {Promise<string|null>}
 */
async function getToken() {
  await load();
  return state.token;
}

/**
 * Статус для интерфейса — без токена.
 * @returns {Promise<{ authorized: boolean, profile: any|null, secureStorage: boolean }>}
 */
async function getStatus() {
  await load();
  return {
    authorized: Boolean(state.token),
    profile: state.profile,
    secureStorage: isSecureStorageAvailable(),
  };
}

module.exports = { login, logout, getToken, getStatus, isSecureStorageAvailable };
