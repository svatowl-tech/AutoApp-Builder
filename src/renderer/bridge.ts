/**
 * @file src/renderer/bridge.ts
 * @description Универсальный клиентский адаптер связи Renderer-процесса React 19:
 *              - В нативном приложении Electron использует `window.electronAPI` (IPC).
 *              - В веб-окружении предпросмотра прозрачно маршрутизирует вызовы на локальный сервер `/api/*`.
 */

import {
  AIProviderConfig,
  BuildSessionState,
  BuildTargetFormat,
  BuiltArtifactInfo,
  HubAutoUpdateSettings,
  ManagedHubApp,
  ModelDownloadProgress,
  PresetGGUFModel,
  ProcessLoggerState,
  SharedCacheStats,
  SourceFileNode,
  SystemProcessLogEntry,
} from '../shared/types.ts';
import type { ElectronOrchestratorAPI } from '../preload/index.ts';

declare global {
  interface Window {
    electronAPI?: ElectronOrchestratorAPI;
  }
}

async function apiRequest<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let errText = `HTTP ${response.status}`;
    try {
      const errJson = (await response.json()) as { error?: string };
      if (errJson.error) errText = errJson.error;
    } catch {
      // Игнорируем ошибку парсинга
    }
    throw new Error(errText);
  }

  return (await response.json()) as T;
}

