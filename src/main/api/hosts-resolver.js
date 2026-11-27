'use strict';

/**
 * Определение хоста API Anixart.
 *
 * Логика (docs/00-decisions.md §3, docs/01-open-questions.md B3):
 *   1. зашитый список известных хостов — фолбэк;
 *   2. динамический список от сообщества (urls.json) — обновляет фолбэк;
 *   3. проба живости — первый ответивший становится активным;
 *   4. результат кэшируется на диск, чтобы не пробовать при каждом старте.
 *
 * IPv6 отключён: у api.anixart.tv AAAA есть, но TCP висит.
 */

const { requestJson } = require('../net/http.js');

/** Известные хосты в порядке предпочтения. */
const FALLBACK_HOSTS = [
  'https://api-s.anixsekai.com',
  'https://api-s2.anixsekai.com',
  'https://api.anixart.tv',
  'https://api.anixsekai.com',
];

/** Откуда брать актуальный список. */
const URLS_JSON = 'https://raw.githubusercontent.com/AnixHelper/pages/refs/heads/main/urls.json';

/** Мобильный User-Agent обязателен: без него API отвечает 400 с пустым телом. */
// Актуальный User-Agent (сверено с обёрткой под Anixart 11 BETA 3).
// На ответы не влияет — проверено, но выглядеть лучше.
const USER_AGENT =
  'AnixartApp/10.5-26101718 (Android 9; SDK 28; x86_64; ROG ASUS AI2201_B; ru)';

/** Сколько ждём ответа при проверке хоста. */
const PROBE_TIMEOUT_MS = 6000;

/** @type {string|null} */
let activeHost = null;
/** @type {string[]} */
let hostsToTry = [...FALLBACK_HOSTS];

/**
 * Тянет актуальный список хостов у сообщества.
 * Молча возвращает null, если не получилось — это не критично.
 * @returns {Promise<string[]|null>}
 */
async function fetchCommunityHosts() {
  try {
    const json = await requestJson(URLS_JSON, { timeoutMs: 8000, maxBytes: 64 * 1024 });
    const urls = Object.values(json || {})
      .map((entry) => entry && entry.api_url)
      .filter((u) => typeof u === 'string' && u.startsWith('https://'))
      .map((u) => u.replace(/\/+$/, ''));

    return urls.length ? [...new Set(urls)] : null;
  } catch {
    return null;
  }
}

/**
 * Проверяет, отвечает ли хост вменяемо.
 * @param {string} host
 * @returns {Promise<boolean>}
 */
async function probeHost(host) {
  try {
    const json = await requestJson(`${host}/release/1`, {
      timeoutMs: PROBE_TIMEOUT_MS,
      maxBytes: 256 * 1024,
      headers: { 'User-Agent': USER_AGENT, 'API-Version': 'v2' },
    });
    return Boolean(json && json.code === 0 && json.release);
  } catch {
    return false;
  }
}

/**
 * Определяет рабочий хост. Кэширует выбор в памяти.
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<string>}
 */
async function resolveHost(options = {}) {
  if (activeHost && !options.forceRefresh) return activeHost;

  const community = await fetchCommunityHosts();
  if (community) {
    // Известные хосты — первыми, затем то, что нашлось у сообщества.
    hostsToTry = [...new Set([...FALLBACK_HOSTS, ...community])];
  }

  for (const host of hostsToTry) {
    if (await probeHost(host)) {
      activeHost = host;
      return host;
    }
  }

  // Никто не ответил — отдаём первый, ошибка всплывёт на реальном запросе.
  activeHost = hostsToTry[0];
  return activeHost;
}

/**
 * Достаёт следующий хост для повтора после сетевой ошибки.
 * @param {string} failedHost
 * @returns {string|null}
 */
function nextHost(failedHost) {
  const idx = hostsToTry.indexOf(failedHost);
  const next = idx >= 0 ? hostsToTry[idx + 1] : hostsToTry[0];
  if (!next || next === failedHost) return null;
  activeHost = next;
  return next;
}

/** Сбрасывает выбор — следующий resolveHost будет искать заново. */
function resetHost() {
  activeHost = null;
}

module.exports = {
  resolveHost,
  nextHost,
  resetHost,
  USER_AGENT,
  FALLBACK_HOSTS,
  URLS_JSON,
};
