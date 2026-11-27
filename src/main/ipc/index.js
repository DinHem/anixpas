'use strict';

/**
 * Регистрация IPC-обработчиков.
 * Только каналы из channels.js. Аргументы валидируются до любых действий.
 *
 * Renderer всегда получает { ok: true, data } либо { ok: false, error }.
 */

const path = require('node:path');
const fs = require('node:fs/promises');
const { app, ipcMain, BrowserWindow, dialog, shell } = require('electron');
const { CHANNELS, validators, ok, fail } = require('./channels.js');
const service = require('../service.js');
const cache = require('../cache.js');
const { resolveStream } = require('../api/streams.js');
const progress = require('../progress.js');
const { openInExternal } = require('../external-player.js');
const { openExternalSafe } = require('../security.js');
const settings = require('../settings.js');
const auth = require('../auth.js');
const updater = require('../updater/index.js');

/**
 * Оборачивает обработчик: ловит исключения, не выпускает стектрейсы наружу.
 * @param {string} channel
 * @param {(payload: any) => Promise<any>} handler
 */
function register(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return await handler(payload, event);
    } catch (err) {
      console.error(`[ipc] ${channel}:`, err && err.message ? err.message : err);

      if (err && err.code === 'network') return fail('network');
      if (err instanceof Error && err.name === 'ApiError') return fail('not_found');
      return fail('internal');
    }
  });
}

/**
 * Безопасное имя файла: без переходов по каталогам и служебных символов Windows.
 * @param {string} name
 */
function sanitizeFilename(name) {
  const cleaned = String(name)
    // Запрещённые в Windows символы.
    .replace(/[\\/:*?"<>|]/g, '_')
    // Никаких «..» — иначе имя файла уведёт из папки.
    .replace(/\.{2,}/g, '_')
    // Управляющие символы.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // Точки и пробелы по краям (Windows их не любит).
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120)
    .trim();

  const safe = cleaned || 'anixpas';
  return safe.toLowerCase().endsWith('.torrent') ? safe : `${safe}.torrent`;
}

/**
 * Отбирает из метаданных только допустимые поля и обрезает длины.
 * @param {any} meta
 */
function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};

  if (typeof meta.title === 'string') out.title = meta.title.slice(0, 300);
  if (typeof meta.poster === 'string' && meta.poster.startsWith('https://')) {
    out.poster = meta.poster.slice(0, 500);
  }
  if (validators.isId(meta.dubberId)) out.dubberId = meta.dubberId;
  if (validators.isId(meta.sourceId)) out.sourceId = meta.sourceId;

  return out;
}

