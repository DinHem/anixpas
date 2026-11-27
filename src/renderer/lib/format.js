/**
 * Форматирование значений для интерфейса.
 * Русская локаль: запятая в дробях, пробелы в тысячах.
 */

/**
 * Рейтинг: 3.8 → «3,8».
 * @param {number} value
 * @returns {string}
 */
export function formatGrade(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Крупные числа как в оригинале: 8660 → «8 660», 18000 → «18 тыс.».
 * @param {number} value
 * @returns {string}
 */
export function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (n >= 10_000) return `${Math.round(n / 1000)} тыс.`;
  return n.toLocaleString('ru-RU');
}

/**
 * Компактно для счётчика просмотров: 8000 → «8K», 293 → «293».
 * @param {number} value
 * @returns {string}
 */
export function formatCompact(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/**
 * Размер файла: 4033793073 -> «3,76 ГБ».
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ГБ`;
  const mb = n / 1024 ** 2;
  return `${Math.round(mb)} МБ`;
}

/**
 * Склонение: 1 серия, 2 серии, 5 серий.
 * @param {number} n
 * @param {[string, string, string]} forms
 */
export function plural(n, forms) {
  const abs = Math.abs(Number(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/**
 * Эпизоды: «8 из 12 эп.» или «8 эп.»
 * @param {number} released
 * @param {number} total
 */
export function formatEpisodes(released, total) {
  if (!released && !total) return '';
  if (total && total !== released) return `${released} из ${total} эп.`;
  return `${released || total} эп.`;
}

/**
 * Длительность: 23 → «23 мин», 95 → «1 ч 35 мин».
 * @param {number} minutes
 */
export function formatDuration(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 60) return `${n} мин`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/**
 * Относительное время: «2 ч назад», «вчера», «13.03.2020».
 * @param {number} unixSeconds
 */
export function timeAgo(unixSeconds) {
  const ts = Number(unixSeconds);
  if (!Number.isFinite(ts) || ts <= 0) return '';

  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 172800) return 'вчера';
  if (diff < 604800) return `${Math.floor(diff / 86400)} дн назад`;

  return new Date(ts * 1000).toLocaleDateString('ru-RU');
}

/** Названия сезонов: 1 — зима, 4 — осень. */
export const SEASON_NAMES = { 1: 'зима', 2: 'весна', 3: 'лето', 4: 'осень' };

const MONTHS_SHORT = [
  'янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июня',
  'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.',
];

/**
 * Дата премьеры для анонсов и онгоингов, как в оригинале:
 * «8 янв. 2027 г.», «лето 2027 г.», «2027 г.».
 *
 * Точная дата приходит не всегда (`release_date` часто пустая),
 * поэтому фолбэк — сезон и год.
 *
 * @param {{ releaseDate?: string, season?: number, year?: string|number }} item
 * @returns {string}
 */
export function formatPremiere(item) {
  if (!item) return '';

  const iso = String(item.releaseDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const month = MONTHS_SHORT[Number(iso[2]) - 1];
    const day = Number(iso[3]);
    if (month && day) return `${day} ${month} ${iso[1]} г.`;
  }

  const year = Number(item.year) || 0;
  const season = SEASON_NAMES[Number(item.season)];

  if (season && year) return `${season} ${year} г.`;
  if (year) return `${year} г.`;
  return '';
}

/**
 * Описание из списков API: сервер режет его на 180 символах без многоточия.
 * Если текст обрывается на полуслове — добавляем «…».
 * @param {string} text
 * @returns {string}
 */
export function formatSnippet(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (/[.!?…»)]$/.test(value)) return value;
  return `${value.replace(/[,;:\-\s]+$/, '')}…`;
}

/**
 * Серии без точки, как в оригинале: «12 эп», «8 из 12 эп», «8 из ? эп».
 * @param {number} released
 * @param {number} total
 */
export function formatEpisodesShort(released, total) {
  const r = Number(released) || 0;
  const t = Number(total) || 0;
  if (!r && !t) return '';
  if (t && r && t > r) return `${r} из ${t} эп`;
  if (!t && r) return `${r} из ? эп`;
  return `${t || r} эп`;
}

/**
 * Возрастной рейтинг Anixart: в API это код, а не число лет.
 * Проверено по официальному приложению: 2 = 6+, 3 = 12+, 4 = 16+, 5 = 18+.
 * @param {number} code
 * @returns {string}
 */
export function formatAgeRating(code) {
  const map = { 2: '6+', 3: '12+', 4: '16+', 5: '18+' };
  return map[Number(code)] || '';
}

/**
 * Секунды → «4:12» или «1:04:12» для подписи продолжаемого просмотра.
 * @param {number} seconds
 * @returns {string}
 */
export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!total) return '';

  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');

  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
