import { politePause } from './rate.js';

/**
 * Постраничная загрузка с обходом пересекающихся страниц.
 *
 * API Anixart отдаёт страницы с перекрытием: сортировка нестабильна, каталог
 * обновляется между запросами. Бывает, что страница целиком состоит из уже
 * загруженных записей — это НЕ конец списка. Конец — только пустой ответ.
 *
 * Подробности: docs/api-scout.md §16.
 */

/** Сколько подряд «полных дублей» терпим, прежде чем считать список концом. */
const MAX_SKIPPED = 5;

/**
 * Забирает следующую непустую порцию новых записей.
 *
 * @param {{
 *   page: number,
 *   knownIds: Set<number>,
 *   fetchPage: (page: number) => Promise<any[]>,
 *   maxSkipped?: number,
 * }} options
 * @returns {Promise<{ fresh: any[], page: number, exhausted: boolean }>}
 */
export async function collectFresh({ page, knownIds, fetchPage, maxSkipped = MAX_SKIPPED }) {
  let current = page;
  let skipped = 0;

  while (skipped < maxSkipped) {
    // Не долбим API: между страницами выдерживаем паузу.
    await politePause();
    const batch = await fetchPage(current);

    // Пустой ответ — единственный достоверный признак конца.
    if (!Array.isArray(batch) || batch.length === 0) {
      return { fresh: [], page: current, exhausted: true };
    }

    current += 1;

    /** @type {Set<number>} */
    const seen = new Set();
    const fresh = batch.filter((item) => {
      if (!item || knownIds.has(item.id) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    if (fresh.length > 0) return { fresh, page: current, exhausted: false };

    // Страница была, но вся из дублей — шагаем дальше, не объявляя конец.
    skipped += 1;
  }

  return { fresh: [], page: current, exhausted: true };
}
