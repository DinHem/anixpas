'use strict';

/**
 * AnixPas — точка входа main-процесса.
 * Правила безопасности: docs/03-security.md
 */

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session } = require('electron');

// Имя фиксируем до первого getPath: иначе dev пишет в 'anixpas', а релиз в 'AnixPas'.
app.setName('AnixPas');

const { applySecurityPolicies, openExternalSafe } = require('./security.js');
const { registerIpc } = require('./ipc/index.js');

/** Путь к собранному рендереру. */
const RENDERER_HTML = path.join(__dirname, '..', '..', 'build', 'renderer', 'index.html');
const RENDERER_URL = pathToFileURL(RENDERER_HTML).toString();

/** Дополнительные заголовки для ответов рендерера. */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://s.anixmirai.com https://s3.anixmirai.com https://img.youtube.com https://i.ytimg.com https://video.sibnet.ru",
  "media-src 'self' blob: https://*.libria.fun https://*.solodcdn.com https://*.kodik-storage.com",
  // hls.js грузит плейлисты и сегменты через XHR — без этих доменов видео не поедет.
  // Список совпадает с media-src и ограничен CDN потоков.
  "connect-src 'self' blob: https://*.libria.fun https://*.solodcdn.com https://*.kodik-storage.com https://kodikplayer.com",
  "font-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

let mainWindow = null;

/** Оконный режим самопроверки: окно собралось — выходим. */
const IS_UI_SMOKE = process.env.ANIXPAS_SMOKE === '1' || process.argv.includes('--smoke=ui');

/**
 * Съёмка экранов для дизайн-разработки.
 * Запуск: npx electron . --shot=catalog  (или release:609, search, watch:1000, profile)
 * Кладёт PNG в docs/screens/<имя>.png и выходит.
 */
const SHOT_ARG = process.argv.find((a) => a.startsWith('--shot='));
const SHOT_TARGET = SHOT_ARG ? SHOT_ARG.slice('--shot='.length) : null;
const SHOT_DELAY = Number(
  (process.argv.find((a) => a.startsWith('--shot-delay=')) || '').split('=')[1] || 4000
);
/** Действие перед снимком: JS, выполняется в странице после загрузки данных. */
const SHOT_EVAL =
  (process.argv.find((a) => a.startsWith('--shot-eval=')) || '').slice('--shot-eval='.length) || null;
/** Имя файла снимка, если нужно отличить состояние (--shot-name=menu). */
const SHOT_NAME =
  (process.argv.find((a) => a.startsWith('--shot-name=')) || '').slice('--shot-name='.length) || null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: SHOT_TARGET ? 1440 : 1280,
    height: SHOT_TARGET ? 900 : 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#111318',
    autoHideMenuBar: true,
    title: 'AnixPas',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  // Показываем окно только когда есть что показать — без белой вспышки.
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Съёмка экрана: ждём загрузки данных и сохраняем PNG.
    if (SHOT_TARGET) {
      setTimeout(async () => {
        try {
          if (SHOT_EVAL) {
            const result = await mainWindow.webContents.executeJavaScript(SHOT_EVAL, true);
            if (result !== undefined) console.log('[shot] результат:', JSON.stringify(result));
            // Даём Svelte перерисовать состояние после действия.
            await new Promise((r) => setTimeout(r, 1500));
          }
          const name = (SHOT_NAME || SHOT_TARGET).replace(/[:]/g, '-');
          const dir = path.join(__dirname, '..', '..', 'docs', 'screens');
          const file = path.join(dir, `${name}.png`);
          const image = await mainWindow.webContents.capturePage();
          await require('node:fs/promises').mkdir(dir, { recursive: true });
          await require('node:fs/promises').writeFile(file, image.toPNG());
          console.log(`[shot] ${file}`);
        } catch (err) {
          console.error('[shot] ошибка:', err && err.message);
        }
        app.exit(0);
      }, SHOT_DELAY);
      return;
    }

    // Режим самопроверки: окно собралось, ошибок нет — выходим.
    // Запуск: ANIXPAS_SMOKE=1 npx electron .
    if (IS_UI_SMOKE) {
      console.log('[smoke] окно готово');
      setTimeout(() => {
        console.log('[smoke] выходим');
        app.exit(0);
      }, 3200);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Любая попытка открыть окно — отклоняется (дублирует политику в security.js).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });

  const watchSmoke = process.argv.find((a) => a.startsWith('--smoke=watch'));
  if (watchSmoke) {
    const id = watchSmoke.split(':')[1] || '1000';
    mainWindow.loadFile(RENDERER_HTML, { hash: `watch:${id}` });
  } else if (SHOT_TARGET) {
    mainWindow.loadFile(RENDERER_HTML, { hash: SHOT_TARGET });
  } else {
    mainWindow.loadFile(RENDERER_HTML);
  }

  // Любая ошибка загрузки — в лог, а не в тишину.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[renderer] не загрузился:', code, desc);
  });

  // Ошибки JS в рендерере выводим в консоль main (в релизе тоже).
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error') {
      console.error('[renderer]', event.message);
    } else if (IS_SMOKE && ([ '[checks]', '[player]', '[load]', '[smoke]', '[diag]', '[list]' ].some((p) => event.message.startsWith(p)))) {
      console.log(event.message);
    }
  });
}

/** Любой режим самопроверки: не мешает уже запущенному экземпляру. */
const IS_SMOKE =
  IS_UI_SMOKE ||
  Boolean(SHOT_TARGET) ||
  process.env.ANIXPAS_SMOKE === 'api' ||
  process.argv.includes('--smoke=api') ||
  process.argv.some((a) => a.startsWith('--smoke=watch'));

// Один экземпляр приложения (в режиме проверки — не блокируемся).
const gotLock = IS_SMOKE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // CSP заголовком — основной способ. Мета-тег в index.html дублирует на случай file://.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CSP],
        },
      });
    });

    // Кэш должен помнить поколение и владельца между запусками.
    const cache = require('./cache.js');
    await cache.restoreEpoch();
    try {
      const auth = require('./auth.js');
      const status = await auth.getStatus();
      cache.setUserScope(status.profile ? status.profile.id : null);
    } catch {
      cache.setUserScope(null);
    }

    applySecurityPolicies({ appUrl: RENDERER_URL });
    registerIpc();

    // Режим проверки API: без окна, только сетевой слой.
    // Запуск: npx electron . --smoke=api   (или ANIXPAS_SMOKE=api)
    const smokeMode =
      process.env.ANIXPAS_SMOKE === 'api' || process.argv.includes('--smoke=api');
    if (smokeMode) {
      const { runApiSmoke } = require('./smoke.js');
      const passed = await runApiSmoke();
      app.exit(passed ? 0 : 1);
      return;
    }

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Сохраняем прогресс на диск перед выходом.
  app.on('before-quit', () => {
    try {
      require('./progress.js').flushNow();
      require('./settings.js').flushNow();
    } catch {
      /* не критично */
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