function registerIpc() {
  register(CHANNELS.APP_INFO, async (payload) => {
    if (!validators.isNoArgs(payload)) return fail('invalid_args');

    return ok({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      packaged: app.isPackaged,
    });
  });

  // --- Каталог ---
  register(CHANNELS.CATALOG, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isPage(payload.page)) return fail('invalid_args');

    const filter = payload.filter ?? {};
    if (!validators.isPlainObject(filter)) return fail('invalid_args');
    if (!validators.areGenres(filter.genres)) return fail('invalid_args');
    if (!validators.isCountry(filter.country)) return fail('invalid_args');
    if (!validators.isStudio(filter.studio)) return fail('invalid_args');
    if (!validators.isSource(filter.source)) return fail('invalid_args');
    if (!validators.isSeason(filter.season)) return fail('invalid_args');
    if (!validators.isEpisodes(filter.episodesFrom)) return fail('invalid_args');
    if (!validators.isEpisodes(filter.episodesTo)) return fail('invalid_args');
    if (!validators.areTypes(filter.types)) return fail('invalid_args');

    const items = await service.getCatalog(payload.page, {
      sort: Number.isInteger(filter.sort) ? filter.sort : 0,
      status_id: validators.isId(filter.status_id) ? filter.status_id : null,
      category_id: validators.isId(filter.category_id) ? filter.category_id : null,
      genres: Array.isArray(filter.genres) ? filter.genres : undefined,
      country: typeof filter.country === 'string' ? filter.country : undefined,
      studio: typeof filter.studio === 'string' && filter.studio ? filter.studio : undefined,
      source: typeof filter.source === 'string' && filter.source ? filter.source : undefined,
      season: Number.isInteger(filter.season) ? filter.season : undefined,
      episodesFrom: Number.isInteger(filter.episodesFrom) ? filter.episodesFrom : undefined,
      episodesTo: Number.isInteger(filter.episodesTo) ? filter.episodesTo : undefined,
      types: Array.isArray(filter.types) && filter.types.length ? filter.types : undefined,
    }, { force: Boolean(payload.force) });

    return ok(items);
  });

  // --- Поиск ---
  register(CHANNELS.SEARCH, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isQuery(payload.query)) return fail('invalid_args');
    if (!validators.isPage(payload.page ?? 0)) return fail('invalid_args');

    const items = await service.searchReleases(payload.query.trim(), payload.page ?? 0, {
      force: Boolean(payload.force),
    });
    return ok(items);
  });

  // --- Карточка релиза ---
  register(CHANNELS.RELEASE, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.id)) return fail('invalid_args');

    const release = await service.getRelease(payload.id, { force: Boolean(payload.force) });
    if (!release) return fail('not_found');
    return ok(release);
  });

  // --- Озвучки ---
  register(CHANNELS.DUBBERS, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');

    return ok(await service.getDubbers(payload.releaseId));
  });

  // --- Источники ---
  register(CHANNELS.SOURCES, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!validators.isId(payload.dubberId)) return fail('invalid_args');

    return ok(await service.getSources(payload.releaseId, payload.dubberId));
  });

  // --- Серии (без кэша: подписи и IP в ссылках) ---
  register(CHANNELS.EPISODES, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!validators.isId(payload.dubberId)) return fail('invalid_args');
    if (!validators.isId(payload.sourceId)) return fail('invalid_args');

    return ok(await service.getEpisodes(payload.releaseId, payload.dubberId, payload.sourceId));
  });

  // --- Поток (без кэша: ссылки протухают и привязаны к IP) ---
  register(CHANNELS.STREAM, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!validators.isId(payload.sourceId)) return fail('invalid_args');
    if (!validators.isPage(payload.position)) return fail('invalid_args');

    const result = await resolveStream(payload.releaseId, payload.sourceId, payload.position);
    if (!result) return fail('not_found');
    return ok(result);
  });

  // --- Полноэкранный режим окна ---
  ipcMain.handle(CHANNELS.FULLSCREEN, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return fail('internal');

    const next = !win.isFullScreen();

    // Сообщаем renderer о фактической смене режима (включая выход по Esc).
    if (!win.__fullscreenWired) {
      win.__fullscreenWired = true;
      win.on('enter-full-screen', () => win.webContents.send(CHANNELS.FULLSCREEN_CHANGED, true));
      win.on('leave-full-screen', () => win.webContents.send(CHANNELS.FULLSCREEN_CHANGED, false));
    }

    win.setFullScreen(next);
    return ok({ fullscreen: next });
  });

  // --- История просмотра ---
  register(CHANNELS.HISTORY, async (payload) => {
    if (!validators.isPlainObject(payload ?? {})) return fail('invalid_args');
    if (!validators.isPage(payload.page ?? 0)) return fail('invalid_args');
    return ok(await service.getHistory(payload.page ?? 0));
  });

  register(CHANNELS.HISTORY_ADD, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!validators.isId(payload.sourceId)) return fail('invalid_args');
    if (!validators.isPage(payload.position)) return fail('invalid_args');
    return ok(await service.addHistory(payload.releaseId, payload.sourceId, payload.position));
  });

  register(CHANNELS.HISTORY_WATCHED, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!validators.isId(payload.sourceId)) return fail('invalid_args');
    if (!validators.isPage(payload.position)) return fail('invalid_args');
    return ok(await service.markWatched(payload.releaseId, payload.sourceId, payload.position));
  });

  // --- Профиль ---
  register(CHANNELS.PROFILE_ME, async (payload) => {
    if (!validators.isPlainObject(payload ?? {})) return fail('invalid_args');
    return ok(await service.getMyProfile({ force: Boolean(payload && payload.force) }));
  });

  // --- Закладки ---
  register(CHANNELS.BOOKMARKS, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!Number.isInteger(payload.status) || payload.status < 1 || payload.status > 5) {
      return fail('invalid_args');
    }
    if (!validators.isPage(payload.page ?? 0)) return fail('invalid_args');

    return ok(await service.getBookmarks(payload.status, payload.page ?? 0, 0));
  });

  register(CHANNELS.FAVORITES, async (payload) => {
    if (!validators.isPlainObject(payload ?? {})) return fail('invalid_args');
    if (!validators.isPage(payload.page ?? 0)) return fail('invalid_args');

    return ok(await service.getFavorites(payload.page ?? 0));
  });

  register(CHANNELS.OPEN_EXTERNAL, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (typeof payload.url !== 'string' || payload.url.length > 2048) return fail('invalid_args');

    const opened = await openExternalSafe(payload.url);
    return opened ? ok({ opened: true }) : fail('blocked');
  });

  register(CHANNELS.VIDEOS, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!validators.isPage(payload.page ?? 0)) return fail('invalid_args');

    return ok(await service.getReleaseVideos(payload.releaseId, payload.page ?? 0));
  });

  register(CHANNELS.RELATED, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.groupId)) return fail('invalid_args');
    if (!validators.isPage(payload.page ?? 0)) return fail('invalid_args');

    return ok(await service.getRelated(payload.groupId, payload.page ?? 0));
  });

  register(CHANNELS.VOTES, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.profileId)) return fail('invalid_args');
    if (!validators.isPage(payload.page ?? 0)) return fail('invalid_args');

    const sort = Number.isInteger(payload.sort) ? payload.sort : 1;
    return ok(await service.getMyVotes(payload.profileId, payload.page ?? 0, sort));
  });

  register(CHANNELS.BOOKMARKS_SET_LIST, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!Number.isInteger(payload.status) || payload.status < 0 || payload.status > 5) {
      return fail('invalid_args');
    }
    return ok(await service.setListStatus(payload.releaseId, payload.status));
  });

  register(CHANNELS.BOOKMARKS_SET_VOTE, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!Number.isInteger(payload.vote) || payload.vote < 0 || payload.vote > 5) {
      return fail('invalid_args');
    }
    return ok(await service.setVote(payload.releaseId, payload.vote));
  });

  register(CHANNELS.BOOKMARKS_SET_FAVORITE, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (typeof payload.value !== 'boolean') return fail('invalid_args');
    return ok(await service.setFavorite(payload.releaseId, payload.value));
  });

  // --- Авторизация ---
  register(CHANNELS.AUTH_LOGIN, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (typeof payload.login !== 'string' || payload.login.length < 1 || payload.login.length > 100) {
      return fail('invalid_args');
    }
    if (typeof payload.password !== 'string' || payload.password.length < 1 || payload.password.length > 200) {
      return fail('invalid_args');
    }

    const result = await auth.login(payload.login.trim(), payload.password);
    if (!result.ok) return fail(result.error || 'internal');
    return ok(result.profile);
  });

  register(CHANNELS.AUTH_LOGOUT, async (payload) => {
    if (!validators.isNoArgs(payload)) return fail('invalid_args');
    return ok(await auth.logout());
  });

  register(CHANNELS.AUTH_STATUS, async (payload) => {
    if (!validators.isNoArgs(payload)) return fail('invalid_args');
    return ok(await auth.getStatus());
  });

  // --- Комментарии ---
  register(CHANNELS.COMMENTS, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!validators.isPage(payload.page ?? 0)) return fail('invalid_args');

    const sort = payload.sort === 2 ? 2 : 0;
    return ok(await service.getComments(payload.releaseId, payload.page ?? 0, sort));
  });

  register(CHANNELS.COMMENTS_REPLIES, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.commentId)) return fail('invalid_args');
    if (!validators.isPage(payload.page ?? 0)) return fail('invalid_args');

    return ok(await service.getReplies(payload.commentId, payload.page ?? 0));
  });

  // --- Справочники фильтра ---
  register(CHANNELS.FILTER_OPTIONS, async (payload) => {
    if (!validators.isNoArgs(payload)) return fail('invalid_args');
    return ok(await service.getFilterOptions());
  });

  // --- Настройки ---
  register(CHANNELS.SETTINGS_ALL, async (payload) => {
    if (!validators.isNoArgs(payload)) return fail('invalid_args');
    return ok(await settings.getAll());
  });

  register(CHANNELS.SETTINGS_SET, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (typeof payload.key !== 'string' || payload.key.length > 40) return fail('invalid_args');

    const result = await settings.set(payload.key, payload.value);
    if (!result.ok) return fail('invalid_args');
    return ok(result.value);
  });

  // --- Внешний плеер ---
  register(CHANNELS.PLAYER_EXTERNAL, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (typeof payload.url !== 'string' || payload.url.length > 2048) return fail('invalid_args');

    const result = await openInExternal(payload.url);
    return ok(result);
  });

  // --- Торренты ---
  register(CHANNELS.TORRENTS_LIST, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');

    const result = await service.getTorrents(payload.releaseId);
    // null — источника Libria нет, это не ошибка.
    return ok(result);
  });

  register(CHANNELS.TORRENTS_SAVE, async (payload, event) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isHash(payload.hash)) return fail('invalid_args');

    const win = BrowserWindow.fromWebContents(event.sender);

    // Имя файла из сети всегда санитизируем — оно попадает в путь.
    const suggested = sanitizeFilename(
      typeof payload.filename === 'string' ? payload.filename : `${payload.hash}.torrent`
    );

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Сохранить торрент',
      defaultPath: path.join(app.getPath('downloads'), suggested),
      filters: [{ name: 'Торрент', extensions: ['torrent'] }],
    });

    if (canceled || !filePath) return ok({ saved: false });

    const { buffer } = await service.downloadTorrent(payload.hash);
    await fs.writeFile(filePath, buffer);

    return ok({ saved: true, path: filePath });
  });

  // --- Прогресс просмотра ---
  register(CHANNELS.PROGRESS_GET, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    return ok(await progress.getRelease(payload.releaseId));
  });

  register(CHANNELS.PROGRESS_LAST, async (payload) => {
    if (!validators.isNoArgs(payload)) return fail('invalid_args');
    return ok(await progress.getLast());
  });

  register(CHANNELS.PROGRESS_STATE, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!validators.isId(payload.dubberId)) return fail('invalid_args');
    if (!validators.isId(payload.sourceId)) return fail('invalid_args');
    if (!validators.isPage(payload.position)) return fail('invalid_args');
    return ok(
      await progress.getEpisodeState(
        payload.releaseId,
        payload.dubberId,
        payload.sourceId,
        payload.position
      )
    );
  });

  register(CHANNELS.PROGRESS_OPENED, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!validators.isId(payload.dubberId)) return fail('invalid_args');
    if (!validators.isId(payload.sourceId)) return fail('invalid_args');
    if (!validators.isPage(payload.position)) return fail('invalid_args');
    return ok(
      await progress.markOpened(
        payload.releaseId,
        payload.dubberId,
        payload.sourceId,
        payload.position,
        sanitizeMeta(payload.meta)
      )
    );
  });

  register(CHANNELS.PROGRESS_SAVE, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isId(payload.releaseId)) return fail('invalid_args');
    if (!validators.isId(payload.dubberId)) return fail('invalid_args');
    if (!validators.isId(payload.sourceId)) return fail('invalid_args');
    if (!validators.isPage(payload.position)) return fail('invalid_args');

    const time = Number(payload.time);
    const duration = Number(payload.duration);
    if (!Number.isFinite(time) || time < 0 || time > 86400) return fail('invalid_args');
    if (!Number.isFinite(duration) || duration < 0 || duration > 86400) return fail('invalid_args');

    return ok(
      await progress.savePosition(payload.releaseId, payload.dubberId, payload.sourceId, payload.position, {
        time,
        duration,
        ...sanitizeMeta(payload.meta),
      })
    );
  });

  register(CHANNELS.PROGRESS_CLEAR, async (payload) => {
    if (!validators.isNoArgs(payload)) return fail('invalid_args');
    await progress.clear();
    return ok(true);
  });

  // --- Кэш ---
  register(CHANNELS.CACHE_CLEAR, async (payload) => {
    if (!validators.isNoArgs(payload)) return fail('invalid_args');
    await cache.clear();
    return ok(true);
  });

  register(CHANNELS.CACHE_SIZE, async (payload) => {
    if (!validators.isNoArgs(payload)) return fail('invalid_args');
    return ok(await cache.size());
  });

  register(CHANNELS.AUTH_RESTORE, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isCredential(payload.data)) return fail('invalid_args');
    return ok(await auth.restore(payload.data.trim()));
  });

  register(CHANNELS.AUTH_RESTORE_RESEND, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isCredential(payload.data)) return fail('invalid_args');
    if (!validators.isCredential(payload.password)) return fail('invalid_args');
    if (typeof payload.hash !== 'string' || payload.hash.length > 300) return fail('invalid_args');

    return ok(
      await auth.restoreResend({
        data: payload.data.trim(),
        password: payload.password,
        hash: payload.hash,
      })
    );
  });

  register(CHANNELS.AUTH_RESTORE_VERIFY, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isCredential(payload.data)) return fail('invalid_args');
    if (!validators.isCredential(payload.password)) return fail('invalid_args');
    if (typeof payload.hash !== 'string' || payload.hash.length > 300) return fail('invalid_args');
    if (!validators.isCode(String(payload.code || ''))) return fail('invalid_args');

    return ok(
      await auth.restoreVerify({
        data: payload.data.trim(),
        password: payload.password,
        hash: payload.hash,
        code: String(payload.code),
      })
    );
  });

  register(CHANNELS.AUTH_SIGNUP, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isCredential(payload.login)) return fail('invalid_args');
    if (!validators.isEmail(payload.email)) return fail('invalid_args');
    if (!validators.isCredential(payload.password)) return fail('invalid_args');
    return ok(await auth.signUp(payload.login.trim(), payload.email.trim(), payload.password));
  });

  register(CHANNELS.AUTH_VERIFY, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (!validators.isCredential(payload.login)) return fail('invalid_args');
    if (!validators.isEmail(payload.email)) return fail('invalid_args');
    if (!validators.isCredential(payload.password)) return fail('invalid_args');
    if (typeof payload.hash !== 'string' || payload.hash.length > 300) return fail('invalid_args');
    if (!validators.isCode(String(payload.code || ''))) return fail('invalid_args');

    return ok(
      await auth.verify({
        login: payload.login.trim(),
        email: payload.email.trim(),
        password: payload.password,
        hash: payload.hash,
        code: String(payload.code),
      })
    );
  });

  register(CHANNELS.UPDATER_CHANGELOG, async (payload) => {
    if (!validators.isNoArgs(payload)) return fail('invalid_args');
    return ok(await updater.changelog());
  });

  register(CHANNELS.UPDATER_CHECK, async (payload) => {
    if (!validators.isNoArgs(payload)) return fail('invalid_args');
    return ok(await updater.check());
  });

  register(CHANNELS.UPDATER_DOWNLOAD, async (payload, event) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (typeof payload.url !== 'string' || payload.url.length > 500) return fail('invalid_args');
    if (typeof payload.version !== 'string' || payload.version.length > 40) return fail('invalid_args');
    if (typeof payload.sha512 !== 'string' || !/^[a-f0-9]{128}$/i.test(payload.sha512)) {
      return fail('invalid_args');
    }

    const sender = event && event.sender;
    const result = await updater.download(
      { url: payload.url, version: payload.version, sha512: payload.sha512 },
      (progress) => {
        if (sender && !sender.isDestroyed()) sender.send('updater:progress', progress);
      }
    );

    // Отдаём ответ как есть: внутри уже есть ok/error и причина сбоя.
    return ok(result);
  });

  register(CHANNELS.UPDATER_INSTALL, async (payload) => {
    if (!validators.isPlainObject(payload)) return fail('invalid_args');
    if (typeof payload.file !== 'string' || payload.file.length > 400) return fail('invalid_args');
    return ok(updater.install(payload.file));
  });
}

module.exports = { registerIpc };
