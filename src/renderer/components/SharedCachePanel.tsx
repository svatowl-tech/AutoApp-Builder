/**
 * @file src/renderer/components/SharedCachePanel.tsx
 * @description Панель мониторинга и управления Единым общим кэшем (Shared Centralized Cache)
 *              в индустриальной палитре Variation 7 (#111113 / #1a1a1e / #5e6ad2).
 */

import React, { useState } from 'react';
import {
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { SharedCacheStats } from '../../shared/types.ts';

interface SharedCachePanelProps {
  stats: SharedCacheStats | null;
  onPurgeCache: () => Promise<void>;
  onRefreshStats: () => Promise<void>;
  onUpdateThresholds: (
    maxAllowedGb: number,
    minFreeDiskGb: number,
  ) => Promise<void>;
}

function formatBytesToHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export const SharedCachePanel: React.FC<SharedCachePanelProps> = ({
  stats,
  onPurgeCache,
  onRefreshStats,
  onUpdateThresholds,
}) => {
  const [maxGbInput, setMaxGbInput] = useState<number>(
    stats?.maxAllowedGb ?? 10,
  );
  const [minFreeGbInput, setMinFreeGbInput] = useState<number>(
    stats?.minFreeDiskGb ?? 5,
  );
  const [purging, setPurging] = useState(false);

  if (!stats) {
    return (
      <div className="p-6 bg-[#1a1a1e] border border-white/10 font-mono text-xs text-white/60">
        SCANNING SHARED CACHE DIRECTORY (userData/shared-cache/)...
      </div>
    );
  }

  const handlePurge = async () => {
    setPurging(true);
    try {
      await onPurgeCache();
    } finally {
      setPurging(false);
    }
  };

  const rows = [
    {
      name: 'npm-cache',
      envVar: 'npm_config_cache / --cache',
      pathSuffix: 'shared-cache/npm-cache',
      bytes: stats.segments.npmCacheBytes,
    },
    {
      name: 'pip-cache',
      envVar: 'PIP_CACHE_DIR',
      pathSuffix: 'shared-cache/pip-cache',
      bytes: stats.segments.pipCacheBytes,
    },
    {
      name: 'gradle-cache',
      envVar: 'GRADLE_USER_HOME',
      pathSuffix: 'shared-cache/gradle-cache',
      bytes: stats.segments.gradleCacheBytes,
    },
    {
      name: 'cargo-cache',
      envVar: 'CARGO_HOME',
      pathSuffix: 'shared-cache/cargo-cache',
      bytes: stats.segments.cargoCacheBytes,
    },
    {
      name: 'workspaces (LRU)',
      envVar: 'Unpacked Build Sandboxes',
      pathSuffix: `shared-cache/workspaces (${stats.cachedWorkspacesCount})`,
      bytes: stats.segments.tempWorkspacesBytes,
    },
  ];

  const displayGb = (stats.totalCacheBytes / (1024 * 1024 * 1024)).toFixed(2);

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-[#1a1a1e] border border-white/10 rounded-[2px] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="font-display font-extrabold text-base tracking-tight text-[#f0f0f0] uppercase">
              SHARED CENTRALIZED CACHE
            </h2>
            <p className="text-xs text-white/55 font-mono truncate mt-1">
              {stats.rootCachePath}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onRefreshStats}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-white/15 text-xs font-mono uppercase tracking-wider text-white/80 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>RESCAN</span>
            </button>

            <button
              type="button"
              disabled={purging}
              onClick={handlePurge}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold font-mono tabular-nums uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>
                {purging
                  ? 'PURGING...'
                  : `ОЧИСТИТЬ КЭШ (${displayGb} GB)`}
              </span>
            </button>
          </div>
        </div>

        {/* Таблица сегментов единого кэша */}
        <div className="overflow-x-auto border border-white/10 bg-black/30">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-black/60 font-mono text-[10px] tracking-[0.14em] uppercase text-white/55">
                <th className="py-3 px-4">SEGMENT</th>
                <th className="py-3 px-4">ENVIRONMENT OVERRIDE</th>
                <th className="py-3 px-4">SUBPATH</th>
                <th className="py-3 px-4 text-right">SIZE ON DISK</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 font-mono tabular-nums">
              {rows.map((r) => (
                <tr
                  key={r.name}
                  className="hover:bg-white/[0.03] transition-colors"
                >
                  <td className="py-3 px-4 font-bold text-white">
                    {r.name}
                  </td>
                  <td className="py-3 px-4 text-[#8b95f2]">
                    {r.envVar}
                  </td>
                  <td className="py-3 px-4 text-white/55">
                    {r.pathSuffix}
                  </td>
                  <td className="py-3 px-4 text-right text-white">
                    {formatBytesToHuman(r.bytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Настройка порогов автоматической LRU-очистки */}
        <div className="mt-5 pt-5 border-t border-white/10 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block font-mono text-[10px] tracking-[0.14em] uppercase text-white/60 mb-1.5">
              MAX CACHE LIMIT (GB, DEFAULT 10 GB)
            </label>
            <input
              type="number"
              min={1}
              max={250}
              value={maxGbInput}
              onChange={(e) => setMaxGbInput(Number(e.target.value))}
              className="w-full bg-black/40 border border-white/10 px-3 py-2 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-[#5e6ad2]"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] tracking-[0.14em] uppercase text-white/60 mb-1.5">
              MIN FREE SYSTEM DISK (GB, DEFAULT 5 GB)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={minFreeGbInput}
              onChange={(e) => setMinFreeGbInput(Number(e.target.value))}
              className="w-full bg-black/40 border border-white/10 px-3 py-2 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-[#5e6ad2]"
            />
          </div>

          <button
            type="button"
            onClick={() => onUpdateThresholds(maxGbInput, minFreeGbInput)}
            className="px-4 py-2.5 bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white font-mono text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            APPLY THRESHOLDS
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-white/50">
          <span>
            SYSTEM DISK FREE: {stats.freeDiskGb.toFixed(2)} GB (MIN REQUIRED: {stats.minFreeDiskGb} GB)
          </span>
          <span>
            GGUF MODELS STORAGE: {formatBytesToHuman(stats.segments.modelsBytes)}
          </span>
        </div>
      </div>
    </div>
  );
};
