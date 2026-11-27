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
/** Сколько ждём ответ, мс. */
const TIMEOUT = 15000;

/** @type {{file: string, version: string}|null} */
let downloaded = null;
let downloading = null;

/**
 * Сравнение версий `1.2.3` / `1.2.3-beta.1`.
 * Возвращает 1, если a новее b; -1, если старше; 0 — равны.
 * @param {string} a @param {string} b
 */
function compareVersions(a, b) {
  /** @param {string} value */
  const parse = (value) => {
    const [core, pre = ''] = String(value).split('-');
    const nums = core.split('.').map((n) => Number(n) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] > right.nums[i] ? 1 : -1;
  }

  // Релиз новее своей же беты: 1.0.0 > 1.0.0-beta.
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre > right.pre ? 1 : -1;
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
async function get(url) {
  if (!isTrustedUrl(url)) throw new Error('untrusted_url');

  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT),
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
  if (!payload || !isTrustedUrl(String(payload.url))) throw new Error('untrusted_url');
  if (downloading) return downloading;

  downloading = (async () => {
    const response = await get(String(payload.url));
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
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

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
      await handle.close();
    }

    const actual = hash.digest('hex');
    if (payload.sha512 && actual !== String(payload.sha512)) {
      await fsp.rm(file, { force: true });
      throw new Error('checksum');
    }

    downloaded = { file, version: String(payload.version) };
    return { file, size: received };
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
  if (!target || !fs.existsSync(target)) throw new Error('no_installer');

  // Только исполняемый файл из нашей временной папки обновлений.
  const dir = path.join(app.getPath('temp'), 'anixpas-update');
  if (path.dirname(path.resolve(target)) !== path.resolve(dir)) throw new Error('bad_path');
  if (!target.toLowerCase().endsWith('.exe')) throw new Error('bad_path');

  spawn(target, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();

  // Даём установщику подняться, затем выходим: он не сможет заменить запущенный файл.
  setTimeout(() => app.quit(), 4000);
  return { started: true };
}

module.exports = { check, download, install, takeDownloaded, compareVersions };
