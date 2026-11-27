'use strict';

/**
 * Запуск внешнего плеера (mpv/VLC) с прямой ссылкой на поток.
 *
 * Безопасность:
 *  - URL проверяется по тому же allowlist, что и сетевые запросы;
 *  - процесс запускается массивом аргументов, без shell:true;
 *  - никаких путей из настроек — только известные имена бинарников.
 */

const { spawn } = require('node:child_process');
const { checkUrl } = require('./net/http.js');

/** Плееры в порядке предпочтения. */
const PLAYERS = [
  { name: 'mpv', command: 'mpv' },
  { name: 'VLC', command: 'vlc' },
];

/** Явные пути на случай, если бинарник не в PATH. */
const KNOWN_PATHS = {
  win32: [
    'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
    'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
    'C:\\Program Files\\mpv\\mpv.exe',
  ],
};

/**
 * Пробует запустить конкретную команду.
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<boolean>}
 */
function trySpawn(command, args) {
  return new Promise((resolve) => {
    let settled = false;

    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
    });

    child.on('error', () => {
      if (settled) return;
      settled = true;
      resolve(false);
    });

    child.on('spawn', () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve(true);
    });
  });
}

/**
 * Открывает поток во внешнем плеере.
 *
 * @param {string} url — прямой HLS-поток
 * @returns {Promise<{ opened: boolean, player?: string, reason?: string }>}
 */
async function openInExternal(url) {
  const check = checkUrl(url);
  if (!check.ok) return { opened: false, reason: check.reason };

  const explicit = KNOWN_PATHS[process.platform] || [];

  // 1. Плееры из PATH, затем — известные пути установки.
  for (const player of PLAYERS) {
    if (await trySpawn(player.command, [url])) {
      return { opened: true, player: player.name };
    }
  }

  for (const candidate of explicit) {
    if (await trySpawn(candidate, [url])) {
      return { opened: true, player: candidate.split(/[\\/]/).pop() };
    }
  }

  return { opened: false, reason: 'no_player' };
}

module.exports = { openInExternal };
