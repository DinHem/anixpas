import svelte from 'rollup-plugin-svelte';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { mkdirSync, copyFileSync } from 'node:fs';

/** Копирует статические файлы рендерера в build/. */
const copyStatic = () => ({
  name: 'copy-static',
  buildStart() {
    mkdirSync('build/renderer', { recursive: true });
  },
  writeBundle() {
    copyFileSync('src/renderer/index.html', 'build/renderer/index.html');
    copyFileSync('src/renderer/app.css', 'build/renderer/app.css');
  },
});

export default {
  input: 'src/renderer/main.js',
  output: {
    file: 'build/renderer/bundle.js',
    format: 'iife',
    name: 'AnixPas',
    sourcemap: true,
  },
  plugins: [
    svelte({
      compilerOptions: {
        dev: !process.env.NODE_ENV || process.env.NODE_ENV !== 'production',
      },
      emitCss: false,
    }),
    resolve({ browser: true, dedupe: ['svelte'] }),
    commonjs(),
    copyStatic(),
  ],
  watch: {
    clearScreen: false,
  },
};
