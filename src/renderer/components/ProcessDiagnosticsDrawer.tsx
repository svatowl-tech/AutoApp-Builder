/**
 * @file src/renderer/components/ProcessDiagnosticsDrawer.tsx
 * @description Выдвижная панель сквозного логирования всех процессов приложения (SystemProcessLogger),
 *              поиска сбоев и автоматического исправления ошибок в 1 клик (Auto-Remediation).
 *              Выполнена в эстетике Variation 7 с соблюдением принципа Production Clean UI:
 *              технические стеки и дампы stderr скрыты в сворачиваемых аккордеонах «Подробнее об ошибке».
 */

import React, { useState, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  ProcessLoggerState,
  ProcessLogSubsystem,
  SystemProcessLogEntry,
} from '../../shared/types.ts';
import { orchestratorClient } from '../bridge.ts';

interface ProcessDiagnosticsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  loggerState: ProcessLoggerState | null;
  onRefreshLogs: () => Promise<void>;
  onRemediateError: (logId: string) => Promise<void>;
  onRemediateAllErrors: () => Promise<void>;
  onSimulateError: (
    faultType: 'build' | 'hub-crash' | 'ai-timeout' | 'cache-lock',
  ) => Promise<void>;
  onClearLogs: () => Promise<void>;
}

const SUBSYSTEM_LABELS: Record<ProcessLogSubsystem | 'all', string> = {
  all: 'ВСЕ ПОДСИСТЕМЫ',
  'child-process': 'ДОЧЕРНИЕ ПРОЦЕССЫ ОС',
  'apps-hub': 'APPS HUB (ЗАПУСК И GITHUB)',
  'pipeline-build': 'КОНВЕЙЕР СБОРКИ',
  'ai-healer': 'ЛОКАЛЬНЫЙ ИИ / HEALER',
  'shared-cache': 'ЕДИНЫЙ КЭШ',
  'archive-security': 'АРХИВЫ И ZIP-SLIP',
  'ipc-http': 'IPC & HTTP API',
};

export const ProcessDiagnosticsDrawer: React.FC<
  ProcessDiagnosticsDrawerProps
