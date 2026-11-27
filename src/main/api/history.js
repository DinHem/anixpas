'use strict';

/**
 * История просмотра на сервере.
 *
 * GET  /history/{page}                          — список релизов в истории
 * GET  /history/add/{id}/{sourceId}/{position}  — записать факт просмотра
 * GET  /episode/watch/{id}/{sourceId}/{position} — отметить серию просмотренной
 *
 * Все три принимают GET (POST отдаёт 405), проверено вручную.
 * Элемент истории — объект релиза с полями last_view_episode и last_view_timestamp.
 */

const anixart = require('./anixart.js');

/**
 * История просмотра.
 * @param {number} page
 */
async function getHistory(page = 0) {
  const json = await anixart.call(`/history/${page}`, { timeoutMs: 15_000 });
  const items = Array.isArray(json.content) ? json.content : [];

  return {
    items: items.map((raw) => ({
      id: Number(raw.id) || 0,
      title: typeof raw.title_ru === 'string' ? raw.title_ru : '',
      poster: typeof raw.image === 'string' && raw.image.startsWith('https://') ? raw.image : '',
      year: typeof raw.year === 'string' ? raw.year : '',
      grade: Number(raw.grade) || 0,
      category: raw.category && raw.category.name ? String(raw.category.name) : '',
      // API отдаёт объект эпизода, а не номер — берём position.
      lastEpisode: Number(raw.last_view_episode && raw.last_view_episode.position) || 0,
      lastViewedAt: Number(raw.last_view_timestamp) || 0,
    })),
    total: Number(json.total_count) || 0,
  };
}

/**
 * Записывает факт просмотра серии в историю.
 * @param {number} releaseId
 * @param {number} sourceId
 * @param {number} position
 */
async function addHistory(releaseId, sourceId, position) {
  await anixart.call(`/history/add/${releaseId}/${sourceId}/${position}`, { timeoutMs: 12_000 });
  return { ok: true };
}

/**
 * Отмечает серию просмотренной на сервере.
 * @param {number} releaseId
 * @param {number} sourceId
 * @param {number} position
 */
async function markWatched(releaseId, sourceId, position) {
  await anixart.call(`/episode/watch/${releaseId}/${sourceId}/${position}`, { timeoutMs: 12_000 });
  return { ok: true };
}

module.exports = { getHistory, addHistory, markWatched };
