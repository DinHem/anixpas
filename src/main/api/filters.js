'use strict';

/**
 * Справочники для панели фильтров.
 *
 * У Anixart нет эндпоинтов со списком жанров и первоисточников:
 * их приходится собирать обходом каталога. Результат кэшируется на сутки.
 *
 * Озвучки отдаются штатно: GET /type/all.
 */

const anixart = require('./anixart.js');
const cache = require('../cache.js');

/** Сколько страниц обойти при сборе справочников. */
const SCAN_PAGES = 6;

/** Значения по умолчанию, если обход не удался. */
const FALLBACK_SOURCES = ['манга', 'оригинал', 'ранобэ', 'игра', 'новелла', 'комикс', 'книга'];

/**
 * Собирает жанры и первоисточники обходом каталога.
 * @returns {Promise<{ genres: string[], sources: string[] }>}
 */
async function scanCatalog() {
  const genres = new Set();
  const sources = new Set();

  for (let page = 0; page < SCAN_PAGES; page++) {
    let items = [];
    try {
      const res = await anixart.catalog(page, {});
      items = res.items || [];
    } catch {
      break;
    }
    if (!items.length) break;

    for (const item of items) {
      if (typeof item.genres === 'string') {
        for (const g of item.genres.split(',')) {
          const name = g.trim();
          if (name) genres.add(name);
        }
      }
      if (typeof item.source === 'string' && item.source.trim()) {
        sources.add(item.source.trim());
      }
    }
  }

  return {
    genres: [...genres].sort((a, b) => a.localeCompare(b, 'ru')),
    sources: [...sources].sort((a, b) => a.localeCompare(b, 'ru')),
  };
}

/**
 * Все опции фильтра.
 * @returns {Promise<{ genres: string[], sources: string[], types: any[] }>}
 */
async function getFilterOptions() {
  return cache.wrap('filter-options', 'genres', async () => {
    const scanned = await scanCatalog();

    /** @type {any[]} */
    let types = [];
    try {
      const json = await anixart.call('/type/all');
      const list = Array.isArray(json.types) ? json.types : [];
      const popular = Array.isArray(json.popular_type_ids) ? json.popular_type_ids : [];

      // Сначала популярные — как в оригинале.
      types = list
        .map((t) => ({
          id: Number(t.id) || 0,
          name: typeof t.name === 'string' ? t.name : '',
          isSub: Boolean(t.is_sub),
          episodes: Number(t.episodes_count) || 0,
          popular: popular.includes(Number(t.id)),
        }))
        .filter((t) => t.id && t.name)
        .sort((a, b) => Number(b.popular) - Number(a.popular) || a.name.localeCompare(b.name, 'ru'));
    } catch {
      types = [];
    }

    return {
      genres: scanned.genres,
      sources: scanned.sources.length ? scanned.sources : FALLBACK_SOURCES,
      types,
    };
  });
}

module.exports = { getFilterOptions, scanCatalog };
