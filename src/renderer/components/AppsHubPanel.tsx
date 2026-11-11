/**
 * @file src/renderer/components/AppsHubPanel.tsx
 * @description Главный экран Хаба собранных приложений (Apps Hub) и управления жизненным циклом
 *              проектов в дизайне Variation 7 (трехколоночная сетка 350px | 1fr | 350px и компактный трей 440x650):
 *              - Запуск и остановка собранных приложений прямо из интерфейса с мониторингом PID и аптайма
 *              - Ручная и фоновая проверка коммитов/релизов GitHub с автоматической пересборкой
 *              - Безопасный откат (Rollback) к предыдущей сохраненной рабочей версии в один клик
 *              - Просмотр живых логов выполнения (stdout/stderr), открытие бинарника и удаление из Хаба
 */

import React, { useState, useEffect } from 'react';
import {
  Activity,
  Play,
  Square,
  RefreshCw,
  RotateCcw,
  Download,
  FolderOpen,
  Trash2,
  Plus,
  GitCommit,
  ArrowUpCircle,
  CheckCircle2,
  Monitor,
  Smartphone,
} from 'lucide-react';
import {
  BuiltArtifactInfo,
  HubAutoUpdateSettings,
  ManagedHubApp,
} from '../../shared/types.ts';

interface AppsHubPanelProps {
  apps: ManagedHubApp[];
  settings: HubAutoUpdateSettings;
  compactMode: boolean;
  onLaunchApp: (appId: string) => Promise<void>;
  onStopApp: (appId: string) => Promise<void>;
  onCheckUpdates: (params?: {
    appId?: string;
    simulateNewUpstreamCommit?: boolean;
  }) => Promise<void>;
  onUpdateAndRebuildApp: (appId: string) => Promise<void>;
  onRollbackApp: (appId: string) => Promise<void>;
  onToggleAppAutoUpdate: (appId: string, enabled: boolean) => Promise<void>;
  onUpdateSettings: (partial: Partial<HubAutoUpdateSettings>) => Promise<void>;
  onDeleteApp: (appId: string) => Promise<void>;
  onRevealOrDownloadArtifact: (artifact: BuiltArtifactInfo) => Promise<void>;
  onNavigateToPipeline: () => void;
  onOpenProcessDiagnostics?: () => void;
  unresolvedErrorCount?: number;
}

