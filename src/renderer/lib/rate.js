/**
 * Вежливость к API.
 *
 * Anixart не публикует лимиты, но долбить его пачкой запросов подряд —
 * плохая идея: можно получить временную блокировку и испортить статистику.
 * Держим минимальный интервал между сетевыми запросами списков.
 */

/** Минимальный интервал между запросами, мс. */
export const MIN_INTERVAL = 260;

let lastAt = 0;

/**
 * Ждёт, пока с прошлого запроса пройдёт MIN_INTERVAL.
 * @param {number} interval
 */
export async function politePause(interval = MIN_INTERVAL) {
  const wait = Math.max(0, interval - (Date.now() - lastAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastAt = Date.now();
}
