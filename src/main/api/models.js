'use strict';

/**
 * Нормализация ответов Anixart в тонкие модели.
 *
 * Зачем: карточка релиза приходит на ~80 КБ и содержит десятки служебных полей
 * (счётчики голосов, комментарии, права, флаги). В UI и в кэш кладём только нужное.
 *
 * Правило: любое поле из API может отсутствовать или быть null — модель это переживает.
 */

/**
 * Безопасно приводит к числу.
 * @param {unknown} value
 * @param {number} fallback
 */
function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Безопасно приводит к строке.
 * @param {unknown} value
 * @param {string} fallback
 */
function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Жанры приходят строкой через запятую.
 * @param {unknown} value
 * @returns {string[]}
 */
function splitGenres(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
}

/**
 * Ссылка на постер: API отдаёт готовый URL в `image`.
 * @param {any} raw
 */
function posterOf(raw) {
  const url = str(raw.image) || str(raw.poster);
  return url.startsWith('http') ? url : '';
}

/**
 * Карточка для списков (каталог, поиск).
 * @param {any} raw — элемент content[] или releases[]
 */
function toReleaseListItem(raw) {
  if (!raw || typeof raw !== 'object') return null;

  return {
    id: num(raw.id),
    title: str(raw.title_ru) || str(raw.title_original),
    titleOriginal: str(raw.title_original),
    year: str(raw.year),
    poster: posterOf(raw),
    genres: splitGenres(raw.genres),
    category: raw.category ? str(raw.category.name) : '',
    status: raw.status ? str(raw.status.name) : '',
    episodesTotal: num(raw.episodes_total),
    episodesReleased: num(raw.episodes_released),
    season: num(raw.season),
    releaseDate: str(raw.release_date),
    grade: Math.round(num(raw.grade) * 100) / 100,
    votes: num(raw.vote_count),
    duration: num(raw.duration),
    description: str(raw.description),
    isAdult: Boolean(raw.is_adult),
    isPlayDisabled: Boolean(raw.is_play_disabled),
    // Персональные поля: приходят только при авторизованном запросе.
    listStatus: Number.isInteger(raw.profile_list_status) ? raw.profile_list_status : null,
    isFavorite: Boolean(raw.is_favorite),
  };
}

/**
 * Полная карточка релиза.
 * @param {any} raw
 */
function toReleaseDetail(raw) {
  const base = toReleaseListItem(raw);
  if (!base) return null;

  return {
    ...base,
    description: str(raw.description),
    studio: str(raw.studio),
    director: str(raw.director),
    country: str(raw.country),
    source: str(raw.source),
    season: num(raw.season),
    releaseDate: str(raw.release_date),
    ageRating: num(raw.age_rating),
    screenshots: Array.isArray(raw.screenshot_images)
      ? raw.screenshot_images.filter((u) => typeof u === 'string' && u.startsWith('http'))
      : [],
    favorites: num(raw.favorites_count),
    commentCount: num(raw.comment_count),
    /** Текущий список пользователя: 1..5 или null. */
    listStatus: Number.isInteger(raw.profile_list_status) ? raw.profile_list_status : null,
    isFavorite: Boolean(raw.is_favorite),
    /** Своя оценка 1..5 или null. */
    yourVote: Number.isInteger(raw.your_vote) ? raw.your_vote : null,
    relatedCount: num(raw.related_count),

    /** Франшиза: группа связанных тайтлов. */
    related:
      raw.related && typeof raw.related === 'object' && Number(raw.related.id)
        ? {
            id: Number(raw.related.id),
            name: typeof raw.related.name === 'string' ? raw.related.name : '',
            description:
              typeof raw.related.description === 'string' ? raw.related.description : '',
            image:
              typeof raw.related.image === 'string' && raw.related.image.startsWith('https://')
                ? raw.related.image
                : '',
          }
        : null,
    /** Превью франшизы (обычно 3 штуки). */
    relatedReleases: Array.isArray(raw.related_releases)
      ? raw.related_releases
          .filter((r) => r && Number(r.id))
          .map((r) => ({
            id: Number(r.id),
            title: typeof r.title_ru === 'string' ? r.title_ru : '',
            poster:
              typeof r.image === 'string' && r.image.startsWith('https://') ? r.image : '',
            year: typeof r.year === 'string' ? r.year : '',
            grade: Math.round((Number(r.grade) || 0) * 100) / 100,
          }))
      : [],

    /**
     * Категории видео с готовыми обложками.
     * `value` совпадает с `category.id` в /video/release — проверено на живых данных.
     */
    videoBanners: Array.isArray(raw.video_banners)
      ? raw.video_banners
          .filter((b) => b && Number(b.value))
          .map((b) => ({
            id: Number(b.value),
            name: typeof b.name === 'string' ? b.name : '',
            // Обложки приходят по http — CSP пропускает только https.
            image:
              typeof b.image === 'string' && b.image.startsWith('http')
                ? b.image.replace(/^http:/, 'https:')
                : '',
          }))
      : [],

    // Распределение оценок: индекс 0 → «1 звезда», 4 → «5 звёзд».
    // Имя отличается от `votes` (число голосов в базовой модели), чтобы не путаться.
    voteHistogram: [
      num(raw.vote_1_count),
      num(raw.vote_2_count),
      num(raw.vote_3_count),
      num(raw.vote_4_count),
      num(raw.vote_5_count),
    ],

    // В скольких списках у людей (публичные счётчики).
    lists: {
      watching: num(raw.watching_count),
      planned: num(raw.plan_count),
      holdOn: num(raw.hold_on_count),
      dropped: num(raw.dropped_count),
      completed: num(raw.completed_count),
    },

    // Похожие тайтлы — тот же объект, что и в списках каталога.
    recommendations: Array.isArray(raw.recommended_releases)
      ? raw.recommended_releases.map(toReleaseListItem).filter(Boolean)
      : [],
    // Реклама и баннеры нам не нужны — не тянем.
  };
}

/**
 * Озвучка.
 * @param {any} raw
 */
function toDubber(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: num(raw.id),
    name: str(raw.name),
    isSub: Boolean(raw.is_sub),
    episodesCount: num(raw.episodes_count),
    viewCount: num(raw.view_count),
    pinned: Boolean(raw.pinned),
    icon: str(raw.icon) || null,
  };
}

/**
 * Источник видео.
 * @param {any} raw
 */
function toSource(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: num(raw.id),
    name: str(raw.name),
    episodesCount: num(raw.episodes_count),
  };
}

/**
 * Серия.
 * @param {any} raw
 */
function toEpisode(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    position: num(raw.position),
    name: str(raw.name),
    url: str(raw.url),
    // iframe:true в ответах API врёт (см. api-scout.md §5.3) — не доверяем, не отдаём.
  };
}

module.exports = {
  toReleaseListItem,
  toReleaseDetail,
  toDubber,
  toSource,
  toEpisode,
  splitGenres,
};
