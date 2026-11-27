'use strict';

/**
 * Профиль пользователя.
 *
 * GET /profile/{id} — публичные данные плюс счётчики списков.
 * Свои данные приходят с токеном (is_my_profile).
 */

const anixart = require('./anixart.js');

/**
 * Приводит профиль к тонкой модели.
 * @param {any} raw
 */
function toProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;

  return {
    id: Number(raw.id) || 0,
    login: typeof raw.login === 'string' ? raw.login : '',
    avatar: typeof raw.avatar === 'string' && raw.avatar.startsWith('https://') ? raw.avatar : '',
    status: typeof raw.status === 'string' ? raw.status : '',
    badge: raw.badge && typeof raw.badge === 'object'
      ? {
          name: String(raw.badge.name || ''),
          image: typeof raw.badge.image_url === 'string' && raw.badge.image_url.startsWith('https://')
            ? raw.badge.image_url
            : '',
        }
      : null,
    registerDate: Number(raw.register_date) || 0,
    privilegeLevel: Number(raw.privilege_level) || 0,
    friends: Number(raw.friend_count) || 0,

    lists: {
      watching: Number(raw.watching_count) || 0,
      planned: Number(raw.plan_count) || 0,
      completed: Number(raw.completed_count) || 0,
      holdOn: Number(raw.hold_on_count) || 0,
      dropped: Number(raw.dropped_count) || 0,
    },

    watchedEpisodes: Number(raw.watched_episode_count) || 0,
    /** Время просмотра в МИНУТАХ (проверено: 7573 серии ≈ 178 000 минут ≈ 124 дня). */
    watchedMinutes: Number(raw.watched_time) || 0,
  };
}

/**
 * Профиль по id.
 * @param {number} id
 * @param {{ force?: boolean }} [options]
 */
async function getProfile(id, options = {}) {
  const json = await anixart.call(`/profile/${id}`, { timeoutMs: 15_000 });
  const profile = toProfile(json.profile);
  return profile ? { ...profile, isMe: Boolean(json.is_my_profile) } : null;
}

module.exports = { getProfile, toProfile };