> = ({
  isOpen,
  onClose,
  loggerState,
  onRefreshLogs,
  onRemediateError,
  onRemediateAllErrors,
  onSimulateError,
  onClearLogs,
}) => {
  const [selectedSubsystem, setSelectedSubsystem] = useState<
    ProcessLogSubsystem | 'all'
  >('all');
  const [levelFilter, setLevelFilter] = useState<
    'all' | 'errors-only' | 'unresolved-only' | 'warn-only'
  >('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedDetailsIds, setExpandedDetailsIds] = useState<
    Record<string, boolean>
  >({});
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  const entries = loggerState?.entries || [];
  const stats = loggerState?.stats || {
    totalEntries: 0,
    errorCount: 0,
    unresolvedErrorCount: 0,
    resolvedErrorCount: 0,
    warnCount: 0,
    childProcessRunsCount: 0,
  };

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (
        selectedSubsystem !== 'all' &&
        entry.subsystem !== selectedSubsystem
      ) {
        return false;
      }
      if (levelFilter === 'errors-only') {
        if (entry.level !== 'error' && entry.level !== 'critical') {
          return false;
        }
      } else if (levelFilter === 'unresolved-only') {
        if (!entry.remediation || entry.remediation.resolved) {
          return false;
        }
      } else if (levelFilter === 'warn-only') {
        if (entry.level !== 'warn') {
          return false;
        }
      }

      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        const haystack = [
          entry.processName,
          entry.message,
          entry.command || '',
          entry.cwd || '',
          entry.pid ? `pid:${entry.pid} ${entry.pid}` : '',
          entry.remediation?.issueCode || '',
          entry.remediation?.diagnosis || '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      }

      return true;
    });
  }, [entries, selectedSubsystem, levelFilter, searchQuery]);

  if (!isOpen) return null;

  const toggleTechnicalAccordion = (id: string) => {
    setExpandedDetailsIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleRunAction = async (id: string, fn: () => Promise<void>) => {
    setBusyActionId(id);
    try {
      await fn();
    } finally {
      setBusyActionId(null);
    }
  };

  const renderLevelBadge = (entry: SystemProcessLogEntry) => {
    if (entry.remediation?.resolved) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-mono text-[9px] uppercase tracking-wider">
          <CheckCircle2 className="h-2.5 w-2.5" />
          <span>ИСПРАВЛЕНО</span>
        </span>
      );
    }
    if (entry.level === 'error' || entry.level === 'critical') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/20 border border-red-500/50 text-red-300 font-mono text-[9px] uppercase tracking-wider">
          <ShieldAlert className="h-2.5 w-2.5" />
          <span>{entry.level.toUpperCase()}</span>
        </span>
      );
    }
    if (entry.level === 'warn') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono text-[9px] uppercase tracking-wider">
          <AlertTriangle className="h-2.5 w-2.5" />
          <span>WARN</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 border border-white/15 text-white/70 font-mono text-[9px] uppercase tracking-wider">
        <span>INFO</span>
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-[2px]">
      <div className="w-full max-w-[1080px] h-full bg-[#111113] border-l border-white/15 flex flex-col overflow-hidden shadow-2xl">
        {/* Верхняя шапка панели логирования и диагностики */}
        <div className="px-6 py-4 bg-black border-b border-white/10 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-[#5e6ad2]" />
            <div>
              <h2 className="font-display font-extrabold text-base tracking-tight text-white uppercase">
                PROCESS TELEMETRY & ERROR REMEDIATION
              </h2>
              <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-white/55">
                ПОЛНОЕ ЛОГИРОВАНИЕ ВСЕХ ПРОЦЕССОВ ОС, GITHUB-АВТООБНОВЛЕНИЯ, СБОРКИ И ИИ-HEALER
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {stats.unresolvedErrorCount > 0 && (
              <button
                type="button"
                disabled={busyActionId !== null}
                onClick={() =>
                  handleRunAction('remediate-all', onRemediateAllErrors)
                }
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                <Wrench className="h-3.5 w-3.5" />
                <span>
                  {busyActionId === 'remediate-all'
                    ? 'ИСПРАВЛЕНИЕ...'
                    : `ИСПРАВИТЬ ВСЕ ОШИБКИ (${stats.unresolvedErrorCount})`}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => orchestratorClient.exportProcessLogs()}
              className="flex items-center gap-1.5 px-3 py-2 border border-white/15 hover:border-[#5e6ad2] text-white/85 font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#5e6ad2]" />
              <span>СКАЧАТЬ .LOG</span>
            </button>

            <button
              type="button"
              onClick={() => handleRunAction('refresh', onRefreshLogs)}
              className="flex items-center gap-1.5 px-3 py-2 border border-white/15 hover:border-white/40 text-white/80 font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
              title="Обновить журнал процессов"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  busyActionId === 'refresh' ? 'animate-spin' : ''
                }`}
              />
              <span>ОБНОВИТЬ</span>
            </button>

            <button
              type="button"
              onClick={() => handleRunAction('clear', onClearLogs)}
              className="flex items-center gap-1.5 px-3 py-2 border border-white/15 hover:border-red-500/50 hover:text-red-300 text-white/75 font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
              title="Очистить журнал"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>ОЧИСТИТЬ</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 border border-white/15 hover:border-white/40 text-white/80 hover:text-white transition-colors cursor-pointer"
              title="Закрыть панель диагностики"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Сводные метрики процессов и панель тестирования сбоев */}
        <div className="px-6 py-3.5 bg-[#1a1a1e] border-b border-white/10 grid grid-cols-2 md:grid-cols-5 gap-3 shrink-0">
          <div className="p-2.5 bg-black/40 border border-white/10">
            <div className="font-mono text-[9px] tracking-[0.14em] uppercase text-white/50">
              ВСЕГО СОБЫТИЙ
            </div>
            <div className="font-mono tabular-nums text-base font-bold text-white mt-0.5">
              {stats.totalEntries}
            </div>
          </div>

          <div
            onClick={() =>
              setLevelFilter(
                levelFilter === 'unresolved-only' ? 'all' : 'unresolved-only',
              )
            }
            className={`p-2.5 border transition-colors cursor-pointer ${
              stats.unresolvedErrorCount > 0
                ? 'bg-red-950/30 border-red-500/50 hover:bg-red-950/50'
                : 'bg-black/40 border-white/10'
            }`}
          >
            <div className="font-mono text-[9px] tracking-[0.14em] uppercase text-red-300/80">
              ТРЕБУЮТ ИСПРАВЛЕНИЯ
            </div>
            <div className="font-mono tabular-nums text-base font-bold text-red-300 mt-0.5 flex items-center justify-between">
              <span>{stats.unresolvedErrorCount}</span>
              {stats.unresolvedErrorCount > 0 && (
                <span className="text-[9px] underline">ФИЛЬТР</span>
              )}
            </div>
          </div>

          <div className="p-2.5 bg-black/40 border border-white/10">
            <div className="font-mono text-[9px] tracking-[0.14em] uppercase text-emerald-400/80">
              ИСПРАВЛЕНО АВТОМАТИЧЕСКИ
            </div>
            <div className="font-mono tabular-nums text-base font-bold text-emerald-400 mt-0.5">
              {stats.resolvedErrorCount}
            </div>
          </div>

          <div className="p-2.5 bg-black/40 border border-white/10">
            <div className="font-mono text-[9px] tracking-[0.14em] uppercase text-white/50">
              ДОЧЕРНИХ ПРОЦЕССОВ ОС
            </div>
            <div className="font-mono tabular-nums text-base font-bold text-[#5e6ad2] mt-0.5">
              {stats.childProcessRunsCount}
            </div>
          </div>

          <div className="p-2.5 bg-black/40 border border-white/10 flex flex-col justify-between">
            <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-white/55">
              ТЕСТ ДИАГНОСТИКИ СБОЕВ:
            </div>
            <div className="flex items-center gap-1 mt-1">
              <button
                type="button"
                disabled={busyActionId !== null}
                onClick={() =>
                  handleRunAction('sim-build', () => onSimulateError('build'))
                }
                className="flex-1 px-1.5 py-1 bg-white/5 hover:bg-[#5e6ad2] border border-white/15 text-white font-mono text-[9px] uppercase transition-colors cursor-pointer"
                title="Симулировать ошибку сборки пакета для проверки автоисправления"
              >
                +BUILD ERR
              </button>
              <button
                type="button"
                disabled={busyActionId !== null}
                onClick={() =>
                  handleRunAction('sim-hub', () => onSimulateError('hub-crash'))
                }
                className="flex-1 px-1.5 py-1 bg-white/5 hover:bg-[#5e6ad2] border border-white/15 text-white font-mono text-[9px] uppercase transition-colors cursor-pointer"
                title="Симулировать аварийную остановку процесса в Хабе"
              >
                +HUB CRASH
              </button>
              <button
                type="button"
                disabled={busyActionId !== null}
                onClick={() =>
                  handleRunAction('sim-ai', () => onSimulateError('ai-timeout'))
                }
                className="flex-1 px-1.5 py-1 bg-white/5 hover:bg-[#5e6ad2] border border-white/15 text-white font-mono text-[9px] uppercase transition-colors cursor-pointer"
                title="Симулировать недоступность внешнего сервера ИИ"
              >
                +AI ERR
              </button>
            </div>
          </div>
        </div>

        {/* Панель фильтрации по подсистемам, критичности и полнотекстового поиска */}
        <div className="px-6 py-3 bg-[#111113] border-b border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                'all',
                'child-process',
                'apps-hub',
                'pipeline-build',
                'ai-healer',
                'shared-cache',
                'archive-security',
                'ipc-http',
              ] as const
            ).map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => setSelectedSubsystem(sub)}
                className={`px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider border transition-colors cursor-pointer ${
                  selectedSubsystem === sub
                    ? 'bg-[#5e6ad2] border-[#5e6ad2] text-white font-bold'
                    : 'bg-[#1a1a1e] border-white/10 text-white/65 hover:text-white'
                }`}
              >
                {SUBSYSTEM_LABELS[sub]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-[420px]">
            <div className="relative flex-1">
              <Search className="h-3.5 w-3.5 text-white/40 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по PID, команде, процессу или коду ошибки..."
                className="w-full bg-[#1a1a1e] border border-white/15 focus:border-[#5e6ad2] focus:outline-none pl-8 pr-3 py-1.5 text-xs font-mono text-white placeholder:text-white/35"
              />
            </div>

            <select
              value={levelFilter}
              onChange={(e) =>
                setLevelFilter(
                  e.target.value as
                    | 'all'
                    | 'errors-only'
                    | 'unresolved-only'
                    | 'warn-only',
                )
              }
              aria-label="Фильтр уровня событий"
              className="bg-[#1a1a1e] border border-white/15 px-2.5 py-1.5 font-mono text-[10px] uppercase text-white focus:border-[#5e6ad2] focus:outline-none cursor-pointer"
            >
              <option value="all">ВСЕ УРОВНИ</option>
              <option value="unresolved-only">ТРЕБУЮТ ИСПРАВЛЕНИЯ</option>
              <option value="errors-only">ВСЕ ОШИБКИ (ERROR)</option>
              <option value="warn-only">ПРЕДУПРЕЖДЕНИЯ (WARN)</option>
            </select>
          </div>
        </div>

        {/* Основной прокручиваемый список записей всех процессов */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-3">
          {filteredEntries.length === 0 ? (
            <div className="p-10 border border-white/10 bg-[#1a1a1e] text-center space-y-3">
              <Filter className="h-6 w-6 text-[#5e6ad2] mx-auto" />
              <div className="font-display font-bold text-sm uppercase text-white">
                ПО ВЫБРАННЫМ ФИЛЬТРАМ ЗАПИСЕЙ НЕ НАЙДЕНО
              </div>
              <p className="text-xs text-white/60 max-w-md mx-auto">
                Сбросьте фильтр подсистем или поисковый запрос, чтобы отобразить все зарегистрированные процессы оркестратора.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedSubsystem('all');
                  setLevelFilter('all');
                  setSearchQuery('');
                }}
                className="px-4 py-2 bg-[#5e6ad2] text-white font-mono text-[10px] uppercase tracking-wider cursor-pointer"
              >
                СБРОСИТЬ ФИЛЬТРЫ
              </button>
            </div>
          ) : (
            filteredEntries.map((entry) => {
              const isExpanded = Boolean(expandedDetailsIds[entry.id]);
              const hasUnresolvedFix =
                entry.remediation && !entry.remediation.resolved;

              return (
                <div
                  key={entry.id}
                  className={`border transition-colors p-4 ${
                    hasUnresolvedFix
                      ? 'bg-red-950/15 border-red-500/45'
                      : entry.remediation?.resolved
                        ? 'bg-emerald-950/10 border-emerald-500/30'
                        : 'bg-[#1a1a1e] border-white/10'
                  }`}
                >
                  {/* Первая строка: бейдж уровня, подсистема, имя процесса, PID, код возврата, время */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {renderLevelBadge(entry)}
                      <span className="px-2 py-0.5 bg-black/60 border border-white/10 font-mono text-[9px] uppercase tracking-wider text-[#5e6ad2]">
                        {entry.subsystem}
                      </span>
                      <span className="font-mono text-xs font-bold text-white">
                        {entry.processName}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 font-mono tabular-nums text-[10px] text-white/60">
                      {entry.pid !== null && (
                        <span className="px-1.5 py-0.5 bg-black/50 border border-white/10 text-white/80">
                          PID: {entry.pid}
                        </span>
                      )}
                      {entry.exitCode !== null && (
                        <span
                          className={`px-1.5 py-0.5 border ${
                            entry.exitCode === 0
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                              : 'bg-red-500/15 border-red-500/40 text-red-300'
                          }`}
                        >
                          EXIT: {entry.exitCode}
                        </span>
                      )}
                      {entry.durationMs !== null && (
                        <span>{entry.durationMs} МС</span>
                      )}
                      <span>{entry.timestamp}</span>
                    </div>
                  </div>

                  {/* Человекочитаемое описание события процесса */}
                  <div className="text-xs text-white/90 leading-relaxed">
                    {entry.message}
                  </div>

                  {/* Блок автоматической диагностики и 1-клик исправления ошибки */}
                  {entry.remediation && (
                    <div
                      className={`mt-3 p-3 border flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                        entry.remediation.resolved
                          ? 'bg-emerald-950/20 border-emerald-500/35'
                          : 'bg-black/60 border-red-500/40'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                          <Sparkles
                            className={`h-3.5 w-3.5 ${
                              entry.remediation.resolved
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                            }`}
                          />
                          <span className="font-bold text-white">
                            АВТОДИАГНОСТИКА [{entry.remediation.issueCode}]:
                          </span>
                          <span className="text-white/80">
                            {entry.remediation.diagnosis}
                          </span>
                        </div>

                        {entry.remediation.resolved &&
                          entry.remediation.resolutionSummary && (
                            <div className="text-xs text-emerald-300 font-mono">
                              ✓ {entry.remediation.resolutionSummary}
                            </div>
                          )}
                      </div>

                      {!entry.remediation.resolved && (
                        <button
                          type="button"
                          disabled={busyActionId !== null}
                          onClick={() =>
                            handleRunAction(entry.id, () =>
                              onRemediateError(entry.id),
                            )
                          }
                          className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                        >
                          <Zap className="h-3.5 w-3.5" />
                          <span>
                            {busyActionId === entry.id
                              ? 'ВЫПОЛНЕНИЕ ИСПРАВЛЕНИЯ...'
                              : entry.remediation.suggestedActionLabel}
                          </span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Свернутый аккордеон «Подробнее об ошибке / Технический контекст» (Production Clean UI) */}
                  {(entry.command ||
                    entry.cwd ||
                    entry.technicalDetails ||
                    entry.remediation?.fixCommandPreview) && (
                    <div className="mt-2.5 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => toggleTechnicalAccordion(entry.id)}
                        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-white/55 hover:text-white transition-colors cursor-pointer"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-[#5e6ad2]" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-[#5e6ad2]" />
                        )}
                        <Terminal className="h-3 w-3" />
                        <span>
                          {isExpanded
                            ? 'СКРЫТЬ ТЕХНИЧЕСКИЕ ДЕТАЛИ И СТЕК'
                            : 'ПОДРОБНЕЕ ОБ ОШИБКЕ / ЛОГИ И КОМАНДА ПРОЦЕССА'}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="mt-2 p-3 bg-black border border-white/10 font-mono text-[11px] text-white/75 space-y-1.5 overflow-x-auto">
                          {entry.command && (
                            <div>
                              <span className="text-white/45">КОМАНДА / ВЫЗОВ: </span>
                              <span className="text-[#5e6ad2]">
                                {entry.command}
                              </span>
                            </div>
                          )}
                          {entry.cwd && (
                            <div>
                              <span className="text-white/45">РАБОЧАЯ ПАПКА (CWD): </span>
                              <span>{entry.cwd}</span>
                            </div>
                          )}
                          {entry.remediation?.fixCommandPreview && (
                            <div>
                              <span className="text-white/45">ОПЕРАЦИЯ АВТОИСПРАВЛЕНИЯ: </span>
                              <span className="text-emerald-300">
                                {entry.remediation.fixCommandPreview}
                              </span>
                            </div>
                          )}
                          {entry.technicalDetails && (
                            <pre className="pt-1.5 mt-1.5 border-t border-white/10 text-[10px] text-red-200/85 whitespace-pre-wrap break-all leading-relaxed">
                              {entry.technicalDetails}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Нижняя строка состояния дискового логгера */}
        <div className="px-6 py-3 bg-black border-t border-white/10 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-white/55 shrink-0">
          <span>
            ФАЙЛ ЖУРНАЛА: {loggerState?.logFilePath || 'userData/logs/autoapp-system.log'}
          </span>
          <span>
            JSONL-ТЕЛЕМЕТРИЯ: {loggerState?.jsonlFilePath || 'userData/logs/process-journal.jsonl'}
          </span>
        </div>
      </div>
    </div>
  );
};
