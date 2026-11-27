'use strict';
const { app } = require('electron');
app.setName('AnixPas');

async function main() {
  const auth = require('../src/main/auth.js');
  const hosts = require('../src/main/api/hosts-resolver.js');

  const token = await auth.getToken();
  const host = await hosts.resolveHost();
  const enc = encodeURIComponent(token);

  const tries = [
    ['GET', '/history/statistics/0'],
    ['GET', '/history/statistics?days=10'],
    ['GET', '/history/statistics?period=10'],
    ['GET', '/history/statistics/10'],
    ['POST', '/history/statistics', '{}'],
    ['POST', '/history/statistics', '{"days":10}'],
  ];

  for (const [method, path, body] of tries) {
    try {
      const sep = path.includes('?') ? '&' : '?';
      const r = await fetch(host + path + sep + 'token=' + enc, {
        method,
        headers: {
          'User-Agent': hosts.USER_AGENT,
          'API-Version': 'v2',
          'Content-Type': 'application/json',
        },
        body: body || undefined,
      });
      const t = await r.text();
      console.log('[diag]', method, path, '->', r.status, '|', t.slice(0, 200));
    } catch (e) {
      console.log('[diag]', method, path, '-> ошибка', e.message);
    }
  }

  app.exit(0);
}
app.whenReady().then(main).catch((e) => { console.error('[diag] сбой:', e); app.exit(1); });
