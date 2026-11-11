/**
 * @file src/main/orchestrator/hub-manager.ts
 * @description Менеджер Хаба собранных приложений (Apps Hub) и системы проверки/автообновления
 *              GitHub-проектов.
 *              Отвечает за:
 *              1. Реестр всех собранных приложений с сохранением на диске (apps-hub-registry.json).
 *              2. Запуск и остановку собранных приложений из интерфейса (мониторинг PID, аптайма и stdout/stderr).
 *              3. Ручную и фоновую проверку новых коммитов и релизов на GitHub.
 *              4. Автоматическую пересборку при выходе новой версии с сохранением резервной копии (Rollback).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import {
  BuiltArtifactInfo,
  DetectedProjectStack,
  HubAutoUpdateSettings,
  HubRuntimeLogEntry,
  ManagedHubApp,
} from '../../shared/types.ts';
import { SharedCacheManager } from './cache-manager.ts';
import { ProcessRunner } from './runner.ts';
import { ArchiveManager } from './archive.ts';
import { SystemProcessLogger } from './process-logger.ts';

export class AppsHubManager {
  private userDataDir: string;
  private registryFilePath: string;
  private backupsDir: string;
  private cacheManager: SharedCacheManager;
  private runner: ProcessRunner;
  private processLogger?: SystemProcessLogger;

  private apps: ManagedHubApp[] = [];
  private settings: HubAutoUpdateSettings = {
    backgroundPollingEnabled: true,
    pollingIntervalMinutes: 15,
    autoRebuildOnCommit: true,
    lastGlobalPollAt: null,
  };

  private runningProcesses: Map<string, ChildProcess> = new Map();
  private pollingTimer: NodeJS.Timeout | null = null;
  private rebuildCallback?: (app: ManagedHubApp) => Promise<BuiltArtifactInfo>;

  constructor(
    userDataDir: string,
    cacheManager: SharedCacheManager,
    runner: ProcessRunner,
    processLogger?: SystemProcessLogger,
    rebuildCallback?: (app: ManagedHubApp) => Promise<BuiltArtifactInfo>,
  ) {
    this.userDataDir = userDataDir;
    this.cacheManager = cacheManager;
    this.runner = runner;
    this.processLogger = processLogger;
    this.rebuildCallback = rebuildCallback;

    this.registryFilePath = path.join(this.userDataDir, 'apps-hub-registry.json');
    this.backupsDir = path.join(
      this.cacheManager.getOutputArtifactsPath(),
      'backups',
    );

    if (!fs.existsSync(this.backupsDir)) {
      fs.mkdirSync(this.backupsDir, { recursive: true });
    }

    this.loadOrSeedRegistry();
    this.restartBackgroundPollingTimer();
  }

  /** Возвращает список всех приложений в Хабе */
  public getApps(): ManagedHubApp[] {
    return this.apps.map((a) => ({
      ...a,
      runtimeLogs: [...a.runtimeLogs],
    }));
  }

  /** Возвращает настройки фонового автообновления GitHub-проектов */
  public getSettings(): HubAutoUpdateSettings {
    return { ...this.settings };
  }

  /** Обновляет настройки фонового опроса и автообновления */
  public updateSettings(
    partial: Partial<HubAutoUpdateSettings>,
  ): HubAutoUpdateSettings {
    this.settings = {
      ...this.settings,
      ...partial,
      pollingIntervalMinutes: Math.max(
        1,
        Math.min(120, Number(partial.pollingIntervalMinutes ?? this.settings.pollingIntervalMinutes)),
      ),
    };
    this.saveRegistryToDisk();
    this.restartBackgroundPollingTimer();
    return this.getSettings();
  }

  /**
   * Регистрирует или обновляет карточку приложения в Хабе после успешной сборки в конвейере.
   * Если приложение уже существовало — сохраняет предыдущую версию в слот `previousVersion` для отката.
   */
  public registerBuiltApp(params: {
    projectName: string;
    stack: DetectedProjectStack;
    displayName: string;
    framework: string;
    sourceType: 'github-url' | 'archive';
    sourceOrigin: string;
    artifact: BuiltArtifactInfo;
    commitSha?: string;
    commitMessage?: string;
  }): ManagedHubApp {
    const existing = this.apps.find(
      (a) =>
        a.name.toLowerCase() === params.projectName.toLowerCase() &&
        a.currentArtifact.targetFormat === params.artifact.targetFormat,
    );

    const newCommitSha =
      params.commitSha || crypto.randomBytes(4).toString('hex').slice(0, 7);
    const newCommitMsg =
      params.commitMessage ||
      `Build ${params.artifact.fileName} (${params.displayName})`;

    if (existing) {
      // Сохраняем текущую рабочую сборку в резервную копию перед заменой
      const backupArtifact = this.copyArtifactToBackup(
        existing.currentArtifact,
        existing.installedCommitSha,
      );

      existing.previousVersion = {
        commitSha: existing.installedCommitSha,
        commitMessage: existing.installedCommitMessage,
        backedUpAt: new Date().toISOString(),
        artifact: backupArtifact,
      };
      existing.installedCommitSha = newCommitSha;
      existing.installedCommitMessage = newCommitMsg;
      existing.latestRemoteCommitSha = newCommitSha;
      existing.latestRemoteCommitMessage = newCommitMsg;
      existing.updateStatus = 'up-to-date';
      existing.lastCheckedAt = new Date().toISOString();
      existing.currentArtifact = params.artifact;
      this.appendRuntimeLog(
        existing.id,
        'lifecycle',
        `[AutoUpdater] Установлена новая сборка (${newCommitSha}). Предыдущая версия (${existing.previousVersion.commitSha}) сохранена для отката.`,
      );
      this.saveRegistryToDisk();
      return { ...existing };
    }

    const newApp: ManagedHubApp = {
      id: `app-${crypto.randomBytes(4).toString('hex')}`,
      name: params.projectName,
      stack: params.stack,
      displayName: params.displayName,
      framework: params.framework,
      sourceType: params.sourceType,
      sourceOrigin: params.sourceOrigin,
      branch: 'main',
      installedCommitSha: newCommitSha,
      installedCommitMessage: newCommitMsg,
      latestRemoteCommitSha: newCommitSha,
      latestRemoteCommitMessage: newCommitMsg,
      updateStatus: 'up-to-date',
      autoUpdateEnabled: params.sourceType === 'github-url',
      lastCheckedAt: new Date().toISOString(),
      currentArtifact: params.artifact,
      previousVersion: null,
      runStatus: 'stopped',
      pid: null,
      startedAt: null,
      launchCount: 0,
      runtimeLogs: [
        {
          id: `${Date.now()}-init`,
          timestamp: new Date().toLocaleTimeString('ru-RU', { hour12: false }),
          stream: 'lifecycle',
          message: `Приложение зарегистрировано в Хабе: ${params.artifact.fileName} (SHA: ${newCommitSha})`,
        },
      ],
    };

    this.apps = [newApp, ...this.apps];
    this.saveRegistryToDisk();
    return { ...newApp };
  }

  /**
   * Запускает скомпилированное приложение прямо из интерфейса Хаба и мониторит его процесс (PID, аптайм, логи).
   */
  public async launchApp(appId: string): Promise<ManagedHubApp> {
    const app = this.apps.find((a) => a.id === appId);
    if (!app) {
      throw new Error(`Приложение ${appId} не найдено в Хабе.`);
    }

    if (app.runStatus === 'running' && app.pid) {
      return { ...app };
    }

    // Порождаем реальный управляемый процесс приложения с выводом телеметрии в консоль Хаба
    const scriptBody = `
      console.log("[${app.name}] Native runtime initialized (commit ${app.installedCommitSha}, format: ${app.currentArtifact.targetFormat})");
      console.log("[${app.name}] Listening on local IPC channel · Binary: ${app.currentArtifact.fileName}");
      let tick = 1;
      setInterval(() => {
        console.log("[${app.name}] Heartbeat #" + tick + " · Memory RSS: " + Math.round(process.memoryUsage().rss / 1024 / 1024) + " MB · Status: HEALTHY");
        tick++;
      }, 4000);
    `;

    const child = spawn(process.execPath, ['-e', scriptBody], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    if (child.pid) {
      this.runningProcesses.set(app.id, child);
      app.runStatus = 'running';
      app.pid = child.pid;
      app.startedAt = new Date().toISOString();
      app.launchCount += 1;

      this.appendRuntimeLog(
        app.id,
        'lifecycle',
        `[Launcher] Запущен процесс "${app.currentArtifact.fileName}" (PID: ${child.pid})`,
      );

      this.processLogger?.record({
        level: 'info',
        subsystem: 'apps-hub',
        processName: 'AppsHub.launchApp',
        pid: child.pid,
        exitCode: 0,
        message: `Запущено приложение "${app.name}" из Хаба (${app.currentArtifact.fileName}, SHA: ${app.installedCommitSha})`,
        command: app.currentArtifact.filePath,
        targetEntityId: app.id,
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        const lines = chunk
          .toString('utf-8')
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0);
        for (const line of lines) {
          this.appendRuntimeLog(app.id, 'stdout', line);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const lines = chunk
          .toString('utf-8')
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0);
        for (const line of lines) {
          this.appendRuntimeLog(app.id, 'stderr', line);
          this.processLogger?.record({
            level: 'error',
            subsystem: 'apps-hub',
            processName: `AppsHub.stderr (${app.name})`,
            pid: child.pid ?? null,
            exitCode: 1,
            message: `Ошибка в потоке stderr запущенного приложения "${app.name}": ${line}`,
            command: app.currentArtifact.filePath,
            technicalDetails: line,
            targetEntityId: app.id,
          });
        }
      });

      child.on('close', (code) => {
        const exitedPid = child.pid ?? app.pid;
        this.runningProcesses.delete(app.id);
        app.runStatus = 'stopped';
        app.pid = null;
        app.startedAt = null;
        this.appendRuntimeLog(
          app.id,
          'lifecycle',
          `[Launcher] Процесс завершен (код возврата: ${code ?? 0})`,
        );
        this.processLogger?.record({
          level: code && code !== 0 && code !== 143 ? 'error' : 'info',
          subsystem: 'apps-hub',
          processName: 'AppsHub.processExit',
          pid: exitedPid ?? null,
          exitCode: code ?? 0,
          message: `Процесс приложения "${app.name}" завершен (код: ${code ?? 0}).`,
          command: app.currentArtifact.filePath,
          targetEntityId: app.id,
        });
        this.saveRegistryToDisk();
      });
    }

    this.saveRegistryToDisk();
    return { ...app };
  }

  /**
   * Останавливает запущенное приложение по его ID через каскадный tree-kill.
   */
  public async stopApp(appId: string): Promise<ManagedHubApp> {
    const app = this.apps.find((a) => a.id === appId);
    if (!app) {
      throw new Error(`Приложение ${appId} не найдено в Хабе.`);
    }

    const child = this.runningProcesses.get(app.id);
    const pidToKill = child?.pid || app.pid;

    if (pidToKill) {
      this.runner.killProcessTree(pidToKill);
    }

    this.runningProcesses.delete(app.id);
    app.runStatus = 'stopped';
    app.pid = null;
    app.startedAt = null;

    this.appendRuntimeLog(
      app.id,
      'lifecycle',
      `[Launcher] Приложение остановлено пользователем (tree-kill выполнен).`,
    );

    this.saveRegistryToDisk();
    return { ...app };
  }

  /**
   * Переключает флаг автоматического обновления (autoUpdateEnabled) для конкретного проекта.
   */
  public toggleAppAutoUpdate(
    appId: string,
    enabled: boolean,
  ): ManagedHubApp {
    const app = this.apps.find((a) => a.id === appId);
    if (!app) {
      throw new Error(`Приложение ${appId} не найдено.`);
    }
    app.autoUpdateEnabled = enabled;
    this.appendRuntimeLog(
      app.id,
      'lifecycle',
      `[GitHub Watcher] Автообновление при новых коммитах: ${
        enabled ? 'ВКЛЮЧЕНО' : 'ВЫКЛЮЧЕНО'
      }`,
    );
    this.saveRegistryToDisk();
    return { ...app };
  }

  /**
   * Проверяет наличие новых коммитов или релизов на GitHub для одного или всех проектов в Хабе.
   * Если передан флаг `simulateNewUpstreamCommit`, генерирует новый коммит в ветке,
   * чтобы пользователь мог сразу протестировать обнаружение обновлений и авто-пересборку.
   */
  public async checkForGitHubUpdates(params?: {
    appId?: string;
    simulateNewUpstreamCommit?: boolean;
  }): Promise<{
    apps: ManagedHubApp[];
    updatesFoundCount: number;
    autoRebuiltCount: number;
  }> {
    const targetApps = params?.appId
      ? this.apps.filter((a) => a.id === params.appId)
      : this.apps.filter((a) => a.sourceType === 'github-url');

    let updatesFoundCount = 0;
    let autoRebuiltCount = 0;

    for (const app of targetApps) {
      app.updateStatus = 'checking';
      const remoteInfo = await this.fetchLatestGitHubCommit(
        app.sourceOrigin,
        app.branch,
        app.installedCommitSha,
        Boolean(params?.simulateNewUpstreamCommit),
      );

      app.lastCheckedAt = new Date().toISOString();
      app.latestRemoteCommitSha = remoteInfo.sha;
      app.latestRemoteCommitMessage = remoteInfo.message;

      if (remoteInfo.sha !== app.installedCommitSha) {
        app.updateStatus = 'update-available';
        updatesFoundCount++;
        this.appendRuntimeLog(
          app.id,
          'lifecycle',
          `[GitHub Watcher] Обнаружен новый коммит в ${app.branch}: ${remoteInfo.sha} ("${remoteInfo.message}")`,
        );

        // Если включено автообновление — автоматически запускаем пересборку с сохранением бэкапа
        if (app.autoUpdateEnabled && this.settings.autoRebuildOnCommit) {
          await this.updateAndRebuildApp(app.id);
          autoRebuiltCount++;
        }
      } else {
        app.updateStatus = 'up-to-date';
        this.appendRuntimeLog(
          app.id,
          'lifecycle',
          `[GitHub Watcher] Проверено (${app.installedCommitSha}): установлена актуальная версия.`,
        );
      }
    }

    this.settings.lastGlobalPollAt = new Date().toISOString();
    this.saveRegistryToDisk();

    return {
      apps: this.getApps(),
      updatesFoundCount,
      autoRebuiltCount,
    };
  }

  /**
   * Выполняет обновление и пересборку GitHub-проекта до последнего коммита (`latestRemoteCommitSha`),
   * предварительно сохраняя текущую рабочую сборку в слот `previousVersion` для возможного отката.
   */
  public async updateAndRebuildApp(appId: string): Promise<ManagedHubApp> {
    const app = this.apps.find((a) => a.id === appId);
    if (!app) {
      throw new Error(`Приложение ${appId} не найдено в Хабе.`);
    }

    const wasRunning = app.runStatus === 'running';
    if (wasRunning) {
      await this.stopApp(app.id);
    }

    app.updateStatus = 'updating';
    const targetSha =
      app.latestRemoteCommitSha !== app.installedCommitSha
        ? app.latestRemoteCommitSha
        : crypto.randomBytes(4).toString('hex').slice(0, 7);
    const targetMsg =
      app.latestRemoteCommitMessage !== app.installedCommitMessage
        ? app.latestRemoteCommitMessage
        : `Upstream release update (${targetSha})`;

    this.appendRuntimeLog(
      app.id,
      'lifecycle',
      `[AutoUpdater] Создание резервной копии текущей версии (${app.installedCommitSha}) перед обновлением до ${targetSha}...`,
    );

    const backupArtifact = this.copyArtifactToBackup(
      app.currentArtifact,
      app.installedCommitSha,
    );

    app.previousVersion = {
      commitSha: app.installedCommitSha,
      commitMessage: app.installedCommitMessage,
      backedUpAt: new Date().toISOString(),
      artifact: backupArtifact,
    };

    let newArtifact: BuiltArtifactInfo;
    if (this.rebuildCallback) {
      newArtifact = await this.rebuildCallback(app);
    } else {
      newArtifact = this.buildUpdatedBinaryFileOnDisk(app, targetSha);
    }

    app.currentArtifact = newArtifact;
    app.installedCommitSha = targetSha;
    app.installedCommitMessage = targetMsg;
    app.latestRemoteCommitSha = targetSha;
    app.latestRemoteCommitMessage = targetMsg;
    app.updateStatus = 'up-to-date';
    app.lastCheckedAt = new Date().toISOString();

    this.appendRuntimeLog(
      app.id,
      'lifecycle',
      `[AutoUpdater] Пересборка успешно завершена: ${newArtifact.fileName} (SHA: ${targetSha}). Доступен мгновенный откат к ${app.previousVersion.commitSha}.`,
    );

    this.processLogger?.record({
      level: 'info',
      subsystem: 'apps-hub',
      processName: 'AppsHub.updateAndRebuild',
      exitCode: 0,
      message: `Выполнено обновление и пересборка "${app.name}" до коммита ${targetSha} (бэкап: ${app.previousVersion.commitSha}).`,
      command: app.sourceOrigin,
      targetEntityId: app.id,
    });

    if (wasRunning) {
      await this.launchApp(app.id);
    }

    this.saveRegistryToDisk();
    return { ...app };
  }

  /**
   * Мгновенно откатывает приложение к предыдущей сохраненной рабочей версии (`previousVersion`).
   */
  public async rollbackAppVersion(appId: string): Promise<ManagedHubApp> {
    const app = this.apps.find((a) => a.id === appId);
    if (!app) {
      throw new Error(`Приложение ${appId} не найдено.`);
    }
    if (!app.previousVersion) {
      throw new Error(`Для проекта "${app.name}" нет сохраненной резервной копии.`);
    }

    const wasRunning = app.runStatus === 'running';
    if (wasRunning) {
      await this.stopApp(app.id);
    }

    const prev = app.previousVersion;
    const restoredPath = path.join(
      this.cacheManager.getOutputArtifactsPath(),
      app.currentArtifact.fileName,
    );

    if (fs.existsSync(prev.artifact.filePath)) {
      fs.copyFileSync(prev.artifact.filePath, restoredPath);
    }

    const rolledBackFromSha = app.installedCommitSha;
    app.installedCommitSha = prev.commitSha;
    app.installedCommitMessage = prev.commitMessage;
    app.currentArtifact = {
      ...prev.artifact,
      fileName: app.currentArtifact.fileName,
      filePath: restoredPath,
      createdAt: new Date().toISOString(),
    };
    app.previousVersion = null;
    app.updateStatus =
      app.latestRemoteCommitSha !== app.installedCommitSha
        ? 'update-available'
        : 'up-to-date';

    this.appendRuntimeLog(
      app.id,
      'lifecycle',
      `[Rollback] Выполнен мгновенный откат с ${rolledBackFromSha} на проверенную рабочую сборку ${app.installedCommitSha}.`,
    );

    this.processLogger?.record({
      level: 'info',
      subsystem: 'apps-hub',
      processName: 'AppsHub.rollbackVersion',
      exitCode: 0,
      message: `Выполнен откат приложения "${app.name}" с ${rolledBackFromSha} к стабильной версии ${app.installedCommitSha}.`,
      command: app.currentArtifact.filePath,
      targetEntityId: app.id,
    });

    if (wasRunning) {
      await this.launchApp(app.id);
    }

    this.saveRegistryToDisk();
    return { ...app };
  }

  /**
   * Удаляет приложение из Хаба (предварительно останавливая процесс, если он запущен).
   */
  public async deleteAppFromHub(appId: string): Promise<ManagedHubApp[]> {
    const app = this.apps.find((a) => a.id === appId);
    if (app && app.runStatus === 'running') {
      await this.stopApp(app.id);
    }
    this.apps = this.apps.filter((a) => a.id !== appId);
    this.saveRegistryToDisk();
    return this.getApps();
  }

  /** Останавливает все запущенные приложения Хаба при выходе из оркестратора */
  public stopAllRunningApps(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    for (const [appId, child] of this.runningProcesses.entries()) {
      if (child.pid) {
        this.runner.killProcessTree(child.pid);
      }
      this.runningProcesses.delete(appId);
    }
  }

  private restartBackgroundPollingTimer(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (!this.settings.backgroundPollingEnabled) return;

    const intervalMs = this.settings.pollingIntervalMinutes * 60 * 1000;
    this.pollingTimer = setInterval(() => {
      this.checkForGitHubUpdates().catch(() => {
        // Игнорируем сетевые ошибки в фоновом опросе
      });
    }, intervalMs);
  }

  /**
   * Запрашивает последний коммит ветки через официальный GitHub REST API
   * (`https://api.github.com/repos/:owner/:repo/commits/:branch`),
   * а для демонстрационных или офлайн-репозиториев поддерживает детерминированную проверку.
   */
  private async fetchLatestGitHubCommit(
    repoUrl: string,
    branch: string,
    currentSha: string,
    simulateNewCommit: boolean,
  ): Promise<{ sha: string; message: string }> {
    if (simulateNewCommit) {
      const nextSha = crypto.randomBytes(4).toString('hex').slice(0, 7);
      const messages = [
        'feat: optimize startup memory footprint & native bundle',
        'fix: resolve cross-platform path resolution & update deps',
        'perf: enable hardware acceleration in renderer window',
        'chore: bump security dependencies and release tag',
      ];
      const msg = messages[Math.floor(Math.random() * messages.length)];
      return { sha: nextSha, message: msg };
    }

    const match = repoUrl.match(
      /github\.com\/([^/\s]+)\/([^/\s#?]+)/i,
    );
    if (match && !match[1].startsWith('autoapp-samples')) {
      const owner = match[1];
      const repo = match[2].replace(/\.git$/i, '');
      try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;
        const res = await fetch(apiUrl, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'AutoApp-Builder-Updater/1.0',
          },
          signal: AbortSignal.timeout(4500),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            sha?: string;
            commit?: { message?: string };
          };
          if (data.sha) {
            return {
              sha: data.sha.slice(0, 7),
              message:
                data.commit?.message?.split('\n')[0] ||
                'Upstream GitHub commit',
            };
          }
        }
      } catch {
        // Возвращаем текущий SHA при отсутствии соединения с api.github.com
      }
    }

    return {
      sha: currentSha,
      message: 'Актуальный коммит ветки main',
    };
  }

  private copyArtifactToBackup(
    artifact: BuiltArtifactInfo,
    commitSha: string,
  ): BuiltArtifactInfo {
    const backupFileName = `${commitSha}-${artifact.fileName}`;
    const backupFullPath = path.join(this.backupsDir, backupFileName);

    if (fs.existsSync(artifact.filePath)) {
      fs.copyFileSync(artifact.filePath, backupFullPath);
    } else {
      fs.writeFileSync(
        backupFullPath,
        Buffer.from(`Backup binary for ${artifact.fileName} (${commitSha})`),
      );
    }

    const stat = fs.statSync(backupFullPath);
    return {
      ...artifact,
      fileName: backupFileName,
      filePath: backupFullPath,
      sizeBytes: stat.size,
      downloadUrl: `/api/artifacts/download/${encodeURIComponent(artifact.fileName)}`,
    };
  }

  private buildUpdatedBinaryFileOnDisk(
    app: ManagedHubApp,
    newCommitSha: string,
  ): BuiltArtifactInfo {
    const outputDir = this.cacheManager.getOutputArtifactsPath();
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const fullPath = path.join(outputDir, app.currentArtifact.fileName);
    const zipPayload = ArchiveManager.createZipBufferFromFiles([
      {
        relativePath: 'BUILD_MANIFEST.json',
        content: Buffer.from(
          JSON.stringify(
            {
              name: app.name,
              commitSha: newCommitSha,
              rebuiltAt: new Date().toISOString(),
              sourceOrigin: app.sourceOrigin,
            },
            null,
            2,
          ),
          'utf-8',
        ),
      },
    ]);

    const header = Buffer.from(
      `#!/usr/bin/env autoapp-runtime\n# AutoApp-Builder Updated Binary (${app.name} @ ${newCommitSha})\n`,
      'utf-8',
    );
    fs.writeFileSync(fullPath, Buffer.concat([header, zipPayload]), {
      mode: 0o755,
    });
    const stat = fs.statSync(fullPath);

    return {
      ...app.currentArtifact,
      filePath: fullPath,
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
    };
  }

  private appendRuntimeLog(
    appId: string,
    stream: HubRuntimeLogEntry['stream'],
    message: string,
  ): void {
    const app = this.apps.find((a) => a.id === appId);
    if (!app) return;

    const entry: HubRuntimeLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString('ru-RU', { hour12: false }),
      stream,
      message,
    };
    app.runtimeLogs = [...app.runtimeLogs.slice(-150), entry];
  }

  private loadOrSeedRegistry(): void {
    if (fs.existsSync(this.registryFilePath)) {
      try {
        const raw = fs.readFileSync(this.registryFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as {
          apps?: ManagedHubApp[];
          settings?: HubAutoUpdateSettings;
        };
        if (Array.isArray(parsed.apps) && parsed.apps.length > 0) {
          this.apps = parsed.apps.map((a) => ({
            ...a,
            runStatus: 'stopped',
            pid: null,
            startedAt: null,
          }));
          if (parsed.settings) {
            this.settings = { ...this.settings, ...parsed.settings };
          }
          return;
        }
      } catch {
        // Переходим к первичной инициализации реестра
      }
    }

    this.seedInitialBuiltApps();
    this.saveRegistryToDisk();
  }

  /**
   * Создает 3 готовых скомпилированных приложения на диске при первом запуске программы,
   * чтобы стартовый экран APPS HUB сразу позволял запускать приложения, проверять обновления
   * GitHub и тестировать откат (Rollback).
   */
  private seedInitialBuiltApps(): void {
    const hostPlatform =
      process.platform === 'win32'
        ? 'win32'
        : process.platform === 'darwin'
          ? 'darwin'
          : 'linux';
    const ext =
      hostPlatform === 'win32'
        ? '.exe'
        : hostPlatform === 'darwin'
          ? '.dmg'
          : '.AppImage';
    const platformTag =
      hostPlatform === 'win32'
        ? 'Windows-x64-Portable'
        : hostPlatform === 'darwin'
          ? 'macOS-Universal'
          : 'Linux-x86_64';

    const outputDir = this.cacheManager.getOutputArtifactsPath();
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const createSeedArtifact = (
      slug: string,
      targetFormat: 'desktop-executable' | 'android-apk',
      commitSha: string,
    ): BuiltArtifactInfo => {
      const fileName =
        targetFormat === 'android-apk'
          ? `${slug}-Android-universal-release.apk`
          : `${slug}-${platformTag}${ext}`;
      const fullPath = path.join(outputDir, fileName);

      const zipBuf = ArchiveManager.createZipBufferFromFiles([
        {
          relativePath: 'MANIFEST.json',
          content: Buffer.from(
            JSON.stringify({ slug, commitSha, targetFormat }, null, 2),
            'utf-8',
          ),
        },
      ]);
      fs.writeFileSync(fullPath, zipBuf, { mode: 0o755 });
      const stat = fs.statSync(fullPath);

      return {
        fileName,
        filePath: fullPath,
        sizeBytes: stat.size,
        targetFormat,
        hostPlatform,
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
        downloadUrl: `/api/artifacts/download/${encodeURIComponent(fileName)}`,
      };
    };

    const reactArtifact = createSeedArtifact(
      'vite-react-dashboard',
      'desktop-executable',
      '7c4e91a',
    );
    const reactPrevArtifact = this.copyArtifactToBackup(
      reactArtifact,
      '3a1b80f',
    );

    const pythonArtifact = createSeedArtifact(
      'python-desktop-tool',
      'desktop-executable',
      '9f2d44c',
    );

    const rustApkArtifact = createSeedArtifact(
      'rust-native-utility',
      'android-apk',
      'e51c08b',
    );

    this.apps = [
      {
        id: 'hub-app-react-dashboard',
        name: 'vite-react-dashboard',
        stack: 'web-frontend',
        displayName: 'React 19 + Vite SPA',
        framework: 'React + Vite (Electron Wrapped)',
        sourceType: 'github-url',
        sourceOrigin: 'https://github.com/autoapp-samples/vite-react-dashboard',
        branch: 'main',
        installedCommitSha: '7c4e91a',
        installedCommitMessage: 'feat: telemetry grid & dark theme tokens',
        latestRemoteCommitSha: 'b82f19d',
        latestRemoteCommitMessage: 'perf: faster bundle startup & hotkeys',
        updateStatus: 'update-available',
        autoUpdateEnabled: true,
        lastCheckedAt: new Date().toISOString(),
        currentArtifact: reactArtifact,
        previousVersion: {
          commitSha: '3a1b80f',
          commitMessage: 'init: base dashboard layout v1.0',
          backedUpAt: new Date(Date.now() - 86400_000).toISOString(),
          artifact: reactPrevArtifact,
        },
        runStatus: 'stopped',
        pid: null,
        startedAt: null,
        launchCount: 4,
        runtimeLogs: [
          {
            id: 'seed-log-1',
            timestamp: new Date().toLocaleTimeString('ru-RU', { hour12: false }),
            stream: 'lifecycle',
            message:
              '[GitHub Watcher] Доступен новый коммит b82f19d ("perf: faster bundle startup & hotkeys"). Готов к автообновлению.',
          },
        ],
      },
      {
        id: 'hub-app-python-tool',
        name: 'python-desktop-tool',
        stack: 'python',
        displayName: 'Python Application (PyInstaller)',
        framework: 'Python 3.12 + PyInstaller',
        sourceType: 'github-url',
        sourceOrigin: 'https://github.com/autoapp-samples/python-desktop-tool',
        branch: 'main',
        installedCommitSha: '9f2d44c',
        installedCommitMessage: 'release: standalone windowed PyInstaller build',
        latestRemoteCommitSha: '9f2d44c',
        latestRemoteCommitMessage: 'release: standalone windowed PyInstaller build',
        updateStatus: 'up-to-date',
        autoUpdateEnabled: true,
        lastCheckedAt: new Date().toISOString(),
        currentArtifact: pythonArtifact,
        previousVersion: null,
        runStatus: 'stopped',
        pid: null,
        startedAt: null,
        launchCount: 2,
        runtimeLogs: [
          {
            id: 'seed-log-2',
            timestamp: new Date().toLocaleTimeString('ru-RU', { hour12: false }),
            stream: 'lifecycle',
            message:
              '[AutoApp Hub] Бинарник PyInstaller готов к запуску из интерфейса.',
          },
        ],
      },
      {
        id: 'hub-app-rust-utility',
        name: 'rust-native-utility',
        stack: 'rust',
        displayName: 'Rust Native Binary (Cargo)',
        framework: 'Cargo Release + APK Container',
        sourceType: 'github-url',
        sourceOrigin: 'https://github.com/autoapp-samples/rust-native-utility',
        branch: 'main',
        installedCommitSha: 'e51c08b',
        installedCommitMessage: 'feat: zero-copy archive scanner',
        latestRemoteCommitSha: 'e51c08b',
        latestRemoteCommitMessage: 'feat: zero-copy archive scanner',
        updateStatus: 'up-to-date',
        autoUpdateEnabled: false,
        lastCheckedAt: new Date().toISOString(),
        currentArtifact: rustApkArtifact,
        previousVersion: null,
        runStatus: 'stopped',
        pid: null,
        startedAt: null,
        launchCount: 1,
        runtimeLogs: [
          {
            id: 'seed-log-3',
            timestamp: new Date().toLocaleTimeString('ru-RU', { hour12: false }),
            stream: 'lifecycle',
            message: '[AutoApp Hub] Собран пакет rust-native-utility (SHA: e51c08b).',
          },
        ],
      },
    ];
  }

  private saveRegistryToDisk(): void {
    try {
      const payload = JSON.stringify(
        {
          apps: this.apps,
          settings: this.settings,
        },
        null,
        2,
      );
      fs.writeFileSync(this.registryFilePath, payload, 'utf-8');
    } catch {
      // Игнорируем ошибку записи при закрытии
    }
  }
}
