'use strict';

/**
 * Белый список внешних хостов. Единственное место, где он задаётся.
 * См. docs/03-security.md §5.
 *
 * Правило проверки — в net/http.js: точное совпадение или поддомен через точку.
 */

const ALLOWED_HOSTS = [
  // --- Anixart API ---
  'api-s.anixsekai.com',
  'api-s2.anixsekai.com',
  'api.anixart.tv',
  'api.anixsekai.com',
  // список хостов, который отдаёт сообщество
  'raw.githubusercontent.com',

  // --- AniLibria API ---
  'anilibria.top',
  'aniliberty.top',

  // --- Kodik (страница плеера + служебный эндпоинт) ---
  'kodikplayer.com',
  'kodik.info',

  // --- CDN потоков ---
  // Поддомены динамические (cache, cache-rfn, cache1.cache-ru1, cache2.cache-ru3...),
  // поэтому разрешаем корневые домены: любой поддомен проходит проверку.
  'libria.fun',
  'solodcdn.com',
  'kodik-storage.com',
  'kodikplayer.com',

  // --- картинки Anixart ---
  's.anixmirai.com',
  's3.anixmirai.com',
];

/**
 * Адреса, которые запрещены всегда — защита от SSRF.
 * Проверяются как по имени, так и по виду адреса.
 */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i, // fc00::/7 — unique local
  /^\[?fe80:/i, // link-local
  /\.local$/i,
  /^metadata\./i,
];

module.exports = { ALLOWED_HOSTS, PRIVATE_HOST_PATTERNS };
