'use strict';

/**
 * Preload: единственный мост между renderer и main.
 * Работает при sandbox: true — доступны только contextBridge и ipcRenderer.
 *
 * Наружу отдаётся узкий API, а не сам ipcRenderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Каналы, разрешённые к вызову из renderer. Зеркало main/ipc/channels.js. */
const ALLOWED_CHANNELS = new Set([
  'app:info',
  'catalog:list',
  'search:releases',
  'release:get',
  'release:dubbers',
  'release:sources',
  'release:episodes',
  'stream:resolve',
  'window:fullscreen',
  'history:list',
  'history:add',
  'history:watched',
  'profile:me',
  'bookmarks:list',
  'favorites:list',
  'videos:list',
  'related:list',
  'votes:list',
  'shell:open',
  'bookmarks:set-list',
  'bookmarks:set-vote',
  'bookmarks:set-favorite',
  'auth:login',
  'auth:signup',
  'auth:verify',
  'auth:restore',
  'auth:restore-verify',
  'auth:restore-resend',
  'auth:logout',
  'auth:status',
  'comments:list',
  'comments:replies',
  'filters:options',
  'settings:all',
  'settings:set',
  'player:external',
  'torrents:list',
  'torrents:save',
  'progress:get',
  'progress:last',
  'progress:state',
  'progress:opened',
  'progress:save',
  'progress:clear',
  'cache:clear',
  'cache:size',
  'updater:check',
  'updater:download',
  'updater:install',
]);

/**
 * Безопасный invoke: только разрешённые каналы.
 * @param {string} channel
 * @param {unknown} [payload]
 */
function invoke(channel, payload) {
  if (!ALLOWED_CHANNELS.has(channel)) {
    return Promise.resolve({ ok: false, error: 'channel_not_allowed' });
  }
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('anixpas', {
  appInfo: () => invoke('app:info'),

  catalog: (page, filter, force) => invoke('catalog:list', { page, filter, force }),
  search: (query, page = 0, force) => invoke('search:releases', { query, page, force }),
  release: (id, force) => invoke('release:get', { id, force }),

  dubbers: (releaseId) => invoke('release:dubbers', { releaseId }),
  sources: (releaseId, dubberId) => invoke('release:sources', { releaseId, dubberId }),
  episodes: (releaseId, dubberId, sourceId) =>
    invoke('release:episodes', { releaseId, dubberId, sourceId }),

  stream: (releaseId, sourceId, position) =>
    invoke('stream:resolve', { releaseId, sourceId, position }),

  toggleFullscreen: () => invoke('window:fullscreen'),

  /** Подписка на смену полноэкранного режима окна. @param {(value: boolean) => void} callback */
  onFullscreenChange: (callback) => {
    const listener = (_event, value) => callback(Boolean(value));
    ipcRenderer.on('window:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', listener);
  },

  history: (page) => invoke('history:list', { page }),
  addHistory: (releaseId, sourceId, position) =>
    invoke('history:add', { releaseId, sourceId, position }),
  markWatched: (releaseId, sourceId, position) =>
    invoke('history:watched', { releaseId, sourceId, position }),

  myProfile: (force) => invoke('profile:me', { force }),

  bookmarks: (status, page) => invoke('bookmarks:list', { status, page }),
  favorites: (page) => invoke('favorites:list', { page }),
  videos: (releaseId, page) => invoke('videos:list', { releaseId, page }),
  related: (groupId, page) => invoke('related:list', { groupId, page }),
  votes: (profileId, page, sort) => invoke('votes:list', { profileId, page, sort }),
  openExternal: (url) => invoke('shell:open', { url }),
  setListStatus: (releaseId, status) =>
    invoke('bookmarks:set-list', { releaseId, status }),
  setFavorite: (releaseId, value) => invoke('bookmarks:set-favorite', { releaseId, value }),
  setVote: (releaseId, vote) => invoke('bookmarks:set-vote', { releaseId, vote }),

  auth: {
    login: (login, password) => invoke('auth:login', { login, password }),
    signUp: (login, email, password) => invoke('auth:signup', { login, email, password }),
    verify: (payload) => invoke('auth:verify', payload),

    /** @param {string} data логин или почта */
    restore: (data) => invoke('auth:restore', { data }),
    restoreVerify: (payload) => invoke('auth:restore-verify', payload),
    restoreResend: (payload) => invoke('auth:restore-resend', payload),
    logout: () => invoke('auth:logout'),
    status: () => invoke('auth:status'),
  },

  comments: (releaseId, page, sort) => invoke('comments:list', { releaseId, page, sort }),
  replies: (commentId, page) => invoke('comments:replies', { commentId, page }),

  filterOptions: () => invoke('filters:options'),

  settings: {
    all: () => invoke('settings:all'),
    set: (key, value) => invoke('settings:set', { key, value }),
  },

  openExternalPlayer: (url) => invoke('player:external', { url }),

  torrents: {
    list: (releaseId) => invoke('torrents:list', { releaseId }),
    save: (hash, filename) => invoke('torrents:save', { hash, filename }),
  },

  progress: {
    get: (releaseId) => invoke('progress:get', { releaseId }),
    last: () => invoke('progress:last'),
    state: (releaseId, dubberId, sourceId, position) =>
      invoke('progress:state', { releaseId, dubberId, sourceId, position }),
    markOpened: (releaseId, dubberId, sourceId, position, meta) =>
      invoke('progress:opened', { releaseId, dubberId, sourceId, position, meta }),
    save: (releaseId, dubberId, sourceId, position, time, duration, meta) =>
      invoke('progress:save', { releaseId, dubberId, sourceId, position, time, duration, meta }),
    clear: () => invoke('progress:clear'),
  },

  cache: {
    clear: () => invoke('cache:clear'),
    size: () => invoke('cache:size'),
  },

  updater: {
    check: () => invoke('updater:check'),
    download: (payload) => invoke('updater:download', payload),
    install: (file) => invoke('updater:install', { file }),

    /** Прогресс скачивания обновления. @param {(value: {percent: number, received: number, total: number}) => void} callback */
    onProgress: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('updater:progress', listener);
      return () => ipcRenderer.removeListener('updater:progress', listener);
    },
  },
});
