'use strict';

/**
 * Оценки пользователя.
 *
 * Путь найден по документации anixdart: GET /profile/vote/release/voted/{profileId}/{page}?sort=
 * Значения `sort` проверены на живом аккаунте с оценками от 1 до 5:
 *   1 — все, по возрастанию оценки
 *   2 — все, по убыванию оценки
 *   3 — только 5★, 4 — 4★, 5 — 3★, 6 — 2★, 7 — 1★
 * (то есть фильтр по звёздам = 8 − звёзды)
 *
 * Подробности: docs/api-scout.md §25.
 */

const anixart = require('./anixart.js');

/** sort → подпись фильтра. */
const SORTS = [
  { sort: 1, label: 'Все' },
  { sort: 3, label: '5★' },
  { sort: 4, label: '4★' },
  { sort: 5, label: '3★' },
  { sort: 6, label: '2★' },
  { sort: 7, label: '1★' },
];

/**
 * Тонкая модель оценённого релиза.
 * @param {any} raw
 */
function toVoted(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = Number(raw.id) || 0;
  if (!id) return null;

  return {
    id,
    title: typeof raw.title_ru === 'string' ? raw.title_ru : '',
    poster: typeof raw.image === 'string' && raw.image.startsWith('https://') ? raw.image : '',
    year: typeof raw.year === 'string' ? raw.year : '',
    season: Number(raw.season) || 0,
    grade: Math.round((Number(raw.grade) || 0) * 100) / 100,
    category: raw.category && raw.category.name ? String(raw.category.name) : '',
    episodesTotal: Number(raw.episodes_total) || 0,
    episodesReleased: Number(raw.episodes_released) || 0,
    releaseDate: String(raw.release_date || ''),
    listStatus: Number.isInteger(raw.profile_list_status) ? raw.profile_list_status : null,
    /** Своя оценка 1..5. */
    myVote: Number(raw.my_vote) || 0,
  };
}

/**
 * Список оценённых релизов.
 * @param {number} profileId
 * @param {number} page
 * @param {number} sort
 */
async function getVoted(profileId, page = 0, sort = 1) {
  const valid = SORTS.some((s) => s.sort === sort);
  const query = `?sort=${valid ? sort : 1}`;

  const json = await anixart.call(
    `/profile/vote/release/voted/${profileId}/${page}${query}`,
    { timeoutMs: 15_000 }
  );

  const content = Array.isArray(json.content) ? json.content : [];

  return {
    items: content.map(toVoted).filter(Boolean),
    total: Number(json.total_count) || 0,
  };
}

module.exports = { getVoted, SORTS };
