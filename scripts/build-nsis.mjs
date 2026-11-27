/**
 * Сборка NSIS-установщика.
 *
 * Запуск: npm run make:nsis
 *
 * Каталог сборки можно переопределить: ANIXPAS_OUT_DIR=out2 npm run make:nsis.
 * Нужно, когда старую папку `out` держит какой-то процесс (EBUSY на app.asar).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const out = process.env.ANIXPAS_OUT_DIR || 'out';

execSync('npm run build:renderer', { stdio: 'inherit' });

execSync('npx electron-forge package', {
  stdio: 'inherit',
  env: { ...process.env, ANIXPAS_OUT_DIR: out },
});

const appDir = `${out}/AnixPas-win32-x64`;
if (!fs.existsSync(appDir)) {
  console.error(`Нет собранного приложения: ${appDir}`);
  process.exit(1);
}

execSync(
  `npx electron-builder --win nsis --prepackaged "${appDir}" --config.directories.output="${out}/nsis"`,
  { stdio: 'inherit' }
);

console.log(`\nГотово: ${out}/nsis`);
