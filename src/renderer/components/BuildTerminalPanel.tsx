/**
 * @file src/renderer/components/BuildTerminalPanel.tsx
 * @description Центральная консоль потоков сборки в реальном времени (Variation 7 Console).
 *              Отображает:
 *              - Шаг конвейера (STEP X/Y) и счетчик попыток самоисцеления (HEALER ATTEMPT 1..4)
 *              - Кнопки фильтрации потоков (ALL / STDOUT / STDERR / AI HEALER)
 *              - Живой вывод child_process.spawn на чисто черном полотне (#000000)
 *              - Панель открытия и скачивания готового автономного исполняемого файла
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Download,
  FolderOpen,
  CheckCircle2,
  Wrench,
} from 'lucide-react';
import {
  BuildLogEntry,
  BuildSessionState,
  BuiltArtifactInfo,
} from '../../shared/types.ts';

interface BuildTerminalPanelProps {
  session: BuildSessionState;
  history: BuiltArtifactInfo[];
  compactMode: boolean;
  onRevealOrDownloadArtifact: (artifact: BuiltArtifactInfo) => Promise<void>;
  onClearTerminal?: () => void;
  onOpenProcessDiagnostics?: () => void;
  unresolvedErrorCount?: number;
}

export const BuildTerminalPanel: React.FC<BuildTerminalPanelProps> = ({
  session,
  history,
  compactMode,
  onRevealOrDownloadArtifact,
  onOpenProcessDiagnostics,
  unresolvedErrorCount = 0,
}) => {
  const [streamFilter, setStreamFilter] = useState<
    'all' | 'stdout' | 'stderr' | 'healer'
  >('all');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const filteredLogs: BuildLogEntry[] = session.logs.filter((entry) => {
    if (streamFilter === 'all') return true;
    return entry.stream === streamFilter;
  });

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [session.logs.length]);

  const progressPercent =
    session.status === 'completed'
      ? 100
      : session.totalSteps > 0
        ? Math.min(
            95,
            Math.round((session.currentStepIndex / session.totalSteps) * 100),
          )
        : 0;

  return (
    <div className="h-full min-h-0 bg-black border border-white/10 flex flex-col relative overflow-hidden">
      {/* Верхняя строка статуса консоли */}
      <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-[11px] tracking-[0.15em] uppercase text-white/70 truncate">
            SYSTEM STREAMS · STEP {session.currentStepIndex}/{session.totalSteps}
          </span>
          {session.healAttempt > 0 && (
            <span className="font-mono text-[11px] text-amber-400 flex items-center gap-1 whitespace-nowrap shrink-0">
              <Wrench className="h-3 w-3" />
              <span>
                HEALER {session.healAttempt}/{session.maxHealAttempts}
              </span>
            </span>
          )}
        </div>

        {/* Кнопки фильтрации потоков и перехода в полный журнал всех процессов */}
        <div className="flex items-center gap-1.5">
          {(
            [
              { id: 'all', label: 'ALL' },
              { id: 'stdout', label: 'STDOUT' },
              { id: 'stderr', label: 'STDERR' },
              { id: 'healer', label: 'HEALER' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStreamFilter(tab.id)}
              className={`px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                streamFilter === tab.id
                  ? 'bg-[#5e6ad2] text-white font-bold'
                  : 'bg-white/5 text-white/60 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}

          {onOpenProcessDiagnostics && (
            <button
              type="button"
              onClick={onOpenProcessDiagnostics}
              className={`ml-1.5 flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                unresolvedErrorCount > 0
                  ? 'bg-red-500/20 border-red-500/50 text-red-300 hover:bg-red-500/30 font-bold'
                  : 'bg-white/5 border-white/15 text-white/75 hover:border-[#5e6ad2] hover:text-white'
              }`}
            >
              <Activity className="h-3 w-3" />
              <span>
                {unresolvedErrorCount > 0
                  ? `ВСЕ ПРОЦЕССЫ · ОШИБОК: ${unresolvedErrorCount}`
                  : 'ВСЕ ПРОЦЕССЫ'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Индикатор прогресса шагов */}
      <div className="h-1 w-full bg-white/5 shrink-0 overflow-hidden">
        <div
          className={`h-full transition-transform duration-200 origin-left ${
            session.status === 'failed'
              ? 'bg-red-500'
              : session.status === 'healing'
                ? 'bg-amber-400'
                : session.status === 'completed'
                  ? 'bg-emerald-500'
                  : 'bg-[#5e6ad2]'
          }`}
          style={{
            transform: `scaleX(${Math.max(0.02, progressPercent / 100)})`,
          }}
        />
      </div>

      {/* Подзаголовок активной операции */}
      <div className="px-6 py-2 border-b border-white/5 bg-white/[0.02] flex items-center justify-between gap-2 shrink-0">
        <span className="font-mono text-xs text-white/80 truncate">
          {session.currentStepLabel}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-white/40 whitespace-nowrap shrink-0">
          {progressPercent}%
        </span>
      </div>

      {/* Скроллируемая область логов терминала */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto p-6 font-mono text-xs leading-relaxed select-text"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-white/60">
            <div className="tracking-[0.15em] uppercase text-xs">
              &gt; CHILD_PROCESS ATTACHED
              <br />
              &gt; WAITING FOR PIPELINE EXECUTION...
            </div>
            <p className="mt-3 text-[11px] text-white/40 max-w-md">
              Перетащите архив слева или выберите стек и нажмите «EXECUTE PIPELINE» справа для компиляции в автономный исполняемый файл.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredLogs.map((entry) => {
              const colorClass =
                entry.stream === 'stderr'
                  ? 'text-red-400'
                  : entry.stream === 'healer'
                    ? 'text-amber-300 bg-amber-950/30 px-2 py-1 border border-amber-500/30'
                    : entry.stream === 'system'
                      ? 'text-[#8b95f2]'
                      : 'text-[#f0f0f0]/90';

              return (
                <div
                  key={entry.id}
                  className={`flex items-start gap-3 break-all ${colorClass}`}
                >
                  <span className="text-[10px] text-white/35 tabular-nums shrink-0 select-none">
                    {entry.timestamp}
                  </span>
                  <span className="flex-1">{entry.message}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Панель готового исполняемого артефакта */}
      {session.artifact && (
        <div className="px-6 py-3.5 border-t border-[#5e6ad2]/50 bg-[#1a1a1e] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate font-mono">
                {session.artifact.fileName}
              </p>
              <div className="flex items-center gap-2 text-[11px] text-white/55 font-mono tabular-nums">
                <span>
                  {(session.artifact.sizeBytes / 1024).toFixed(1)} KB
                </span>
                <span aria-hidden="true">·</span>
                <span>output/{session.artifact.fileName}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onRevealOrDownloadArtifact(session.artifact!)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white font-mono text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {typeof window !== 'undefined' && window.electronAPI ? (
              <>
                <FolderOpen className="h-3.5 w-3.5" />
                <span>ПОКАЗАТЬ В ПАПКЕ</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                <span>ОТКРЫТЬ ГОТОВЫЙ ФАЙЛ</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Недавние сборки */}
      {!compactMode && history.length > 1 && (
        <div className="px-6 py-2 border-t border-white/10 bg-black flex items-center justify-between gap-2 shrink-0 overflow-x-auto">
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/45 whitespace-nowrap shrink-0">
            АРТЕФАКТЫ OUTPUT/:
          </span>
          <div className="flex items-center gap-3">
            {history.slice(0, 3).map((item) => (
              <button
                key={item.fileName}
                type="button"
                onClick={() => onRevealOrDownloadArtifact(item)}
                className="font-mono text-[11px] text-[#8b95f2] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                {item.fileName}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
