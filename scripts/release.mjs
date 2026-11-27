/**
 * Сборка и публикация релиза.
 *
 * Запуск: node scripts/release.mjs ["заметки к релизу"]
 *
 * Что делает:
 *  1. проверяет, что рабочий каталог чистый и ключ подписи на месте;
 *  2. собирает установщик (`npm run make`);
 *  3. переименовывает артефакт в `AnixPas-Setup-<версия>.exe`, считает sha512;
 *  4. пишет `latest.json`, подписывает его Ed25519 → `latest.json.sig`;
 *  5. создаёт релиз `v<версия>` в репозитории артефактов и заливает три файла;
 *  6. ставит тег в репозитории исходников.
 *
 * Приватный ключ берётся из `.keys/update-key.pem` и остаётся на машине автора.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { releaseNotes, plainNotes } from './release-notes.mjs';

const REPO_SOURCES = 'DinHem/anixpas';
const REPO_RELEASES = 'DinHem/anixpas-releases';
const KEY_PATH = path.join('.keys', 'update-key.pem');
const OUT_ROOT = process.env.ANIXPAS_OUT_DIR || 'out';
const SETUP_DIR = path.join(OUT_ROOT, 'nsis');
const OUT_DIR = 'release-artifacts';

/** @param {string} command */
function run(command) {
  execSync(command, { stdio: 'inherit' });
}

/** @param {string} command @returns {string} */
function capture(command) {
  return execSync(command, { encoding: 'utf8' }).trim();
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.version;

// Заметки — из CHANGELOG.md по текущей версии. Аргумент командной строки их заменяет.
const fromChangelog = releaseNotes(version);
const notes =
  process.argv.slice(2).join(' ').trim() ||
  (fromChangelog ? plainNotes(fromChangelog) : `AnixPas ${version}`);

if (!fromChangelog) {
  console.warn(`Внимание: в CHANGELOG.md нет раздела для версии ${version}`);
}

if (!fs.existsSync(KEY_PATH)) {
  console.error(`Нет ключа подписи: ${KEY_PATH}`);
  console.error('Сгенерировать: node scripts/keygen.mjs');
  process.exit(1);
}

const dirty = capture('git status --porcelain');
if (dirty) {
  console.error('В рабочем каталоге есть незакоммиченные изменения:');
  console.error(dirty);
  console.error('Закоммитьте их — иначе релиз не совпадёт с состоянием репозитория.');
  process.exit(1);
}

// Релиз выпускается только с master: в нём лежит ровно то, что видят люди.
const branch = capture('git rev-parse --abbrev-ref HEAD');
if (branch !== 'master') {
  console.error(`Релиз делается с ветки master, а сейчас активна ${branch}.`);
  console.error('Сначала: git checkout master && git merge dev && git push');
  process.exit(1);
}

const tag = `v${version}`;
if (capture(`git tag --list ${tag}`)) {
  console.error(`Тег ${tag} уже существует — поднимите версию в package.json.`);
  process.exit(1);
}

console.log(`\n=== Сборка ${version} ===\n`);
run('npm run make:nsis');

// electron-builder может переименовать артефакт: 0.2.4a → AnixPas-Setup-0.2.4-a.exe.
// Берём самый свежий установщик из папки и переименовываем сами.
const candidates = fs
  .readdirSync(SETUP_DIR)
  .filter((name) => name.startsWith('AnixPas-Setup-') && name.endsWith('.exe') && !name.includes('__uninstaller'))
  .map((name) => ({ name, at: fs.statSync(path.join(SETUP_DIR, name)).mtimeMs }))
  .sort((a, b) => b.at - a.at);

if (candidates.length === 0) {
  console.error(`Не найден установщик в ${SETUP_DIR}`);
  process.exit(1);
}

const setupSource = path.join(SETUP_DIR, candidates[0].name);

fs.mkdirSync(OUT_DIR, { recursive: true });
const setupName = `AnixPas-Setup-${version}.exe`;
const setupPath = path.join(OUT_DIR, setupName);
fs.copyFileSync(setupSource, setupPath);

const fileBuffer = fs.readFileSync(setupPath);
const sha512 = crypto.createHash('sha512').update(fileBuffer).digest('hex');
const size = fileBuffer.length;

const manifest = {
  version,
  url: `https://github.com/${REPO_RELEASES}/releases/download/${tag}/${setupName}`,
  sha512,
  size,
  publishedAt: new Date().toISOString(),
  notes,
};

const manifestText = JSON.stringify(manifest, null, 2);
const manifestPath = path.join(OUT_DIR, 'latest.json');
fs.writeFileSync(manifestPath, manifestText);

// Подписываем ровно те байты, что лежат в latest.json — иначе подпись не сойдётся.
const privateKey = crypto.createPrivateKey(fs.readFileSync(KEY_PATH));
const signature = crypto.sign(null, fs.readFileSync(manifestPath), privateKey);
const signaturePath = path.join(OUT_DIR, 'latest.json.sig');
fs.writeFileSync(signaturePath, signature.toString('base64'));

console.log(`\nУстановщик: ${setupName}, ${(size / 1024 / 1024).toFixed(1)} МБ`);
console.log(`sha512: ${sha512.slice(0, 24)}…`);

// Заметки пишем файлом: многострочный текст через аргументы командной строки ломается.
const notesPath = path.join(OUT_DIR, 'notes.md');
fs.writeFileSync(notesPath, notes);

console.log(`\n=== Публикация ${tag} ===\n`);
run(
  [
    'gh release create',
    tag,
    `"${setupPath}"`,
    `"${manifestPath}"`,
    `"${signaturePath}"`,
    `--repo ${REPO_RELEASES}`,
    `--title "AnixPas ${version}"`,
    `--notes-file "${notesPath}"`,
  ].join(' ')
);

run(`git tag -a ${tag} -m "AnixPas ${version}"`);
run('git push origin ' + tag);

console.log(`\nГотово: https://github.com/${REPO_RELEASES}/releases/tag/${tag}`);
console.log(`Манифест: https://github.com/${REPO_RELEASES}/releases/latest/download/latest.json`);
