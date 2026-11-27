/**
 * Разбор заметок к релизу.
 *
 * В манифесте заметки лежат обычным текстом из CHANGELOG.md: строки «### Добавлено»
 * стали «Добавлено», пункты остались с дефисом, длинные пункты перенесены
 * с отступом в два пробела. Здесь это превращается в блоки для разметки.
 */

/**
 * @typedef {{type: 'heading'|'text', text: string}
 *   | {type: 'items', items: string[]}} Block
 */

/**
 * @param {string} raw
 * @returns {Block[]}
 */
/** Убирает инлайн-разметку: обратные кавычки и звёздочки. */
function cleanInline(value) {
  return String(value).replace(/[\u0060*]+/g, '').trim();
}

export function parseNotes(raw) {
  const lines = String(raw || '').split('\n');
  /** @type {Block[]} */
  const blocks = [];
  /** @type {string[]} */
  let items = [];
  /** @type {string|null} */
  let lastItem = null;

  const flushItems = () => {
    if (items.length) {
      blocks.push({ type: 'items', items });
      items = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushItems();
      lastItem = null;
      continue;
    }

    // Перенос длинного пункта: строка с отступом — продолжение предыдущего.
    if (lastItem !== null && /^\s{2,}\S/.test(line)) {
      const merged = cleanInline(`${lastItem} ${trimmed}`);
      items[items.length - 1] = merged;
      lastItem = merged;
      continue;
    }

    if (trimmed.startsWith('- ')) {
      items.push(cleanInline(trimmed.slice(2).trim()));
      lastItem = items[items.length - 1];
      continue;
    }

    flushItems();
    lastItem = null;

    // Короткая строка без пунктуации в конце — заголовок раздела.
    const isHeading = trimmed.length <= 60 && !/[.!?…]$/.test(trimmed);
    blocks.push({ type: isHeading ? 'heading' : 'text', text: cleanInline(trimmed) });
  }

  flushItems();

  // Первая строка — служебный заголовок версии вида «[0.2.0] — 2026-11-26»:
  // версия уже показана отдельно, в теле она лишняя.
  if (blocks.length && blocks[0].type !== 'items' && blocks[0].text.startsWith('[')) blocks.shift();

  return blocks;
}

/**
 * Первые несколько пунктов для короткой плашки.
 * @param {Block[]} blocks
 * @param {number} limit
 */
export function previewItems(blocks, limit = 3) {
  /** @type {string[]} */
  const result = [];
  for (const block of blocks) {
    if (block.type !== 'items') continue;
    for (const item of block.items) {
      result.push(item);
      if (result.length >= limit) return result;
    }
  }
  return result;
}
