/**
 * @file src/renderer/components/AIEnginePanel.tsx
 * @description Панель настройки локального ИИ-движка (100% бесплатно, без платных облачных API)
 *              и менеджер загрузки легковесных квантованных GGUF-моделей (до 3B параметров)
 *              из Hugging Face в системную директорию userData/models (Дизайн Variation 7).
 */

import React, { useState } from 'react';
import {
  Cpu,
  Download,
  Trash2,
  CheckCircle2,
  Activity,
} from 'lucide-react';
import {
  AIProviderConfig,
  AIProviderMode,
  PresetGGUFModel,
} from '../../shared/types.ts';

interface AIEnginePanelProps {
  config: AIProviderConfig;
  presetModels: PresetGGUFModel[];
  onUpdateConfig: (partial: Partial<AIProviderConfig>) => Promise<void>;
  onTestConnection: () => Promise<{
    reachable: boolean;
    mode: string;
    endpoint: string;
    latencyMs: number;
    details: string;
  }>;
  onDownloadModel: (modelId: string) => Promise<void>;
  onDeleteModel: (modelId: string) => Promise<void>;
}

const PROVIDER_MODES: Array<{
  id: AIProviderMode;
  title: string;
  endpointHint: string;
}> = [
  {
    id: 'builtin-llama',
    title: '01. BUILT-IN LLAMA-SERVER (GGUF)',
    endpointHint: '127.0.0.1:8080 · Автоскачивание из Hugging Face',
  },
  {
    id: 'ollama',
    title: '02. OLLAMA LOCAL DAEMON',
    endpointHint: 'http://localhost:11434',
  },
  {
    id: 'local-server',
    title: '03. LM STUDIO / LOCALAI SERVER',
    endpointHint: 'http://127.0.0.1:1234/v1',
  },
  {
    id: 'custom-openai',
    title: '04. CUSTOM OPENAI-COMPATIBLE API',
    endpointHint: 'Произвольный локальный / self-hosted URL',
  },
];

