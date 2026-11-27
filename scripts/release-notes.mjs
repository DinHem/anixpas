import fs from 'node:fs';

/**
 * Достаёт из CHANGELOG.md секцию нужной версии вместе с заголовком.
 * @param {string} version
 * @returns {string}
 */
export function releaseNotes(version) {
  const file = 'CHANGELOG.md';
  if (!fs.existsSync(file)) return '';

  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf(`## [${version}]`);
  if (start === -1) return '';

  const rest = text.slice(start);
  // Следующий раздел версии — конец текущего.
  const next = rest.slice(1).indexOf('\n## [');
  const block = next === -1 ? rest : rest.slice(0, next + 1);

  return block.trim();
}

/**
 * Убирает markdown-разметку заголовков, оставляя читаемый текст:
 * «### Добавлено» → «Добавлено».
 * @param {string} markdown
 */
export function plainNotes(markdown) {
  return markdown
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s*/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
