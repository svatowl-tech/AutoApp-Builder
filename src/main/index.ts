/**
 * @file src/main/index.ts
 * @description Главный процесс Electron (Main Process) приложения AutoApp-Builder.
 *              Отвечает за:
 *              1. Инициализацию системного трея (System Tray) с контекстным меню.
 *              2. Создание компактного всплывающего окна 440x650 (с возможностью разворачивания в студию).
 *              3. Регистрацию всех IPC-обработчиков (ipcMain.handle) для связи с React 19 Renderer.
 *              4. Автоматическое сканирование единого кэша при старте и корректную остановку llama-server при выходе.
 */

import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  shell,
  nativeImage,
  screen,
} from 'electron';
import path from 'path';
import fs from 'fs';
import { OrchestratorEngine } from './orchestrator/engine.ts';
import {
  AIProviderConfig,
  BuildTargetFormat,
  HubAutoUpdateSettings,
} from '../shared/types.ts';

/** Размеры всплывающего окна системного трея по умолчанию (согласно ТЗ: 440x650) */
const TRAY_WINDOW_WIDTH = 440;
const TRAY_WINDOW_HEIGHT = 650;

let mainWindow: BrowserWindow | null = null;
let systemTray: Tray | null = null;
let orchestrator: OrchestratorEngine | null = null;
let isQuitting = false;

/**
 * Генерирует встроенную векторную иконку для System Tray (16x16 PNG data URL),
 * чтобы трей гарантированно отображался на Windows, macOS и Linux даже без внешних PNG-файлов.
 */
function createTrayIconImage() {
  const base64Png =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA8SURBVDhPY2RgYPgPxGQMo4ZRAwYNoIYRBeACJAbUNAxXADUgNWDAgB80MGoYNYwaRg0g2wBiDCAGAAAz6wMR6v7l3QAAAABJRU5ErkJggg==';
  return nativeImage.createFromDataURL(`data:image/png;base64,${base64Png}`);
}

/**
 * Создает главное окно приложения (в компактном режиме 440x650 над треем
 * с поддержкой переключения в полноэкранный режим рабочей студии).
 */
async function createMainWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindow({
    width: TRAY_WINDOW_WIDTH,
    height: TRAY_WINDOW_HEIGHT,
    minWidth: TRAY_WINDOW_WIDTH,
    minHeight: TRAY_WINDOW_HEIGHT,
    frame: false,
    resizable: true,
    fullscreenable: true,
    show: false,
    backgroundColor: '#111113',
    title: 'AutoApp-Builder',
    webPreferences: {
      preload: fs.existsSync(path.join(__dirname, '../preload/index.cjs'))
        ? path.join(__dirname, '../preload/index.cjs')
        : path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    positionWindowNearTray();
    mainWindow?.show();
  });

  // Скрываем окно в системный трей при нажатии на крестик, если не идет полный выход
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  return mainWindow;
}

/**
 * Позиционирует всплывающее окно 440x650 рядом с иконкой в системном трее
 * (с учетом расположения панели задач на Windows, macOS Menu Bar и Linux).
 */
function positionWindowNearTray(): void {
  if (!mainWindow) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const windowBounds = mainWindow.getBounds();

  if (systemTray) {
    const trayBounds = systemTray.getBounds();
    if (trayBounds.width > 0 && trayBounds.height > 0) {
      const x = Math.round(
        Math.min(
          Math.max(workArea.x + 12, trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2),
          workArea.x + workArea.width - windowBounds.width - 12,
        ),
      );
      const y =
        process.platform === 'darwin'
          ? trayBounds.y + trayBounds.height + 8
          : Math.max(workArea.y + 12, trayBounds.y - windowBounds.height - 8);

      mainWindow.setPosition(x, y, false);
      return;
    }
  }

  // Центрирование у правого нижнего края рабочей области по умолчанию
  const defaultX = workArea.x + workArea.width - windowBounds.width - 24;
  const defaultY = workArea.y + workArea.height - windowBounds.height - 24;
  mainWindow.setPosition(defaultX, defaultY, false);
}

/**
 * Инициализирует системный трей (System Tray) с быстрым переключением видимости окна 440x650.
 */
