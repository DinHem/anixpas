/**
 * Разворачивает код конкретной версии в отдельную папку рядом с проектом.
 *
 * Запуск: node scripts/old-version.mjs v0.2.2
 * Результат: ../anixpas-v0.2.2 — полноценная рабочая копия той версии.
 *
 * Зачем: посмотреть, как вёл себя старый код, и сравнить с текущим, не трогая
 * рабочую папку и не копируя историю репозитория вручную. Внутри git worktree
 * файлы общие с основным репозиторием — папка занимает только рабочую копию.
 *
 * Убрать папку: git worktree remove ../anixpas-v0.2.2
 */
import { execSync } from 'node:child_process';
import path from 'node:path';

const tag = process.argv[2];
if (!tag) {
  console.error('Укажите версию: node scripts/old-version.mjs v0.2.2');
  const tags = execSync('git tag --list --sort=-creatordate', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .slice(0, 5)
    .join(', ');
  console.error('Доступные версии:', tags || 'тегов нет');
  process.exit(1);
}

const exists = execSync('git tag --list', { encoding: 'utf8' }).split('\n').includes(tag);
if (!exists) {
  console.error(`Тега ${tag} нет. Посмотреть список: git tag --list`);
  process.exit(1);
}

const target = path.join('..', `anixpas-${tag}`);

try {
  execSync(`git worktree add "${target}" ${tag}`, { stdio: 'inherit' });
} catch {
  console.error(`Не удалось создать ${target}. Возможно, папка уже существует.`);
  console.error(`Убрать старую: git worktree remove "${target}"`);
  process.exit(1);
}

console.log(`\nГотово: ${path.resolve(target)}`);
console.log('Запуск: npm install && npm start (зависимости ставятся заново)');
console.log(`Убрать: git worktree remove "${target}"`);
