/**
 * Списки пользователя: единый источник названий и цветов.
 *
 * Цвета заданы в CSS-классах status-1…status-5 (см. app.css),
 * чтобы не дублировать значения по компонентам.
 */

export const LISTS = [
  { status: 1, id: 'watching', label: 'Смотрю', className: 'status-1' },
  { status: 2, id: 'planned', label: 'В планах', className: 'status-2' },
  { status: 3, id: 'completed', label: 'Просмотрено', className: 'status-3' },
  { status: 4, id: 'holdOn', label: 'Отложено', className: 'status-4' },
  { status: 5, id: 'dropped', label: 'Брошено', className: 'status-5' },
];

/**
 * Название списка по статусу.
 * @param {number|null} status
 */
export function listLabel(status) {
  const found = LISTS.find((l) => l.status === status);
  return found ? found.label : '';
}

/**
 * CSS-класс цвета по статусу.
 * @param {number|null} status
 */
export function listClass(status) {
  const found = LISTS.find((l) => l.status === status);
  return found ? found.className : '';
}
