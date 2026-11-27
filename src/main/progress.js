'use strict';

/**
 * Прогресс просмотра.
 *
 * Хранится локально в userData/progress.json.
 * Синхронизация с Anixart появится вместе с авторизацией —
 * формат уже под неё приспособлен (releaseId + позиция серии).
 *
 * Логика (docs/00-decisions.md §9):
 *  - факт открытия серии = «просмотрено» (галочка), даже без времени;
 *  - время хранится отдельно, показывается только если реально смотрели;
 *  - досмотрел до конца — прогресс больше не предлагается.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');

/** Сколько секунд считать «начал смотреть». */
const MIN_PROGRESS_SECONDS = 15;
/** Доля длительности, после которой серия считается досмотренной. */
const COMPLETED_RATIO = 0.95;
/** Как часто сбрасывать накопленное на диск, мс. */
const FLUSH_DELAY = 4000;
/** Максимум релизов в истории. */
const MAX_RELEASES = 200;

/** @type {Record<string, any>|null} */
let data = null;
/** @type {NodeJS.Timeout|null} */
let flushTimer = null;
let dirty = false;

function filePath() {
  return path.join(app.getPath('userData'), 'progress.json');
}

/**
 * Читает файл с диска (один раз).
 * @returns {Promise<Record<string, any>>}
 */
async function load() {
  if (data) return data;

  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw);
    data = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Нет файла или битый JSON — начинаем с чистого листа.
    data = {};
  }
  return data;
}

/** Планирует запись на диск (не чаще раза в FLUSH_DELAY). */
function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_DELAY);
}

/** Немедленная запись. */
async function flush() {
  if (!dirty || !data) return;
  dirty = false;

  try {
    const target = filePath();
    const tmp = `${target}.tmp`;
    // Пишем через временный файл — не оставляем битый JSON при обрыве.
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.rename(tmp, target);
  } catch {
    // Диск недоступен — не роняем приложение из-за прогресса.
  }
}

/**
 * Обрезает историю до MAX_RELEASES самых свежих записей.
 */
function prune() {
  const entries = Object.entries(data || {});
  if (entries.length <= MAX_RELEASES) return;

  entries
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .slice(MAX_RELEASES)
    .forEach(([key]) => {
      delete data[key];
    });
}

/**
 * Запись о релизе, создаётся при необходимости.
 * @param {number} releaseId
 * @param {{ title?: string, poster?: string, dubberId?: number, sourceId?: number }} meta
 */
async function ensureRelease(releaseId, meta = {}) {
  const db = await load();
  const key = String(releaseId);

  if (!db[key]) {
    db[key] = {
      releaseId,
      title: '',
      poster: '',
      dubberId: null,
      sourceId: null,
      lastPosition: null,
      updatedAt: 0,
      episodes: {},
      lastDubberId: null,
      lastSourceId: null,
    };
  }

  const entry = db[key];
  if (meta.title) entry.title = meta.title;
  if (meta.poster) entry.poster = meta.poster;
  if (meta.dubberId) entry.dubberId = meta.dubberId;
  if (meta.sourceId) entry.sourceId = meta.sourceId;

  return entry;
}

/**
 * Ключ серии в истории: озвучка + источник + номер.
 *
 * Разные озвучки — разные тайминги.
 * Разные источники одной озвучки — тоже: у Kodik и Libria разная нарезка,
 * рекламные вставки и сдвиги, поэтому позиции не переносятся.
 *
 * @param {number} dubberId
 * @param {number} sourceId
 * @param {number} position
 */
function episodeKey(dubberId, sourceId, position) {
  return `${dubberId}:${sourceId}:${position}`;
}

/**
 * Фиксирует открытие серии: галочка «просмотрено» появляется сразу.
 * @param {number} releaseId
 * @param {number} dubberId
 * @param {number} position
 * @param {{ title?: string, poster?: string, sourceId?: number }} [meta]
 */
async function markOpened(releaseId, dubberId, sourceId, position, meta = {}) {
  const entry = await ensureRelease(releaseId, { ...meta, dubberId, sourceId });
  const key = episodeKey(dubberId, sourceId, position);

  if (!entry.episodes[key]) {
    entry.episodes[key] = { time: 0, duration: 0, completed: false, openedAt: Date.now() };
  }

  entry.lastPosition = position;
  entry.lastDubberId = dubberId;
  entry.lastSourceId = sourceId;
  entry.updatedAt = Date.now();
  scheduleFlush();

  return entry;
}

/**
 * Сохраняет позицию просмотра.
 * @param {number} releaseId
 * @param {number} dubberId
 * @param {number} position
 * @param {{ time: number, duration: number, title?: string, poster?: string, sourceId?: number }} payload
 */
async function savePosition(releaseId, dubberId, sourceId, position, payload) {
  const entry = await ensureRelease(releaseId, { ...payload, dubberId, sourceId });
  const key = episodeKey(dubberId, sourceId, position);
  const episode = entry.episodes[key] || { time: 0, duration: 0, completed: false, openedAt: Date.now() };

  const duration = Math.max(0, Number(payload.duration) || episode.duration || 0);
  const time = Math.max(0, Number(payload.time) || 0);

  episode.time = time;
  episode.duration = duration;
  episode.completed = duration > 0 && time >= duration * COMPLETED_RATIO;
  episode.updatedAt = Date.now();

  entry.episodes[key] = episode;
  entry.lastPosition = position;
  entry.lastDubberId = dubberId;
  entry.lastSourceId = sourceId;
  entry.updatedAt = Date.now();
  prune();
  scheduleFlush();

  return entry;
}

/**
 * Данные по релизу.
 * @param {number} releaseId
 * @returns {Promise<any|null>}
 */
async function getRelease(releaseId) {
  const db = await load();
  return db[String(releaseId)] ?? null;
}

/**
 * Последний просмотренный релиз (для плашки «Продолжить просмотр»).
 * @returns {Promise<any|null>}
 */
async function getLast() {
  const db = await load();
  const entries = Object.values(db);
  if (!entries.length) return null;

  entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const last = entries[0];

  // Если у последнего нет ни одной открытой серии — плашку не показываем.
  if (!last || !last.lastPosition) return null;
  return last;
}

/**
 * Что делать при выборе серии.
 * Возвращает данные для диалога «начать сначала / продолжить».
 * @param {number} releaseId
 * @param {number} dubberId
 * @param {number} position
 */
async function getEpisodeState(releaseId, dubberId, sourceId, position) {
  const entry = await getRelease(releaseId);
  const episode =
    entry && entry.episodes ? entry.episodes[episodeKey(dubberId, sourceId, position)] : null;

  if (!episode) {
    return { opened: false, completed: false, resumeAt: null };
  }

  const hasProgress =
    !episode.completed &&
    episode.time >= MIN_PROGRESS_SECONDS &&
    episode.duration > 0 &&
    episode.time < episode.duration * COMPLETED_RATIO;

  return {
    opened: true,
    completed: Boolean(episode.completed),
    resumeAt: hasProgress ? episode.time : null,
  };
}

/** Полная очистка истории. */
async function clear() {
  data = {};
  dirty = true;
  await flush();
}

/** Принудительный сброс на диск (при выходе из приложения). */
async function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flush();
}

module.exports = {
  markOpened,
  savePosition,
  getRelease,
  getLast,
  getEpisodeState,
  clear,
  flushNow,
  MIN_PROGRESS_SECONDS,
};
