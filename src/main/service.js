'use strict';

/**
 * Сервисный слой: связывает клиент Anixart, кэш и нормализацию.
 *
 * Правила:
 *  - наружу отдаём только тонкие модели;
 *  - списки серий НЕ кэшируем: в них лежат подписанные ссылки на видео,
 *    они протухают и привязаны к IP (docs/api-scout.md §5, §11).
 */

const anixart = require('./api/anixart.js');
const cache = require('./cache.js');
const models = require('./api/models.js');
const torrentsApi = require('./api/torrents.js');
const filtersApi = require('./api/filters.js');
const commentsApi = require('./api/comments.js');
const bookmarksApi = require('./api/bookmarks.js');
const videosApi = require('./api/videos.js');
const relatedApi = require('./api/related.js');
const votesApi = require('./api/votes.js');
const profileApi = require('./api/profile.js');
const historyApi = require('./api/history.js');
const auth = require('./auth.js');

/**
 * Каталог с кэшем.
 * @param {number} page
 * @param {{ sort?: number, status_id?: number|null, category_id?: number|null, genres?: string[],
 *           country?: string, studio?: string, source?: string, season?: number,
 *           episodesFrom?: number, episodesTo?: number, types?: number[] }} filter
 */
/**
 * Каталог.
 * @param {number} page
 * @param {object} filter
 * @param {{ force?: boolean }} [options] — force: обойти кэш (смена вкладки, возврат в раздел)
 */
async function getCatalog(page, filter = {}, options = {}) {
  const key = [
    'catalog',
    page,
    filter.sort ?? 0,
    filter.status_id ?? '-',
    filter.category_id ?? '-',
    filter.country ?? '-',
    filter.studio ?? '-',
    filter.source ?? '-',
    filter.season ?? '-',
    filter.episodesFrom ?? '-',
    filter.episodesTo ?? '-',
    (filter.genres || []).join('|'),
    (filter.types || []).join('|'),
  ].join(':');

  const fetchFresh = async () => {
    const { items } = await anixart.catalog(page, filter);
    return items.map(models.toReleaseListItem).filter(Boolean);
  };

  // У авторизованного пользователя в выдаче есть персональные поля
  // (profile_list_status, is_favorite). Кэш их устаревает: изменения,
  // сделанные с телефона, не видны до истечения TTL. Поэтому кэшируем
  // только анонимную выдачу.
  // Смена вкладки или возврат из карточки — читаем свежее, минуя кэш.
  if (options.force) return fetchFresh();

  return cache.wrap(key, 'catalog', fetchFresh);
}

/**
 * Поиск с кэшем.
 * @param {string} query
 * @param {number} page
 */
async function searchReleases(query, page = 0, options = {}) {
  const key = `search:${page}:${query.toLowerCase()}`;

  const fetchFresh = async () => {
    const { items } = await anixart.search(query, page);
    return items.map(models.toReleaseListItem).filter(Boolean);
  };

  if (options.force) return fetchFresh();

  return cache.wrap(key, 'search', fetchFresh);
}

/**
 * Карточка релиза с кэшем.
 * @param {number} id
 */
async function getRelease(id, options = {}) {
  const fetchFresh = async () => {
    const raw = await anixart.release(id);
    return models.toReleaseDetail(raw);
  };

  if (options.force) return fetchFresh();

  return cache.wrap(`release:${id}`, 'release', fetchFresh);
}

/**
 * Озвучки. Кэшируются вместе с релизом редко меняются.
 * @param {number} releaseId
 */
async function getDubbers(releaseId) {
  return cache.wrap(`dubbers:${releaseId}`, 'release', async () => {
    const list = await anixart.dubbers(releaseId);
    return list.map(models.toDubber).filter(Boolean);
  });
}

/**
 * Источники для озвучки.
 * @param {number} releaseId
 * @param {number} dubberId
 */
async function getSources(releaseId, dubberId) {
  return cache.wrap(`sources:${releaseId}:${dubberId}`, 'release', async () => {
    const list = await anixart.sources(releaseId, dubberId);
    return list.map(models.toSource).filter(Boolean);
  });
}

