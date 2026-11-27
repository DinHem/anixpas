'use strict';

/**
 * Единственная точка исходящих HTTP-запросов.
 *
 * Правила (docs/03-security.md §5):
 *  - принимает не URL, а имя операции с параметрами;
 *  - проверяет хост по белому списку;
 *  - запрещает приватные адреса и не-HTTPS;
 *  - таймаут и лимит размера ответа;
 *  - не переотправляет Authorization на чужой хост.
 */

const { ALLOWED_HOSTS, PRIVATE_HOST_PATTERNS } = require('./hosts.js');

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Точная проверка хоста: либо полное совпадение, либо поддомен через точку.
 * Никогда не includes() — иначе evil-libria.fun.attacker.com пройдёт.
 * @param {string} hostname
 * @returns {boolean}
 */
function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();

  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) return false;

  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith('.' + allowed));
}

/**
 * Проверяет URL перед запросом.
 * @param {string} rawUrl
 * @returns {{ ok: true, url: URL } | { ok: false, reason: string }}
 */
function checkUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'scheme_not_allowed' };
  if (url.username || url.password) return { ok: false, reason: 'credentials_in_url' };
  if (!isAllowedHost(url.hostname)) return { ok: false, reason: 'host_not_allowed' };

  return { ok: true, url };
}

/**
 * Запрос с проверкой адреса и ограничениями.
 *
 * @param {string} rawUrl
 * @param {{
 *   method?: string,
 *   headers?: Record<string,string>,
 *   body?: string,
 *   timeoutMs?: number,
 *   maxBytes?: number,
 * }} [options]
 * @returns {Promise<{ status: number, headers: Headers, text: string, url: string }>}
 */
async function request(rawUrl, options = {}) {
  const check = checkUrl(rawUrl);
  if (!check.ok) {
    const err = new Error(`Запрос отклонён: ${check.reason}`);
    err.code = check.reason;
    throw err;
  }

  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(check.url.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
      redirect: 'follow',
    });

    // Проверяем, куда нас в итоге привели редиректы.
    if (res.url && res.url !== check.url.toString()) {
      const finalCheck = checkUrl(res.url);
      if (!finalCheck.ok) {
        console.log(`[net] редирект ${check.url.hostname} → ${res.url} (${finalCheck.reason})`);
        throw Object.assign(new Error(`Редирект на запрещённый адрес: ${finalCheck.reason}`), {
          code: 'redirect_not_allowed',
        });
      }
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw Object.assign(new Error('Ответ превысил лимит размера'), { code: 'too_large' });
    }

    return {
      status: res.status,
      headers: res.headers,
      text: new TextDecoder('utf-8').decode(buf),
      url: res.url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Запрос бинарных данных (например .torrent).
 * Не декодирует в текст — иначе bencode побьётся.
 *
 * @param {string} rawUrl
 * @param {{ timeoutMs?: number, maxBytes?: number, headers?: Record<string,string> }} [options]
 * @returns {Promise<{ status: number, buffer: Buffer, url: string }>}
 */
async function requestBuffer(rawUrl, options = {}) {
  const check = checkUrl(rawUrl);
  if (!check.ok) {
    const err = new Error(`Запрос отклонён: ${check.reason}`);
    err.code = check.reason;
    throw err;
  }

  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, headers = {} } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(check.url.toString(), { headers, signal: controller.signal });

    if (res.url && res.url !== check.url.toString()) {
      const finalCheck = checkUrl(res.url);
      if (!finalCheck.ok) {
        throw Object.assign(new Error("Редирект на запрещённый адрес"), { code: "redirect_not_allowed" });
      }
    }

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw Object.assign(new Error("Ответ превысил лимит размера"), { code: "too_large" });
    }

    return { status: res.status, buffer: Buffer.from(arrayBuffer), url: res.url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Запрос JSON с проверкой кода в теле (Anixart отдаёт 200 при ошибках).
 * @param {string} rawUrl
 * @param {object} [options]
 * @returns {Promise<any>}
 */
async function requestJson(rawUrl, options) {
  const res = await request(rawUrl, options);
  if (!res.text.trim()) {
    throw Object.assign(new Error('Пустой ответ'), { code: 'empty_body' });
  }
  return JSON.parse(res.text);
}

module.exports = { request, requestJson, requestBuffer, checkUrl, isAllowedHost };
