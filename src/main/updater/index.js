'use strict';

/**
 * Автообновление через GitHub Releases.
 *
 * Канал обновлений недоверенный (docs/03-security.md §10.1), поэтому порядок жёсткий:
 *  1. манифест `latest.json` и отдельная подпись `latest.json.sig`;
 *  2. подпись Ed25519 проверяется вшитым публичным ключом — не сошлась, стоп;
 *  3. версия сравнивается с текущей;
 *  4. установщик скачивается и сверяется по sha512;
 *  5. запускается установщик, приложение выходит.
 *
 * Проверка никогда не блокирует запуск: нет сети — просто «не удалось проверить».
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app } = require('electron');
const { PUBLIC_KEY_DER_BASE64 } = require('./public-key.js');

/**
 * Источники манифеста. Список вшит в код, а не в конфиг: конфиг можно подменить
 * вместе с файлами приложения.
 */
const UPDATE_SOURCES = [
  'https://github.com/DinHem/anixpas-releases/releases/latest/download',
];

const MANIFEST = 'latest.json';
/** Отладка интерфейса обновлений без публикации релиза: --fake-update. */
const FAKE = process.argv.includes('--fake-update') && !app.isPackaged;
if (!app.isPackaged) console.log('[updater] flags:', process.argv.filter((a) => a.startsWith('--')).join(' '), '| fake:', FAKE);
const SIGNATURE = 'latest.json.sig';
/** Манифест маленький: ждём ответ не дольше 15 секунд. */
const MANIFEST_TIMEOUT = 15000;
/**
 * Установщик — 120 МБ. Общий таймаут тут ставить нельзя: у кого медленный канал
 * или VPN, скачивание рвётся на середине. Ждём «нет данных дольше минуты».
 */
const DOWNLOAD_IDLE_TIMEOUT = 60000;

/** @type {{file: string, version: string}|null} */
let downloaded = null;
let downloading = null;

/**
 * Сравнение версий `1.2.3` / `1.2.3-beta.1`.
 * Возвращает 1, если a новее b; -1, если старше; 0 — равны.
 * @param {string} a @param {string} b
 */
function compareVersions(a, b) {
  /**
   * Поддерживаем три вида: 1.2.3, 1.2.3-beta (до релиза) и 1.2.4a (после релиза).
   * Буквенный суффикс без дефиса считается шагом вперёд: 0.2.4a > 0.2.4.
   * @param {string} value
   */
  const parse = (value) => {
    const [core, pre = ''] = String(value).trim().split('-');
    const match = /^(\d+)\.(\d+)\.(\d+)([a-z]*)$/i.exec(core);

    if (!match) {
      const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
      while (nums.length < 3) nums.push(0);
      return { nums, pre, step: '' };
    }

    return {
      nums: [Number(match[1]), Number(match[2]), Number(match[3])],
      pre,
      step: String(match[4] || '').toLowerCase(),
    };
  };

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] > right.nums[i] ? 1 : -1;
  }

  // 1.0.0-beta < 1.0.0 — предрелиз идёт до финальной версии.
  if (left.pre !== right.pre) {
    if (!left.pre) return 1;
    if (!right.pre) return -1;
    return left.pre > right.pre ? 1 : -1;
  }

  // 0.2.4 < 0.2.4a < 0.2.4b — буквенный шаг идёт после релиза.
  if (left.step === right.step) return 0;
  if (!left.step) return -1;
  if (!right.step) return 1;
  return left.step > right.step ? 1 : -1;
}

/**
 * Проверка, что URL ведёт куда ожидаем: только https и только наш репозиторий.
 * @param {string} url
 */
function isTrustedUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return (
      parsed.hostname === 'github.com' ||
      parsed.hostname === 'objects.githubusercontent.com' ||
      parsed.hostname === 'release-assets.githubusercontent.com'
    );
  } catch {
    return false;
  }
}

/**
 * GET с таймаутом и проверкой протокола после редиректов.
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function get(url, timeoutMs = MANIFEST_TIMEOUT) {
  if (!isTrustedUrl(url)) throw new Error('untrusted_url');

  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': `AnixPas/${app.getVersion()}` },
  });

  if (!response.ok) throw new Error(`http_${response.status}`);
  // Редирект мог увести на http — проверяем, куда пришли.
  if (response.url && !String(response.url).startsWith('https://')) throw new Error('insecure_redirect');

  return response;
}

/**
 * Проверяет подпись манифеста вшитым ключом.
 * @param {Buffer} manifestBytes @param {string} signatureBase64
 */
