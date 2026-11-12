/**
 * @file src/renderer/App.tsx
 * @description Главный интерфейс React 19 приложения AutoApp-Builder в дизайне Variation 7:
 *              - Стартовый экран по умолчанию: APPS HUB (Хаб уже собранных приложений с запуском из UI,
 *                мониторингом PID/аптайма, проверкой обновлений GitHub и откатом версий).
 *              - Конвейер сборки (PIPELINE): трехколоночная рабочая сетка (350px INPUT SOURCES | 1fr CONSOLE | 350px CONFIG).
 *              - Поддержка переключения в компактный виджет системного трея (440x650).
 *              - Индикатор локальной ИИ-модели и единого кэша в нижней панели (footer).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Trash2,
  Maximize2,
  Minimize2,
  Download,
  Cpu,
  HardDrive,
  Terminal,
  Code2,
  Layers,
} from 'lucide-react';
import {
  AIProviderConfig,
  BuildSessionState,
  BuildTargetFormat,
  BuiltArtifactInfo,
  HubAutoUpdateSettings,
  ManagedHubApp,
  PresetGGUFModel,
  ProcessLoggerState,
  SharedCacheStats,
} from '../shared/types.ts';
import { orchestratorClient } from './bridge.ts';
import { AppsHubPanel } from './components/AppsHubPanel.tsx';
import { ProjectIngestPanel } from './components/ProjectIngestPanel.tsx';
import { BuildTerminalPanel } from './components/BuildTerminalPanel.tsx';
import { AIEnginePanel } from './components/AIEnginePanel.tsx';
import { SharedCachePanel } from './components/SharedCachePanel.tsx';
import { ReleaseCodeInspector } from './components/ReleaseCodeInspector.tsx';
import { ProcessDiagnosticsDrawer } from './components/ProcessDiagnosticsDrawer.tsx';

type ActiveSection =
  | 'apps-hub'
  | 'pipeline'
  | 'ai-engine'
  | 'shared-cache'
  | 'release-code';
type LayoutMode = 'studio' | 'tray';

export function AutoAppBuilderRenderer() {
  // Стартовый экран по умолчанию — Хаб собранных приложений ('apps-hub')
  const [activeSection, setActiveSection] = useState<ActiveSection>('apps-hub');
  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
      ? 'tray'
      : 'studio',
  );
  const [targetFormat, setTargetFormat] = useState<BuildTargetFormat>(
    'desktop-executable',
  );
  const [simulateHealDemo, setSimulateHealDemo] = useState<boolean>(true);

  useEffect(() => {
    const handleResize = () => {
      const compact = window.innerWidth < 768;
      setIsCompactViewport(compact);
      if (compact) {
        setLayoutMode('tray');
      } else if (window.innerWidth >= 1024 && window.electronAPI) {
        setLayoutMode('studio');
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [hubApps, setHubApps] = useState<ManagedHubApp[]>([]);
  const [hubSettings, setHubSettings] = useState<HubAutoUpdateSettings>({
    backgroundPollingEnabled: true,
    pollingIntervalMinutes: 15,
    autoRebuildOnCommit: true,
    lastGlobalPollAt: null,
  });

  const [session, setSession] = useState<BuildSessionState>({
    jobId: 'init',
    projectName: 'vite-react-dashboard',
    sourceType: 'github-url',
    sourceOrigin: 'https://github.com/autoapp-samples/vite-react-dashboard',
    workspaceDir: '',
    targetFormat: 'desktop-executable',
    detection: null,
    status: 'idle',
    currentStepIndex: 0,
    totalSteps: 4,
    currentStepLabel: 'Готов к приему архива или ссылки GitHub',
    healAttempt: 0,
    maxHealAttempts: 4,
    logs: [],
    artifact: null,
  });
  const [artifactsHistory, setArtifactsHistory] = useState<BuiltArtifactInfo[]>([]);
  const [cacheStats, setCacheStats] = useState<SharedCacheStats | null>(null);
  const [aiConfig, setAiConfig] = useState<AIProviderConfig>({
    mode: 'builtin-llama',
    selectedModelId: 'qwen2.5-coder-1.5b-q4_k_m',
    builtinLlamaUrl: 'http://127.0.0.1:8080',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModelName: 'qwen2.5-coder:1.5b',
    localServerUrl: 'http://127.0.0.1:1234/v1',
    customOpenAiUrl: 'http://127.0.0.1:8000/v1',
    customOpenAiKey: '',
    maxHealAttempts: 4,
  });
  const [presetModels, setPresetModels] = useState<PresetGGUFModel[]>([]);
  const [purgingQuick, setPurgingQuick] = useState<boolean>(false);
  const [processLoggerState, setProcessLoggerState] =
    useState<ProcessLoggerState | null>(null);
  const [isDiagnosticsDrawerOpen, setIsDiagnosticsDrawerOpen] =
    useState<boolean>(false);

  const refreshAllState = useCallback(async () => {
    try {
      const [sessionData, cacheData, aiData, hubData, logsData] =
        await Promise.all([
          orchestratorClient.getSession(),
          orchestratorClient.getCacheStats(),
          orchestratorClient.getAIConfig(),
          orchestratorClient.getHubState(),
          orchestratorClient.getProcessLoggerState(),
        ]);
      setSession(sessionData.session);
      setArtifactsHistory(sessionData.history);
      setCacheStats(cacheData);
      setAiConfig(aiData.config);
      setPresetModels(aiData.presetModels);
      setHubApps(hubData.apps);
      setHubSettings(hubData.settings);
      setProcessLoggerState(logsData);
    } catch (err) {
      console.error('Ошибка синхронизации состояния оркестратора:', err);
    }
  }, []);

  useEffect(() => {
    refreshAllState();
  }, [refreshAllState]);

  // Периодическая синхронизация живых логов запущенных приложений в Хабе и журнала процессов
  useEffect(() => {
    const hasRunning = hubApps.some((a) => a.runStatus === 'running');
    if (!hasRunning && !isDiagnosticsDrawerOpen) return;

    const timer = setInterval(() => {
      Promise.all([
        orchestratorClient.getHubState(),
        orchestratorClient.getProcessLoggerState(),
      ])
        .then(([hubData, logsData]) => {
          setHubApps(hubData.apps);
          setHubSettings(hubData.settings);
          setProcessLoggerState(logsData);
        })
        .catch(() => {});
    }, 2500);

    return () => clearInterval(timer);
  }, [hubApps, isDiagnosticsDrawerOpen]);

  const refreshHubOnly = async () => {
    const [hubData, logsData] = await Promise.all([
      orchestratorClient.getHubState(),
      orchestratorClient.getProcessLoggerState(),
    ]);
    setHubApps(hubData.apps);
    setHubSettings(hubData.settings);
    setProcessLoggerState(logsData);
  };

  const handleIngestArchive = async (fileName: string, base64Data: string) => {
    const updatedSession = await orchestratorClient.ingestArchive(
      fileName,
      base64Data,
    );
    setSession(updatedSession);
    const updatedCache = await orchestratorClient.getCacheStats();
    setCacheStats(updatedCache);
  };

  const handleIngestGitHub = async (
    repoUrl: string,
    stackHint?: 'react' | 'python' | 'rust' | 'go',
  ) => {
    const updatedSession = await orchestratorClient.ingestGitHub(
      repoUrl,
      stackHint,
    );
    setSession(updatedSession);
    const updatedCache = await orchestratorClient.getCacheStats();
    setCacheStats(updatedCache);
  };

  const handleStartBuild = async (
    fmt: BuildTargetFormat,
    healDemo: boolean,
  ) => {
    setSession((prev) => ({
      ...prev,
      targetFormat: fmt,
      status: 'building',
      currentStepLabel: 'Запуск конвейера бинаризации...',
    }));
    const updatedSession = await orchestratorClient.startBuild(fmt, healDemo);
    setSession(updatedSession);
    const [sessionData, updatedCache, hubData] = await Promise.all([
      orchestratorClient.getSession(),
      orchestratorClient.getCacheStats(),
      orchestratorClient.getHubState(),
    ]);
    setArtifactsHistory(sessionData.history);
    setCacheStats(updatedCache);
    setHubApps(hubData.apps);
  };

  const handleCancelBuild = async () => {
    const cancelled = await orchestratorClient.cancelBuild();
    setSession(cancelled);
  };

  const handlePurgeCache = async () => {
    setPurgingQuick(true);
    try {
      const res = await orchestratorClient.purgeCache();
      setCacheStats(res.updatedStats);
    } finally {
      setPurgingQuick(false);
    }
  };

  const handleToggleLayoutMode = async (nextMode: LayoutMode) => {
    setLayoutMode(nextMode);
    await orchestratorClient.setWindowLayoutMode(nextMode);
  };

  const cacheDisplayGb = cacheStats
    ? (cacheStats.totalCacheBytes / (1024 * 1024 * 1024)).toFixed(2)
    : '0.00';

  const runningAppsCount = hubApps.filter(
    (a) => a.runStatus === 'running',
  ).length;
  const availableUpdatesCount = hubApps.filter(
    (a) => a.updateStatus === 'update-available',
  ).length;
  const unresolvedErrorCount =
    processLoggerState?.stats.unresolvedErrorCount || 0;
  const totalProcessLogsCount = processLoggerState?.stats.totalEntries || 0;

  return (
    <div
      className={`h-dvh w-full overflow-hidden grid ${
        isCompactViewport && layoutMode === 'tray'
          ? 'grid-rows-[1fr_auto]'
          : 'grid-rows-[auto_1fr_auto]'
      } bg-[#111113] text-[#f0f0f0]`}
    >
      {/* 1. Верхняя панель навигации (Top Bar Contract + Variation 7 — скрыта внутри узкого окна 440x650, чтобы не дублировать шапку виджета) */}
      {!(isCompactViewport && layoutMode === 'tray') && (
        <header className="px-8 py-5 flex items-center justify-between gap-8 bg-black border-b border-white/10 shrink-0">
          {/* Зона 1: Бренд Syne 800 с пометкой ранней стадии (Early Stage Alpha) */}
          <a
            href="#apps-hub"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('apps-hub');
            }}
            className="font-display font-extrabold text-xl xl:text-2xl tracking-tight text-[#f0f0f0] whitespace-nowrap shrink-0"
          >
            AUTOAPP [0.1.0-ALPHA · EARLY STAGE]
          </a>

          {/* Зона 2: 5 однострочных навигационных ссылок (APPS HUB — стартовый экран) */}
          <nav className="hidden md:flex items-center gap-8">
            {(
              [
                {
                  id: 'apps-hub',
                  label:
                    availableUpdatesCount > 0
                      ? `APPS HUB (${hubApps.length} · ${availableUpdatesCount} UPD)`
                      : `APPS HUB (${hubApps.length})`,
                },
                { id: 'pipeline', label: 'PIPELINE' },
                { id: 'ai-engine', label: 'AI ENGINE' },
                { id: 'shared-cache', label: 'CACHE' },
                { id: 'release-code', label: 'RELEASE' },
              ] as const
            ).map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection(item.id);
                }}
                className={`text-xs font-semibold tracking-[0.06em] transition-colors whitespace-nowrap shrink-0 ${
                  activeSection === item.id
                    ? 'text-[#5e6ad2] underline underline-offset-8 decoration-2'
                    : 'text-[#f0f0f0]/75 hover:text-white'
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Зона 3: Главное действие выгрузки публичного релиза */}
          <button
            type="button"
            onClick={() => orchestratorClient.downloadReleaseZip()}
            className="bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white px-5 py-2.5 text-xs font-bold tracking-wider uppercase transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>DOWNLOAD</span>
          </button>
        </header>
      )}

      {/* 2. Центральное рабочее пространство (.workspace) */}
      <main className="min-h-0 overflow-hidden flex items-center justify-center">
        {layoutMode === 'tray' ? (
          /* Режим компактного всплывающего окна System Tray (440x650) */
          <div
            className={`${
              isCompactViewport
                ? 'w-full h-full'
                : 'w-[440px] h-[650px] max-h-full border border-white/15 shadow-2xl'
            } bg-[#111113] flex flex-col overflow-hidden`}
          >
            <div className="px-3.5 py-2.5 bg-black border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-display font-extrabold text-xs tracking-tight text-white truncate">
                  AUTOAPP · 440×650
                </span>
                <button
                  type="button"
                  onClick={() => handleToggleLayoutMode('studio')}
                  className="px-1.5 py-0.5 bg-white/5 hover:bg-[#5e6ad2] border border-white/15 text-white/85 font-mono text-[9px] uppercase tracking-wider transition-colors cursor-pointer shrink-0"
                  title="Развернуть полноэкранную студию (1440×900)"
                >
                  1440×900
                </button>
              </div>
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'apps-hub', icon: Layers, label: 'HUB' },
                    { id: 'pipeline', icon: Terminal, label: 'PIPE' },
                    { id: 'ai-engine', icon: Cpu, label: 'AI' },
                    { id: 'shared-cache', icon: HardDrive, label: 'CACHE' },
                    { id: 'release-code', icon: Code2, label: 'CODE' },
                  ] as const
                ).map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveSection(t.id)}
                      className={`flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        activeSection === t.id
                          ? 'bg-[#5e6ad2] text-white font-bold'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      <Icon className="h-3 w-3" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
              {activeSection === 'apps-hub' && (
                <AppsHubPanel
                  apps={hubApps}
                  settings={hubSettings}
                  compactMode={true}
                  onLaunchApp={async (id) => {
                    await orchestratorClient.launchHubApp(id);
                    await refreshHubOnly();
                  }}
                  onStopApp={async (id) => {
                    await orchestratorClient.stopHubApp(id);
                    await refreshHubOnly();
                  }}
                  onCheckUpdates={async (params) => {
                    const res = await orchestratorClient.checkHubUpdates(params);
                    setHubApps(res.apps);
                  }}
                  onUpdateAndRebuildApp={async (id) => {
                    await orchestratorClient.updateHubApp(id);
                    await refreshAllState();
                  }}
                  onRollbackApp={async (id) => {
                    await orchestratorClient.rollbackHubApp(id);
                    await refreshHubOnly();
                  }}
                  onToggleAppAutoUpdate={async (id, enabled) => {
                    await orchestratorClient.toggleHubAutoUpdate(id, enabled);
                    await refreshHubOnly();
                  }}
                  onUpdateSettings={async (partial) => {
                    const updated =
                      await orchestratorClient.updateHubSettings(partial);
                    setHubSettings(updated);
                  }}
                  onDeleteApp={async (id) => {
                    const remaining = await orchestratorClient.deleteHubApp(id);
                    setHubApps(remaining);
                  }}
                  onRevealOrDownloadArtifact={(art) =>
                    orchestratorClient.revealOrDownloadArtifact(art)
                  }
                  onNavigateToPipeline={() => setActiveSection('pipeline')}
                  onOpenProcessDiagnostics={() =>
                    setIsDiagnosticsDrawerOpen(true)
                  }
                  unresolvedErrorCount={unresolvedErrorCount}
                />
              )}

              {activeSection === 'pipeline' && (
                <>
                  <ProjectIngestPanel
                    session={session}
                    compactMode={true}
                    paneMode="both"
                    targetFormat={targetFormat}
                    onTargetFormatChange={setTargetFormat}
                    simulateHealDemo={simulateHealDemo}
                    onSimulateHealDemoChange={setSimulateHealDemo}
                    cacheStats={cacheStats}
                    onPurgeCache={handlePurgeCache}
                    onIngestArchive={handleIngestArchive}
                    onIngestGitHub={handleIngestGitHub}
                    onStartBuild={handleStartBuild}
                    onCancelBuild={handleCancelBuild}
                  />
                  <div className="min-h-[220px]">
                    <BuildTerminalPanel
                      session={session}
                      history={artifactsHistory}
                      compactMode={true}
                      onRevealOrDownloadArtifact={(art) =>
                        orchestratorClient.revealOrDownloadArtifact(art)
                      }
                      onOpenProcessDiagnostics={() =>
                        setIsDiagnosticsDrawerOpen(true)
                      }
                      unresolvedErrorCount={unresolvedErrorCount}
                    />
                  </div>
                </>
              )}

              {activeSection === 'ai-engine' && (
                <AIEnginePanel
                  config={aiConfig}
                  presetModels={presetModels}
                  onUpdateConfig={async (partial) => {
                    const res = await orchestratorClient.updateAIConfig(partial);
                    setAiConfig(res.config);
                    setPresetModels(res.presetModels);
                  }}
                  onTestConnection={() => orchestratorClient.testAIConnection()}
                  onDownloadModel={async (modelId) => {
                    await orchestratorClient.downloadModel(modelId, true);
                    await refreshAllState();
                  }}
                  onDeleteModel={async (modelId) => {
                    await orchestratorClient.deleteModel(modelId);
                    await refreshAllState();
                  }}
                />
              )}

              {activeSection === 'shared-cache' && (
                <SharedCachePanel
                  stats={cacheStats}
                  onPurgeCache={handlePurgeCache}
                  onRefreshStats={async () => {
                    const st = await orchestratorClient.getCacheStats();
                    setCacheStats(st);
                  }}
                  onUpdateThresholds={async (maxGb, minFreeGb) => {
                    const st = await orchestratorClient.setCacheThresholds(
                      maxGb,
                      minFreeGb,
                    );
                    setCacheStats(st);
                  }}
                />
              )}

              {activeSection === 'release-code' && <ReleaseCodeInspector />}
            </div>
          </div>
        ) : (
          /* Полноэкранная студия с 3-колоночной сеткой Variation 7 (350px | 1fr | 350px) */
          <div className="w-full h-full min-h-0 p-5">
            {activeSection === 'apps-hub' && (
              <AppsHubPanel
                apps={hubApps}
                settings={hubSettings}
                compactMode={false}
                onLaunchApp={async (id) => {
                  await orchestratorClient.launchHubApp(id);
                  await refreshHubOnly();
                }}
                onStopApp={async (id) => {
                  await orchestratorClient.stopHubApp(id);
                  await refreshHubOnly();
                }}
                onCheckUpdates={async (params) => {
                  const res = await orchestratorClient.checkHubUpdates(params);
                  setHubApps(res.apps);
                }}
                onUpdateAndRebuildApp={async (id) => {
                  await orchestratorClient.updateHubApp(id);
                  await refreshAllState();
                }}
                onRollbackApp={async (id) => {
                  await orchestratorClient.rollbackHubApp(id);
                  await refreshHubOnly();
                }}
                onToggleAppAutoUpdate={async (id, enabled) => {
                  await orchestratorClient.toggleHubAutoUpdate(id, enabled);
                  await refreshHubOnly();
                }}
                onUpdateSettings={async (partial) => {
                  const updated =
                    await orchestratorClient.updateHubSettings(partial);
                  setHubSettings(updated);
                }}
                onDeleteApp={async (id) => {
                  const remaining = await orchestratorClient.deleteHubApp(id);
                  setHubApps(remaining);
                }}
                onRevealOrDownloadArtifact={(art) =>
                  orchestratorClient.revealOrDownloadArtifact(art)
                }
                onNavigateToPipeline={() => setActiveSection('pipeline')}
                onOpenProcessDiagnostics={() =>
                  setIsDiagnosticsDrawerOpen(true)
                }
                unresolvedErrorCount={unresolvedErrorCount}
              />
            )}

            {activeSection === 'pipeline' && (
              <div className="h-full min-h-0 grid grid-cols-1 xl:grid-cols-[350px_1fr_350px] gap-5">
                {/* Левая колонка: INPUT SOURCES */}
                <ProjectIngestPanel
                  session={session}
                  compactMode={false}
                  paneMode="inputs"
                  targetFormat={targetFormat}
                  onTargetFormatChange={setTargetFormat}
                  simulateHealDemo={simulateHealDemo}
                  onSimulateHealDemoChange={setSimulateHealDemo}
                  onIngestArchive={handleIngestArchive}
                  onIngestGitHub={handleIngestGitHub}
                  onStartBuild={handleStartBuild}
                  onCancelBuild={handleCancelBuild}
                />

                {/* Центральная колонка: SYSTEM CONSOLE */}
                <BuildTerminalPanel
                  session={session}
                  history={artifactsHistory}
                  compactMode={false}
                  onRevealOrDownloadArtifact={(art) =>
                    orchestratorClient.revealOrDownloadArtifact(art)
                  }
                  onOpenProcessDiagnostics={() =>
                    setIsDiagnosticsDrawerOpen(true)
                  }
                  unresolvedErrorCount={unresolvedErrorCount}
                />

                {/* Правая колонка: CONFIG & EXECUTE PIPELINE */}
                <ProjectIngestPanel
                  session={session}
                  compactMode={false}
                  paneMode="config"
                  targetFormat={targetFormat}
                  onTargetFormatChange={setTargetFormat}
                  simulateHealDemo={simulateHealDemo}
                  onSimulateHealDemoChange={setSimulateHealDemo}
                  cacheStats={cacheStats}
                  onPurgeCache={handlePurgeCache}
                  onIngestArchive={handleIngestArchive}
                  onIngestGitHub={handleIngestGitHub}
                  onStartBuild={handleStartBuild}
                  onCancelBuild={handleCancelBuild}
                />
              </div>
            )}

            {activeSection === 'ai-engine' && (
              <div className="h-full min-h-0 overflow-y-auto max-w-[1440px] mx-auto">
                <AIEnginePanel
                  config={aiConfig}
                  presetModels={presetModels}
                  onUpdateConfig={async (partial) => {
                    const res = await orchestratorClient.updateAIConfig(partial);
                    setAiConfig(res.config);
                    setPresetModels(res.presetModels);
                  }}
                  onTestConnection={() => orchestratorClient.testAIConnection()}
                  onDownloadModel={async (modelId) => {
                    await orchestratorClient.downloadModel(modelId, true);
                    await refreshAllState();
                  }}
                  onDeleteModel={async (modelId) => {
                    await orchestratorClient.deleteModel(modelId);
                    await refreshAllState();
                  }}
                />
              </div>
            )}

            {activeSection === 'shared-cache' && (
              <div className="h-full min-h-0 overflow-y-auto max-w-[1440px] mx-auto">
                <SharedCachePanel
                  stats={cacheStats}
                  onPurgeCache={handlePurgeCache}
                  onRefreshStats={async () => {
                    const st = await orchestratorClient.getCacheStats();
                    setCacheStats(st);
                  }}
                  onUpdateThresholds={async (maxGb, minFreeGb) => {
                    const st = await orchestratorClient.setCacheThresholds(
                      maxGb,
                      minFreeGb,
                    );
                    setCacheStats(st);
                  }}
                />
              </div>
            )}

            {activeSection === 'release-code' && (
              <div className="h-full min-h-0 max-w-[1440px] mx-auto">
                <ReleaseCodeInspector />
              </div>
            )}
          </div>
        )}
      </main>

      {/* 3. Нижняя панель управления и индикации (Variation 7 Footer) */}
      <footer
        className={`${
          isCompactViewport ? 'px-3 py-2 gap-2' : 'px-8 py-3 gap-4'
        } border-t border-white/10 bg-[#111113] flex flex-wrap items-center justify-between shrink-0`}
      >
        {!isCompactViewport && (
          <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.12em] uppercase text-white/70">
            <span className="text-amber-300 font-bold">
              EARLY STAGE ALPHA (v0.1.0-alpha.1)
            </span>
            <span aria-hidden="true">·</span>
            <span>LLM: {aiConfig.selectedModelId}</span>
            <span aria-hidden="true">·</span>
            <span>RUNNING APPS: {runningAppsCount}</span>
            <span aria-hidden="true">·</span>
            <span>
              GITHUB POLLING:{' '}
              {hubSettings.backgroundPollingEnabled
                ? `ON (${hubSettings.pollingIntervalMinutes}M)`
                : 'OFF'}
            </span>
          </div>
        )}

        <div
          className={`flex items-center ${
            isCompactViewport ? 'w-full justify-between gap-1.5' : 'gap-3'
          }`}
        >
          {/* Кнопка открытия сквозного журнала всех процессов и автоисправления ошибок */}
          <button
            type="button"
            onClick={() => setIsDiagnosticsDrawerOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 border font-mono tabular-nums text-[10px] tracking-wider uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              unresolvedErrorCount > 0
                ? 'bg-red-500/20 border-red-500/60 text-red-300 hover:bg-red-500/30 font-bold'
                : 'border-white/15 hover:border-[#5e6ad2] text-white/85'
            }`}
          >
            <Activity className="h-3 w-3 text-[#5e6ad2]" />
            <span>
              {unresolvedErrorCount > 0
                ? `ЛОГ (${totalProcessLogsCount} · ERR: ${unresolvedErrorCount})`
                : `ЛОГ ПРОЦЕССОВ (${totalProcessLogsCount})`}
            </span>
          </button>

          {/* Переключатель между полноэкранной 3-колоночной студией и виджетом трея 440x650 */}
          <button
            type="button"
            onClick={() =>
              handleToggleLayoutMode(layoutMode === 'studio' ? 'tray' : 'studio')
            }
            className="flex items-center gap-1.5 px-2.5 py-1 border border-white/15 hover:border-[#5e6ad2] text-white/80 font-mono text-[10px] tracking-wider uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {layoutMode === 'studio' ? (
              <>
                <Minimize2 className="h-3 w-3 text-[#5e6ad2]" />
                <span>ВИДЖЕТ ТРЕЯ (440×650)</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3 w-3 text-[#5e6ad2]" />
                <span>{isCompactViewport ? 'СТУДИЯ' : 'ПОЛНОЭКРАННАЯ ПАНЕЛЬ'}</span>
              </>
            )}
          </button>

          {/* Кнопка быстрой очистки единого кэша */}
          <button
            type="button"
            disabled={purgingQuick}
            onClick={handlePurgeCache}
            className="flex items-center gap-1.5 px-2.5 py-1 border border-white/15 hover:border-red-500/60 hover:text-red-400 text-white/80 font-mono tabular-nums text-[10px] tracking-wider uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3 w-3 text-red-400" />
            <span>
              {purgingQuick
                ? 'ОЧИСТКА...'
                : isCompactViewport
                  ? `КЭШ (${cacheDisplayGb}G)`
                  : `ОЧИСТИТЬ КЭШ (${cacheDisplayGb} GB)`}
            </span>
          </button>
        </div>
      </footer>

      {/* Выдвижная панель сквозного логирования всех процессов и автоисправления ошибок */}
      <ProcessDiagnosticsDrawer
        isOpen={isDiagnosticsDrawerOpen}
        onClose={() => setIsDiagnosticsDrawerOpen(false)}
        loggerState={processLoggerState}
        onRefreshLogs={async () => {
          const logsData = await orchestratorClient.getProcessLoggerState();
          setProcessLoggerState(logsData);
        }}
        onRemediateError={async (logId) => {
          const res = await orchestratorClient.remediateProcessError(logId);
          setProcessLoggerState(res.loggerState);
          await refreshAllState();
        }}
        onRemediateAllErrors={async () => {
          const res = await orchestratorClient.remediateAllProcessErrors();
          setProcessLoggerState(res.loggerState);
          await refreshAllState();
        }}
        onSimulateError={async (faultType) => {
          const updated = await orchestratorClient.simulateProcessError(
            faultType,
          );
          setProcessLoggerState(updated);
        }}
        onClearLogs={async () => {
          const cleared = await orchestratorClient.clearProcessLogs();
          setProcessLoggerState(cleared);
        }}
      />
    </div>
  );
}

export default AutoAppBuilderRenderer;
