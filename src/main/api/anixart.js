'use strict';

/**
 * Клиент API Anixart.
 *
 * Особенности (проверено, см. docs/api-scout.md):
 *  - мобильный User-Agent обязателен, иначе 400 с пустым телом;
 *  - API почти всегда отвечает HTTP 200, реальный код в теле (json.code);
 *  - поиск и каталог — POST с JSON-телом;
 *  - total_count в каталоге не работает — крутим страницы до пустого content.
 */

const { requestJson } = require('../net/http.js');
const { resolveHost, nextHost, USER_AGENT } = require('./hosts-resolver.js');
const auth = require('../auth.js');

/** Коды ответов API. */
const CODE = {
  OK: 0,
  BAD_CREDENTIALS: 2,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
};

/** Ошибка API с кодом из тела ответа. */
class ApiError extends Error {
  constructor(code, message) {
    super(message || `API вернул код ${code}`);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * Выполняет запрос к API с фолбэком хостов.
 *
 * @param {string} path — путь начиная с '/'
 * @param {{ method?: 'GET'|'POST', body?: object, timeoutMs?: number, token?: string }} [options]
 * @returns {Promise<any>}
 */
async function call(path, options = {}) {
  const { method = 'GET', body, timeoutMs = 15_000, token } = options;

  // Если явный токен не передан — берём сохранённый (docs/03-security.md §9).
  const effectiveToken = token !== undefined ? token : await auth.getToken();

  let lastError = null;
  // Один повтор на каждый хост из списка — не больше.
  for (let attempt = 0; attempt < 4; attempt++) {
    const host = await resolveHost();
    // Anixart принимает токен ТОЛЬКО query-параметром: с Bearer отвечает 401.
    const withToken =
      effectiveToken
        ? `${host}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(effectiveToken)}`
        : `${host}${path}`;

    const headers = {
      'User-Agent': USER_AGENT,
      'API-Version': 'v2',
    };

    if (body) headers['Content-Type'] = 'application/json';

    try {
      const json = await requestJson(withToken, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        timeoutMs,
        maxBytes: 4 * 1024 * 1024,
      });

      const code = json && typeof json.code === 'number' ? json.code : null;
      if (code === CODE.OK) return json;

      // Код в теле — это ответ API, повторять бессмысленно (кроме пустого тела).
      throw new ApiError(code, `API ${path}: код ${code}`);
    } catch (err) {
      if (err instanceof ApiError) throw err;

      // Сеть/таймаут/битый ответ — пробуем следующий хост.
      lastError = err;
      if (err && err.code === 'host_not_allowed') throw err;

      const fallback = nextHost(host);
      if (!fallback) break;
    }
  }

  const networkError = new Error(
    `Сеть недоступна: ${lastError && lastError.message ? lastError.message : 'неизвестная ошибка'}`
  );
  networkError.code = 'network';
  throw networkError;
}

/**
 * Каталог. Формат тела проверен: docs/api-scout.md §12.
 * @param {number} page
 * @param {{ sort?: number, status_id?: number|null, category_id?: number|null, genres?: string[],
 *           country?: string, studio?: string, source?: string, season?: number,
 *           episodesFrom?: number, episodesTo?: number, types?: number[] }} [filter]
 * @returns {Promise<{ items: any[] }>}
 */
async function catalog(page, filter = {}) {
  const body = {
    sort: filter.sort ?? 0,
    status_id: filter.status_id ?? null,
    category_id: filter.category_id ?? null,
  };
  // genres принимает ТОЛЬКО массив строк (названий жанров), числа дают пустой список.
  if (Array.isArray(filter.genres) && filter.genres.length) body.genres = filter.genres;
  // country — строка совпадением: "Япония" / "Китай" / "Корея".
  if (typeof filter.country === "string" && filter.country) body.country = filter.country;
  // Остальные фильтры проверены запросами: docs/api-scout.md §18.
  if (typeof filter.studio === "string" && filter.studio) body.studio = filter.studio;
  if (typeof filter.source === "string" && filter.source) body.source = filter.source;
  if (Number.isInteger(filter.season)) body.season = filter.season;
  if (Number.isInteger(filter.episodesFrom)) body.episodes_from = filter.episodesFrom;
  if (Number.isInteger(filter.episodesTo)) body.episodes_to = filter.episodesTo;
  if (Array.isArray(filter.types) && filter.types.length) body.types = filter.types;

  // Проверено: docs/api-scout.md §27.3 — годы, длительность эпизода, возраст, режим жанров.
  if (Number.isInteger(filter.startYear)) body.start_year = filter.startYear;
  if (Number.isInteger(filter.endYear)) body.end_year = filter.endYear;
  if (Number.isInteger(filter.durationFrom)) body.episode_duration_from = filter.durationFrom;
  if (Number.isInteger(filter.durationTo)) body.episode_duration_to = filter.durationTo;
  if (Array.isArray(filter.ageRatings) && filter.ageRatings.length) {
    body.age_ratings = filter.ageRatings;
  }
  if (Number.isInteger(filter.genresMode)) body.genres_mode = filter.genresMode;

  const json = await call(`/filter/${page}?extended_mode=true`, { method: 'POST', body });
  return { items: json.content || [] };
}

/**
 * Поиск релизов.
 * @param {string} query
 * @param {number} [page]
 * @returns {Promise<{ items: any[], related: any|null }>}
 */
async function search(query, page = 0) {
  const json = await call(`/search/releases/${page}`, {
    method: 'POST',
    body: { query, searchBy: 0 },
  });
  return { items: json.releases || [], related: json.related || null };
}

/**
 * Полная карточка релиза.
 * @param {number} id
 * @returns {Promise<any>}
 */
async function release(id) {
  const json = await call(`/release/${id}`);
  return json.release;
}

/**
 * Озвучки релиза.
 * @param {number} releaseId
 * @returns {Promise<any[]>}
 */
async function dubbers(releaseId) {
  const json = await call(`/episode/${releaseId}`);
  return json.types || [];
}

/**
 * Источники (Kodik / Libria) для конкретной озвучки.
 * @param {number} releaseId
 * @param {number} dubberId
 * @returns {Promise<any[]>}
 */
async function sources(releaseId, dubberId) {
  const json = await call(`/episode/${releaseId}/${dubberId}`);
  return json.sources || [];
}

/**
 * Серии для источника.
 * @param {number} releaseId
 * @param {number} dubberId
 * @param {number} sourceId
 * @returns {Promise<any[]>}
 */
async function episodes(releaseId, dubberId, sourceId) {
  const json = await call(`/episode/${releaseId}/${dubberId}/${sourceId}`);
  return json.episodes || [];
}

module.exports = {
  call,
  catalog,
  search,
  release,
  dubbers,
  sources,
  episodes,
  CODE,
  ApiError,
};