function verifySignature(manifestBytes, signatureBase64) {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(PUBLIC_KEY_DER_BASE64, 'base64'),
    format: 'der',
    type: 'spki',
  });

  return crypto.verify(null, manifestBytes, publicKey, Buffer.from(signatureBase64, 'base64'));
}

/**
 * Проверка обновлений.
 * @returns {Promise<{checked: boolean, available: boolean, current: string, version?: string,
 *   notes?: string, size?: number, publishedAt?: string, error?: string}>}
 */
async function check() {
  const current = app.getVersion();

  // Отладка интерфейса без публикации релиза: npx electron . --fake-update
  if (FAKE) {
    let notes = '';
    try {
      const changelog = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'CHANGELOG.md'), 'utf8');
      const at = changelog.indexOf('## [');
      const block = at === -1 ? '' : changelog.slice(at);
      const end = block.slice(1).indexOf('\n## [');
      notes = (end === -1 ? block : block.slice(0, end + 1))
        .split('\n')
        .map((line) => line.replace(/^#{1,6}\s*/, ''))
        .join('\n')
        .trim();
    } catch {
      notes = '';
    }

    return {
      checked: true,
      available: true,
      current,
      version: '9.9.9',
      notes,
      size: 155642880,
      publishedAt: new Date().toISOString(),
      sha512: 'a'.repeat(128),
      url: 'https://github.com/DinHem/anixpas-releases/releases/download/v9.9.9/AnixPas-Setup-9.9.9.exe',
    };
  }

  for (const source of UPDATE_SOURCES) {
    try {
      const manifestUrl = `${source}/${MANIFEST}`;
      const signatureUrl = `${source}/${SIGNATURE}`;

      const [manifestResponse, signatureResponse] = await Promise.all([
        get(manifestUrl),
        get(signatureUrl),
      ]);

      const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
      const signatureText = (await signatureResponse.text()).trim();

      if (!verifySignature(manifestBytes, signatureText)) {
        // Подпись не сошлась — это не «нет обновлений», а подмена. Тихо выходим.
        console.error('[updater] подпись манифеста неверна');
        return { checked: true, available: false, current, error: 'signature' };
      }

      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      const version = String(manifest.version || '');

      if (!version || !isTrustedUrl(String(manifest.url))) {
        return { checked: true, available: false, current, error: 'manifest' };
      }

      if (compareVersions(version, current) <= 0) {
        return { checked: true, available: false, current };
      }

      return {
        checked: true,
        available: true,
        current,
        version,
        notes: String(manifest.notes || ''),
        size: Number(manifest.size) || 0,
        publishedAt: String(manifest.publishedAt || ''),
        sha512: String(manifest.sha512 || ''),
        url: String(manifest.url),
      };
    } catch (err) {
      console.error('[updater] источник недоступен:', err && err.message ? err.message : err);
    }
  }

  return { checked: false, available: false, current, error: 'offline' };
}

/** @returns {string} путь к свежему установщику или '' */
function takeDownloaded() {
  const file = downloaded ? downloaded.file : '';
  downloaded = null;
  return file;
}

/**
 * Скачивание установщика с проверкой sha512 и отчётом о прогрессе.
 * @param {{url: string, sha512: string, version: string}} payload
 * @param {(progress: {received: number, total: number, percent: number}) => void} onProgress
 */
