'use strict';

/**
 * Политики безопасности уровня приложения.
 * Применяются ко всем webContents, а не только к главному окну.
 *
 * Правила: docs/03-security.md
 */

const { app, shell } = require('electron');
const { URL } = require('node:url');

/** Схемы, которые вообще разрешено открывать во внешнем браузере. */
const SAFE_SCHEMES = new Set(['https:']);

/**
 * Хосты, которые можно открыть в системном браузере.
 * Только явные домены, без подстановочных.
 */
const SAFE_EXTERNAL_HOSTS = new Set([
  'anixart.tv',
  'www.anixart.tv',
  'anilibria.top',
  'www.aniliberty.top',
  'aniliberty.top',
  'github.com',
  // Видео релиза лежит на этих хостингах: открываем только во внешнем браузере.
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'sibnet.ru',
  'video.sibnet.ru',
]);

/**
 * Проверяет, безопасно ли открывать ссылку во внешнем браузере.
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isSafeExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return false;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (!SAFE_SCHEMES.has(parsed.protocol)) return false;
  if (parsed.username || parsed.password) return false;

  return SAFE_EXTERNAL_HOSTS.has(parsed.hostname);
}

/**
 * Открывает ссылку в системном браузере, если она прошла проверку.
 * @param {string} rawUrl
 * @returns {Promise<boolean>}
 */
async function openExternalSafe(rawUrl) {
  if (!isSafeExternalUrl(rawUrl)) return false;
  await shell.openExternal(rawUrl, { activate: true });
  return true;
}

/**
 * Применяет глобальные ограничения. Вызывать до создания окон.
 * @param {{ appUrl: string }} options
 */
function applySecurityPolicies({ appUrl }) {
  app.on('web-contents-created', (_event, contents) => {
    // 1. Никакой навигации окна. Единственный разрешённый адрес — сам рендерер.
    contents.on('will-navigate', (event, url) => {
      if (url !== appUrl) {
        event.preventDefault();
        console.warn('[security] заблокирована навигация:', url.slice(0, 120));
      }
    });

    // 2. Никаких новых окон из рендерера.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // 3. Никаких <webview>.
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
      console.warn('[security] заблокирована попытка вставить <webview>');
    });

    // 4. Никаких разрешений (камера, микрофон, гео, уведомления) — они нам не нужны.
    contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      console.warn('[security] запрошено разрешение:', permission);
      callback(false);
    });

    // 5. Никаких скачиваний средствами Chromium — файлы только через наш код.
    contents.session.on('will-download', (event) => {
      event.preventDefault();
      console.warn('[security] заблокировано скачивание средствами Chromium');
    });
  });
}

module.exports = { applySecurityPolicies, isSafeExternalUrl, openExternalSafe };
