'use strict';

/**
 * Комментарии к релизу.
 *
 * GET /release/comment/all/{releaseId}/{page}?sort=…
 * GET /release/comment/replies/{commentId}/{page}?sort=…
 *
 * Сортировки проверены вручную: sort=0 — новые, sort=2 — популярные.
 * Без токена доступно только чтение; лайки и ответы требуют авторизации.
 */

const anixart = require('./anixart.js');

/** Сколько символов сообщения отдаём — защита от гигантских текстов. */
const MAX_MESSAGE = 5000;

/**
 * Приводит комментарий к тонкой модели.
 * @param {any} raw
 */
function toComment(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const profile = raw.profile || {};

  return {
    id: Number(raw.id) || 0,
    author: {
      login: typeof profile.login === 'string' ? profile.login : 'Неизвестный',
      avatar: typeof profile.avatar === 'string' && profile.avatar.startsWith('https://')
        ? profile.avatar
        : '',
      badge: typeof profile.badge_name === 'string' ? profile.badge_name : '',
      badgeUrl:
        typeof profile.badge_url === 'string' && profile.badge_url.startsWith('https://')
          ? profile.badge_url
          : '',
    },
    message:
      typeof raw.message === 'string' ? raw.message.slice(0, MAX_MESSAGE) : '',
    timestamp: Number(raw.timestamp) || 0,
    likes: Number(raw.likes_count) || 0,
    replies: Number(raw.reply_count) || 0,
    isSpoiler: Boolean(raw.is_spoiler),
    isEdited: Boolean(raw.is_edited),
    isDeleted: Boolean(raw.is_deleted),
    isReply: Boolean(raw.is_reply),
    episode: Number(raw.posted_at_episode) || 0,
  };
}

/**
 * Комментарии релиза.
 * @param {number} releaseId
 * @param {number} page
 * @param {0|2} sort — 0 новые, 2 популярные
 */
async function getComments(releaseId, page = 0, sort = 0) {
  const json = await anixart.call(
    `/release/comment/all/${releaseId}/${page}?sort=${sort === 2 ? 2 : 0}`,
    { timeoutMs: 15_000 }
  );

  const list = Array.isArray(json.content) ? json.content : [];
  return {
    items: list.map(toComment).filter(Boolean),
    total: Number(json.total_count) || 0,
    pages: Number(json.total_page_count) || 0,
  };
}

/**
 * Ответы на комментарий.
 * @param {number} commentId
 * @param {number} page
 */
async function getReplies(commentId, page = 0) {
  const json = await anixart.call(
    `/release/comment/replies/${commentId}/${page}?sort=0`,
    { timeoutMs: 15_000 }
  );

  const list = Array.isArray(json.content) ? json.content : [];
  return {
    items: list.map(toComment).filter(Boolean),
    total: Number(json.total_count) || 0,
  };
}

module.exports = { getComments, getReplies, toComment };
