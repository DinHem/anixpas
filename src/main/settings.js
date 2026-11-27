'use strict';

/**
 * Настройки приложения.
 *
 * Хранятся в userData/settings.json — надёжнее, чем localStorage в окне
 * с file:// (там он не гарантирует сохранность между запусками).
 *
 * Ключи фиксированные, значения валидируются: renderer не может записать
 * произвольный мусор.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');

/** Допустимые настройки и их значения по умолчанию. */
const DEFAULTS = {
  /** Скорость воспроизведения. */
  playerRate: 1,
  /** Автопропуск опенинга и эндинга. */
  autoSkip: false,
  /** Вид каталога: 'grid' | 'list'. */
  catalogMode: 'grid',
  /** Вкладка страны: 'anime' | 'donghua'. */
  catalogCountry: 'anime',
  /** Вкладка внутри страны: latest | ongoing | announced | completed | films | ova. */
  catalogTab: 'latest',
};

/** Допустимые значения для проверки. */
const VALIDATORS = {
  playerRate: (v) => [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(Number(v)),
  autoSkip: (v) => typeof v === 'boolean',
  catalogMode: (v) => v === 'grid' || v === 'list',
  catalogCountry: (v) => ['anime', 'donghua'].includes(v),
  catalogTab: (v) =>
    ['latest', 'ongoing', 'announced', 'completed', 'films', 'ova'].includes(v),
};

/** @type {Record<string, any>|null} */
let cache = null;
/** @type {NodeJS.Timeout|null} */
let flushTimer = null;
let dirty = false;

function filePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

/**
 * Читает настройки с диска.
 * @returns {Promise<Record<string, any>>}
 */
async function load() {
  if (cache) return cache;

  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw);

    cache = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (parsed && key in parsed && VALIDATORS[key](parsed[key])) {
        cache[key] = parsed[key];
      }
    }
  } catch {
    cache = { ...DEFAULTS };
  }

  return cache;
}

/** Пишет на диск с задержкой. */
function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;

  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (!dirty || !cache) return;
    dirty = false;

    try {
      const target = filePath();
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(cache), 'utf8');
      await fs.rename(tmp, target);
    } catch {
      // Не смогли сохранить — не критично, настройки не стоят падения.
    }
  }, 500);
}

/**
 * Все настройки.
 * @returns {Promise<Record<string, any>>}
 */
async function getAll() {
  return { ...(await load()) };
}

/**
 * Устанавливает одну настройку.
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<{ ok: boolean, value?: any }>}
 */
async function set(key, value) {
  await load();

  if (!(key in DEFAULTS)) return { ok: false };
  if (!VALIDATORS[key](value)) return { ok: false };

  cache[key] = value;
  scheduleFlush();
  return { ok: true, value };
}

/** Сброс к значениям по умолчанию. */
async function reset() {
  cache = { ...DEFAULTS };
  dirty = true;
  scheduleFlush();
  return { ...cache };
}

/** Принудительная запись (при выходе). */
async function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!dirty || !cache) return;

  try {
    const target = filePath();
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(cache), 'utf8');
    await fs.rename(tmp, target);
    dirty = false;
  } catch {
    /* ничего */
  }
}

module.exports = { getAll, set, reset, flushNow, DEFAULTS };
