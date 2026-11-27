/**
 * Превью вариантов иконки приложения.
 *
 * Запуск: npx electron scripts/icon-preview.js
 * Результат: docs/screens/icon-options.png
 *
 * Иконку рисуем в SVG и рендерим через offscreen-окно — та же картинка потом
 * пойдёт в .ico для установщика и exe.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const VARIANTS = [
  {
    title: 'A. Как в приложении',
    svg: `
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d9cbf2" />
          <stop offset="1" stop-color="#8f7ec9" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="128" fill="url(#g1)" />
      <path d="M196 152v208l164-104z" fill="#14131a" />`,
  },
  {
    title: 'B. Тёмная плитка',
    svg: `
      <defs>
        <linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2a2733" />
          <stop offset="1" stop-color="#15141a" />
        </linearGradient>
        <linearGradient id="g3" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#e4d8fa" />
          <stop offset="1" stop-color="#a48fd8" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="128" fill="url(#g2)" />
      <rect x="14" y="14" width="484" height="484" rx="116" fill="none" stroke="rgba(201,182,232,0.35)" stroke-width="6" />
      <path d="M196 152v208l164-104z" fill="url(#g3)" />`,
  },
  {
    title: 'C. Лаванда и белый',
    svg: `
      <defs>
        <linearGradient id="g4" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#bfa8ea" />
          <stop offset="1" stop-color="#8f7ec9" />
        </linearGradient>
        <radialGradient id="g5" cx="0.3" cy="0.2" r="0.8">
          <stop offset="0" stop-color="rgba(255,255,255,0.35)" />
          <stop offset="1" stop-color="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="128" fill="url(#g4)" />
      <rect width="512" height="512" rx="128" fill="url(#g5)" />
      <path d="M196 152v208l164-104z" fill="#ffffff" />`,
  },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1000px; height: 420px; background: #15171c;
         font-family: 'Segoe UI', sans-serif; display: flex; gap: 40px;
         align-items: center; justify-content: center; }
  figure { margin: 0; text-align: center; }
  svg { display: block; filter: drop-shadow(0 12px 24px rgba(0,0,0,0.45)); }
  figcaption { margin-top: 18px; color: #c3c9d6; font-size: 17px; }
</style></head><body>
${VARIANTS.map(
  (v) => `<figure><svg width="256" height="256" viewBox="0 0 512 512">${v.svg}</svg><figcaption>${v.title}</figcaption></figure>`
).join('')}
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000,
    height: 420,
    show: false,
    frame: false,
    webPreferences: { offscreen: true },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 600));

  const image = await win.webContents.capturePage();
  const dir = path.join(__dirname, '..', 'docs', 'screens');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'icon-options.png');
  fs.writeFileSync(file, image.toPNG());

  console.log('[icon]', file);
  app.exit(0);
});
