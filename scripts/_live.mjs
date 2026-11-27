import fs from 'node:fs';

const p = 'src/renderer/views/Search.svelte';
let raw = fs.readFileSync(p, 'utf8');
const crlf = raw.includes('\r\n');
let s = crlf ? raw.replace(/\r\n/g, '\n') : raw;

// 1. Параметры живого поиска.
s = s.replace(
  "  /** Сколько последних запросов помним. */\n  const HISTORY_LIMIT = 8;",
  `  /** Сколько последних запросов помним. */
  const HISTORY_LIMIT = 8;
  /** Живой поиск: не раньше третьего символа и с паузой после ввода. */
  const LIVE_MIN_CHARS = 3;
  const LIVE_DELAY = 450;`
);

// 2. Таймер debounce.
s = s.replace(
  "  let query = $state('');",
  `  let query = $state('');
  /** @type {ReturnType<typeof setTimeout>|null} */
  let liveTimer = null;
  /** Номер последнего живого запроса: старые ответы отбрасываем. */
  let liveSeq = 0;`
);

// 3. startSearch: параметр «писать в историю» + живой вызов.
s = s.replace(
  `  async function startSearch(value = query) {
    const text = value.trim();
    if (!text) return;

    query = text;
    pushHistory(text);`,
  `  /** @param {string} [value] @param {{push?: boolean}} [options] */
  async function startSearch(value = query, options = {}) {
    const text = value.trim();
    if (!text) return;

    query = text;
    // Живой поиск историю не засоряет: туда попадает только явный запрос.
    if (options.push !== false) pushHistory(text);`
);

// 4. Живой поиск: debounce и порог.
s = s.replace(
  "  /** Быстрый подбор по одному жанру — без открытия панели. */",
  `  /**
   * Живой поиск: пользователь печатает — через 450 мс после последнего символа
   * уходит запрос. Короче трёх символов не ищем, чтобы не грузить API зря.
   */
  function scheduleLiveSearch() {
    if (liveTimer) clearTimeout(liveTimer);

    const text = query.trim();

    if (text.length < LIVE_MIN_CHARS) {
      // Стерли до одного-двух символов — возвращаемся к витрине.
      if (searched && mode === 'search') {
        searched = false;
        mode = 'filter';
        results = [];
        page = 0;
        exhausted = false;
        error = '';
      }
      return;
    }

    liveTimer = setTimeout(() => {
      liveTimer = null;
      if (text === (lastQuery || '').trim()) return;
      startSearch(text, { push: false });
    }, LIVE_DELAY);
  }

  /** Быстрый подбор по одному жанру — без открытия панели. */`
);

// 5. Отбрасываем устаревшие ответы: пока грузили, запрос мог измениться.
s = s.replace(
  `      if (result.fresh.length > 0) results = [...results, ...result.fresh];`,
  `      // Пока шёл запрос, текст мог измениться — такой ответ уже неактуален.
      if (mode === 'search' && query.trim() !== requestedQuery) return;

      if (result.fresh.length > 0) results = [...results, ...result.fresh];`
);

fs.writeFileSync(p, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('ok');
