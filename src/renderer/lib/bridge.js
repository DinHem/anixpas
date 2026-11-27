/**
 * Обёртка над мостом preload.
 *
 * Renderer не знает про IPC-каналы напрямую — только про эти функции.
 * Все ответы нормализуются: либо данные, либо понятная ошибка.
 */

const api = window.anixpas;

/**
 * Ошибка вызова.
 */
export class BridgeError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(`Ошибка: ${code}`);
    this.name = 'BridgeError';
    this.code = code;
  }
}

/**
 * Разворачивает { ok, data } / { ok, error } в данные или исключение.
 * @template T
 * @param {Promise<{ ok: boolean, data?: T, error?: string }>} promise
 * @returns {Promise<T>}
 */
async function unwrap(promise) {
  const res = await promise;
  if (!res || res.ok !== true) {
    throw new BridgeError((res && res.error) || 'unknown');
  }
  return res.data;
}

/**
 * Снимает реактивные прокси Svelte 5 и оставляет простые значения.
 *
 * IPC использует structured clone, а Proxy им не поддерживается —
 * передача $state-объекта напрямую даёт «An object could not be cloned».
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function plain(value) {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

export const bridge = {
  appInfo: () => unwrap(api.appInfo()),

  /** @param {number} page @param {object} [filter] */
  catalog: (page, filter, force = false) =>
    unwrap(api.catalog(page, plain(filter), force)),

  /** @param {string} query @param {number} [page] */
  search: (query, page = 0, force = false) => unwrap(api.search(query, page, force)),

  /** @param {number} id */
  release: (id, force = false) => unwrap(api.release(id, force)),

  /** @param {number} releaseId */
  dubbers: (releaseId) => unwrap(api.dubbers(releaseId)),

  /** @param {number} releaseId @param {number} dubberId */
  sources: (releaseId, dubberId) => unwrap(api.sources(releaseId, dubberId)),

  /** @param {number} releaseId @param {number} dubberId @param {number} sourceId */
  episodes: (releaseId, dubberId, sourceId) => unwrap(api.episodes(releaseId, dubberId, sourceId)),

  /** @param {number} releaseId @param {number} sourceId @param {number} position */
  stream: (releaseId, sourceId, position) =>
    unwrap(api.stream(releaseId, sourceId, position)),

  toggleFullscreen: () => unwrap(api.toggleFullscreen()),

  /** @param {(value: boolean) => void} callback */
  onFullscreenChange: (callback) => api.onFullscreenChange(callback),

  history: (page = 0) => unwrap(api.history(page)),
  addHistory: (releaseId, sourceId, position) =>
    unwrap(api.addHistory(releaseId, sourceId, position)),
  markWatched: (releaseId, sourceId, position) =>
    unwrap(api.markWatched(releaseId, sourceId, position)),

  myProfile: (force = false) => unwrap(api.myProfile(force)),

  bookmarks: (status, page = 0) => unwrap(api.bookmarks(status, page)),
  favorites: (page = 0) => unwrap(api.favorites(page)),
  videos: (releaseId, page = 0) => unwrap(api.videos(releaseId, page)),
  related: (groupId, page = 0) => unwrap(api.related(groupId, page)),
  votes: (profileId, page = 0, sort = 1) => unwrap(api.votes(profileId, page, sort)),
  openExternal: (url) => unwrap(api.openExternal(url)),

  setListStatus: (releaseId, status) => unwrap(api.setListStatus(releaseId, status)),
  setFavorite: (releaseId, value) => unwrap(api.setFavorite(releaseId, value)),
  setVote: (releaseId, vote) => unwrap(api.setVote(releaseId, vote)),

  auth: {
    login: (login, password) => unwrap(api.auth.login(login, password)),
    logout: () => unwrap(api.auth.logout()),
    status: () => unwrap(api.auth.status()),
  },

  comments: (releaseId, page = 0, sort = 0) =>
    unwrap(api.comments(releaseId, page, sort)),
  replies: (commentId, page = 0) => unwrap(api.replies(commentId, page)),

  filterOptions: () => unwrap(api.filterOptions()),

  settings: {
    all: () => unwrap(api.settings.all()),
    set: (key, value) => unwrap(api.settings.set(key, value)),
  },

  openExternalPlayer: (url) => unwrap(api.openExternalPlayer(url)),

  torrents: {
    list: (releaseId) => unwrap(api.torrents.list(releaseId)),
    save: (hash, filename) => unwrap(api.torrents.save(hash, filename)),
  },

  progress: {
    get: (releaseId) => unwrap(api.progress.get(releaseId)),
    last: () => unwrap(api.progress.last()),
    state: (releaseId, dubberId, sourceId, position) =>
      unwrap(api.progress.state(releaseId, dubberId, sourceId, position)),
    markOpened: (releaseId, dubberId, sourceId, position, meta) =>
      unwrap(api.progress.markOpened(releaseId, dubberId, sourceId, position, plain(meta))),
    save: (releaseId, dubberId, sourceId, position, time, duration, meta) =>
      unwrap(api.progress.save(releaseId, dubberId, sourceId, position, time, duration, plain(meta))),
    clear: () => unwrap(api.progress.clear()),
  },

  updater: {
    check: () => unwrap(api.updater.check()),

    /** @param {{url: string, version: string, sha512: string}} payload */
    download: (payload) => unwrap(api.updater.download(plain(payload))),

    /** @param {string} file */
    install: (file) => unwrap(api.updater.install(file)),

    /** @param {(value: {percent: number, received: number, total: number}) => void} callback */
    onProgress: (callback) => api.updater.onProgress(callback),
  },

  cacheSize: () => unwrap(api.cache.size()),
  cacheClear: () => unwrap(api.cache.clear()),
};
