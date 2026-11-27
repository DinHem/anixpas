/**
 * Состояние обновлений — одно на всё приложение.
 *
 * Плашка, модалка «Что нового» и экран «Статус» читают один и тот же объект,
 * поэтому проверка, запущенная откуда угодно, видна везде.
 */
import { bridge } from './bridge.js';

const state = $state({
  /** Текущая версия приложения. */
  current: '',
  /** Идёт проверка манифеста. */
  checking: false,
  /** Найденное обновление: версия, адрес установщика, sha512, заметки. */
  /** @type {null | {version: string, url: string, sha512: string, size: number, notes: string}} */
  available: null,
  /** Пользователь закрыл плашку — она не мозолит глаза, но обновление остаётся. */
  hidden: false,
  /** Идёт скачивание установщика. */
  downloading: false,
  /** Процент скачанного. */
  percent: 0,
  /** Установщик скачан и ждёт перезапуска. */
  ready: false,
  /** Путь к скачанному установщику. */
  file: '',
  /** Код ошибки. */
  error: '',
  /** Когда проверяли в последний раз (ms). */
  lastChecked: 0,
  /** Проверка уже была — есть что показать вместо пустоты. */
  checked: false,
  /** Короткое сообщение для плашки: «Установлена последняя версия». */
  message: '',
  /** Открыта модалка «Что нового». */
  showNotes: false,
  /** История всех релизов с GitHub. */
  /** @type {Array<{version: string, name: string, notes: string, publishedAt: string}>} */
  history: [],
  historyLoading: false,
  historyError: '',
});

/** @returns {typeof state} */
export function updateState() {
  return state;
}

/**
 * Проверка обновлений. Сеть недоступна — это не ошибка, просто «не проверить».
 * @param {boolean} [manual] — нажали кнопку: показываем результат, даже если он скучный
 */
export async function checkForUpdates(manual = false) {
  if (state.checking || state.downloading) return;

  state.checking = true;
  state.message = '';
  if (manual) state.error = '';

  try {
    const result = await bridge.updater.check();
    state.current = result.current || state.current;
    state.lastChecked = Date.now();
    state.checked = Boolean(result.checked);

    if (result.available) {
      state.available = {
        version: result.version,
        url: result.url,
        sha512: result.sha512,
        size: result.size || 0,
        notes: result.notes || '',
      };
      state.hidden = false;
      state.error = '';
      state.message = '';
    } else {
      state.available = null;
      state.error = result.error === 'signature' ? 'signature' : '';
      // По кнопке человек хочет знать, что всё в порядке, а не смотреть в пустоту.
      if (manual && result.checked && !result.error) {
        const text = `Установлена последняя версия — ${result.current}`;
        state.message = text;
        // Сообщение не должно висеть вечно.
        setTimeout(() => {
          if (state.message === text) state.message = '';
        }, 5000);
      }
    }
  } catch {
    if (manual) state.error = 'offline';
  } finally {
    state.checking = false;
  }
}

/** Скачивание установщика. */
export async function downloadUpdate() {
  if (!state.available || state.downloading || state.ready) return;

  state.downloading = true;
  state.percent = 0;
  state.error = '';

  const stop = bridge.updater.onProgress((value) => {
    state.percent = Number(value && value.percent) || 0;
  });

  try {
    const result = await bridge.updater.download({
      url: state.available.url,
      version: state.available.version,
      sha512: state.available.sha512,
    });

    // main возвращает код причины: timeout, network, checksum, untrusted_url.
    if (!result || result.ok !== true) {
      state.downloading = false;
      state.percent = 0;
      state.error = (result && result.error) || 'download';
      return;
    }

    state.percent = 100;
    state.downloading = false;
    state.ready = true;
    state.file = result && result.file ? String(result.file) : '';
    return result;
  } catch (err) {
    console.error('[updates] download failed:', err && (err.code || err.message));
    state.downloading = false;
    state.percent = 0;
    state.error = 'download';
  } finally {
    if (typeof stop === 'function') stop();
  }
}

/**
 * Запуск установщика. Приложение закроется само — установщик не может
 * заменить запущенный файл.
 */
export async function installUpdate() {
  if (!state.ready) return;
  try {
    const result = await bridge.updater.install(state.file);
    if (!result || result.ok !== true) {
      state.error = (result && result.error) || 'install';
      return result;
    }
    return result;
  } catch {
    state.error = 'install';
  }
}

/** Скрыть плашку (обновление никуда не девается — оно есть в «Статусе»). */
export function dismissUpdate() {
  state.hidden = true;
  state.message = '';
}

/** Показать плашку снова. */
export function showUpdate() {
  if (!state.available) return;
  state.hidden = false;
}

/** @param {boolean} value */
export function setShowNotes(value) {
  state.showNotes = Boolean(value);
  if (value) loadHistory();
}

/** История всех версий: грузим один раз за сессию. */
export async function loadHistory() {
  if (state.historyLoading || state.history.length) return;

  state.historyLoading = true;
  state.historyError = '';

  try {
    const result = await bridge.updater.changelog();
    if (result && Array.isArray(result.items)) state.history = result.items;
    if (!result || result.ok !== true) state.historyError = (result && result.error) || 'offline';
  } catch {
    state.historyError = 'offline';
  } finally {
    state.historyLoading = false;
  }
}
