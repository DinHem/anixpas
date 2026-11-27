'use strict';
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setName('AnixPas');

const HTML = path.join(__dirname, '..', 'build', 'renderer', 'index.html');

function mem() {
  const m = app.getAppMetrics();
  const get = (t) => Math.round((m.filter((x) => x.type === t)[0]?.memory.workingSetSize || 0) / 1024);
  return { браузер: get('Browser'), gpu: get('GPU'), renderer: get('Tab') };
}

async function main() {
  require('../src/main/security.js').applySecurityPolicies({ appUrl: 'file://' + HTML.split(path.sep).join('/') });
  require('../src/main/ipc/index.js').registerIpc();
  await require('../src/main/cache.js').restoreEpoch();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  await win.loadFile(HTML);
  await new Promise((r) => setTimeout(r, 7000));

  const stats = () =>
    win.webContents.executeJavaScript(`(() => {
      const imgs = [...document.querySelectorAll('img')];
      const decoded = imgs.filter((i) => i.naturalWidth > 0);
      const area = decoded.reduce((a, i) => a + i.naturalWidth * i.naturalHeight, 0);
      return { карточек: document.querySelectorAll('.card').length, вDOM: document.querySelectorAll('*').length,
               декодировано: decoded.length, Мпикс: Math.round(area / 1e6) };
    })()`);

  console.log('старт:', JSON.stringify(await stats()), JSON.stringify(mem()));

  for (let i = 0; i < 15; i++) {
    await win.webContents.executeJavaScript(
      `(() => { const s = document.querySelector('.main'); s.scrollTop = s.scrollHeight; })()`
    );
    await new Promise((r) => setTimeout(r, 2400));
    if (i % 5 === 4) console.log('шаг ' + (i + 1) + ':', JSON.stringify(await stats()), JSON.stringify(mem()));
  }

  console.log('после 15 прокруток:', JSON.stringify(await stats()), JSON.stringify(mem()));
  app.exit(0);
}

app.whenReady().then(main);