function formatUptime(startedAtIso: string | null, nowMs: number): string {
  if (!startedAtIso) return '00:00:00';
  const diffSec = Math.max(
    0,
    Math.floor((nowMs - new Date(startedAtIso).getTime()) / 1000),
  );
  const hrs = String(Math.floor(diffSec / 3600)).padStart(2, '0');
  const mins = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
  const secs = String(diffSec % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

export const AppsHubPanel: React.FC<AppsHubPanelProps> = ({
  apps,
  settings,
  compactMode,
  onLaunchApp,
  onStopApp,
  onCheckUpdates,
  onUpdateAndRebuildApp,
  onRollbackApp,
  onToggleAppAutoUpdate,
  onUpdateSettings,
  onDeleteApp,
  onRevealOrDownloadArtifact,
  onNavigateToPipeline,
  onOpenProcessDiagnostics,
  unresolvedErrorCount = 0,
}) => {
  const [selectedAppId, setSelectedAppId] = useState<string>(
    apps[0]?.id || '',
  );
  const [filterMode, setFilterMode] = useState<'all' | 'running' | 'updates'>(
    'all',
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // Живой таймер для обновления счетчика аптайма запущенных процессов каждую секунду
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (apps.length > 0 && !apps.some((a) => a.id === selectedAppId)) {
      setSelectedAppId(apps[0].id);
    }
  }, [apps, selectedAppId]);

  const filteredApps = apps.filter((app) => {
    if (filterMode === 'running') return app.runStatus === 'running';
    if (filterMode === 'updates') return app.updateStatus === 'update-available';
    return true;
  });

  const selectedApp =
    apps.find((a) => a.id === selectedAppId) || filteredApps[0] || null;

  const runningCount = apps.filter((a) => a.runStatus === 'running').length;
  const updatesCount = apps.filter(
    (a) => a.updateStatus === 'update-available',
  ).length;

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setBusyAction(key);
    try {
      await fn();
    } finally {
      setBusyAction(null);
    }
  };

  // Левая колонка: Список собранных приложений и фильтры
  const renderAppsListPane = () => (
    <div
      className={`bg-[#1a1a1e] border border-white/10 rounded-[2px] flex flex-col min-h-0 ${
        compactMode ? 'p-3.5 gap-3' : 'p-6 gap-4 h-full'
      }`}
    >
      <div className="flex items-center justify-between gap-2 shrink-0">
        <h2 className="font-display font-extrabold text-base tracking-tight text-[#f0f0f0] uppercase">
          APPS HUB ({apps.length})
        </h2>
        <button
          type="button"
          onClick={onNavigateToPipeline}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="h-3 w-3" />
          <span>NEW BUILD</span>
        </button>
      </div>

      {/* Сегментированный фильтр приложений */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-black/40 border border-white/10 shrink-0">
        {(
          [
            { id: 'all', label: `ALL (${apps.length})` },
            { id: 'running', label: `ACTIVE (${runningCount})` },
            { id: 'updates', label: `UPDATES (${updatesCount})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilterMode(tab.id)}
            className={`py-1.5 px-2 font-mono text-[10px] tracking-wider uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              filterMode === tab.id
                ? 'bg-[#5e6ad2] text-white font-bold'
                : 'text-white/60 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Список карточек собранных приложений */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 pr-0.5">
        {filteredApps.length === 0 ? (
          <div className="p-5 border border-dashed border-white/15 text-center my-auto">
            <p className="font-mono text-xs text-white/60 uppercase">
              Нет проектов по выбранному фильтру
            </p>
            <button
              type="button"
              onClick={() => {
                if (filterMode !== 'all') {
                  setFilterMode('all');
                } else {
                  onNavigateToPipeline();
                }
              }}
              className="mt-3 px-4 py-2 bg-[#5e6ad2] text-white font-mono text-[10px] font-bold uppercase tracking-wider cursor-pointer"
            >
              {filterMode !== 'all' ? 'ПОКАЗАТЬ ВСЕ' : 'СОБРАТЬ ПЕРВЫЙ ПРОЕКТ'}
            </button>
          </div>
        ) : (
          filteredApps.map((item) => {
            const isSelected = selectedApp?.id === item.id;
            const isRunning = item.runStatus === 'running';
            const hasUpdate = item.updateStatus === 'update-available';

            return (
              <div
                key={item.id}
                onClick={() => setSelectedAppId(item.id)}
                className={`p-3.5 border transition-colors cursor-pointer flex flex-col gap-2 ${
                  isSelected
                    ? 'border-[#5e6ad2] bg-[#5e6ad2]/15'
                    : 'border-white/10 bg-black/25 hover:border-white/25'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {item.currentArtifact.targetFormat === 'android-apk' ? (
                      <Smartphone className="h-3.5 w-3.5 text-[#8b95f2] shrink-0" />
                    ) : (
                      <Monitor className="h-3.5 w-3.5 text-[#8b95f2] shrink-0" />
                    )}
                    <span className="text-xs font-bold text-white truncate">
                      {item.name}
                    </span>
                  </div>

                  {/* Текстовый индикатор состояния процесса или наличия обновления */}
                  <span
                    className={`font-mono text-[10px] uppercase tracking-wider whitespace-nowrap shrink-0 ${
                      isRunning
                        ? 'text-emerald-400 font-bold'
                        : hasUpdate
                          ? 'text-amber-400 font-bold'
                          : 'text-white/45'
                    }`}
                  >
                    {isRunning
                      ? `PID ${item.pid}`
                      : hasUpdate
                        ? 'UPDATE READY'
                        : 'READY'}
                  </span>
                </div>

                {/* Строгие метаданные без пилюль с разделителями · */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums text-white/55">
                  <span>{item.displayName}</span>
                  <span aria-hidden="true">·</span>
                  <span>SHA {item.installedCommitSha}</span>
                  {hasUpdate && (
                    <>
                      <span aria-hidden="true">→</span>
                      <span className="text-amber-300">
                        {item.latestRemoteCommitSha}
                      </span>
                    </>
                  )}
                </div>

                {/* Быстрые кнопки прямо на карточке */}
                <div
                  className="pt-1 flex items-center justify-between gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {!isRunning ? (
                    <button
                      type="button"
                      disabled={busyAction === `launch-${item.id}`}
                      onClick={() =>
                        runAction(`launch-${item.id}`, () =>
                          onLaunchApp(item.id),
                        )
                      }
                      className="flex items-center gap-1.5 px-3 py-1 bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      <span>ЗАПУСТИТЬ</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyAction === `stop-${item.id}`}
                      onClick={() =>
                        runAction(`stop-${item.id}`, () => onStopApp(item.id))
                      }
                      className="flex items-center gap-1.5 px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Square className="h-3 w-3 fill-current" />
                      <span>ОСТАНОВИТЬ</span>
                    </button>
                  )}

                  {hasUpdate && (
                    <button
                      type="button"
                      disabled={busyAction === `update-${item.id}`}
                      onClick={() =>
                        runAction(`update-${item.id}`, () =>
                          onUpdateAndRebuildApp(item.id),
                        )
                      }
                      className="flex items-center gap-1 px-2.5 py-1 border border-amber-400/60 text-amber-300 hover:bg-amber-400/15 font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <ArrowUpCircle className="h-3 w-3" />
                      <span>ОБНОВИТЬ</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  // Центральная колонка: Живая консоль процесса и мониторинг обновлений GitHub
  const renderRuntimeConsolePane = () => {
    if (!selectedApp) {
      return (
        <div className="h-full min-h-0 bg-black border border-white/10 flex items-center justify-center p-6 font-mono text-xs text-white/50">
          ВЫБЕРИТЕ ПРИЛОЖЕНИЕ В ХАБЕ ИЛИ СОБЕРИТЕ НОВЫЙ ПРОЕКТ
        </div>
      );
    }

    const isRunning = selectedApp.runStatus === 'running';
    const uptimeStr = formatUptime(selectedApp.startedAt, nowMs);

    return (
      <div className="h-full min-h-0 bg-black border border-white/10 flex flex-col relative overflow-hidden">
        {/* Верхняя шапка консоли с кнопками проверки GitHub */}
        <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-[11px] tracking-[0.14em] uppercase text-white/80 truncate">
              APP RUNTIME · {selectedApp.name}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-white/45">
              · SHA {selectedApp.installedCommitSha}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busyAction === 'check-all'}
              onClick={() =>
                runAction('check-all', () =>
                  onCheckUpdates({ simulateNewUpstreamCommit: false }),
                )
              }
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/15 text-white font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3 w-3 ${
                  busyAction === 'check-all' ? 'animate-spin' : ''
                }`}
              />
              <span>ПРОВЕРИТЬ GITHUB</span>
            </button>

            <button
              type="button"
              disabled={busyAction === 'sim-commit'}
              onClick={() =>
                runAction('sim-commit', () =>
                  onCheckUpdates({
                    appId: selectedApp.id,
                    simulateNewUpstreamCommit: true,
                  }),
                )
              }
              title="Симулировать выход нового коммита в GitHub для мгновенной проверки автообновления и отката"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#5e6ad2]/20 hover:bg-[#5e6ad2]/35 border border-[#5e6ad2]/60 text-[#9ba5ff] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <GitCommit className="h-3 w-3" />
              <span>СИМУЛИРОВАТЬ КОММИТ</span>
            </button>

            {onOpenProcessDiagnostics && (
              <button
                type="button"
                onClick={onOpenProcessDiagnostics}
                title="Открыть сквозной журнал всех процессов и автоисправление ошибок"
                className={`flex items-center gap-1.5 px-3 py-1.5 border font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  unresolvedErrorCount > 0
                    ? 'bg-red-500/20 border-red-500/50 text-red-300 hover:bg-red-500/30 font-bold'
                    : 'bg-white/5 hover:bg-white/10 border-white/15 text-white'
                }`}
              >
                <Activity className="h-3 w-3" />
                <span>
                  {unresolvedErrorCount > 0
                    ? `ЖУРНАЛ ПРОЦЕССОВ (${unresolvedErrorCount} ERR)`
                    : 'ЖУРНАЛ ПРОЦЕССОВ'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Строка телеметрии процесса (PID, Аптайм, Количество запусков, Бинарник) */}
        <div className="px-6 py-2.5 border-b border-white/10 bg-white/[0.02] flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] tabular-nums text-white/65 shrink-0">
          <div className="flex items-center gap-2">
            <span>
              STATUS:{' '}
              <strong
                className={
                  isRunning ? 'text-emerald-400' : 'text-white/70'
                }
              >
                {isRunning ? 'RUNNING' : 'STOPPED'}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>PID: {selectedApp.pid ?? '—'}</span>
            <span aria-hidden="true">·</span>
            <span>UPTIME: {uptimeStr}</span>
            <span aria-hidden="true">·</span>
            <span>LAUNCHES: {selectedApp.launchCount}</span>
          </div>

          <span className="text-white/45 truncate">
            {selectedApp.currentArtifact.fileName} (
            {(selectedApp.currentArtifact.sizeBytes / 1024).toFixed(1)} KB)
          </span>
        </div>

        {/* Скроллируемый поток stdout / stderr / lifecycle запущенного приложения */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 font-mono text-xs leading-relaxed select-text">
          {selectedApp.runtimeLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-white/50">
              <p className="uppercase tracking-widest text-xs">
                &gt; PROCESS IDLE · NO ACTIVE STREAM
              </p>
              <p className="mt-2 text-[11px] text-white/35">
                Нажмите «LAUNCH APPLICATION» для запуска исполняемого файла и подключения потоков stdout/stderr.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {selectedApp.runtimeLogs.map((log) => {
                const color =
                  log.stream === 'stderr'
                    ? 'text-red-400'
                    : log.stream === 'lifecycle'
                      ? 'text-[#8b95f2]'
                      : 'text-emerald-300';
                return (
                  <div
                    key={log.id}
                    className={`flex items-start gap-3 break-all ${color}`}
                  >
                    <span className="text-[10px] text-white/35 tabular-nums shrink-0 select-none">
                      {log.timestamp}
                    </span>
                    <span className="flex-1">{log.message}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Нижняя полоса быстрого доступа к бинарному файлу */}
        <div className="px-6 py-3 border-t border-white/10 bg-[#1a1a1e] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 font-mono text-[11px] text-white/60 truncate">
            SOURCE: {selectedApp.sourceOrigin} ({selectedApp.branch})
          </div>
          <button
            type="button"
            onClick={() =>
              onRevealOrDownloadArtifact(selectedApp.currentArtifact)
            }
            className="flex items-center gap-1.5 px-3.5 py-1.5 border border-white/15 hover:border-[#5e6ad2] text-white font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {typeof window !== 'undefined' && window.electronAPI ? (
              <>
                <FolderOpen className="h-3.5 w-3.5 text-[#5e6ad2]" />
                <span>ОТКРЫТЬ ПАПКУ БИНАРНИКА</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5 text-[#5e6ad2]" />
                <span>СКАЧАТЬ БИНАРНИК</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  };

  // Правая колонка: Управление запуском, GitHub автообновлением, откатом (Rollback) и глобальным таймером
  const renderManagementPane = () => {
    if (!selectedApp) return null;
    const isRunning = selectedApp.runStatus === 'running';
    const hasUpdate = selectedApp.updateStatus === 'update-available';

    return (
      <div
        className={`bg-[#1a1a1e] border border-white/10 rounded-[2px] flex flex-col min-h-0 ${
          compactMode ? 'p-3.5 gap-3' : 'p-6 gap-4 h-full overflow-y-auto'
        }`}
      >
        <h2 className="font-display font-extrabold text-base tracking-tight text-[#f0f0f0] uppercase">
          LIFECYCLE & SYNC
        </h2>

        {/* Главная кнопка запуска / остановки выбранного приложения */}
        {!isRunning ? (
          <button
            type="button"
            disabled={busyAction === `launch-${selectedApp.id}`}
            onClick={() =>
              runAction(`launch-${selectedApp.id}`, () =>
                onLaunchApp(selectedApp.id),
              )
            }
            className="w-full py-3.5 px-4 bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white font-mono text-xs font-bold uppercase tracking-[0.12em] flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="h-4 w-4 fill-current" />
            <span>LAUNCH APPLICATION</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={busyAction === `stop-${selectedApp.id}`}
            onClick={() =>
              runAction(`stop-${selectedApp.id}`, () =>
                onStopApp(selectedApp.id),
              )
            }
            className="w-full py-3.5 px-4 bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-bold uppercase tracking-[0.12em] flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Square className="h-4 w-4 fill-current" />
            <span>STOP PROCESS (PID {selectedApp.pid})</span>
          </button>
        )}

        {/* Карточка контроля версий GitHub и автообновления */}
        <div className="p-4 border border-white/10 rounded-[4px] bg-black/25 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-white/60">
              GITHUB VERSION TRACKER
            </span>
            {hasUpdate ? (
              <span className="font-mono text-[10px] text-amber-400 font-bold uppercase">
                NEW COMMIT
              </span>
            ) : (
              <span className="font-mono text-[10px] text-emerald-400 uppercase flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                <span>UP TO DATE</span>
              </span>
            )}
          </div>

          <div className="text-xs font-mono tabular-nums space-y-1 text-white/80">
            <div className="flex items-center justify-between">
              <span className="text-white/50">INSTALLED SHA:</span>
              <span>{selectedApp.installedCommitSha}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/50">REMOTE SHA:</span>
              <span className={hasUpdate ? 'text-amber-300 font-bold' : ''}>
                {selectedApp.latestRemoteCommitSha}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-white/55 font-mono line-clamp-2">
            &ldquo;{selectedApp.latestRemoteCommitMessage}&rdquo;
          </p>

          {/* Переключатель автоматического обновления для данного проекта */}
          <label className="pt-1 flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selectedApp.autoUpdateEnabled}
              onChange={(e) =>
                onToggleAppAutoUpdate(selectedApp.id, e.target.checked)
              }
              className="h-4 w-4 accent-[#5e6ad2]"
            />
            <span className="font-mono text-[10px] tracking-wider uppercase text-white/85">
              АВТООБНОВЛЕНИЕ ПРИ НОВОМ КОММИТЕ
            </span>
          </label>

          {/* Кнопка принудительного обновления и пересборки из GitHub */}
          <button
            type="button"
            disabled={busyAction === `rebuild-${selectedApp.id}`}
            onClick={() =>
              runAction(`rebuild-${selectedApp.id}`, () =>
                onUpdateAndRebuildApp(selectedApp.id),
              )
            }
            className={`mt-1 w-full py-2.5 px-3 font-mono text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              hasUpdate
                ? 'bg-amber-500 hover:bg-amber-400 text-black'
                : 'border border-white/15 hover:border-[#5e6ad2] text-white'
            }`}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                busyAction === `rebuild-${selectedApp.id}` ? 'animate-spin' : ''
              }`}
            />
            <span>
              {busyAction === `rebuild-${selectedApp.id}`
                ? 'ПЕРЕСБОРКА ПРОЕКТА...'
                : hasUpdate
                  ? `ОБНОВИТЬ ДО ${selectedApp.latestRemoteCommitSha}`
                  : 'ПЕРЕСОБРАТЬ ИЗ GITHUB'}
            </span>
          </button>
        </div>

        {/* Карточка мгновенного отката к предыдущей рабочей версии (Rollback) */}
        <div className="p-4 border border-white/10 rounded-[4px] bg-black/25 flex flex-col gap-2">
          <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-white/60">
            BACKUP & ROLLBACK SLOT
          </div>
          {selectedApp.previousVersion ? (
            <>
              <div className="text-[11px] font-mono tabular-nums text-white/75">
                Доступна резервная копия:{' '}
                <strong className="text-white">
                  SHA {selectedApp.previousVersion.commitSha}
                </strong>
              </div>
              <p className="text-[11px] text-white/50 truncate">
                {selectedApp.previousVersion.commitMessage}
              </p>
              <button
                type="button"
                disabled={busyAction === `rollback-${selectedApp.id}`}
                onClick={() =>
                  runAction(`rollback-${selectedApp.id}`, () =>
                    onRollbackApp(selectedApp.id),
                  )
                }
                className="mt-1 w-full py-2 px-3 border border-white/20 hover:border-amber-400 hover:text-amber-300 text-white font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>
                  ОТКАТИТЬ К SHA {selectedApp.previousVersion.commitSha}
                </span>
              </button>
            </>
          ) : (
            <p className="text-[11px] text-white/45 leading-relaxed">
              Резервная копия создается автоматически перед каждым обновлением проекта из GitHub.
            </p>
          )}
        </div>

        {/* Глобальные настройки фонового опроса GitHub */}
        <div className="p-4 border border-white/10 rounded-[4px] bg-black/20 flex flex-col gap-2.5">
          <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-white/60">
            BACKGROUND GITHUB POLLER
          </div>
          <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
            <span className="text-xs text-white/80">
              Фоновый опрос репозиториев
            </span>
            <input
              type="checkbox"
              checked={settings.backgroundPollingEnabled}
              onChange={(e) =>
                onUpdateSettings({
                  backgroundPollingEnabled: e.target.checked,
                })
              }
              className="h-4 w-4 accent-[#5e6ad2]"
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-white/60">Интервал опроса (мин):</span>
            <input
              type="number"
              min={1}
              max={120}
              value={settings.pollingIntervalMinutes}
              onChange={(e) =>
                onUpdateSettings({
                  pollingIntervalMinutes: Number(e.target.value),
                })
              }
              className="w-20 bg-black/40 border border-white/15 px-2 py-1 text-right font-mono text-xs tabular-nums text-white"
            />
          </div>
        </div>

        {/* Удаление приложения из Хаба (с инлайн-подтверждением без модальных окон) */}
        <div className="mt-auto pt-2">
          {confirmDeleteId === selectedApp.id ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await onDeleteApp(selectedApp.id);
                  setConfirmDeleteId(null);
                }}
                className="flex-1 py-2.5 px-3 bg-red-600 hover:bg-red-500 text-white font-mono text-[10px] font-bold uppercase tracking-wider cursor-pointer whitespace-nowrap shrink-0"
              >
                ПОДТВЕРДИТЬ УДАЛЕНИЕ
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="py-2.5 px-3 border border-white/15 text-white/70 hover:text-white font-mono text-[10px] uppercase cursor-pointer whitespace-nowrap shrink-0"
              >
                ОТМЕНА
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDeleteId(selectedApp.id)}
              className="w-full py-2.5 px-3 border border-white/10 hover:border-red-500/50 text-white/55 hover:text-red-400 font-mono text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>УДАЛИТЬ ПРОЕКТ ИЗ ХАБА</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  if (compactMode) {
    return (
      <div className="flex flex-col gap-3">
        {renderAppsListPane()}
        <div className="min-h-[240px]">{renderRuntimeConsolePane()}</div>
        {renderManagementPane()}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 grid grid-cols-1 xl:grid-cols-[350px_1fr_350px] gap-5">
      {renderAppsListPane()}
      {renderRuntimeConsolePane()}
      {renderManagementPane()}
    </div>
  );
};
