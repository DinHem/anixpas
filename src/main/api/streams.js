'use strict';

/**
 * Получение прямых ссылок на видеопоток.
 *
 * Схемы проверены вручную, см. docs/api-scout.md §5 и §11:
 *  - Libria: id из iframe.php → официальный API AniLibria → hls_480/720/1080
 *  - Kodik: страница плеера → /ftor → ROT18 + base64 → прямой m3u8
 *  - Sibnet: не поддерживается (сервис недоступен), docs/00-decisions.md §6
 */

const { request, requestJson } = require('../net/http.js');
const { USER_AGENT } = require('./hosts-resolver.js');

/** Ключи качества в порядке предпочтения. */
const QUALITY_ORDER = ['1080', '720', '480', '360'];

/**
 * Нормализует ссылку: добавляет схему, если пришла протокол-относительная.
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

/**
 * Сортирует качества по убыванию и выкидывает пустые.
 * @param {Record<string, string|null|undefined>} map
 * @returns {{ qualities: Record<string,string>, best: string|null }}
 */
function packQualities(map) {
  /** @type {Record<string,string>} */
  const qualities = {};
  for (const key of QUALITY_ORDER) {
    const value = normalizeUrl(map[key]);
    if (value) qualities[key] = value;
  }
  // ВАЖНО: Object.keys() сортирует числоподобные ключи по возрастанию,
  // поэтому нельзя брать первый ключ — только явный порядок предпочтения.
  const best = QUALITY_ORDER.find((q) => qualities[q]) ?? null;
  return { qualities, best };
}

/** Хосты AniLibria в порядке предпочтения.
 * anilibria.top периодически не отвечает (таймаут), aniliberty.top — рабочий.
 * Данные идентичны, проверено сравнением хешей m3u8. */
const ANILIBRIA_HOSTS = ['https://aniliberty.top', 'https://anilibria.top'];

/**
 * Запрос релиза AniLibria с перебором хостов.
 * @param {number} releaseId
 * @returns {Promise<any>}
 */
async function fetchAniLibriaRelease(releaseId) {
  let lastError = null;
  for (const host of ANILIBRIA_HOSTS) {
    try {
      return await requestJson(`${host}/api/v1/anime/releases/${releaseId}`, {
        timeoutMs: 10_000,
        maxBytes: 4 * 1024 * 1024,
      });
    } catch (err) {
      console.log('[anilibria] ' + host + ' → ' + (err && err.message) + ' code=' + (err && err.code));
      lastError = err;
    }
  }
  throw Object.assign(new Error('AniLibria недоступна'), {
    code: 'network',
    cause: lastError,
  });
}

/**
 * Таймкоды опенинга и эндинга из эпизода AniLibria.
 * Нужны для кнопки «Пропустить»: { start, stop } в секундах.
 * @param {any} episode
 * @returns {{ opening: {start:number, stop:number}|null, ending: {start:number, stop:number}|null }}
 */
function normalizeSkip(episode) {
  const pick = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const start = Number(raw.start);
    const stop = Number(raw.stop);
    if (!Number.isFinite(start) || !Number.isFinite(stop)) return null;
    if (stop <= start) return null;
    return { start, stop };
  };

  return {
    opening: pick(episode.opening),
    ending: pick(episode.ending),
  };
}

/**
 * Libria: достаём id релиза и номер серии из iframe-ссылки.
 * @param {string} iframeUrl — вида https://anixart.libria.fun/public/iframe.php?id=8460&ep=1
 * @returns {Promise<{ qualities: Record<string,string>, best: string|null } | null>}
 */
async function resolveLibria(iframeUrl) {
  const idMatch = /[?&]id=(\d+)/.exec(iframeUrl);
  const epMatch = /[?&]ep=(\d+)/.exec(iframeUrl);
  if (!idMatch) return null;

  const releaseId = Number(idMatch[1]);
  const position = epMatch ? Number(epMatch[1]) : 1;

  const json = await fetchAniLibriaRelease(releaseId);

  const episodes = Array.isArray(json.episodes) ? json.episodes : [];
  // ordinal — порядковый номер серии в AniLibria, совпадает с ep из iframe.
  const episode =
    episodes.find((e) => Number(e.ordinal) === position) ||
    episodes[position - 1] ||
    null;

  if (!episode) return null;

  const packed = packQualities({
    '1080': episode.hls_1080,
    '720': episode.hls_720,
    '480': episode.hls_480,
  });

  return { ...packed, skip: normalizeSkip(episode) };
}

/**
 * Расшифровка ссылок Kodik: ROT18 по буквам, затем base64.
 * @param {string} src
 * @returns {string}
 */