/**
 * Серии. Без кэша — в ссылках подписи и IP.
 * @param {number} releaseId
 * @param {number} dubberId
 * @param {number} sourceId
 */
async function getEpisodes(releaseId, dubberId, sourceId) {
  const list = await anixart.episodes(releaseId, dubberId, sourceId);
  return list.map(models.toEpisode).filter(Boolean);
}

/**
 * Торренты релиза. null — Libria-источника нет, блок не показываем.
 * @param {number} releaseId
 */
async function getTorrents(releaseId) {
  return torrentsApi.getForRelease(releaseId, (path) => anixart.call(path));
}

/**
 * Скачать .torrent по hash.
 * @param {string} hash
 */
async function downloadTorrent(hash) {
  return torrentsApi.downloadTorrent(hash);
}

/**
 * Справочники для панели фильтров.
 */
async function getFilterOptions() {
  return filtersApi.getFilterOptions();
}

/**
 * Комментарии релиза (с кэшем — читаются часто, меняются редко).
 * @param {number} releaseId @param {number} page @param {number} sort
 */
async function getComments(releaseId, page, sort) {
  return cache.wrap(`comments:${releaseId}:${page}:${sort}`, 'search', () =>
    commentsApi.getComments(releaseId, page, sort)
  );
}

/**
 * Ответы на комментарий.
 * @param {number} commentId @param {number} page
 */
async function getReplies(commentId, page) {
  return cache.wrap(`replies:${commentId}:${page}`, 'search', () =>
    commentsApi.getReplies(commentId, page)
  );
}

/** Свои оценки. */
async function getMyVotes(profileId, page, sort) {
  return votesApi.getVoted(profileId, page, sort);
}

/** Видео релиза. */
async function getReleaseVideos(releaseId, page) {
  return videosApi.getReleaseVideos(releaseId, page);
}

/** Франшиза: связанные тайтлы. */
async function getRelated(groupId, page) {
  return relatedApi.getRelated(groupId, page);
}

/** Закладки пользователя. */
async function getBookmarks(status, page, sort) {
  return bookmarksApi.getList(status, page, sort);
}

/** Избранное пользователя. */
async function getFavorites(page) {
  return bookmarksApi.getFavorites(page);
}

async function setListStatus(releaseId, status) {
  const result = await bookmarksApi.setListStatus(releaseId, status);
  // Статусы в каталоге и карточке закэшированы — сбрасываем, иначе UI покажет старое.
  cache.bumpEpoch();
  return result;
}

async function setFavorite(releaseId, value) {
  const result = await bookmarksApi.setFavorite(releaseId, value);
  cache.bumpEpoch();
  return result;
}

async function setVote(releaseId, vote) {
  const result = await bookmarksApi.setVote(releaseId, vote);
  cache.bumpEpoch();
  return result;
}

function getBookmarkLists() {
  return bookmarksApi.LISTS;
}

/** Профиль по id. */
async function getProfile(id, options = {}) {
  return profileApi.getProfile(id, options);
}

/** Мой профиль (id из сохранённого токена). */
async function getMyProfile(options = {}) {
  const status = await auth.getStatus();
  if (!status.profile) return null;
  return profileApi.getProfile(status.profile.id, options);
}

/** Серверная история просмотра. */
async function getHistory(page = 0) {
  return historyApi.getHistory(page);
}

/** Записать просмотр на сервер. */
async function addHistory(releaseId, sourceId, position) {
  return historyApi.addHistory(releaseId, sourceId, position);
}

/** Отметить серию просмотренной. */
async function markWatched(releaseId, sourceId, position) {
  return historyApi.markWatched(releaseId, sourceId, position);
}

module.exports = {
  getCatalog,
  searchReleases,
  getRelease,
  getDubbers,
  getSources,
  getEpisodes,
  getHistory,
  addHistory,
  markWatched,
  getProfile,
  getMyProfile,
  getBookmarks,
  getFavorites,
  getReleaseVideos,
  getRelated,
  getMyVotes,
  setListStatus,
  setFavorite,
  setVote,
  getBookmarkLists,
  getComments,
  getReplies,
  getFilterOptions,
  getTorrents,
  downloadTorrent,
};
