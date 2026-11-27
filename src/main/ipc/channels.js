'use strict';

/**
 * Единый источник правды по IPC-каналам.
 * Любой канал вне этого файла — ошибка ревью (см. docs/03-security.md §4).
 */

const CHANNELS = {
  APP_INFO: 'app:info',
  CATALOG: 'catalog:list',
  SEARCH: 'search:releases',
  RELEASE: 'release:get',
  DUBBERS: 'release:dubbers',
  SOURCES: 'release:sources',
  EPISODES: 'release:episodes',
  STREAM: 'stream:resolve',
  FULLSCREEN: 'window:fullscreen',
  HISTORY: 'history:list',
  HISTORY_ADD: 'history:add',
  HISTORY_WATCHED: 'history:watched',
  PROFILE_ME: 'profile:me',
  BOOKMARKS: 'bookmarks:list',
  FAVORITES: 'favorites:list',
  VIDEOS: 'videos:list',
  RELATED: 'related:list',
  VOTES: 'votes:list',
  OPEN_EXTERNAL: 'shell:open',
  BOOKMARKS_SET_LIST: 'bookmarks:set-list',
  BOOKMARKS_SET_VOTE: 'bookmarks:set-vote',
  BOOKMARKS_SET_FAVORITE: 'bookmarks:set-favorite',
  AUTH_LOGIN: 'auth:login',
  AUTH_SIGNUP: 'auth:signup',
  AUTH_VERIFY: 'auth:verify',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATUS: 'auth:status',
  COMMENTS: 'comments:list',
  COMMENTS_REPLIES: 'comments:replies',
  FILTER_OPTIONS: 'filters:options',
  SETTINGS_ALL: 'settings:all',
  SETTINGS_SET: 'settings:set',
  PLAYER_EXTERNAL: 'player:external',
  TORRENTS_LIST: 'torrents:list',
  TORRENTS_SAVE: 'torrents:save',
  PROGRESS_GET: 'progress:get',
  PROGRESS_LAST: 'progress:last',
  PROGRESS_STATE: 'progress:state',
  PROGRESS_OPENED: 'progress:opened',
  PROGRESS_SAVE: 'progress:save',
  PROGRESS_CLEAR: 'progress:clear',
  FULLSCREEN_CHANGED: 'window:fullscreen-changed',
  CACHE_CLEAR: 'cache:clear',
  CACHE_SIZE: 'cache:size',
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
};

/**
 * Валидаторы аргументов. Каждый возвращает true/false, ничего не бросает.
 */
const validators = {
  isId: (v) => Number.isInteger(v) && v > 0 && v < 1e9,
  isPage: (v) => Number.isInteger(v) && v >= 0 && v <= 10_000,
  isQuery: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 100,
  isHash: (v) => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v),
  isNoArgs: (v) => v === undefined || v === null || (typeof v === 'object' && Object.keys(v).length === 0),
  isPlainObject: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),

  /** Строка страны — только из известного списка. */
  isCountry: (v) => v === undefined || ['Япония', 'Китай', 'Корея'].includes(v),

  /** Строка поиска по студии. */
  isStudio: (v) => v === undefined || (typeof v === 'string' && v.length <= 100),

  /** Первоисточник. */
  isSource: (v) => v === undefined || (typeof v === 'string' && v.length <= 40),

  /** Сезон 0–4 или не задан. */
  isSeason: (v) => v === undefined || v === null || (Number.isInteger(v) && v >= 0 && v <= 4),

  /** Количество эпизодов. */
  isEpisodes: (v) => v === undefined || v === null || (Number.isInteger(v) && v >= 0 && v <= 5000),

  /** Айди озвучек — массив чисел, не больше 20. */
  areTypes: (v) =>
    v === undefined ||
    (Array.isArray(v) && v.length <= 20 && v.every((n) => Number.isInteger(n) && n > 0 && n < 1e6)),

  /** Жанры — массив коротких строк, не больше 10. */
  /** Строки для форм входа: логин, почта, пароль, код. */
  isCredential: (v) => typeof v === 'string' && v.length > 0 && v.length <= 200,
  isEmail: (v) => typeof v === 'string' && v.length >= 3 && v.length <= 200 && v.includes('@'),
  isCode: (v) => typeof v === 'string' && /^[0-9]{3,10}$/.test(v),

  areGenres: (v) =>
    v === undefined ||
    (Array.isArray(v) &&
      v.length <= 10 &&
      v.every((g) => typeof g === 'string' && g.length > 0 && g.length <= 40)),
};

/**
 * Успешный ответ.
 */
const ok = (data = null) => ({ ok: true, data });

/**
 * Ошибка. Наружу — только код, без стектрейсов и путей.
 * @param {'invalid_args'|'not_found'|'network'|'internal'} code
 */
const fail = (code) => ({ ok: false, error: code });

module.exports = { CHANNELS, validators, ok, fail };
