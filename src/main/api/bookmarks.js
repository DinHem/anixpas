'use strict';

/**
 * Закладки пользователя — списки релизов.
 *
 * Путь найден экспериментально: GET /profile/list/all/{status}/{page}
 * В обёртке theDesConnet/AnixartJS его нет, там только добавление и удаление.
 *
 * Соответствие статусов проверено на живом профиле:
 *   1 — смотрю, 2 — в планах, 3 — завершено, 4 — отложено, 5 — брошено
 * Счётчики совпали с полями профиля (watching_count, plan_count и т.д.).
 */

const anixart = require('./anixart.js');

/** Названия списков для интерфейса. */
const LISTS = [
  { status: 1, id: 'watching', label: 'Смотрю' },
  { status: 2, id: 'planned', label: 'В планах' },
  { status: 3, id: 'completed', label: 'Завершено' },
  { status: 4, id: 'holdOn', label: 'Отложено' },
  { status: 5, id: 'dropped', label: 'Брошено' },
];

/**
 * Список релизов из закладок.
 * @param {number} status — 1..5
 * @param {number} page
 * @param {number} [sort]
 */
async function getList(status, page = 0, sort = 0) {
  const valid = LISTS.some((l) => l.status === status);
  if (!valid) {
    throw Object.assign(new Error('Неизвестный список'), { code: 'invalid_args' });
  }

  const query = sort ? `?sort=${sort}` : '';
  const json = await anixart.call(`/profile/list/all/${status}/${page}${query}`, {
    timeoutMs: 15_000,
  });

  const items = Array.isArray(json.content) ? json.content : [];

  return {
    items: items.map((raw) => ({
      id: Number(raw.id) || 0,
      title: typeof raw.title_ru === 'string' ? raw.title_ru : '',
      poster: typeof raw.image === 'string' && raw.image.startsWith('https://') ? raw.image : '',
      year: typeof raw.year === 'string' ? raw.year : '',
      grade: Number(raw.grade) || 0,
      episodesTotal: Number(raw.episodes_total) || 0,
      episodesReleased: Number(raw.episodes_released) || 0,
      season: Number(raw.season) || 0,
      releaseDate: String(raw.release_date || ''),
      category: raw.category && raw.category.name ? String(raw.category.name) : '',
      listStatus: Number.isInteger(raw.profile_list_status) ? raw.profile_list_status : null,
      isFavorite: Boolean(raw.is_favorite),
    })),
    total: Number(json.total_count) || 0,
  };
}

/**
 * Ставит релиз в список или убирает из списков.
 * status 0 — убрать отовсюду, 1..5 — конкретный список.
 *
 * @param {number} releaseId
 * @param {number} status
 */
async function setListStatus(releaseId, status) {
  if (!Number.isInteger(status) || status < 0 || status > 5) {
    throw Object.assign(new Error('Неверный статус'), { code: 'invalid_args' });
  }

  const path = status === 0
    ? `/profile/list/delete/0/${releaseId}`
    : `/profile/list/add/${status}/${releaseId}`;

  // Проверено: API принимает GET, а не POST (POST → 405).
  await anixart.call(path);
  return { ok: true };
}

/**
 * Избранное пользователя.
 * Путь проверен на живом аккаунте: GET /favorite/all/{page}
 * @param {number} page
 */
async function getFavorites(page = 0) {
  const json = await anixart.call(`/favorite/all/${page}`, { timeoutMs: 15_000 });
  const items = Array.isArray(json.content) ? json.content : [];

  return {
    items: items.map((raw) => ({
      id: Number(raw.id) || 0,
      title: typeof raw.title_ru === 'string' ? raw.title_ru : '',
      poster: typeof raw.image === 'string' && raw.image.startsWith('https://') ? raw.image : '',
      year: typeof raw.year === 'string' ? raw.year : '',
      grade: Number(raw.grade) || 0,
      episodesTotal: Number(raw.episodes_total) || 0,
      episodesReleased: Number(raw.episodes_released) || 0,
      season: Number(raw.season) || 0,
      releaseDate: String(raw.release_date || ''),
      category: raw.category && raw.category.name ? String(raw.category.name) : '',
      listStatus: Number.isInteger(raw.profile_list_status) ? raw.profile_list_status : null,
      isFavorite: Boolean(raw.is_favorite),
    })),
    total: Number(json.total_count) || 0,
  };
}

/**
 * Добавляет или убирает из избранного.
 * @param {number} releaseId
 * @param {boolean} value
 */
async function setFavorite(releaseId, value) {
  const path = value
    ? `/favorite/add/${releaseId}`
    : `/favorite/delete/${releaseId}`;

  await anixart.call(path);
  return { ok: true };
}

/**
 * Ставит свою оценку релизу. vote = 0 — снять оценку.
 * Проверено: API принимает GET, POST отдаёт пустое тело.
 * @param {number} releaseId
 * @param {number} vote — 0..5
 */
async function setVote(releaseId, vote) {
  if (!Number.isInteger(vote) || vote < 0 || vote > 5) {
    throw Object.assign(new Error('Неверная оценка'), { code: 'invalid_args' });
  }

  const path = vote === 0
    ? `/release/vote/delete/${releaseId}`
    : `/release/vote/add/${releaseId}/${vote}`;

  await anixart.call(path);
  return { ok: true, vote: vote || null };
}

module.exports = { getList, getFavorites, setListStatus, setFavorite, setVote, LISTS };
