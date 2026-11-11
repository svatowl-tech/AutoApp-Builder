/**
 * @file src/shared/types.ts
 * @description Единые строго типизированные контракты данных между процессами Main, Preload,
 *              сервером оркестрации и интерфейсом React 19 (Renderer).
 */

/** Поддерживаемые режимы работы локального ИИ-движка (100% бесплатно, без платных облачных API) */
export type AIProviderMode =
  | 'builtin-llama'
  | 'ollama'
  | 'local-server'
  | 'custom-openai';

/** Описание предустановленной легковесной GGUF-модели (до 3B параметров) */
export interface PresetGGUFModel {
  /** Уникальный идентификатор модели */
  id: string;
  /** Человекочитаемое название модели */
  name: string;
  /** Семейство модели (Qwen 2.5 Coder, Llama 3.2, SmolLM2) */
  family: 'Qwen 2.5 Coder' | 'Llama 3.2' | 'SmolLM2';
  /** Количество параметров (0.5B, 1B, 1.5B, 1.7B, 3B) */
  parameters: '0.5B' | '1B' | '1.5B' | '1.7B' | '3B';
  /** Квантование GGUF */
  quantization: string;
  /** Имя файла на диске в папке userData/models */
  fileName: string;
  /** Прямая ссылка на скачивание из официального репозитория Hugging Face */
  downloadUrl: string;
  /** Ожидаемый размер в байтах */
  sizeBytes: number;
  /** Рекомендуемый объем ОЗУ */
  minRamGb: number;
  /** Специализация модели */
  description: string;
  /** Установлена ли модель локально в userData/models */
  installed?: boolean;
  /** Фактический размер скачанного файла на диске */
  installedBytes?: number;
}

/** Конфигурация активного ИИ-провайдера */
export interface AIProviderConfig {
  /** Выбранный режим подключения */
  mode: AIProviderMode;
  /** ID выбранной модели из пресетов или имя модели в Ollama/OpenAI */
  selectedModelId: string;
  /** Адрес встроенного сервера llama-server */
  builtinLlamaUrl: string;
  /** Адрес локального демона Ollama */
  ollamaBaseUrl: string;
  /** Имя модели внутри Ollama (например, qwen2.5-coder:1.5b) */
  ollamaModelName: string;
  /** Адрес локального сервера (LM Studio / LocalAI) */
  localServerUrl: string;
  /** Адрес произвольного OpenAI-совместимого эндпоинта */
  customOpenAiUrl: string;
  /** Опциональный ключ авторизации для совместимого сервера */
  customOpenAiKey: string;
  /** Максимальное число попыток самоисцеления ошибок на один шаг (до 4) */
  maxHealAttempts: number;
}

/** Ответ от ИИ-движка при диагностике ошибки сборки */
export interface AIHealPrescription {
  /** Команда для устранения ошибки (установка пакета, флаг компилятора и т.д.) */
  fix_command: string;
  /** Следует ли повторить упавший шаг после выполнения fix_command */
  retry: boolean;
  /** Краткое техническое пояснение причины сбоя на русском языке */
  explanation?: string;
}

/** Прогресс потокового скачивания GGUF-модели из Hugging Face */
export interface ModelDownloadProgress {
  modelId: string;
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  speedMbPerSec: number;
  status: 'downloading' | 'completed' | 'cancelled' | 'error';
  errorMessage?: string;
}

/** Обнаруженный тип исходного проекта */
export type DetectedProjectStack =
  | 'web-frontend'
  | 'web-node'
  | 'python'
  | 'rust'
  | 'go'
  | 'cpp'
  | 'android-native'
  | 'flutter'
  | 'unknown';

/** Результат глубокого анализа структуры проекта модулем detector.ts */
export interface ProjectDetectionResult {
  /** Основной стек проекта */
  stack: DetectedProjectStack;
  /** Человекочитаемое описание стека (например: "React + Vite (TypeScript)") */
  displayName: string;
  /** Обнаруженный фреймворк или сборочная система */
  framework: string;
  /** Главный входной файл или манифест */
  entryFile: string;
  /** Найденные файлы конфигурации */
  detectedManifests: string[];
  /** Рекомендуемая стратегия бинаризации под текущую ОС */
  desktopStrategy: string;
  /** Рекомендуемая стратегия сборки под Android APK */
  androidStrategy: string;
  /** Поддерживается ли упаковка в десктопный бинарник */
  supportsDesktop: boolean;
  /** Поддерживается ли упаковка в Android APK */
  supportsAndroid: boolean;
}

/** Целевой формат компиляции в интерфейсе */
export type BuildTargetFormat = 'desktop-executable' | 'android-apk';

/** Отдельная строка в терминале логов сборки */
export interface BuildLogEntry {
  id: string;
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system' | 'healer';
  message: string;
  stepName?: string;
}