export const AIEnginePanel: React.FC<AIEnginePanelProps> = ({
  config,
  presetModels,
  onUpdateConfig,
  onTestConnection,
  onDownloadModel,
  onDeleteModel,
}) => {
  const [testing, setTesting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pingResult, setPingResult] = useState<{
    reachable: boolean;
    endpoint: string;
    latencyMs: number;
    details: string;
  } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await onTestConnection();
      setPingResult(res);
    } finally {
      setTesting(false);
    }
  };

  const handleDownload = async (modelId: string) => {
    setDownloadingId(modelId);
    try {
      await onDownloadModel(modelId);
      await onUpdateConfig({ selectedModelId: modelId });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Секция выбора режима локального ИИ */}
      <div className="bg-[#1a1a1e] border border-white/10 rounded-[2px] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="font-display font-extrabold text-base tracking-tight text-[#f0f0f0] uppercase">
              AI ENGINE ARCHITECTURE
            </h2>
            <p className="text-xs text-white/55 mt-1">
              100% локальная и бесплатная диагностика ошибок сборки без платных ключей и без Gemini API
            </p>
          </div>

          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white font-mono text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Activity className="h-3.5 w-3.5" />
            <span>{testing ? 'TESTING...' : 'PING ENDPOINT'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PROVIDER_MODES.map((m) => {
            const active = config.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onUpdateConfig({ mode: m.id })}
                className={`text-left p-4 border transition-colors cursor-pointer ${
                  active
                    ? 'border-[#5e6ad2] bg-[#5e6ad2]/15 text-white'
                    : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-[#f0f0f0]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold tracking-wider uppercase">
                    {m.title}
                  </span>
                  {active && (
                    <span className="font-mono text-[10px] text-[#8b95f2] uppercase">
                      ACTIVE
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] font-mono text-white/55 truncate">
                  {m.endpointHint}
                </p>
              </button>
            );
          })}
        </div>

        {/* Контекстные поля параметров выбранного режима */}
        <div className="mt-5 pt-4 border-t border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4">
          {config.mode === 'builtin-llama' && (
            <div>
              <label className="block font-mono text-[10px] tracking-[0.15em] uppercase text-white/60 mb-1.5">
                BUILTIN LLAMA-SERVER URL
              </label>
              <input
                type="text"
                value={config.builtinLlamaUrl}
                onChange={(e) =>
                  onUpdateConfig({ builtinLlamaUrl: e.target.value })
                }
                className="w-full bg-black/40 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#5e6ad2]"
              />
            </div>
          )}

          {config.mode === 'ollama' && (
            <>
              <div>
                <label className="block font-mono text-[10px] tracking-[0.15em] uppercase text-white/60 mb-1.5">
                  OLLAMA DAEMON BASE URL
                </label>
                <input
                  type="text"
                  value={config.ollamaBaseUrl}
                  onChange={(e) =>
                    onUpdateConfig({ ollamaBaseUrl: e.target.value })
                  }
                  className="w-full bg-black/40 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#5e6ad2]"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] tracking-[0.15em] uppercase text-white/60 mb-1.5">
                  OLLAMA MODEL TAG (UP TO 3B)
                </label>
                <input
                  type="text"
                  value={config.ollamaModelName}
                  onChange={(e) =>
                    onUpdateConfig({ ollamaModelName: e.target.value })
                  }
                  placeholder="qwen2.5-coder:1.5b"
                  className="w-full bg-black/40 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#5e6ad2]"
                />
              </div>
            </>
          )}

          {config.mode === 'local-server' && (
            <div>
              <label className="block font-mono text-[10px] tracking-[0.15em] uppercase text-white/60 mb-1.5">
                LM STUDIO / LOCALAI URL
              </label>
              <input
                type="text"
                value={config.localServerUrl}
                onChange={(e) =>
                  onUpdateConfig({ localServerUrl: e.target.value })
                }
                className="w-full bg-black/40 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#5e6ad2]"
              />
            </div>
          )}

          {config.mode === 'custom-openai' && (
            <>
              <div>
                <label className="block font-mono text-[10px] tracking-[0.15em] uppercase text-white/60 mb-1.5">
                  OPENAI-COMPATIBLE BASE URL
                </label>
                <input
                  type="text"
                  value={config.customOpenAiUrl}
                  onChange={(e) =>
                    onUpdateConfig({ customOpenAiUrl: e.target.value })
                  }
                  className="w-full bg-black/40 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#5e6ad2]"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] tracking-[0.15em] uppercase text-white/60 mb-1.5">
                  OPTIONAL BEARER TOKEN
                </label>
                <input
                  type="password"
                  value={config.customOpenAiKey}
                  onChange={(e) =>
                    onUpdateConfig({ customOpenAiKey: e.target.value })
                  }
                  placeholder="Optional for local servers"
                  className="w-full bg-black/40 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#5e6ad2]"
                />
              </div>
            </>
          )}

          <div>
            <label className="block font-mono text-[10px] tracking-[0.15em] uppercase text-white/60 mb-1.5">
              MAX HEALING RETRIES (1–4)
            </label>
            <input
              type="number"
              min={1}
              max={4}
              value={config.maxHealAttempts}
              onChange={(e) =>
                onUpdateConfig({ maxHealAttempts: Number(e.target.value) })
              }
              className="w-full bg-black/40 border border-white/10 px-3 py-2 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-[#5e6ad2]"
            />
          </div>
        </div>

        {pingResult && (
          <div className="mt-4 p-3.5 border border-white/10 bg-black/40 text-xs">
            <div className="flex items-center justify-between font-mono tabular-nums text-[11px] text-white/55">
              <span>ENDPOINT: {pingResult.endpoint}</span>
              <span>LATENCY: {pingResult.latencyMs} MS</span>
            </div>
            <p className="mt-1.5 text-white/85 text-xs">
              {pingResult.details}
            </p>
          </div>
        )}
      </div>

      {/* Реестр предустановленных легковесных GGUF-моделей до 3B */}
      <div className="bg-[#1a1a1e] border border-white/10 rounded-[2px] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display font-extrabold text-base tracking-tight text-[#f0f0f0] uppercase">
              QUANTIZED GGUF MODELS (UP TO 3B)
            </h3>
            <p className="text-xs text-white/55 mt-0.5">
              Потоковое скачивание из Hugging Face в <code className="font-mono text-white/80">userData/models</code>
            </p>
          </div>
          <span className="font-mono text-xs tabular-nums text-white/50">
            MODELS: {presetModels.length}
          </span>
        </div>

        <div className="divide-y divide-white/10">
          {presetModels.map((model) => {
            const isSelected = config.selectedModelId === model.id;
            const isDownloading = downloadingId === model.id;
            const sizeMb = Math.round(model.sizeBytes / (1024 * 1024));

            return (
              <div
                key={model.id}
                className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-[#5e6ad2] shrink-0" />
                    <span className="text-xs font-bold text-white uppercase font-mono">
                      {model.name}
                    </span>
                    {model.installed && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    )}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-white/55">
                    <span>{model.family}</span>
                    <span aria-hidden="true">·</span>
                    <span>{model.parameters}</span>
                    <span aria-hidden="true">·</span>
                    <span>{model.quantization}</span>
                    <span aria-hidden="true">·</span>
                    <span>{sizeMb} MB</span>
                    <span aria-hidden="true">·</span>
                    <span>MIN RAM {model.minRamGb} GB</span>
                  </div>

                  <p className="mt-1.5 text-xs text-white/70">
                    {model.description}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {model.installed ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateConfig({ selectedModelId: model.id })
                        }
                        className={`px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          isSelected
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        {isSelected ? 'ACTIVE MODEL' : 'SELECT'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteModel(model.id)}
                        title="Удалить файл GGUF с диска"
                        className="p-2 border border-white/15 text-white/60 hover:text-red-400 hover:border-red-500/50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={isDownloading}
                      onClick={() => handleDownload(model.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white font-mono text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>
                        {isDownloading
                          ? 'DOWNLOADING GGUF...'
                          : `PULL GGUF (${sizeMb} MB)`}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
