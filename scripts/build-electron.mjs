/**
 * @file scripts/build-electron.mjs
 * @description Кроссплатформенный скрипт компиляции процессов Main и Preload (Electron)
 *              с использованием esbuild и генерацией валидной иконки 512x512 PNG (zlib + CRC32)
 *              для упаковки через electron-builder на Windows, macOS и Linux.
 */

import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

/**
 * Вычисляет стандартную контрольную сумму CRC32 (IEEE 802.3) для чанков PNG (IHDR, IDAT, IEND).
 */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Упаковывает отдельный чанк формата PNG: [Length (4B)][Type (4B)][Data][CRC32 (4B)].
 */
function createPngChunk(typeStr, dataBuf) {
  const typeBuf = Buffer.from(typeStr, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(dataBuf.length, 0);

  const crcInput = Buffer.concat([typeBuf, dataBuf]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBuf, typeBuf, dataBuf, crcBuf]);
}

/**
 * Генерирует 100% валидный файл PNG размером 512x512 (RGBA, 8-bit) в фирменной палитре
 * AutoApp-Builder (#111113 фон, #5e6ad2 акцентная рамка и геометрический символ).
 * Удовлетворяет строгим требованиям app-builder (Go image/png) на Windows (.ico),
 * macOS (.icns >= 512x512) и Linux AppImage/deb (>= 256x256).
 */
function generateValid512x512IconPng() {
  const width = 512;
  const height = 512;

  // Сигнатура PNG (8 байт)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // Заголовок IHDR (13 байт)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8 bits per channel
  ihdr[9] = 6; // Color type: 6 (Truecolor with alpha RGBA)
  ihdr[10] = 0; // Compression method: 0 (deflate/inflate)
  ihdr[11] = 0; // Filter method: 0 (adaptive)
  ihdr[12] = 0; // Interlace method: 0 (no interlace)

  // Каждая строка сканлайна начинается с 1 байта фильтра (0 = None) + width * 4 байт RGBA
  const stride = 1 + width * 4;
  const rawScanlines = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    rawScanlines[rowStart] = 0; // Filter type 0 (None)

    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;

      // Базовый темный фон (#111113)
      let r = 0x11;
      let g = 0x11;
      let b = 0x13;
      const a = 0xff;

      // Внешняя акцентная рамка (#5e6ad2)
      const border = 32;
      if (
        x >= border &&
        x < width - border &&
        y >= border &&
        y < height - border
      ) {
        if (
          x < border + 24 ||
          x >= width - border - 24 ||
          y < border + 24 ||
          y >= height - border - 24
        ) {
          r = 0x5e;
          g = 0x6a;
          b = 0xd2;
        } else if (
          x >= 168 &&
          x < 344 &&
          y >= 168 &&
          y < 344
        ) {
          // Центральный логотип-ядро (#f0f0f0 с акцентом #5e6ad2)
          if (x >= 216 && x < 296 && y >= 216 && y < 296) {
            r = 0x5e;
            g = 0x6a;
            b = 0xd2;
          } else {
            r = 0xf0;
            g = 0xf0;
            b = 0xf0;
          }
        }
      }

      rawScanlines[px] = r;
      rawScanlines[px + 1] = g;
      rawScanlines[px + 2] = b;
      rawScanlines[px + 3] = a;
    }
  }

  const compressedIdat = zlib.deflateSync(rawScanlines, { level: 9 });

  return Buffer.concat([
    signature,
    createPngChunk('IHDR', ihdr),
    createPngChunk('IDAT', compressedIdat),
    createPngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function buildElectronMainAndPreload() {
  const rootDir = process.cwd();
  const outMainDir = path.join(rootDir, 'dist-electron', 'main');
  const outPreloadDir = path.join(rootDir, 'dist-electron', 'preload');
  const buildResourcesDir = path.join(rootDir, 'build');

  fs.mkdirSync(outMainDir, { recursive: true });
  fs.mkdirSync(outPreloadDir, { recursive: true });
  fs.mkdirSync(buildResourcesDir, { recursive: true });

  // Генерируем валидную иконку 512x512 PNG для Windows (.ico), macOS (.icns) и Linux (.AppImage / .deb)
  const iconPngBuffer = generateValid512x512IconPng();
  fs.writeFileSync(path.join(buildResourcesDir, 'icon.png'), iconPngBuffer);

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
    `[build-electron] Процессы Main/Preload и иконка 512x512 (${iconPngBuffer.length} байт) успешно собраны.`,
  );
}

buildElectronMainAndPreload().catch((err) => {
  console.error('[build-electron] Ошибка сборки Electron-модулей:', err);
  process.exit(1);
});
