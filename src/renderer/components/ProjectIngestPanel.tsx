/**
 * @file src/renderer/components/ProjectIngestPanel.tsx
 * @description Компоненты панелей подачи проекта (INPUT SOURCES) и конфигурации сборки (CONFIG)
 *              в соответствии с архитектурой и дизайн-системой Variation 7:
 *              - Пунктирная зона Drag & Drop (`border-dotted border-[#5e6ad2]`) для ZIP / TAR.GZ архивов
 *              - Карточка клонирования GitHub-репозитория с моноширинным вводом и кнопкой INITIALIZE CLONE
 *              - Быстрые пресеты стеков (REACT VITE, PYTHON, RUST, GO)
 *              - Панель CONFIG с переключателем платформы (OS NATIVE BINARY / ANDROID APK),
 *                переключателем AI ERROR HEALING ENABLED и главной кнопкой EXECUTE PIPELINE.
 */

import React, { useState, useRef } from 'react';
import {
  Upload,
  Play,
  Square,
  Monitor,
  Smartphone,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import {
  BuildSessionState,
  BuildTargetFormat,
  SharedCacheStats,
} from '../../shared/types.ts';

interface ProjectIngestPanelProps {
  session: BuildSessionState;
  compactMode: boolean;
  /** Режим рендеринга для 3-колоночной сетки Variation 7: 'inputs' (левая), 'config' (правая) или 'both' (трей 440x650) */
  paneMode?: 'inputs' | 'config' | 'both';
  targetFormat?: BuildTargetFormat;
  onTargetFormatChange?: (format: BuildTargetFormat) => void;
  simulateHealDemo?: boolean;
  onSimulateHealDemoChange?: (enabled: boolean) => void;
  cacheStats?: SharedCacheStats | null;
  onPurgeCache?: () => Promise<void>;
  onIngestArchive: (fileName: string, base64Data: string) => Promise<void>;
  onIngestGitHub: (
    repoUrl: string,
    stackHint?: 'react' | 'python' | 'rust' | 'go',
  ) => Promise<void>;
  onStartBuild: (
    targetFormat: BuildTargetFormat,
    simulateHealDemo: boolean,
  ) => Promise<void>;
  onCancelBuild: () => Promise<void>;
}

const SAMPLE_REPOS: Array<{
  label: string;
  url: string;
  stack: 'react' | 'python' | 'rust' | 'go';
}> = [
  {
    label: 'REACT VITE',
    url: 'https://github.com/autoapp-samples/vite-react-dashboard',
    stack: 'react',
  },
  {
    label: 'PYTHON',
    url: 'https://github.com/autoapp-samples/python-desktop-tool',
    stack: 'python',
  },
  {
    label: 'RUST',
    url: 'https://github.com/autoapp-samples/rust-native-utility',
    stack: 'rust',
  },
  {
    label: 'GO BIN',
    url: 'https://github.com/autoapp-samples/go-fast-binary',
    stack: 'go',
  },
];

export const ProjectIngestPanel: React.FC<ProjectIngestPanelProps> = ({
  session,
  compactMode,
  paneMode = 'both',
  targetFormat: controlledFormat,
  onTargetFormatChange,
  simulateHealDemo: controlledHealDemo,
  onSimulateHealDemoChange,
  cacheStats,
  onPurgeCache,
  onIngestArchive,
  onIngestGitHub,
  onStartBuild,
  onCancelBuild,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [githubUrl, setGithubUrl] = useState(
    'https://github.com/autoapp-samples/vite-react-dashboard',
  );
  const [internalFormat, setInternalFormat] = useState<BuildTargetFormat>(
    session.targetFormat || 'desktop-executable',
  );
  const [internalHealDemo, setInternalHealDemo] = useState(true);
  const [busyIngest, setBusyIngest] = useState(false);
  const [purging, setPurging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeFormat = controlledFormat ?? internalFormat;
  const setTargetFormat = (fmt: BuildTargetFormat) => {
    setInternalFormat(fmt);
    onTargetFormatChange?.(fmt);
  };

  const activeHealDemo = controlledHealDemo ?? internalHealDemo;
  const setSimulateHealDemo = (val: boolean) => {
    setInternalHealDemo(val);
    onSimulateHealDemoChange?.(val);
  };

  const isBuilding =
    session.status === 'building' ||
    session.status === 'healing' ||
    session.status === 'extracting';

  const handleFileObject = async (file: File) => {
    setBusyIngest(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64Data = btoa(binary);
      await onIngestArchive(file.name, base64Data);
    } finally {
      setBusyIngest(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleFileObject(file);
    }
  };

  const handleGitHubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubUrl.trim() || busyIngest) return;
    setBusyIngest(true);
    try {
      await onIngestGitHub(githubUrl.trim());
    } finally {
      setBusyIngest(false);
    }
  };

  const handleQuickPreset = async (preset: (typeof SAMPLE_REPOS)[number]) => {
    setGithubUrl(preset.url);
    setBusyIngest(true);
    try {
      await onIngestGitHub(preset.url, preset.stack);
    } finally {
      setBusyIngest(false);
    }
  };

  const handleQuickPurge = async () => {
    if (!onPurgeCache) return;
    setPurging(true);
    try {
      await onPurgeCache();
    } finally {
      setPurging(false);
    }
  };

  const renderInputsPane = () => (
    <div
      className={`bg-[#1a1a1e] border border-white/10 rounded-[2px] flex flex-col ${
        compactMode ? 'p-4 gap-3' : 'p-6 gap-4 h-full overflow-y-auto'
      }`}
    >
      <h2 className="font-display font-extrabold text-base tracking-tight text-[#f0f0f0] uppercase">
        INPUT SOURCES
      </h2>

      {/* Пунктирный триггер загрузки архива (ZIP / TAR.GZ) из Variation 7 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border border-dotted border-[#5e6ad2] text-center cursor-pointer transition-colors ${
          compactMode ? 'p-4' : 'p-7'
        } ${
          isDragging
            ? 'bg-[#5e6ad2]/20 text-white'
            : 'bg-[#5e6ad2]/5 hover:bg-[#5e6ad2]/12 text-[#5e6ad2]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,.tar.gz,.tgz,.json,.py,.html"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              handleFileObject(file);
            }
          }}
        />
        <Upload className="h-5 w-5 mx-auto mb-2 text-[#5e6ad2]" />
        <div className="font-mono text-[11px] tracking-[0.14em] uppercase font-bold">
          DRAG ARCHIVE [ZIP / TAR.GZ]
        </div>
        <div className="mt-1 text-[11px] text-white/50">
          Распаковка с защитой от Zip-Slip
        </div>
      </div>

      {/* Карточка ввода ссылки на GitHub-репозиторий */}
      <form
        onSubmit={handleGitHubSubmit}
        className="p-4 border border-white/10 rounded-[4px] bg-black/20"
      >
        <label className="block font-mono text-[10px] tracking-[0.15em] uppercase text-white/70">
          GITHUB REPO
        </label>
        <input
          type="text"
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="w-full bg-black/40 border border-white/10 px-3 py-2.5 text-white font-mono text-xs mt-2 focus:outline-none focus:border-[#5e6ad2]"
        />
        <button
          type="submit"
          disabled={busyIngest || isBuilding}
          className="w-full mt-3 bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white py-3 px-4 font-bold text-xs tracking-wider uppercase transition-opacity disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
        >
          {busyIngest ? 'ANALYZING REPO...' : 'INITIALIZE CLONE'}
        </button>
      </form>

      {/* Быстрые кнопки выбора шаблонных репозиториев для мгновенной проверки */}
      <div>
        <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-white/50 mb-2">
          БЫСТРЫЙ ТЕСТ СТЕКА
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLE_REPOS.map((preset) => (
            <button
              key={preset.stack}
              type="button"
              disabled={busyIngest || isBuilding}
              onClick={() => handleQuickPreset(preset)}
              className="bg-transparent border border-white/15 hover:border-[#5e6ad2] hover:text-white text-[#f0f0f0]/80 px-3 py-1.5 font-mono text-[10px] tracking-wider uppercase cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Карточка обнаруженного стека проекта */}
      {session.detection && (
        <div className="mt-auto p-3.5 border border-white/10 rounded-[4px] bg-black/30">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-bold text-white truncate">
                {session.projectName}
              </span>
            </div>
            <span className="font-mono text-[10px] text-[#5e6ad2] uppercase whitespace-nowrap shrink-0">
              {session.detection.framework}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-white/60">
            <span>{session.detection.displayName}</span>
            <span aria-hidden="true">·</span>
            <span>{session.detection.entryFile}</span>
          </div>
        </div>
      )}
    </div>
  );

  const renderConfigPane = () => {
    const cacheGb = cacheStats
      ? (cacheStats.totalCacheBytes / (1024 * 1024 * 1024)).toFixed(2)
      : '0.00';

    return (
      <div
        className={`bg-[#1a1a1e] border border-white/10 rounded-[2px] flex flex-col ${
          compactMode ? 'p-4 gap-3' : 'p-6 gap-4 h-full overflow-y-auto'
        }`}
      >
        <h2 className="font-display font-extrabold text-base tracking-tight text-[#f0f0f0] uppercase">
          CONFIG & TARGET
        </h2>

        {/* Переключатель целевого формата: Исполняемый файл текущей ОС vs Android APK */}
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setTargetFormat('desktop-executable')}
            className={`w-full p-3.5 text-left border transition-colors cursor-pointer flex items-center justify-between ${
              activeFormat === 'desktop-executable'
                ? 'bg-[#5e6ad2]/15 border-[#5e6ad2] text-white'
                : 'bg-white/[0.04] border-transparent text-[#f0f0f0]/80 hover:bg-white/[0.07]'
            }`}
          >
            <div>
              <div className="text-xs font-bold uppercase tracking-wide">
                OS NATIVE BINARY
              </div>
              <div className="text-[11px] text-white/55 font-mono mt-0.5">
                Windows .exe · macOS .dmg · Linux .AppImage
              </div>
            </div>
            <Monitor className="h-4 w-4 text-[#5e6ad2] shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => setTargetFormat('android-apk')}
            className={`w-full p-3.5 text-left border transition-colors cursor-pointer flex items-center justify-between ${
              activeFormat === 'android-apk'
                ? 'bg-[#5e6ad2]/15 border-[#5e6ad2] text-white'
                : 'bg-white/[0.04] border-transparent text-[#f0f0f0]/80 hover:bg-white/[0.07]'
            }`}
          >
            <div>
              <div className="text-xs font-bold uppercase tracking-wide">
                ANDROID APK
              </div>
              <div className="text-[11px] text-white/55 font-mono mt-0.5">
                Capacitor + Gradle Release (.apk)
              </div>
            </div>
            <Smartphone className="h-4 w-4 text-[#5e6ad2] shrink-0" />
          </button>
        </div>

        {/* Блок настройки рекурсивного цикла самоисцеления ошибок (Error Healing Loop) */}
        <div className="p-4 border border-white/10 rounded-[4px] bg-black/20">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={activeHealDemo}
              onChange={(e) => setSimulateHealDemo(e.target.checked)}
              className="h-4 w-4 accent-[#5e6ad2]"
            />
            <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-white/90">
              AI ERROR HEALING ENABLED
            </span>
          </label>
          <p className="mt-2 text-[11px] text-white/55 leading-relaxed">
            При коде возврата != 0 перехватывает stderr и запрашивает JSON-фикс у локальной модели (до 4 попыток).
          </p>
        </div>

        {/* Блок мониторинга и быстрой очистки единого кэша */}
        {cacheStats && (
          <div className="p-4 border border-white/10 rounded-[4px] bg-black/20">
            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-white/70">
              <span>SHARED CACHE</span>
              <span>
                {cacheGb} GB / {cacheStats.maxAllowedGb} GB
              </span>
            </div>
            <div className="mt-1.5 text-[11px] font-mono tabular-nums text-white/45">
              npm · pip · gradle · cargo · Свободно: {cacheStats.freeDiskGb.toFixed(1)} ГБ
            </div>
            {onPurgeCache && (
              <button
                type="button"
                disabled={purging}
                onClick={handleQuickPurge}
                className="mt-3 w-full py-2 px-3 border border-white/15 hover:border-red-500/60 hover:text-red-400 text-white/80 font-mono text-[10px] tracking-wider uppercase flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>
                  {purging
                    ? 'ОЧИСТКА КЭША...'
                    : `ОЧИСТИТЬ КЭШ (${cacheGb} GB)`}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Главная кнопка запуска конвейера бинаризации (EXECUTE PIPELINE) */}
        <div className="mt-auto pt-2">
          {!isBuilding ? (
            <button
              type="button"
              onClick={() => onStartBuild(activeFormat, activeHealDemo)}
              className="w-full bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white py-4 px-5 font-bold text-xs tracking-[0.12em] uppercase transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>EXECUTE PIPELINE</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onCancelBuild}
              className="w-full bg-red-600 hover:bg-red-500 text-white py-4 px-5 font-bold text-xs tracking-[0.12em] uppercase transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Square className="h-4 w-4 fill-current" />
              <span>ABORT PIPELINE (TREE-KILL)</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  if (paneMode === 'inputs') {
    return renderInputsPane();
  }
  if (paneMode === 'config') {
    return renderConfigPane();
  }

  return (
    <div className="flex flex-col gap-3">
      {renderInputsPane()}
      {renderConfigPane()}
    </div>
  );
};
