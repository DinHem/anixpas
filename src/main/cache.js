'use strict';

/**
 * Дисковый кэш JSON.
 *
 * Правила (docs/03-security.md, docs/01-open-questions.md B2):
 *  - пишем только в userData/cache;
 *  - ключ хешируется, чтобы в имени файла не было ничего из сети;
 *  - TTL обязателен;
 *  - ссылки на видео НЕ кэшируем: они протухают и привязаны к IP.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

/** Время жизни по типам записей, мс. */
const TTL = {
  release: 3 * 60 * 1000, // карточка — 3 минуты (там персональные статусы)
  catalog: 3 * 60 * 1000, // каталог — 3 минуты
  search: 3 * 60 * 1000, // поиск — 3 минуты
  episodes: 2 * 60 * 60 * 1000, // список серий — 2 часа
  genres: 24 * 60 * 60 * 1000, // справочник жанров — сутки
};

/**
 * Версия схемы кэша. Меняй при изменении формы моделей —
 * старые записи перестанут находиться и перезапишутся.
 */
const CACHE_VERSION = 5;

/** Максимальный размер файла кэша, байт. */
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;

/** @type {string|null} */
let cacheDir = null;

/**
 * Поколение кэша.
 *
 * Участвует в хеше ключа. Увеличиваем его после действий, меняющих состояние
 * на сервере (списки, оценки) — иначе UI показывал бы старые статусы.
 */
let epoch = 0;

/**
 * Чей кэш. У авторизованного и анонимного пользователя разные данные:
 * `profile_list_status` и `is_favorite` приходят только с токеном.
 * Без этого разделения анонимный кэш подсовывал null вместо статусов.
 */
let userScope = 'anon';

/** Сбрасывает весь кэш, не удаляя файлы. */
function bumpEpoch() {
  epoch += 1;
  persistEpoch().catch(() => {});
}

/**
 * Переключает область кэша при входе/выходе.
 * @param {number|string|null} userId
 */
function setUserScope(userId) {
  const next = userId ? String(userId) : 'anon';
  if (next === userScope) return;
  userScope = next;
  bumpEpoch();
}

/**
 * Папка кэша. Создаётся лениво.
 * @returns {Promise<string>}
 */
async function dir() {
  if (!cacheDir) {
    cacheDir = path.join(app.getPath('userData'), 'cache');
    await fs.mkdir(cacheDir, { recursive: true });
  }
  return cacheDir;
}

/**
 * Путь к файлу записи. Имя — sha256 от ключа, ничего из сети в пути.
 * @param {string} key
 * @returns {Promise<string>}
 */
async function fileFor(key) {
  const hash = crypto
    .createHash('sha256')
    .update(`${CACHE_VERSION}|${epoch}|${userScope}|${key}`)
    .digest('hex');
  return path.join(await dir(), `${hash}.json`);
}

/**
 * Читает запись, если она живая.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function get(key) {
  try {
    const file = await fileFor(key);
    const raw = await fs.readFile(file, 'utf8');
    const entry = JSON.parse(raw);

    if (!entry || typeof entry.expiresAt !== 'number') return null;
    if (Date.now() > entry.expiresAt) return null;

    return entry.value ?? null;
  } catch {
    // Нет файла, битый JSON, нет прав — для вызывающего это просто «кэша нет».
    return null;
  }
}

/**
 * Кладёт значение в кэш.
 * @param {string} key
 * @param {unknown} value
 * @param {keyof TTL} kind
 * @returns {Promise<void>}
 */
async function set(key, value, kind = 'release') {
  try {
    const serialized = JSON.stringify({
      expiresAt: Date.now() + (TTL[kind] ?? TTL.release),
      value,
    });

    // Гигантские ответы на диск не кладём.
    if (serialized.length > MAX_ENTRY_BYTES) return;

    const file = await fileFor(key);
    await fs.writeFile(file, serialized, 'utf8');
  } catch {
    // Кэш — оптимизация. Не смогли записать — работаем дальше.
  }
}

/**
 * Обёртка «взять из кэша или выполнить и сохранить».
 * @template T
 * @param {string} key
 * @param {keyof TTL} kind
 * @param {() => Promise<T>} producer
 * @returns {Promise<T>}
 */
async function wrap(key, kind, producer) {
  const cached = await get(key);
  if (cached !== null) return cached;

  const value = await producer();
  if (value !== null && value !== undefined) await set(key, value, kind);
  return value;
}

/** Удаляет все записи кэша. */
async function clear() {
  const d = await dir();
  const entries = await fs.readdir(d).catch(() => []);
  await Promise.all(
    entries.map((name) => fs.unlink(path.join(d, name)).catch(() => undefined))
  );
}

/** Размер кэша на диске, байт. */
async function size() {
  const d = await dir();
  const entries = await fs.readdir(d).catch(() => []);
  let total = 0;
  for (const name of entries) {
    const stat = await fs.stat(path.join(d, name)).catch(() => null);
    if (stat) total += stat.size;
  }
  return total;
}

/**
 * Восстанавливает поколение с диска: без этого после перезапуска
 * старые записи (с epoch = 0) снова находились бы.
 */
async function restoreEpoch() {
  try {
    const raw = await fs.readFile(path.join(await dir(), 'epoch.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (Number.isInteger(parsed.epoch)) epoch = parsed.epoch;
  } catch {
    /* первый запуск */
  }
}

/** Сохраняет поколение на диск. */
async function persistEpoch() {
  try {
    await fs.writeFile(path.join(await dir(), 'epoch.json'), JSON.stringify({ epoch }), 'utf8');
  } catch {
    /* не критично */
  }
}

module.exports = { get, set, wrap, clear, size, bumpEpoch, setUserScope, restoreEpoch, persistEpoch, TTL };
