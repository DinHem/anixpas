'use strict';

/**
 * Видео релиза: трейлеры, опенинги, эндинги, клипы.
 *
 * Путь найден эмпирически: GET /video/release/{releaseId}/{page}
 * Карточка релиза отдаёт только `video_banners` — категории с обложками,
 * сами ролики лежат отдельно.
 *
 * Подробности: docs/api-scout.md §24.
 */

const anixart = require('./anixart.js');

/** Категории по id — на случай, если сервер не пришлёт название. */
const CATEGORY_NAMES = {
  1: 'Трейлеры',
  2: 'Опенинги',
  3: 'Эндинги',
  4: 'Сцены',
  5: 'Муз клипы',
};

/**
 * Приводит видео к тонкой модели.
 * @param {any} raw
 */
function toVideo(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = Number(raw.id) || 0;
  if (!id) return null;

  // Обложки YouTube и Sibnet приходят по http — переводим на https,
  // иначе CSP их не пропустит.
  const image =
    typeof raw.image === 'string' && raw.image.startsWith('http')
      ? raw.image.replace(/^http:/, 'https:')
      : '';

  const url = typeof raw.url === 'string' && raw.url.startsWith('http') ? raw.url : '';

  const categoryId = raw.category && Number(raw.category.id) || 0;
  const category =
    (raw.category && typeof raw.category.name === 'string' && raw.category.name) ||
    CATEGORY_NAMES[categoryId] ||
    'Видео';

  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    category,
    categoryId,
    hosting: raw.hosting && typeof raw.hosting.name === 'string' ? raw.hosting.name : '',
    image,
    url,
    favorites: Number(raw.favorites_count) || 0,
  };
}

/**
 * Видео релиза.
 * @param {number} releaseId
 * @param {number} page
 * @returns {Promise<{ items: any[], total: number }>}
 */
async function getReleaseVideos(releaseId, page = 0) {
  const json = await anixart.call(`/video/release/${releaseId}/${page}`, { timeoutMs: 15_000 });
  const content = Array.isArray(json.content) ? json.content : [];

  return {
    items: content.map(toVideo).filter(Boolean),
    total: Number(json.total_count) || 0,
  };
}

module.exports = { getReleaseVideos };
