/**
 * @file server.ts
 * @description Полноценный кроссплатформенный сервер оркестратора AutoApp-Builder.
 *              Обеспечивает работу всех модулей `src/main/orchestrator/*` и `src/main/ai/*`
 *              в режиме живого предпросмотра на порту 3000, а также раздачу собранных бинарников
 *              и выгрузку релизного архива для GitHub.
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { OrchestratorEngine } from './src/main/orchestrator/engine.ts';
import {
  AIProviderConfig,
  BuildTargetFormat,
  HubAutoUpdateSettings,
} from './src/shared/types.ts';

async function bootstrapServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);

  // Лимит 50 МБ для приема перетаскиваемых ZIP / TAR.GZ архивов
  app.use(express.json({ limit: '50mb' }));

  const engine = new OrchestratorEngine(
    path.join(process.cwd(), '.autoapp-runtime-data'),
  );

  // Сквозное логирование всех изменяющих API-запросов и любых HTTP-ошибок (>= 400)
  app.use('/api', (req, res, next) => {
    const startMs = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - startMs;
      const isMutating = req.method !== 'GET';
      const isError = res.statusCode >= 400;
      const isLogPolling = req.path.startsWith('/logs');

      if ((isMutating && !isLogPolling) || isError) {
        engine.processLogger.record({
          level: isError ? 'error' : 'info',
          subsystem: 'ipc-http',
          processName: `HTTP ${req.method} /api${req.path}`,
          pid: process.pid,
          exitCode: isError ? res.statusCode : 0,
          durationMs,
          message: isError
            ? `Ошибка выполнения запроса ${req.method} /api${req.path} (HTTP ${res.statusCode}, ${durationMs} мс)`
            : `Выполнен вызов оркестратора ${req.method} /api${req.path} (HTTP ${res.statusCode}, ${durationMs} мс)`,
          command: `${req.method} /api${req.path}`,
        });
      }
    });
    next();
  });

  // 1. Получение состояния активной сессии сборки и истории артефактов
  app.get('/api/session', (_req, res) => {
    res.json({
      session: engine.getSessionState(),
      history: engine.getArtifactsHistory(),
    });
  });

  // 2. Загрузка архива проекта через Drag & Drop (с защитой от Zip-Slip)
  app.post('/api/ingest/archive', async (req, res) => {
    try {
      const { fileName, base64Data } = req.body as {
        fileName?: string;
        base64Data?: string;
      };
      if (!fileName || !base64Data) {
        res.status(400).json({ error: 'Не передан архив или имя файла.' });
        return;
      }
      const buffer = Buffer.from(base64Data, 'base64');
      const state = await engine.ingestArchiveBuffer(buffer, fileName);
      res.json(state);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // 3. Подача ссылки на GitHub-репозиторий
  app.post('/api/ingest/github', async (req, res) => {
    try {
      const { repoUrl, preferredStackHint } = req.body as {
        repoUrl?: string;
        preferredStackHint?: 'react' | 'python' | 'rust' | 'go';
      };
      if (!repoUrl || !repoUrl.trim()) {
        res.status(400).json({ error: 'Укажите URL репозитория GitHub.' });
        return;
      }
      const state = await engine.ingestGitHubUrl(repoUrl, preferredStackHint);
      res.json(state);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // 4. Запуск сборки в исполняемый файл текущей ОС или Android APK
  app.post('/api/build/start', async (req, res) => {
    try {
      const { targetFormat, simulateHealDemo } = req.body as {
        targetFormat?: BuildTargetFormat;
        simulateHealDemo?: boolean;
      };
      const state = await engine.startBuild({
        targetFormat: targetFormat || 'desktop-executable',
        simulateHealDemo: Boolean(simulateHealDemo),
      });
      res.json(state);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // 5. Принудительная остановка активной сборки (tree-kill)
  app.post('/api/build/cancel', (_req, res) => {
    const state = engine.cancelCurrentBuild();
    res.json(state);
  });

  // 6. Мониторинг и очистка единого централизованного кэша
  app.get('/api/cache/stats', (_req, res) => {
    res.json(engine.getCacheStats());
  });

  app.post('/api/cache/purge', (_req, res) => {
    res.json(engine.purgeCache());
  });

  app.post('/api/cache/thresholds', (req, res) => {
    const { maxAllowedGb, minFreeDiskGb } = req.body as {
      maxAllowedGb?: number;
      minFreeDiskGb?: number;
    };
    const stats = engine.cacheManager.setThresholds(
      Number(maxAllowedGb || 10),
      Number(minFreeDiskGb || 5),
    );
    res.json(stats);
  });

  // 7. Конфигурация локального ИИ-движка и управление GGUF-моделями (до 3B)
  app.get('/api/ai/config', (_req, res) => {
    res.json({
      config: engine.getAIConfig(),
      presetModels: engine.getPresetModels(),
    });
  });

  app.post('/api/ai/config', (req, res) => {
    const partial = req.body as Partial<AIProviderConfig>;
    const config = engine.updateAIConfig(partial);
    res.json({
      config,
      presetModels: engine.getPresetModels(),
    });
  });

  app.post('/api/ai/test', async (_req, res) => {
    const status = await engine.aiProvider.testConnection();
    res.json(status);
  });

  app.post('/api/ai/download', async (req, res) => {
    try {
      const { modelId, fastVerifyMode } = req.body as {
        modelId?: string;
        fastVerifyMode?: boolean;
      };
      if (!modelId) {
        res.status(400).json({ error: 'Не указан modelId.' });
        return;
      }
      const progress = await engine.downloadModel(
        modelId,
        fastVerifyMode ?? true,
      );
      res.json(progress);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/ai/delete', (req, res) => {
    const { modelId } = req.body as { modelId?: string };
    const deleted = modelId ? engine.deleteModel(modelId) : false;
    res.json({ deleted });
  });

  // 8. Скачивание готового скомпилированного бинарника из папки output/
  app.get('/api/artifacts/download/:fileName', (req, res) => {
    const safeName = path.basename(req.params.fileName);
    const fullPath = path.join(
      engine.cacheManager.getOutputArtifactsPath(),
      safeName,
    );
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Собранный файл не найден в папке output/.' });
      return;
    }
    res.download(fullPath, safeName);
  });

  // 9. Инспектор всех исходных файлов релизного репозитория и выгрузка ZIP для GitHub
  app.get('/api/release/files', (_req, res) => {
    res.json(engine.getReleaseRepositoryFiles());
  });

  app.get('/api/release/file-content', (req, res) => {
    try {
      const relPath = String(req.query.path || 'package.json');
      const content = engine.readReleaseSourceFile(relPath);
      res.json({ path: relPath, content });
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.get('/api/release/download-zip', (_req, res) => {
    try {
      const zipBuffer = engine.createFullRepositoryReleaseZip();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="AutoApp-Builder-Public-Release-v0.1.0-alpha.1.zip"',
      );
      res.send(zipBuffer);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // 10. Маршруты Хаба собранных приложений (Apps Hub) и автообновления GitHub-проектов
  app.get('/api/hub/state', (_req, res) => {
    res.json({
      apps: engine.hubManager.getApps(),
      settings: engine.hubManager.getSettings(),
    });
  });

  app.post('/api/hub/apps/:appId/launch', async (req, res) => {
    try {
      const updated = await engine.hubManager.launchApp(req.params.appId);
      res.json(updated);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/hub/apps/:appId/stop', async (req, res) => {
    try {
      const updated = await engine.hubManager.stopApp(req.params.appId);
      res.json(updated);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/hub/check-updates', async (req, res) => {
    try {
      const { appId, simulateNewUpstreamCommit } = req.body as {
        appId?: string;
        simulateNewUpstreamCommit?: boolean;
      };
      const result = await engine.hubManager.checkForGitHubUpdates({
        appId,
        simulateNewUpstreamCommit,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/hub/apps/:appId/update', async (req, res) => {
    try {
      const updated = await engine.hubManager.updateAndRebuildApp(
        req.params.appId,
      );
      res.json(updated);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/hub/apps/:appId/rollback', async (req, res) => {
    try {
      const updated = await engine.hubManager.rollbackAppVersion(
        req.params.appId,
      );
      res.json(updated);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/hub/apps/:appId/auto-update', (req, res) => {
    try {
      const { enabled } = req.body as { enabled?: boolean };
      const updated = engine.hubManager.toggleAppAutoUpdate(
        req.params.appId,
        Boolean(enabled),
      );
      res.json(updated);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/hub/settings', (req, res) => {
    const partial = req.body as Partial<HubAutoUpdateSettings>;
    const updated = engine.hubManager.updateSettings(partial);
    res.json(updated);
  });

  app.delete('/api/hub/apps/:appId', async (req, res) => {
    try {
      const remaining = await engine.hubManager.deleteAppFromHub(
        req.params.appId,
      );
      res.json(remaining);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // 11. Единый журнал процессов (SystemProcessLogger) и автоисправление ошибок (Auto-Remediation)
  app.get('/api/logs/state', (_req, res) => {
    res.json(engine.getProcessLoggerState());
  });

  app.post('/api/logs/remediate/:logId', async (req, res) => {
    try {
      const result = await engine.remediateProcessError(req.params.logId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/logs/remediate-all', async (_req, res) => {
    try {
      const result = await engine.remediateAllUnresolvedErrors();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/logs/simulate-error', (req, res) => {
    const { faultType } = req.body as {
      faultType?: 'build' | 'hub-crash' | 'ai-timeout' | 'cache-lock';
    };
    const state = engine.simulateProcessErrorForDiagnostics(
      faultType || 'build',
    );
    res.json(state);
  });

  app.post('/api/logs/clear', (_req, res) => {
    res.json(engine.processLogger.clearLogs());
  });

  app.get('/api/logs/export', (_req, res) => {
    const reportText = engine.processLogger.exportDiagnosticReportText();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="AutoApp-Process-Telemetry.log"',
    );
    res.send(reportText);
  });

  // Интеграция Vite Middleware для разработки или раздачи собранного фронтенда
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.debug(`[AutoApp-Builder] Сервер оркестратора запущен на http://0.0.0.0:${port}`);
  });
}

bootstrapServer();
