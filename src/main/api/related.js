'use strict';

/**
 * Франшиза: связанные тайтлы одной группы.
 *
 * В карточке релиза приходят:
 *   related       — объект группы { id, name, description, image }
 *   related_count — сколько всего тайтлов в группе
 *   related_releases — превью (3 штуки)
 *
 * Полный список: GET /related/{groupId}/{page}, по 25 на страницу.
 * Подробности: docs/api-scout.md §24.
 */

const anixart = require('./anixart.js');

/**
 * Тонкая модель тайтла внутри франшизы.
 * @param {any} raw
 */
function toRelatedItem(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = Number(raw.id) || 0;
  if (!id) return null;

  return {
    id,
    title: typeof raw.title_ru === 'string' ? raw.title_ru : '',
    poster: typeof raw.image === 'string' && raw.image.startsWith('https://') ? raw.image : '',
    year: typeof raw.year === 'string' ? raw.year : '',
    grade: Math.round((Number(raw.grade) || 0) * 100) / 100,
    category: raw.category && raw.category.name ? String(raw.category.name) : '',
    episodesTotal: Number(raw.episodes_total) || 0,
    listStatus: Number.isInteger(raw.profile_list_status) ? raw.profile_list_status : null,
  };
}

/**
 * Тайтлы франшизы по id группы.
 * @param {number} groupId
 * @param {number} page
 */
async function getRelated(groupId, page = 0) {
  const json = await anixart.call(`/related/${groupId}/${page}`, { timeoutMs: 15_000 });
  const content = Array.isArray(json.content) ? json.content : [];

  return {
    items: content.map(toRelatedItem).filter(Boolean),
    total: Number(json.total_count) || 0,
  };
}

module.exports = { getRelated };
