const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');

/**
 * Конфигурация electron-forge.
 * Сборка: npm run make
 * Обновления: свой апдейтер, см. docs/03-security.md §10.1
 */
module.exports = {
  packagerConfig: {
    name: 'AnixPas',
    executableName: 'anixpas',
    appBundleId: 'app.anixpas',
    asar: true,
    icon: 'assets/icon',
    // Каталог сборки можно переопределить: ANIXPAS_OUT_DIR=out2
    ...(process.env.ANIXPAS_OUT_DIR ? { out: process.env.ANIXPAS_OUT_DIR } : {}),
    // В сборку не попадает ничего лишнего.
    // node_modules не нужен вовсе: main использует только встроенные модули Node и electron,
    // а hls.js уже вкомпилирован в бандл рендерера.
    ignore: [
      /^\/node_modules/,
      /^\/out/,
      /^\/docs/,
      /^\/release-artifacts/,
      /^\/assets/,
      /^\/scripts/,
      /^\/build\/renderer\/.*\.map$/,
      /^\/\.git/,
      /^\/\.vscode/,
      /^\/\.keys/,
      /^\/CHANGELOG\.md$/,
      /^\/eslint\.config\.js$/,
      /^\/rollup\.config\.mjs$/,
      /^\/README\.md$/,
      /^\/LICENSE$/,
      /^\/forge\.config\.js$/,
      /^\/package-lock\.json$/,
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'anixpas',
      setupExe: 'AnixPas-Setup.exe',
    }),
    new MakerZIP({}, ['linux', 'darwin']),
  ],
  plugins: [new AutoUnpackNativesPlugin({})],
};
