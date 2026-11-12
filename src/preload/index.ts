/**
 * @file src/preload/index.ts
 * @description Типизированный мост безопасности Electron (contextBridge API),
 *              изолирующий Renderer-процесс React 19 от прямого доступа к Node.js примитивам.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  AIProviderConfig,
  BuildSessionState,
  BuildTargetFormat,
  HubAutoUpdateSettings,
  ManagedHubApp,
  ModelDownloadProgress,
  PresetGGUFModel,
  ProcessLoggerState,
  SharedCacheStats,
  SourceFileNode,
  SystemProcessLogEntry,
} from '../shared/types.ts';

export interface ElectronOrchestratorAPI {
  getSession: () => Promise<BuildSessionState>;
  ingestArchive: (payload: {
    fileName: string;
    base64Data: string;
  }) => Promise<BuildSessionState>;
  ingestGitHub: (payload: {
    repoUrl: string;
    preferredStackHint?: 'react' | 'python' | 'rust' | 'go';
  }) => Promise<BuildSessionState>;
  startBuild: (payload: {
    targetFormat: BuildTargetFormat;
    simulateHealDemo?: boolean;
  }) => Promise<BuildSessionState>;
  cancelBuild: () => Promise<BuildSessionState>;
  getCacheStats: () => Promise<SharedCacheStats>;
  purgeCache: () => Promise<{
    freedBytes: number;
    updatedStats: SharedCacheStats;
  }>;
  setCacheThresholds: (payload: {
    maxAllowedGb: number;
    minFreeDiskGb: number;
  }) => Promise<SharedCacheStats>;
  getAIConfig: () => Promise<{
    config: AIProviderConfig;
    presetModels: PresetGGUFModel[];
  }>;
  updateAIConfig: (partial: Partial<AIProviderConfig>) => Promise<{
    config: AIProviderConfig;
    presetModels: PresetGGUFModel[];
  }>;
  testAIConnection: () => Promise<{
    reachable: boolean;
    mode: string;
    endpoint: string;
    latencyMs: number;
    details: string;
  }>;
  downloadModel: (payload: {
    modelId: string;
    fastVerifyMode?: boolean;
  }) => Promise<ModelDownloadProgress>;
  deleteModel: (modelId: string) => Promise<boolean>;
  revealArtifact: (filePath: string) => Promise<{
    opened: boolean;
    path: string;
  }>;
  setLayoutMode: (mode: 'tray' | 'studio') => Promise<{ mode: 'tray' | 'studio' }>;
  getHubState: () => Promise<{
    apps: ManagedHubApp[];
    settings: HubAutoUpdateSettings;
  }>;
  launchHubApp: (appId: string) => Promise<ManagedHubApp>;
  stopHubApp: (appId: string) => Promise<ManagedHubApp>;
  checkHubUpdates: (payload?: {
    appId?: string;
    simulateNewUpstreamCommit?: boolean;
  }) => Promise<{
    apps: ManagedHubApp[];
    updatesFoundCount: number;
    autoRebuiltCount: number;
  }>;
  updateHubApp: (appId: string) => Promise<ManagedHubApp>;
  rollbackHubApp: (appId: string) => Promise<ManagedHubApp>;
  toggleHubAutoUpdate: (payload: {
    appId: string;
    enabled: boolean;
  }) => Promise<ManagedHubApp>;
  updateHubSettings: (
    partial: Partial<HubAutoUpdateSettings>,
  ) => Promise<HubAutoUpdateSettings>;
  deleteHubApp: (appId: string) => Promise<ManagedHubApp[]>;
  getProcessLoggerState: () => Promise<ProcessLoggerState>;
  remediateProcessError: (logId: string) => Promise<{
    resolvedEntry: SystemProcessLogEntry | null;
    loggerState: ProcessLoggerState;
  }>;
  remediateAllProcessErrors: () => Promise<{
    fixedCount: number;
    loggerState: ProcessLoggerState;
  }>;
  simulateProcessError: (
    faultType?: 'build' | 'hub-crash' | 'ai-timeout' | 'cache-lock',
  ) => Promise<ProcessLoggerState>;
  clearProcessLogs: () => Promise<ProcessLoggerState>;
  exportProcessLogs: () => Promise<{ reportText: string }>;
  getReleaseFiles: () => Promise<SourceFileNode[]>;
  getReleaseFileContent: (
    filePath: string,
  ) => Promise<{ path: string; content: string }>;
  downloadReleaseZip: () => Promise<{ savedPath: string }>;
}

const electronAPI: ElectronOrchestratorAPI = {
  getSession: () => ipcRenderer.invoke('orchestrator:get-session'),
  ingestArchive: (payload) =>
    ipcRenderer.invoke('orchestrator:ingest-archive', payload),
  ingestGitHub: (payload) =>
    ipcRenderer.invoke('orchestrator:ingest-github', payload),
  startBuild: (payload) =>
    ipcRenderer.invoke('orchestrator:start-build', payload),
  cancelBuild: () => ipcRenderer.invoke('orchestrator:cancel-build'),
  getCacheStats: () => ipcRenderer.invoke('cache:get-stats'),
  purgeCache: () => ipcRenderer.invoke('cache:purge'),
  setCacheThresholds: (payload) =>
    ipcRenderer.invoke('cache:set-thresholds', payload),
  getAIConfig: () => ipcRenderer.invoke('ai:get-config'),
  updateAIConfig: (partial) => ipcRenderer.invoke('ai:update-config', partial),
  testAIConnection: () => ipcRenderer.invoke('ai:test-connection'),
  downloadModel: (payload) => ipcRenderer.invoke('ai:download-model', payload),
  deleteModel: (modelId) => ipcRenderer.invoke('ai:delete-model', modelId),
  revealArtifact: (filePath) =>
    ipcRenderer.invoke('shell:reveal-artifact', filePath),
  setLayoutMode: (mode) => ipcRenderer.invoke('window:set-layout-mode', mode),
  getHubState: () => ipcRenderer.invoke('hub:get-state'),
  launchHubApp: (appId) => ipcRenderer.invoke('hub:launch-app', appId),
  stopHubApp: (appId) => ipcRenderer.invoke('hub:stop-app', appId),
  checkHubUpdates: (payload) =>
    ipcRenderer.invoke('hub:check-updates', payload),
  updateHubApp: (appId) => ipcRenderer.invoke('hub:update-app', appId),
  rollbackHubApp: (appId) => ipcRenderer.invoke('hub:rollback-app', appId),
  toggleHubAutoUpdate: (payload) =>
    ipcRenderer.invoke('hub:toggle-autoupdate', payload),
  updateHubSettings: (partial) =>
    ipcRenderer.invoke('hub:update-settings', partial),
  deleteHubApp: (appId) => ipcRenderer.invoke('hub:delete-app', appId),
  getProcessLoggerState: () => ipcRenderer.invoke('logs:get-state'),
  remediateProcessError: (logId) => ipcRenderer.invoke('logs:remediate', logId),
  remediateAllProcessErrors: () => ipcRenderer.invoke('logs:remediate-all'),
  simulateProcessError: (faultType) =>
    ipcRenderer.invoke('logs:simulate-error', faultType),
  clearProcessLogs: () => ipcRenderer.invoke('logs:clear'),
  exportProcessLogs: () => ipcRenderer.invoke('logs:export'),
  getReleaseFiles: () => ipcRenderer.invoke('release:get-files'),
  getReleaseFileContent: (filePath) =>
    ipcRenderer.invoke('release:get-file-content', filePath),
  downloadReleaseZip: () => ipcRenderer.invoke('release:download-zip'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