function decryptKodik(src) {
  const Z = 'Z'.charCodeAt(0);
  const rotated = src.replace(/[a-zA-Z]/g, (ch) => {
    const original = ch.charCodeAt(0);
    const limit = original <= Z ? 90 : 122;
    const shifted = original + 18;
    return String.fromCharCode(limit >= shifted ? shifted : shifted - 26);
  });
  return Buffer.from(rotated, 'base64').toString('utf-8');
}

/**
 * Загружает страницу плеера Kodik.
 * Ссылка из API бывает подписанной (`?d=&s=&ip=`), и такие отдают 500:
 * пробуем как есть, при неудаче — без query-строки.
 * @param {string} url
 * @returns {Promise<{ status: number, text: string } | null>}
 */
async function fetchKodikPage(url) {
  const attempts = [url];
  const bare = url.split('?')[0];
  if (bare !== url) attempts.push(bare);

  for (const attempt of attempts) {
    try {
      const page = await request(attempt, { timeoutMs: 12_000, maxBytes: 2 * 1024 * 1024 });
      if (page.status === 200 && /urlParams/.test(page.text)) return page;
    } catch {
      // пробуем следующий вариант
    }
  }
  return null;
}

/**
 * Kodik: страница плеера → urlParams/hash/id/type → /ftor → расшифровка.
 * @param {string} playerUrl
 * @returns {Promise<{ qualities: Record<string,string>, best: string|null } | null>}
 */
async function resolveKodik(playerUrl) {
  const page = await fetchKodikPage(playerUrl);
  if (!page) return null;

  const html = page.text;
  const paramsRaw = /var\s+urlParams\s*=\s*'(.*?)';/is.exec(html)?.[1];
  const hash = /\w+\.hash\s*=\s*'(.*?)';/is.exec(html)?.[1];
  const id = /\w+\.id\s*=\s*'(.*?)';/is.exec(html)?.[1];
  const type = /\w+\.type\s*=\s*'(.*?)';/.exec(html)?.[1];

  if (!paramsRaw || !hash || !id || !type) return null;

  /** @type {Record<string,string>} */
  let params;
  try {
    params = JSON.parse(paramsRaw);
  } catch {
    return null;
  }

  const query = new URLSearchParams({ ...params, type, hash, id }).toString();
  const json = await requestJson(`https://kodikplayer.com/ftor?${query}`, {
    timeoutMs: 15_000,
    maxBytes: 512 * 1024,
    headers: { referer: '', 'referrer-policy': 'no-referrer' },
  });

  const links = json && json.links;
  if (!links || typeof links !== 'object') return null;

  /** @type {Record<string,string>} */
  const decoded = {};
  for (const [quality, list] of Object.entries(links)) {
    const first = Array.isArray(list) ? list[0] : null;
    if (!first || typeof first.src !== 'string') continue;
    try {
      decoded[quality.replace(/p$/i, '')] = decryptKodik(first.src);
    } catch {
      // Битая ссылка — пропускаем качество, а не весь источник.
    }
  }

  return packQualities(decoded);
}

/**
 * Берёт адрес серии у Anixart и превращает его в прямые ссылки на поток.
 *
 * @param {number} releaseId
 * @param {number} sourceId
 * @param {number} position — номер серии
 * @returns {Promise<{ source: string, qualities: Record<string,string>, best: string|null } | null>}
 */
async function resolveStream(releaseId, sourceId, position) {
  const json = await requestJson(
    `${await hostOfAnixart()}/episode/target/${releaseId}/${sourceId}/${position}`,
    { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024, headers: { 'User-Agent': USER_AGENT, 'API-Version': 'v2' } }
  );

  const episode = json && json.episode;
  if (!episode || typeof episode.url !== 'string') return null;

  const sourceName = (episode.source && episode.source.name) || '';

  if (sourceName === 'Libria' || sourceName === 'Liberty') {
    const result = await resolveLibria(episode.url);
    return result ? { source: sourceName, ...result } : null;
  }

  if (sourceName === 'Kodik') {
    const result = await resolveKodik(episode.url);
    // У Kodik таймкодов опенинга нет — только поток.
    return result ? { source: sourceName, ...result, skip: null } : null;
  }

  // Sibnet и прочее — не поддерживаются.
  return null;
}

/**
 * Хост Anixart нужен внутри модуля, чтобы не тянуть его в renderer.
 * @returns {Promise<string>}
 */
async function hostOfAnixart() {
  const { resolveHost } = require('./hosts-resolver.js');
  return resolveHost();
}

module.exports = { resolveStream, resolveLibria, resolveKodik, decryptKodik };
