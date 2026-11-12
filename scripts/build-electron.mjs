/**
 * @file scripts/build-electron.mjs
 * @description Кроссплатформенный скрипт компиляции процессов Main и Preload (Electron)
 *              с использованием esbuild для упаковки в автономные дистрибутивы через electron-builder.
 */

import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

async function buildElectronMainAndPreload() {
  const rootDir = process.cwd();
  const outMainDir = path.join(rootDir, 'dist-electron', 'main');
  const outPreloadDir = path.join(rootDir, 'dist-electron', 'preload');
  const buildResourcesDir = path.join(rootDir, 'build');

  fs.mkdirSync(outMainDir, { recursive: true });
  fs.mkdirSync(outPreloadDir, { recursive: true });
  fs.mkdirSync(buildResourcesDir, { recursive: true });

  // Создаем иконку по умолчанию в папке build/, чтобы electron-builder всегда находил ресурсы сборки
  const iconPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA8SURBVDhPY2RgYPgPxGQMo4ZRAwYNoIYRBeACJAbUNAxXADUgNWDAgB80MGoYNYwaRg0g2wBiDCAGAAAz6wMR6v7l3QAAAABJRU5ErkJggg==';
  fs.writeFileSync(
    path.join(buildResourcesDir, 'icon.png'),
    Buffer.from(iconPngBase64, 'base64'),
  );

  // 1. Компиляция главного процесса Electron (src/main/index.ts -> dist-electron/main/index.cjs)
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src', 'main', 'index.ts')],
    outfile: path.join(outMainDir, 'index.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: false,
  });

  // Также создаем копию index.js для обратной совместимости
  fs.copyFileSync(
    path.join(outMainDir, 'index.cjs'),
    path.join(outMainDir, 'index.js'),
  );

  // 2. Компиляция скрипта предзагрузки (src/preload/index.ts -> dist-electron/preload/index.cjs)
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src', 'preload', 'index.ts')],
    outfile: path.join(outPreloadDir, 'index.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: false,
  });

  fs.copyFileSync(
    path.join(outPreloadDir, 'index.cjs'),
    path.join(outPreloadDir, 'index.js'),
  );

  console.debug(
    '[build-electron] Процессы Main и Preload успешно скомпилированы в dist-electron/',
  );
}

buildElectronMainAndPreload().catch((err) => {
  console.error('[build-electron] Ошибка сборки Electron-модулей:', err);
  process.exit(1);
});