function setupSystemTray(): void {
  const icon = createTrayIconImage();
  systemTray = new Tray(icon);
  systemTray.setToolTip('AutoApp-Builder — Оркестратор автономной сборки и самоисцеления');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть виджет оркестратора (440×650)',
      click: () => {
        if (!mainWindow) return;
        mainWindow.setSize(TRAY_WINDOW_WIDTH, TRAY_WINDOW_HEIGHT, true);
        positionWindowNearTray();
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: 'Развернуть студию (1440×900)',
      click: () => {
        if (!mainWindow) return;
        mainWindow.setSize(1440, 900, true);
        mainWindow.center();
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Проверить обновления GitHub-проектов',
      click: () => {
        orchestrator?.hubManager.checkForGitHubUpdates();
      },
    },
    {
      label: 'Очистить единый кэш сборщиков',
      click: () => {
        orchestrator?.purgeCache();
      },
    },
    {
      label: 'Открыть папку готовых бинарников (output/)',
      click: () => {
        if (orchestrator) {
          shell.openPath(orchestrator.cacheManager.getOutputArtifactsPath());
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Выход из AutoApp-Builder',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  systemTray.setContextMenu(contextMenu);

  systemTray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      positionWindowNearTray();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Регистрирует все IPC-обработчики для взаимодействия между Renderer и Main процессом.
 */
function registerIpcHandlers(engine: OrchestratorEngine): void {
  // 1. Получение текущего состояния сессии сборки
  ipcMain.handle('orchestrator:get-session', async () => {
    return engine.getSessionState();
  });

  // 2. Подача архива через Drag & Drop
  ipcMain.handle(
    'orchestrator:ingest-archive',
    async (_event, payload: { fileName: string; base64Data: string }) => {
      const buffer = Buffer.from(payload.base64Data, 'base64');
      return engine.ingestArchiveBuffer(buffer, payload.fileName);
    },
  );

  // 3. Подача ссылки на GitHub-репозиторий
  ipcMain.handle(
    'orchestrator:ingest-github',
    async (
      _event,
      payload: { repoUrl: string; preferredStackHint?: 'react' | 'python' | 'rust' | 'go' },
    ) => {
      return engine.ingestGitHubUrl(payload.repoUrl, payload.preferredStackHint);
    },
  );

  // 4. Запуск конвейера бинаризации (Desktop Executable или Android APK)
  ipcMain.handle(
    'orchestrator:start-build',
    async (
      _event,
      payload: { targetFormat: BuildTargetFormat; simulateHealDemo?: boolean },
    ) => {
      return engine.startBuild(payload);
    },
  );

  // 5. Отмена активной сборки (tree-kill)
  ipcMain.handle('orchestrator:cancel-build', async () => {
    return engine.cancelCurrentBuild();
  });

  // 6. Мониторинг и очистка единого централизованного кэша
  ipcMain.handle('cache:get-stats', async () => {
    return engine.getCacheStats();
  });

  ipcMain.handle('cache:purge', async () => {
    return engine.purgeCache();
  });

  ipcMain.handle(
    'cache:set-thresholds',
    async (_event, payload: { maxAllowedGb: number; minFreeDiskGb: number }) => {
      return engine.cacheManager.setThresholds(
        payload.maxAllowedGb,
        payload.minFreeDiskGb,
      );
    },
  );

  // 7. Настройки локального ИИ-движка и скачивание GGUF-моделей
  ipcMain.handle('ai:get-config', async () => {
    return {
      config: engine.getAIConfig(),
      presetModels: engine.getPresetModels(),
    };
  });

  ipcMain.handle(
    'ai:update-config',
    async (_event, partial: Partial<AIProviderConfig>) => {
      const updated = engine.updateAIConfig(partial);
      return {
        config: updated,
        presetModels: engine.getPresetModels(),
      };
    },
  );

  ipcMain.handle('ai:test-connection', async () => {
    return engine.aiProvider.testConnection();
  });

  ipcMain.handle(
    'ai:download-model',
    async (_event, payload: { modelId: string; fastVerifyMode?: boolean }) => {
      return engine.downloadModel(
        payload.modelId,
        payload.fastVerifyMode ?? false,
      );
    },
  );

  ipcMain.handle('ai:delete-model', async (_event, modelId: string) => {
    return engine.deleteModel(modelId);
  });

  // 8. Открытие полученного готового файла в проводнике ОС (Finder / Explorer / Linux File Manager)
  ipcMain.handle('shell:reveal-artifact', async (_event, filePath: string) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return { opened: true, path: filePath };
    }
    const outputDir = engine.cacheManager.getOutputArtifactsPath();
    await shell.openPath(outputDir);
    return { opened: true, path: outputDir };
  });

  // 9. Переключение размера окна между виджетом трея (440x650) и полноэкранной студией
  ipcMain.handle(
    'window:set-layout-mode',
    async (_event, mode: 'tray' | 'studio') => {
      if (!mainWindow) return { mode };
      if (mode === 'tray') {
        mainWindow.setSize(TRAY_WINDOW_WIDTH, TRAY_WINDOW_HEIGHT, true);
        positionWindowNearTray();
      } else {
        mainWindow.setSize(1440, 900, true);
        mainWindow.center();
      }
      return { mode };
    },
  );

  // 10. Управление Хабом собранных приложений (Apps Hub) и автообновлением GitHub
  ipcMain.handle('hub:get-state', async () => {
    return {
      apps: engine.hubManager.getApps(),
      settings: engine.hubManager.getSettings(),
    };
  });

  ipcMain.handle('hub:launch-app', async (_event, appId: string) => {
    return engine.hubManager.launchApp(appId);
  });

  ipcMain.handle('hub:stop-app', async (_event, appId: string) => {
    return engine.hubManager.stopApp(appId);
  });

  ipcMain.handle(
    'hub:check-updates',
    async (
      _event,
      payload?: { appId?: string; simulateNewUpstreamCommit?: boolean },
    ) => {
      return engine.hubManager.checkForGitHubUpdates(payload);
    },
  );

  ipcMain.handle('hub:update-app', async (_event, appId: string) => {
    return engine.hubManager.updateAndRebuildApp(appId);
  });

  ipcMain.handle('hub:rollback-app', async (_event, appId: string) => {
    return engine.hubManager.rollbackAppVersion(appId);
  });

  ipcMain.handle(
    'hub:toggle-autoupdate',
    async (_event, payload: { appId: string; enabled: boolean }) => {
      return engine.hubManager.toggleAppAutoUpdate(
        payload.appId,
        payload.enabled,
      );
    },
  );

  ipcMain.handle(
    'hub:update-settings',
    async (_event, partial: Partial<HubAutoUpdateSettings>) => {
      return engine.hubManager.updateSettings(partial);
    },
  );

  ipcMain.handle('hub:delete-app', async (_event, appId: string) => {
    return engine.hubManager.deleteAppFromHub(appId);
  });

  // 11. Единый журнал процессов (SystemProcessLogger) и автоисправление ошибок (Auto-Remediation)
  ipcMain.handle('logs:get-state', async () => {
    return engine.getProcessLoggerState();
  });

  ipcMain.handle('logs:remediate', async (_event, logId: string) => {
    return engine.remediateProcessError(logId);
  });

  ipcMain.handle('logs:remediate-all', async () => {
    return engine.remediateAllUnresolvedErrors();
  });

  ipcMain.handle(
    'logs:simulate-error',
    async (
      _event,
      faultType?: 'build' | 'hub-crash' | 'ai-timeout' | 'cache-lock',
    ) => {
      return engine.simulateProcessErrorForDiagnostics(faultType);
    },
  );

  ipcMain.handle('logs:clear', async () => {
    return engine.processLogger.clearLogs();
  });

  ipcMain.handle('logs:export', async () => {
    return {
      reportText: engine.processLogger.exportDiagnosticReportText(),
    };
  });
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  orchestrator = new OrchestratorEngine(userDataPath);

  registerIpcHandlers(orchestrator);
  setupSystemTray();
  await createMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  orchestrator?.hubManager.stopAllRunningApps();
  orchestrator?.aiProvider.stopBuiltinLlamaServer();
  orchestrator?.runner.cancelActiveProcess();
});

app.on('window-all-closed', () => {
  // На всех ОС приложение продолжает жить в системном трее до явного выбора "Выход"
});

