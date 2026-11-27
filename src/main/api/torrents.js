'use strict';

/**
 * Торренты AniLibria.
 *
 * Правило (docs/00-decisions.md A1): показываем только там, где у релиза
 * есть источник Libria — значит релиз существует в AniLibria.
 * Список может быть пустым, если релиз убрали из торрентов по лицензии.
 */

const { requestBuffer, requestJson } = require('../net/http.js');
const { USER_AGENT } = require('./hosts-resolver.js');
const cache = require('../cache.js');

/** Хосты AniLibria (anilibria.top периодически не отвечает). */
const ANILIBRIA_HOSTS = ['https://aniliberty.top', 'https://anilibria.top'];

/**
 * Запрос к API AniLibria с перебором хостов.
 * @param {string} path
 * @param {{ maxBytes?: number }} [options]
 */
async function aniLibriaRequest(path, options = {}) {
  let lastError = null;
  for (const host of ANILIBRIA_HOSTS) {
    try {
      return await requestJson(`${host}${path}`, {
        timeoutMs: 12_000,
        maxBytes: options.maxBytes ?? 4 * 1024 * 1024,
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw Object.assign(new Error('AniLibria недоступна'), { code: 'network', cause: lastError });
}

/**
 * Запрос сырых байтов (для .torrent).
 * @param {string} path
 * @returns {Promise<Buffer>}
 */
async function aniLibriaBytes(path) {
  let lastError = null;
  for (const host of ANILIBRIA_HOSTS) {
    try {
      const res = await requestBuffer(`${host}${path}`, {
        timeoutMs: 20_000,
        maxBytes: 8 * 1024 * 1024,
      });
      if (res.status !== 200) {
        throw Object.assign(new Error(`AniLibria: HTTP ${res.status}`), { code: 'network' });
      }
      return res.buffer;
    } catch (err) {
      lastError = err;
    }
  }
  throw Object.assign(new Error('Не удалось скачать торрент'), {
    code: 'network',
    cause: lastError,
  });
}

/**
 * Ищет источник Libria у релиза и достаёт id релиза AniLibria.
 * @param {number} releaseId
 * @param {(path: string) => Promise<any>} anixartCall — клиент Anixart
 * @returns {Promise<{ libriaId: number, dubberId: number, sourceId: number } | null>}
 */
async function findLibriaSource(releaseId, anixartCall) {
  const dubbersJson = await anixartCall(`/episode/${releaseId}`);
  const dubbers = Array.isArray(dubbersJson.types) ? dubbersJson.types : [];

  for (const dubber of dubbers) {
    const sourcesJson = await anixartCall(`/episode/${releaseId}/${dubber.id}`);
    const sources = Array.isArray(sourcesJson.sources) ? sourcesJson.sources : [];

    const libria = sources.find((s) => s.name === 'Libria' || s.name === 'Liberty');
    if (!libria) continue;

    // Ссылка первой серии содержит id релиза AniLibria.
    const episodesJson = await anixartCall(`/episode/${releaseId}/${dubber.id}/${libria.id}`);
    const episodes = Array.isArray(episodesJson.episodes) ? episodesJson.episodes : [];
    const first = episodes.find((e) => typeof e.url === 'string');
    if (!first) continue;

    const match = /[?&]id=(\d+)/.exec(first.url);
    if (!match) continue;

    return {
      libriaId: Number(match[1]),
      dubberId: Number(dubber.id),
      sourceId: Number(libria.id),
    };
  }

  return null;
}

/**
 * Приводит торрент к тонкой модели.
 * @param {any} raw
 */
function toTorrent(raw) {
  if (!raw || typeof raw !== 'object') return null;

  return {
    id: Number(raw.id) || 0,
    hash: typeof raw.hash === 'string' ? raw.hash : '',
    label: typeof raw.label === 'string' ? raw.label : '',
    size: Number(raw.size) || 0,
    quality: raw.quality && raw.quality.value ? String(raw.quality.value) : '',
    codec: raw.codec && raw.codec.value ? String(raw.codec.value) : '',
    type: raw.type && raw.type.value ? String(raw.type.value) : '',
    seeders: Number(raw.seeders) || 0,
    leechers: Number(raw.leechers) || 0,
    filename: typeof raw.filename === 'string' ? raw.filename : '',
    magnet: typeof raw.magnet === 'string' ? raw.magnet : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    updatedAt: typeof raw.created_at === 'string' ? raw.created_at : '',
  };
}

/**
 * Список торрентов для релиза Anixart.
 * Возвращает null, если Libria-источника нет (блок не показываем).
 *
 * @param {number} releaseId
 * @param {(path: string) => Promise<any>} anixartCall
 * @returns {Promise<{ libriaId: number, torrents: any[] } | null>}
 */
async function getForRelease(releaseId, anixartCall) {
  return cache.wrap(`torrents:${releaseId}`, 'release', async () => {
    const found = await findLibriaSource(releaseId, anixartCall);
    if (!found) return null;

    const json = await aniLibriaRequest(`/api/v1/anime/torrents/release/${found.libriaId}`);
    const list = Array.isArray(json) ? json : json.data || json.torrents || [];

    return {
      libriaId: found.libriaId,
      torrents: list.map(toTorrent).filter((t) => t && t.hash),
    };
  });
}

/**
 * Скачивает .torrent по hash. Возвращает буфер.
 * @param {string} hash
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
async function downloadTorrent(hash) {
  if (!/^[a-f0-9]{40}$/.test(hash)) {
    throw Object.assign(new Error('Некорректный hash'), { code: 'invalid_args' });
  }

  const buffer = await aniLibriaBytes(`/api/v1/anime/torrents/${hash}/file`);
  return { buffer, filename: `${hash}.torrent` };
}

module.exports = { getForRelease, downloadTorrent, findLibriaSource, toTorrent, ANILIBRIA_HOSTS };