export const orchestratorClient = {
  async getSession(): Promise<{
    session: BuildSessionState;
    history: BuiltArtifactInfo[];
  }> {
    if (window.electronAPI) {
      const session = await window.electronAPI.getSession();
      return { session, history: session.artifact ? [session.artifact] : [] };
    }
    return apiRequest('/api/session');
  },

  async ingestArchive(
    fileName: string,
    base64Data: string,
  ): Promise<BuildSessionState> {
    if (window.electronAPI) {
      return window.electronAPI.ingestArchive({ fileName, base64Data });
    }
    return apiRequest('/api/ingest/archive', {
      method: 'POST',
      body: JSON.stringify({ fileName, base64Data }),
    });
  },

  async ingestGitHub(
    repoUrl: string,
    preferredStackHint?: 'react' | 'python' | 'rust' | 'go',
  ): Promise<BuildSessionState> {
    if (window.electronAPI) {
      return window.electronAPI.ingestGitHub({ repoUrl, preferredStackHint });
    }
    return apiRequest('/api/ingest/github', {
      method: 'POST',
      body: JSON.stringify({ repoUrl, preferredStackHint }),
    });
  },

  async startBuild(
    targetFormat: BuildTargetFormat,
    simulateHealDemo = false,
  ): Promise<BuildSessionState> {
    if (window.electronAPI) {
      return window.electronAPI.startBuild({ targetFormat, simulateHealDemo });
    }
    return apiRequest('/api/build/start', {
      method: 'POST',
      body: JSON.stringify({ targetFormat, simulateHealDemo }),
    });
  },

  async cancelBuild(): Promise<BuildSessionState> {
    if (window.electronAPI) {
      return window.electronAPI.cancelBuild();
    }
    return apiRequest('/api/build/cancel', { method: 'POST' });
  },

  async getCacheStats(): Promise<SharedCacheStats> {
    if (window.electronAPI) {
      return window.electronAPI.getCacheStats();
    }
    return apiRequest('/api/cache/stats');
  },

  async purgeCache(): Promise<{
    freedBytes: number;
    updatedStats: SharedCacheStats;
  }> {
    if (window.electronAPI) {
      return window.electronAPI.purgeCache();
    }
    return apiRequest('/api/cache/purge', { method: 'POST' });
  },

  async setCacheThresholds(
    maxAllowedGb: number,
    minFreeDiskGb: number,
  ): Promise<SharedCacheStats> {
    if (window.electronAPI) {
      return window.electronAPI.setCacheThresholds({
        maxAllowedGb,
        minFreeDiskGb,
      });
    }
    return apiRequest('/api/cache/thresholds', {
      method: 'POST',
      body: JSON.stringify({ maxAllowedGb, minFreeDiskGb }),
    });
  },

  async getAIConfig(): Promise<{
    config: AIProviderConfig;
    presetModels: PresetGGUFModel[];
  }> {
    if (window.electronAPI) {
      return window.electronAPI.getAIConfig();
    }
    return apiRequest('/api/ai/config');
  },

  async updateAIConfig(partial: Partial<AIProviderConfig>): Promise<{
    config: AIProviderConfig;
    presetModels: PresetGGUFModel[];
  }> {
    if (window.electronAPI) {
      return window.electronAPI.updateAIConfig(partial);
    }
    return apiRequest('/api/ai/config', {
      method: 'POST',
      body: JSON.stringify(partial),
    });
  },

  async testAIConnection(): Promise<{
    reachable: boolean;
    mode: string;
    endpoint: string;
    latencyMs: number;
    details: string;
  }> {
    if (window.electronAPI) {
      return window.electronAPI.testAIConnection();
    }
    return apiRequest('/api/ai/test', { method: 'POST' });
  },

  async downloadModel(
    modelId: string,
    fastVerifyMode = true,
  ): Promise<ModelDownloadProgress> {
    if (window.electronAPI) {
      return window.electronAPI.downloadModel({ modelId, fastVerifyMode });
    }
    return apiRequest('/api/ai/download', {
      method: 'POST',
      body: JSON.stringify({ modelId, fastVerifyMode }),
    });
  },

  async deleteModel(modelId: string): Promise<boolean> {
    if (window.electronAPI) {
      return window.electronAPI.deleteModel(modelId);
    }
    const res = await apiRequest<{ deleted: boolean }>('/api/ai/delete', {
      method: 'POST',
      body: JSON.stringify({ modelId }),
    });
    return res.deleted;
  },

  async revealOrDownloadArtifact(artifact: BuiltArtifactInfo): Promise<void> {
    if (window.electronAPI) {
      await window.electronAPI.revealArtifact(artifact.filePath);
      return;
    }
    // В браузерном режиме инициируем прямое скачивание собранного бинарника
    const link = document.createElement('a');
    link.href = artifact.downloadUrl;
    link.download = artifact.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  async setWindowLayoutMode(mode: 'tray' | 'studio'): Promise<void> {
    if (window.electronAPI) {
      await window.electronAPI.setLayoutMode(mode);
    }
  },

  async getReleaseFiles(): Promise<SourceFileNode[]> {
    return apiRequest('/api/release/files');
  },

  async getReleaseFileContent(filePath: string): Promise<{
    path: string;
    content: string;
  }> {
    return apiRequest(
      `/api/release/file-content?path=${encodeURIComponent(filePath)}`,
    );
  },

  async getHubState(): Promise<{
    apps: ManagedHubApp[];
    settings: HubAutoUpdateSettings;
  }> {
    if (window.electronAPI) {
      return window.electronAPI.getHubState();
    }
    return apiRequest('/api/hub/state');
  },

  async launchHubApp(appId: string): Promise<ManagedHubApp> {
    if (window.electronAPI) {
      return window.electronAPI.launchHubApp(appId);
    }
    return apiRequest(`/api/hub/apps/${encodeURIComponent(appId)}/launch`, {
      method: 'POST',
    });
  },

  async stopHubApp(appId: string): Promise<ManagedHubApp> {
    if (window.electronAPI) {
      return window.electronAPI.stopHubApp(appId);
    }
    return apiRequest(`/api/hub/apps/${encodeURIComponent(appId)}/stop`, {
      method: 'POST',
    });
  },

  async checkHubUpdates(params?: {
    appId?: string;
    simulateNewUpstreamCommit?: boolean;
  }): Promise<{
    apps: ManagedHubApp[];
    updatesFoundCount: number;
    autoRebuiltCount: number;
  }> {
    if (window.electronAPI) {
      return window.electronAPI.checkHubUpdates(params);
    }
    return apiRequest('/api/hub/check-updates', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  },

  async updateHubApp(appId: string): Promise<ManagedHubApp> {
    if (window.electronAPI) {
      return window.electronAPI.updateHubApp(appId);
    }
    return apiRequest(`/api/hub/apps/${encodeURIComponent(appId)}/update`, {
      method: 'POST',
    });
  },

  async rollbackHubApp(appId: string): Promise<ManagedHubApp> {
    if (window.electronAPI) {
      return window.electronAPI.rollbackHubApp(appId);
    }
    return apiRequest(`/api/hub/apps/${encodeURIComponent(appId)}/rollback`, {
      method: 'POST',
    });
  },

  async toggleHubAutoUpdate(
    appId: string,
    enabled: boolean,
  ): Promise<ManagedHubApp> {
    if (window.electronAPI) {
      return window.electronAPI.toggleHubAutoUpdate({ appId, enabled });
    }
    return apiRequest(
      `/api/hub/apps/${encodeURIComponent(appId)}/auto-update`,
      {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      },
    );
  },

  async updateHubSettings(
    partial: Partial<HubAutoUpdateSettings>,
  ): Promise<HubAutoUpdateSettings> {
    if (window.electronAPI) {
      return window.electronAPI.updateHubSettings(partial);
    }
    return apiRequest('/api/hub/settings', {
      method: 'POST',
      body: JSON.stringify(partial),
    });
  },

  async deleteHubApp(appId: string): Promise<ManagedHubApp[]> {
    if (window.electronAPI) {
      return window.electronAPI.deleteHubApp(appId);
    }
    return apiRequest(`/api/hub/apps/${encodeURIComponent(appId)}`, {
      method: 'DELETE',
    });
  },

  async getProcessLoggerState(): Promise<ProcessLoggerState> {
    if (window.electronAPI) {
      return window.electronAPI.getProcessLoggerState();
    }
    return apiRequest('/api/logs/state');
  },

  async remediateProcessError(logId: string): Promise<{
    resolvedEntry: SystemProcessLogEntry | null;
    loggerState: ProcessLoggerState;
  }> {
    if (window.electronAPI) {
      return window.electronAPI.remediateProcessError(logId);
    }
    return apiRequest(`/api/logs/remediate/${encodeURIComponent(logId)}`, {
      method: 'POST',
    });
  },

  async remediateAllProcessErrors(): Promise<{
    fixedCount: number;
    loggerState: ProcessLoggerState;
  }> {
    if (window.electronAPI) {
      return window.electronAPI.remediateAllProcessErrors();
    }
    return apiRequest('/api/logs/remediate-all', {
      method: 'POST',
    });
  },

  async simulateProcessError(
    faultType: 'build' | 'hub-crash' | 'ai-timeout' | 'cache-lock' = 'build',
  ): Promise<ProcessLoggerState> {
    if (window.electronAPI) {
      return window.electronAPI.simulateProcessError(faultType);
    }
    return apiRequest('/api/logs/simulate-error', {
      method: 'POST',
      body: JSON.stringify({ faultType }),
    });
  },

  async clearProcessLogs(): Promise<ProcessLoggerState> {
    if (window.electronAPI) {
      return window.electronAPI.clearProcessLogs();
    }
    return apiRequest('/api/logs/clear', {
      method: 'POST',
    });
  },
};