async function download(payload, onProgress) {
  if (!payload || !isTrustedUrl(String(payload.url))) return { ok: false, error: 'untrusted_url' };
  if (downloading) return downloading;

  downloading = (async () => {
    const controller = new AbortController();
    let idleTimer = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT);
    const keepAlive = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT);
    };

    let response;
    try {
      response = await fetch(String(payload.url), {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': `AnixPas/${app.getVersion()}` },
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      if (response.url && !String(response.url).startsWith('https://')) {
        throw new Error('insecure_redirect');
      }
    } catch (err) {
      clearTimeout(idleTimer);
      const code = err && err.name === 'AbortError' ? 'timeout' : 'network';
      console.error('[updater] скачивание:', code, err && err.message);
      return { ok: false, error: code };
    }

    const total = Number(response.headers.get('content-length')) || Number(payload.size) || 0;

    const dir = path.join(app.getPath('temp'), 'anixpas-update');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `AnixPas-Setup-${payload.version}.exe`);

    const handle = await fsp.open(file, 'w');
    const hash = crypto.createHash('sha512');
    let received = 0;

    try {
      const reader = response.body.getReader();
      for (;;) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (err) {
          // Долго нет данных или сеть пропала — сообщаем внятно.
          const code = err && err.name === 'AbortError' ? 'timeout' : 'network';
          console.error('[updater] поток:', code, err && err.message);
          // Файл и таймер закроет finally ниже.
          return { ok: false, error: code };
        }

        const { done, value } = chunk;
        if (done) break;
        if (!value) continue;

        keepAlive();
        received += value.length;
        hash.update(value);
        await handle.write(value);

        if (onProgress) {
          onProgress({
            received,
            total,
            percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
          });
        }
      }
    } finally {
      clearTimeout(idleTimer);
      await handle.close();
    }

    const actual = hash.digest('hex');
    if (payload.sha512 && actual !== String(payload.sha512)) {
      await fsp.rm(file, { force: true });
      console.error('[updater] контрольная сумма не совпала');
      return { ok: false, error: 'checksum' };
    }

    downloaded = { file, version: String(payload.version) };
    return { ok: true, file, size: received };
  })();

  try {
    return await downloading;
  } finally {
    downloading = null;
  }
}

/**
 * Запуск установщика. Приложение закрывается, установка идёт своим ходом.
 * @param {string} file
 */
function install(file) {
  const target = String(file || '');
  if (!target || !fs.existsSync(target)) return { ok: false, error: 'no_installer' };

  // Только исполняемый файл из нашей временной папки обновлений.
  const dir = path.join(app.getPath('temp'), 'anixpas-update');
  if (path.dirname(path.resolve(target)) !== path.resolve(dir)) return { ok: false, error: 'bad_path' };
  if (!target.toLowerCase().endsWith('.exe')) return { ok: false, error: 'bad_path' };

  spawn(target, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();

  // Даём установщику подняться, затем выходим: он не сможет заменить запущенный файл.
  setTimeout(() => app.quit(), 4000);
  return { ok: true, started: true };
}

/** История релизов: кэш на час, чтобы не тратить лимит GitHub (60 запросов/час). */
let historyCache = { at: 0, items: [] };
const HISTORY_TTL = 60 * 60 * 1000;
const HISTORY_URL = 'https://api.github.com/repos/DinHem/anixpas-releases/releases?per_page=20';

/**
 * Список прошлых версий с заметками — прямо из релизов на GitHub.
 * @returns {Promise<{ok: boolean, error?: string, items?: Array<{version: string, name: string, notes: string, publishedAt: string}>}>}
 */
async function changelog() {
  const now = Date.now();
  if (historyCache.items.length && now - historyCache.at < HISTORY_TTL) {
    return { ok: true, items: historyCache.items };
  }

  try {
    const response = await fetch(HISTORY_URL, {
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT),
      headers: {
        'User-Agent': `AnixPas/${app.getVersion()}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!response.ok) {
      console.error('[updater] история: http', response.status);
      return { ok: false, error: `http_${response.status}`, items: historyCache.items };
    }

    const list = await response.json();
    const items = (Array.isArray(list) ? list : [])
      .filter((release) => release && !release.draft)
      .map((release) => ({
        version: String(release.tag_name || '').replace(/^v/, ''),
        name: String(release.name || release.tag_name || ''),
        notes: String(release.body || ''),
        publishedAt: String(release.published_at || ''),
      }))
      .filter((release) => release.version);

    historyCache = { at: now, items };
    return { ok: true, items };
  } catch (err) {
    console.error('[updater] история недоступна:', err && err.message);
    return { ok: false, error: 'offline', items: historyCache.items };
  }
}

module.exports = { check, download, install, takeDownloaded, compareVersions, changelog };