/** Описание готового скомпилированного бинарного артефакта */
export interface BuiltArtifactInfo {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  targetFormat: BuildTargetFormat;
  hostPlatform: 'win32' | 'darwin' | 'linux';
  createdAt: string;
  downloadUrl: string;
}

/** Состояние текущей или завершенной сессии сборки */
export interface BuildSessionState {
  jobId: string;
  projectName: string;
  sourceType: 'archive' | 'github-url' | 'sample';
  sourceOrigin: string;
  workspaceDir: string;
  targetFormat: BuildTargetFormat;
  detection: ProjectDetectionResult | null;
  status: 'idle' | 'extracting' | 'detecting' | 'building' | 'healing' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  totalSteps: number;
  currentStepLabel: string;
  healAttempt: number;
  maxHealAttempts: number;
  logs: BuildLogEntry[];
  artifact: BuiltArtifactInfo | null;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** Детальная статистика единого централизованного кэша (Shared Centralized Cache) */
export interface SharedCacheStats {
  /** Корневой путь к userData/shared-cache */
  rootCachePath: string;
  /** Размеры каждого сегмента кэша в байтах */
  segments: {
    npmCacheBytes: number;
    pipCacheBytes: number;
    gradleCacheBytes: number;
    cargoCacheBytes: number;
    tempWorkspacesBytes: number;
    modelsBytes: number;
  };
  /** Суммарный объем очищаемого кэша сборщиков + временных сборок (в байтах) */
  totalCacheBytes: number;
  /** Суммарный объем в гигабайтах для кнопки "Очистить кэш (X.X GB)" */
  totalCacheGb: number;
  /** Настроенный лимит кэша в гигабайтах (по умолчанию 10 ГБ) */
  maxAllowedGb: number;
  /** Порог минимального свободного места на системном диске (по умолчанию 5 ГБ) */
  minFreeDiskGb: number;
  /** Доступное свободное место на системном диске (в гигабайтах) */
  freeDiskGb: number;
  /** Количество сохраненных временных папок распакованных репозиториев */
  cachedWorkspacesCount: number;
  /** Время последнего сканирования */
  lastScannedAt: string;
  /** Была ли выполнена автоматическая LRU-очистка при последнем сканировании */
  autoCleanedLastRun: boolean;
}

/** Элемент дерева исходного кода самого проекта AutoApp-Builder (для вкладки "Код релиза") */
export interface SourceFileNode {
  path: string;
  name: string;
  category: 'config' | 'ci-cd' | 'main-ai' | 'main-orchestrator' | 'templates' | 'preload' | 'renderer';
  sizeBytes: number;
  description: string;
}

/** Резервная копия предыдущей рабочей сборки приложения для мгновенного отката (Rollback) */
export interface HubBackupSnapshot {
  commitSha: string;
  commitMessage: string;
  backedUpAt: string;
  artifact: BuiltArtifactInfo;
}

/** Строка лога выполнения запущенного из Хаба приложения */
export interface HubRuntimeLogEntry {
  id: string;
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'lifecycle';
  message: string;
}

/** Полная карточка собранного приложения в Хабе проектов (Apps Hub) */
export interface ManagedHubApp {
  /** Уникальный идентификатор приложения в Хабе */
  id: string;
  /** Название проекта */
  name: string;
  /** Стек проекта (web-frontend, python, rust, go и т.д.) */
  stack: DetectedProjectStack;
  /** Человекочитаемое описание стека */
  displayName: string;
  /** Фреймворк */
  framework: string;
  /** Тип источника ('github-url' или 'archive') */
  sourceType: 'github-url' | 'archive';
  /** URL репозитория GitHub или имя исходного архива */
  sourceOrigin: string;
  /** Ветка репозитория GitHub (по умолчанию main) */
  branch: string;
  /** Хэш коммита (7 символов) текущей установленной версии */
  installedCommitSha: string;
  /** Описание текущего установленного коммита */
  installedCommitMessage: string;
  /** Последний обнаруженный в GitHub хэш коммита */
  latestRemoteCommitSha: string;
  /** Описание последнего коммита в GitHub */
  latestRemoteCommitMessage: string;
  /** Статус проверки обновлений GitHub */
  updateStatus: 'up-to-date' | 'checking' | 'update-available' | 'updating';
  /** Включено ли автоматическое обновление и пересборка при выходе нового коммита/релиза */
  autoUpdateEnabled: boolean;
  /** Время последней проверки обновлений */
  lastCheckedAt: string;
  /** Текущий исполняемый артефакт (.exe, .dmg, .AppImage, .apk) */
  currentArtifact: BuiltArtifactInfo;
  /** Сохраненная предыдущая рабочая сборка для отката в один клик (Rollback) */
  previousVersion: HubBackupSnapshot | null;
  /** Статус выполнения приложения при запуске из интерфейса Хаба */
  runStatus: 'stopped' | 'running' | 'error';
  /** Системный PID запущенного процесса */
  pid: number | null;
  /** Время запуска процесса (ISO) для вычисления аптайма */
  startedAt: string | null;
  /** Количество выполненных запусков из Хаба */
  launchCount: number;
  /** Буфер живых логов выполнения (stdout/stderr) запущенного приложения */
  runtimeLogs: HubRuntimeLogEntry[];
}

/** Настройки фонового демона проверки и автообновления GitHub-проектов */
export interface HubAutoUpdateSettings {
  /** Включен ли фоновый периодический опрос GitHub */
  backgroundPollingEnabled: boolean;
  /** Интервал фоновой проверки в минутах */
  pollingIntervalMinutes: number;
  /** Автоматически пересобирать все проекты с флагом autoUpdateEnabled при обнаружении коммита */
  autoRebuildOnCommit: boolean;
  /** Время последнего глобального опроса GitHub */
  lastGlobalPollAt: string | null;
}

/** Уровень критичности записи в едином системном журнале процессов */
export type ProcessLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/** Подсистема оркестратора, породившая событие или процесс */
export type ProcessLogSubsystem =
  | 'child-process'
  | 'apps-hub'
  | 'pipeline-build'
  | 'ai-healer'
  | 'shared-cache'
  | 'archive-security'
  | 'ipc-http';

/** Тип автоматического действия для исправления обнаруженной ошибки процесса */
export type ProcessFixActionType =
  | 'heal-dependency'
  | 'rollback-hub-app'
  | 'restart-hub-app'
  | 'repair-cache-workspace'
  | 'reset-ai-provider'
  | 'kill-zombie-process';

/** Рецепт автоматической диагностики и исправления ошибки процесса */
export interface ProcessErrorRemediation {
  /** Код классифицированной проблемы */
  issueCode:
    | 'PORT_CONFLICT'
    | 'BROKEN_DEPENDENCY'
    | 'CRASHED_HUB_APP'
    | 'CORRUPTED_WORKSPACE'
    | 'AI_ENDPOINT_OFFLINE'
    | 'GITHUB_RATE_LIMIT'
    | 'CACHE_OVERFLOW'
    | 'PROCESS_TIMEOUT'
    | 'EXECUTION_FAILURE';
  /** Человекочитаемое описание первопричины сбоя на русском языке */
  diagnosis: string;
  /** Текст на кнопке быстрого исправления в интерфейсе */
  suggestedActionLabel: string;
  /** Тип выполняемого сценария автоисправления */
  fixActionType: ProcessFixActionType;
  /** Конкретная команда или операция, которая будет выполнена для устранения сбоя */
  fixCommandPreview: string;
  /** Связанный ID приложения Хаба или задачи сборки */
  targetEntityId?: string;
  /** Устранена ли ошибка */
  resolved: boolean;
  /** Время устранения ошибки */
  resolvedAt?: string | null;
  /** Отчет о результате автоматического исправления */
  resolutionSummary?: string | null;
}

/** Запись в едином журнале всех процессов приложения (SystemProcessLogger) */
export interface SystemProcessLogEntry {
  /** Уникальный идентификатор записи лога */
  id: string;
  /** Точное время события в формате ISO */
  isoTimestamp: string;
  /** Краткое время ЧЧ:ММ:СС.мсс для табличного отображения */
  timestamp: string;
  /** Уровень важности события */
  level: ProcessLogLevel;
  /** Подсистема оркестратора */
  subsystem: ProcessLogSubsystem;
  /** Имя процесса или операции (например, ProcessRunner.spawn, AppsHub.launchApp) */
  processName: string;
  /** Системный PID процесса (если применимо) */
  pid: number | null;
  /** Код возврата процесса (0 — успех, >0 — ошибка) */
  exitCode: number | null;
  /** Длительность выполнения операции в миллисекундах */
  durationMs: number | null;
  /** Основное человекочитаемое сообщение */
  message: string;
  /** Выполнявшаяся команда или HTTP/IPC маршрут */
  command?: string;
  /** Рабочая директория процесса */
  cwd?: string;
  /** Подробные технические данные (stderr, stdout, stack trace) — скрываются под аккордеоном */
  technicalDetails?: string;
  /** Автоматическая диагностика и рецепт исправления (для warn / error / critical) */
  remediation?: ProcessErrorRemediation | null;
}

/** Агрегированное состояние единого журнала процессов и диагностики */
export interface ProcessLoggerState {
  /** Список записей журнала (от новых к старым) */
  entries: SystemProcessLogEntry[];
  /** Путь к файлу постоянного журнала на диске */
  logFilePath: string;
  /** Путь к структурированному JSONL-журналу */
  jsonlFilePath: string;
  /** Сводная статистика по процессам и ошибкам */
  stats: {
    totalEntries: number;
    errorCount: number;
    unresolvedErrorCount: number;
    resolvedErrorCount: number;
    warnCount: number;
    childProcessRunsCount: number;
  };
}


