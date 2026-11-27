/**
 * Генерация пары ключей Ed25519 для подписи манифеста обновлений.
 *
 * Запуск: node scripts/keygen.mjs
 *
 * Приватный ключ уходит в `.keys/update-key.pem` (в .gitignore, никуда не коммитится,
 * ни в один репозиторий не попадает). Публичный — вшивается в исходник
 * `src/main/updater/public-key.js`.
 *
 * Файлы не перезаписываются: если ключ уже есть, скрипт откажется работать,
 * чтобы случайно не сломать уже выпущенные обновления.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KEY_DIR = '.keys';
const PRIVATE_PATH = path.join(KEY_DIR, 'update-key.pem');
const PUBLIC_PATH = 'src/main/updater/public-key.js';

if (fs.existsSync(PRIVATE_PATH)) {
  console.error(`Ключ уже существует: ${PRIVATE_PATH}`);
  console.error('Если нужен новый — сначала удалите старый вручную (старые обновления перестанут проверяться).');
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

fs.mkdirSync(KEY_DIR, { recursive: true });
fs.writeFileSync(PRIVATE_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
  mode: 0o600,
});

const spki = publicKey.export({ type: 'spki', format: 'der' });
const base64 = Buffer.from(spki).toString('base64');

const source = `/**
 * Публичный ключ Ed25519 для проверки подписи манифеста обновлений.
 *
 * Сгенерирован \`node scripts/keygen.mjs\`, приватная часть — только у автора.
 * Менять нельзя: приложение с другим ключом не примет уже выпущенные обновления.
 */
const PUBLIC_KEY_DER_BASE64 = '${base64}';

module.exports = { PUBLIC_KEY_DER_BASE64 };
`;

fs.mkdirSync(path.dirname(PUBLIC_PATH), { recursive: true });
fs.writeFileSync(PUBLIC_PATH, source);

console.log('Приватный ключ:', PRIVATE_PATH, '(держите локально, в git не коммитить)');
console.log('Публичный ключ записан в', PUBLIC_PATH);
console.log('Отпечаток SPKI:', crypto.createHash('sha256').update(spki).digest('hex').slice(0, 32));
