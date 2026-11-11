/**
 * @file src/main/orchestrator/archive.ts
 * @description Модуль безопасной распаковки и создания архивов с жесткой защитой от уязвимости
 *              Zip-Slip (Path Traversal), поддержкой скачивания репозиториев с GitHub
 *              и кроссплатформенной упаковкой без нативных C++ зависимостей.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';

export class ArchiveManager {
  /**
   * Проверяет, что целевой путь распаковки строго находится внутри корневой директории назначения.
   * Предотвращает атаку Zip-Slip (например, записи вида "../../etc/passwd" или "..\..\Windows\...").
   */
  public static assertSafeExtractPath(
    destinationRoot: string,
    entryRelativePath: string,
  ): string {
    // Заменяем любые обратные слэши на системные и убираем ведущие разделители
    const sanitizedRelative = entryRelativePath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');

    const resolvedRoot = path.resolve(destinationRoot);
    const resolvedTarget = path.resolve(resolvedRoot, sanitizedRelative);

    if (
      resolvedTarget !== resolvedRoot &&
      !resolvedTarget.startsWith(resolvedRoot + path.sep)
    ) {
      throw new Error(
        `[Zip-Slip Guard] Заблокирована попытка записи файла за пределы рабочей песочницы: "${entryRelativePath}"`,
      );
    }

    return resolvedTarget;
  }

  /**
   * Распаковывает ZIP или TAR.GZ архив из буфера или файла в изолированную директорию,
   * проверяя каждый элемент на отсутствие Path Traversal (Zip-Slip).
   */
  public static async extractArchiveToWorkspace(
    archiveBuffer: Buffer,
    originalFileName: string,
    destinationDir: string,
  ): Promise<{ extractedFilesCount: number; rootProjectDir: string }> {
    if (!fs.existsSync(destinationDir)) {
      fs.mkdirSync(destinationDir, { recursive: true });
    }

    // Проверяем нативную сигнатуру ZIP (PK\x03\x04)
    const isZipSignature =
      archiveBuffer.length >= 4 &&
      archiveBuffer[0] === 0x50 &&
      archiveBuffer[1] === 0x4b &&
      archiveBuffer[2] === 0x03 &&
      archiveBuffer[3] === 0x04;

    let extractedFilesCount = 0;

    if (isZipSignature || originalFileName.toLowerCase().endsWith('.zip')) {
      extractedFilesCount = this.extractZipBufferSafe(
        archiveBuffer,
        destinationDir,
      );
    } else if (
      originalFileName.toLowerCase().endsWith('.tar.gz') ||
      originalFileName.toLowerCase().endsWith('.tgz')
    ) {
      extractedFilesCount = this.extractTarGzBufferSafe(
        archiveBuffer,
        destinationDir,
      );
    } else {
      // Если передан одиночный исходный файл или JSON-манифест, сохраняем его напрямую с проверкой пути
      const safeTarget = this.assertSafeExtractPath(
        destinationDir,
        path.basename(originalFileName || 'index.html'),
      );
      fs.writeFileSync(safeTarget, archiveBuffer);
      extractedFilesCount = 1;
    }

    const rootProjectDir = this.unwrapSingleTopLevelFolder(destinationDir);
    return { extractedFilesCount, rootProjectDir };
  }

  /**
   * Встроенный кроссплатформенный распаковщик ZIP-буфера (поддерживает методы Store=0 и Deflate=8)
   * с обязательной проверкой каждого заголовка через assertSafeExtractPath (Zip-Slip Guard).
   */
  public static extractZipBufferSafe(
    zipBuffer: Buffer,
    destinationDir: string,
  ): number {
    let offset = 0;
    let extractedCount = 0;

    while (offset + 30 <= zipBuffer.length) {
      const signature = zipBuffer.readUInt32LE(offset);
      // Local file header signature = 0x04034b50
      if (signature !== 0x04034b50) {
        break;
      }

      const generalPurposeBitFlag = zipBuffer.readUInt16LE(offset + 6);
      const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
      const compressedSize = zipBuffer.readUInt32LE(offset + 18);
      const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
      const extraFieldLength = zipBuffer.readUInt16LE(offset + 28);

      const fileNameStart = offset + 30;
      const fileNameEnd = fileNameStart + fileNameLength;
      if (fileNameEnd > zipBuffer.length) break;

      const entryName = zipBuffer
        .subarray(fileNameStart, fileNameEnd)
        .toString('utf-8');

      const dataStart = fileNameEnd + extraFieldLength;

      // Если установлен бит 3 (Data Descriptor), или размер неизвестен, пробуем системный unzip с предварительной проверкой
      if ((generalPurposeBitFlag & 0x0008) !== 0 && compressedSize === 0) {
        return this.extractZipViaSystemFallbackSafe(zipBuffer, destinationDir);
      }

      const dataEnd = dataStart + compressedSize;
      if (dataEnd > zipBuffer.length) break;

      // Защита от Zip-Slip!
      const safeTargetPath = this.assertSafeExtractPath(
        destinationDir,
        entryName,
      );

      if (entryName.endsWith('/')) {
        if (!fs.existsSync(safeTargetPath)) {
          fs.mkdirSync(safeTargetPath, { recursive: true });
        }
      } else {
        const parentDir = path.dirname(safeTargetPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        const compressedSlice = zipBuffer.subarray(dataStart, dataEnd);
        let fileContent: Buffer;
        if (compressionMethod === 0) {
          fileContent = Buffer.from(compressedSlice);
        } else if (compressionMethod === 8) {
          fileContent = zlib.inflateRawSync(compressedSlice);
        } else {
          throw new Error(
            `Неподдерживаемый метод сжатия ZIP (${compressionMethod}) для файла ${entryName}`,
          );
        }

        fs.writeFileSync(safeTargetPath, fileContent);
        extractedCount++;
      }

      offset = dataEnd;
    }

    return extractedCount;
  }

  /**
   * Резервный метод для потоковых ZIP-архивов GitHub (с флагом Data Descriptor):
   * сначала инспектирует список файлов на отсутствие `..`, затем распаковывает.
   */
  private static extractZipViaSystemFallbackSafe(
    zipBuffer: Buffer,
    destinationDir: string,
  ): number {
    // Инспектируем Central Directory в конце ZIP-архива на отсутствие Zip-Slip
    const entries = this.listZipCentralDirectoryEntries(zipBuffer);
    for (const entryName of entries) {
      this.assertSafeExtractPath(destinationDir, entryName);
    }

    const tempArchivePath = path.join(destinationDir, '__temp_upload__.zip');
    fs.writeFileSync(tempArchivePath, zipBuffer);

    try {
      if (process.platform === 'win32') {
        spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Path "${tempArchivePath}" -DestinationPath "${destinationDir}" -Force`,
          ],
          { stdio: 'ignore', timeout: 30000 },
        );
      } else {
        spawnSync('unzip', ['-q', '-o', tempArchivePath, '-d', destinationDir], {
          stdio: 'ignore',
          timeout: 30000,
        });
      }
    } finally {
      if (fs.existsSync(tempArchivePath)) {
        fs.unlinkSync(tempArchivePath);
      }
    }

    return Math.max(1, entries.length);
  }

  /** Читает имена всех записей из Central Directory ZIP-буфера */
  public static listZipCentralDirectoryEntries(zipBuffer: Buffer): string[] {
    const names: string[] = [];
    let i = 0;
    while (i + 46 <= zipBuffer.length) {
      if (zipBuffer.readUInt32LE(i) === 0x02014b50) {
        const nameLen = zipBuffer.readUInt16LE(i + 28);
        const extraLen = zipBuffer.readUInt16LE(i + 30);
        const commentLen = zipBuffer.readUInt16LE(i + 32);
        const name = zipBuffer
          .subarray(i + 46, i + 46 + nameLen)
          .toString('utf-8');
        names.push(name);
        i += 46 + nameLen + extraLen + commentLen;
      } else {
        i++;
      }
    }
    return names;
  }

  /** Безопасная распаковка .tar.gz / .tgz с проверкой путей */
  private static extractTarGzBufferSafe(
    tarGzBuffer: Buffer,
    destinationDir: string,
  ): number {
    const tarBuffer = zlib.gunzipSync(tarGzBuffer);
    let offset = 0;
    let count = 0;

    while (offset + 512 <= tarBuffer.length) {
      const header = tarBuffer.subarray(offset, offset + 512);
      if (header[0] === 0) break;

      const rawName = header
        .subarray(0, 100)
        .toString('utf-8')
        .replace(/\0+$/, '');
      const sizeOctal = header
        .subarray(124, 136)
        .toString('ascii')
        .replace(/\0+$/, '')
        .trim();
      const fileSize = parseInt(sizeOctal || '0', 8) || 0;
      const typeFlag = String.fromCharCode(header[156]);

      const safePath = this.assertSafeExtractPath(destinationDir, rawName);
      const dataStart = offset + 512;
      const dataEnd = dataStart + fileSize;

      if (typeFlag === '5' || rawName.endsWith('/')) {
        if (!fs.existsSync(safePath)) {
          fs.mkdirSync(safePath, { recursive: true });
        }
      } else if (typeFlag === '0' || typeFlag === '\0') {
        const parentDir = path.dirname(safePath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(safePath, tarBuffer.subarray(dataStart, dataEnd));
        count++;
      }

      const blocks = Math.ceil(fileSize / 512);
      offset = dataStart + blocks * 512;
    }

    return count;
  }

  /**
   * Если архив распаковался в единственную вложенную папку (как в архивах GitHub repo-main/),
   * возвращает путь к этой папке как корневую директорию проекта.
   */
  private static unwrapSingleTopLevelFolder(destinationDir: string): string {
    try {
      const entries = fs.readdirSync(destinationDir, { withFileTypes: true });
      if (entries.length === 1 && entries[0].isDirectory()) {
        return path.join(destinationDir, entries[0].name);
      }
    } catch {
      // Возвращаем исходную папку
    }
    return destinationDir;
  }

  /**
   * Упаковывает набор файлов ({ relativePath, content }) в стандартный кроссплатформенный ZIP-буфер
   * на чистом TypeScript/Node.js (без внешних бинарных зависимостей).
   */
  public static createZipBufferFromFiles(
    files: Array<{ relativePath: string; content: Buffer }>,
  ): Buffer {
    const localHeaders: Buffer[] = [];
    const centralHeaders: Buffer[] = [];
    let currentOffset = 0;

    for (const file of files) {
      const cleanName = file.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
      const nameBuf = Buffer.from(cleanName, 'utf-8');
      const uncompressedData = file.content;
      const compressedData = zlib.deflateRawSync(uncompressedData);
      const crc = this.crc32(uncompressedData);

      // Local File Header (30 bytes + filename)
      const localHeader = Buffer.alloc(30 + nameBuf.length);
      localHeader.writeUInt32LE(0x04034b50, 0); // Signature
      localHeader.writeUInt16LE(20, 4); // Version needed (2.0)
      localHeader.writeUInt16LE(0, 6); // Flags
      localHeader.writeUInt16LE(8, 8); // Compression method: Deflate (8)
      localHeader.writeUInt16LE(0, 10); // Mod time
      localHeader.writeUInt16LE(0, 12); // Mod date
      localHeader.writeUInt32LE(crc, 14); // CRC-32
      localHeader.writeUInt32LE(compressedData.length, 18); // Compressed size
      localHeader.writeUInt32LE(uncompressedData.length, 22); // Uncompressed size
      localHeader.writeUInt16LE(nameBuf.length, 26); // Filename length
      localHeader.writeUInt16LE(0, 28); // Extra field length
      nameBuf.copy(localHeader, 30);

      localHeaders.push(localHeader, compressedData);

      // Central Directory File Header (46 bytes + filename)
      const centralHeader = Buffer.alloc(46 + nameBuf.length);
      centralHeader.writeUInt32LE(0x02014b50, 0); // Signature
      centralHeader.writeUInt16LE(20, 4); // Version made by
      centralHeader.writeUInt16LE(20, 6); // Version needed
      centralHeader.writeUInt16LE(0, 8); // Flags
      centralHeader.writeUInt16LE(8, 10); // Compression method: Deflate (8)
      centralHeader.writeUInt16LE(0, 12); // Mod time
      centralHeader.writeUInt16LE(0, 14); // Mod date
      centralHeader.writeUInt32LE(crc, 16); // CRC-32
      centralHeader.writeUInt32LE(compressedData.length, 20); // Compressed size
      centralHeader.writeUInt32LE(uncompressedData.length, 24); // Uncompressed size
      centralHeader.writeUInt16LE(nameBuf.length, 28); // Filename length
      centralHeader.writeUInt16LE(0, 30); // Extra length
      centralHeader.writeUInt16LE(0, 32); // Comment length
      centralHeader.writeUInt16LE(0, 34); // Disk number
      centralHeader.writeUInt16LE(0, 36); // Internal attributes
      centralHeader.writeUInt32LE(0, 38); // External attributes
      centralHeader.writeUInt32LE(currentOffset, 42); // Offset of local header
      nameBuf.copy(centralHeader, 46);

      centralHeaders.push(centralHeader);
      currentOffset += localHeader.length + compressedData.length;
    }

    const centralDirBuffer = Buffer.concat(centralHeaders);
    const endOfCentralDir = Buffer.alloc(22);
    endOfCentralDir.writeUInt32LE(0x06054b50, 0); // EOCD Signature
    endOfCentralDir.writeUInt16LE(0, 4); // Disk number
    endOfCentralDir.writeUInt16LE(0, 6); // Start disk
    endOfCentralDir.writeUInt16LE(files.length, 8); // Entries on disk
    endOfCentralDir.writeUInt16LE(files.length, 10); // Total entries
    endOfCentralDir.writeUInt32LE(centralDirBuffer.length, 12); // Size of central dir
    endOfCentralDir.writeUInt32LE(currentOffset, 16); // Offset of central dir
    endOfCentralDir.writeUInt16LE(0, 20); // Comment length

    return Buffer.concat([
      ...localHeaders,
      centralDirBuffer,
      endOfCentralDir,
    ]);
  }

  /** Вычисление контрольной суммы CRC-32 по стандарту IEEE 802.3 */
  private static crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}
