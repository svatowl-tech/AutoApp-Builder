var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/preload/index.ts
var index_exports = {};
module.exports = __toCommonJS(index_exports);
var import_electron = require("electron");
var electronAPI = {
  getSession: () => import_electron.ipcRenderer.invoke("orchestrator:get-session"),
  ingestArchive: (payload) => import_electron.ipcRenderer.invoke("orchestrator:ingest-archive", payload),
  ingestGitHub: (payload) => import_electron.ipcRenderer.invoke("orchestrator:ingest-github", payload),
  startBuild: (payload) => import_electron.ipcRenderer.invoke("orchestrator:start-build", payload),
  cancelBuild: () => import_electron.ipcRenderer.invoke("orchestrator:cancel-build"),
  getCacheStats: () => import_electron.ipcRenderer.invoke("cache:get-stats"),
  purgeCache: () => import_electron.ipcRenderer.invoke("cache:purge"),
  setCacheThresholds: (payload) => import_electron.ipcRenderer.invoke("cache:set-thresholds", payload),
  getAIConfig: () => import_electron.ipcRenderer.invoke("ai:get-config"),
  updateAIConfig: (partial) => import_electron.ipcRenderer.invoke("ai:update-config", partial),
  testAIConnection: () => import_electron.ipcRenderer.invoke("ai:test-connection"),
  downloadModel: (payload) => import_electron.ipcRenderer.invoke("ai:download-model", payload),
  deleteModel: (modelId) => import_electron.ipcRenderer.invoke("ai:delete-model", modelId),
  revealArtifact: (filePath) => import_electron.ipcRenderer.invoke("shell:reveal-artifact", filePath),
  setLayoutMode: (mode) => import_electron.ipcRenderer.invoke("window:set-layout-mode", mode),
  getHubState: () => import_electron.ipcRenderer.invoke("hub:get-state"),
  launchHubApp: (appId) => import_electron.ipcRenderer.invoke("hub:launch-app", appId),
  stopHubApp: (appId) => import_electron.ipcRenderer.invoke("hub:stop-app", appId),
  checkHubUpdates: (payload) => import_electron.ipcRenderer.invoke("hub:check-updates", payload),
  updateHubApp: (appId) => import_electron.ipcRenderer.invoke("hub:update-app", appId),
  rollbackHubApp: (appId) => import_electron.ipcRenderer.invoke("hub:rollback-app", appId),
  toggleHubAutoUpdate: (payload) => import_electron.ipcRenderer.invoke("hub:toggle-autoupdate", payload),
  updateHubSettings: (partial) => import_electron.ipcRenderer.invoke("hub:update-settings", partial),
  deleteHubApp: (appId) => import_electron.ipcRenderer.invoke("hub:delete-app", appId),
  getProcessLoggerState: () => import_electron.ipcRenderer.invoke("logs:get-state"),
  remediateProcessError: (logId) => import_electron.ipcRenderer.invoke("logs:remediate", logId),
  remediateAllProcessErrors: () => import_electron.ipcRenderer.invoke("logs:remediate-all"),
  simulateProcessError: (faultType) => import_electron.ipcRenderer.invoke("logs:simulate-error", faultType),
  clearProcessLogs: () => import_electron.ipcRenderer.invoke("logs:clear"),
  exportProcessLogs: () => import_electron.ipcRenderer.invoke("logs:export"),
  getReleaseFiles: () => import_electron.ipcRenderer.invoke("release:get-files"),
  getReleaseFileContent: (filePath) => import_electron.ipcRenderer.invoke("release:get-file-content", filePath),
  downloadReleaseZip: () => import_electron.ipcRenderer.invoke("release:download-zip")
};
import_electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
