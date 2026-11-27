/**
 * Сборка иконки приложения из SVG.
 *
 * Запуск: npx electron scripts/make-icon.js
 * Результат:
 *  - assets/icon.ico — для установщика, exe и ярлыков (16…256 px);
 *  - assets/icon.png — 512 px, для Linux и превью.
 *
 * Рендерим в offscreen-окне сразу нужным размером — так иконка остаётся резкой
 * в мелких размерах, без «мыла» от масштабирования одного большого PNG.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/** Вариант B: тёмная плитка с лавандовым треугольником. */
const BODY = `
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a2733" />
      <stop offset="1" stop-color="#15141a" />
    </linearGradient>
    <linearGradient id="play" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e4d8fa" />
      <stop offset="1" stop-color="#a48fd8" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="128" fill="url(#tile)" />
  <rect x="14" y="14" width="484" height="484" rx="116" fill="none"
        stroke="rgba(201,182,232,0.35)" stroke-width="6" />
  <path d="M196 152v208l164-104z" fill="url(#play)" />`;

const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** @param {number} size @returns {string} */
function html(size) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: transparent; width: ${size}px; height: ${size}px; overflow: hidden; }
  </style></head><body>
    <svg width="${size}" height="${size}" viewBox="0 0 512 512">${BODY}</svg>
  </body></html>`;
}

/**
 * Собирает .ico из PNG-блоков (формат Vista+: внутри ICO лежит PNG).
 * @param {{size: number, png: Buffer}[]} images
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;

  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0); // width
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1); // height
    entry.writeUInt8(0, 2); // палитра
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

app.whenReady().then(async () => {
  // Рендерим один раз в 512 — дальше уменьшаем штатным ресайзом Electron.
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html(512))}`);
  await new Promise((r) => setTimeout(r, 400));

  const source = await win.webContents.capturePage();
  win.destroy();

  /** @type {{size: number, png: Buffer}[]} */
  const images = SIZES.map((size) => ({
    size,
    png: source.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));

  const dir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'icon.ico'), buildIco(images));
  fs.writeFileSync(path.join(dir, 'icon.png'), source.toPNG());

  console.log('[icon] assets/icon.ico', images.map((i) => i.size).join(','), 'assets/icon.png 512');
  app.exit(0);
});
