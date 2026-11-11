/**
 * @file src/main/ai/provider.ts
 * @description Единая кроссплатформенная абстракция локального ИИ-движка (100% бесплатно, без платных облачных API).
 *              Поддерживает 4 режима работы:
 *              1. "builtin-llama" — встроенный бинарник llama-server на 127.0.0.1:8080 с GGUF-моделями в userData/models.
 *              2. "ollama" — подключение к локальному демону Ollama (http://localhost:11434).
 *              3. "local-server" — подключение к стороннему локальному серверу (LM Studio, LocalAI) по кастомному URL.
 *              4. "custom-openai" — подключение к любому OpenAI-совместимому API (base URL + опциональный ключ).
 *              Модели Gemini и проприетарные платные SDK категорически НЕ используются.
 */

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  AIProviderConfig,
  AIHealPrescription,
  PresetGGUFModel,
} from '../../shared/types.ts';

/**
 * Реестр предустановленных легковесных квантованных моделей (строго до 3B параметров),
 * оптимизированных для работы на CPU и интегрированных GPU без дискретной видеокарты.
 */
export const PRESET_GGUF_MODELS: PresetGGUFModel[] = [
  {
    id: 'qwen2.5-coder-0.5b-q4_k_m',
    name: 'Qwen 2.5 Coder 0.5B Instruct',
    family: 'Qwen 2.5 Coder',
    parameters: '0.5B',
    quantization: 'Q4_K_M',
    fileName: 'qwen2.5-coder-0.5b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf',
    sizeBytes: 397_000_000,
    minRamGb: 1.5,
    description: 'Сверхбыстрая специализированная кодовая модель (397 МБ) для мгновенного анализа stderr на любом ПК.',
  },
  {
    id: 'qwen2.5-coder-1.5b-q4_k_m',
    name: 'Qwen 2.5 Coder 1.5B Instruct',
    family: 'Qwen 2.5 Coder',
    parameters: '1.5B',
    quantization: 'Q4_K_M',
    fileName: 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
    sizeBytes: 1_120_000_000,
    minRamGb: 2.5,
    description: 'Оптимальный баланс точности и скорости для исправления ошибок npm, pip, Cargo и Gradle.',
  },
  {
    id: 'qwen2.5-coder-3b-q4_k_m',
    name: 'Qwen 2.5 Coder 3B Instruct',
    family: 'Qwen 2.5 Coder',
    parameters: '3B',
    quantization: 'Q4_K_M',
    fileName: 'qwen2.5-coder-3b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf',
    sizeBytes: 2_105_000_000,
    minRamGb: 4.0,
    description: 'Флагманская легковесная кодовая модель до 3B для сложных конфликтов зависимостей и флагов C++/Rust.',
  },
  {
    id: 'llama-3.2-1b-q4_k_m',
    name: 'Llama 3.2 1B Instruct',
    family: 'Llama 3.2',
    parameters: '1B',
    quantization: 'Q4_K_M',
    fileName: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    sizeBytes: 808_000_000,
    minRamGb: 2.0,
    description: 'Компактная универсальная модель Meta Llama 3.2 (1B) с низким потреблением памяти.',
  },
  {
    id: 'llama-3.2-3b-q4_k_m',
    name: 'Llama 3.2 3B Instruct',
    family: 'Llama 3.2',
    parameters: '3B',
    quantization: 'Q4_K_M',
    fileName: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sizeBytes: 2_019_000_000,
    minRamGb: 4.0,
    description: 'Мощная модель Llama 3.2 (3B) с высокой точностью генерации JSON-предписаний самоисцеления.',
  },
  {
    id: 'smollm2-1.7b-q4_k_m',
    name: 'SmolLM2 1.7B Instruct',
    family: 'SmolLM2',
    parameters: '1.7B',
    quantization: 'Q4_K_M',
    fileName: 'SmolLM2-1.7B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/SmolLM2-1.7B-Instruct-GGUF/resolve/main/SmolLM2-1.7B-Instruct-Q4_K_M.gguf',
    sizeBytes: 1_055_000_000,
    minRamGb: 2.5,
    description: 'Эффективная модель от HuggingFace (1.7B), обученная на большом корпусе кода и технических логов.',
  },
];

/**
 * Системный промпт для легковесных моделей (до 3B параметров).
 * Строго ограничивает вывод форматом JSON {"fix_command": "...", "retry": true/false}.
 */
const SYSTEM_HEALER_PROMPT = `Ты — автономный инженер самоисцеления сборки (Build Error Healer) в приложении AutoApp-Builder.
Твоя задача: проанализировать код возврата, команду и поток stderr упавшего шага сборки и вернуть СТРОГО валидный JSON-объект без Markdown-разметки:
{
  "fix_command": "точная shell-команда для устранения ошибки",
  "retry": true,
  "explanation": "краткое описание причины на русском языке"
}
Правила:
1. Если не хватает пакета npm — предложи "npm install <package> --save --legacy-peer-deps".
2. Если конфликт peerDependencies в npm — предложи "npm install --legacy-peer-deps".
3. Если не найден модуль Python (ModuleNotFoundError) — предложи "pip install <module>".
4. Если не установлен PyInstaller — предложи "pip install pyinstaller".
5. Если ошибка не может быть исправлена командой — верни {"fix_command": "", "retry": false, "explanation": "причина"}.
Отвечай ТОЛЬКО чистым JSON.`;

export class LocalAIProvider {
  private config: AIProviderConfig;
  private userDataDir: string;
  private llamaServerProcess: ChildProcess | null = null;

  constructor(userDataDir?: string, initialConfig?: Partial<AIProviderConfig>) {
    this.userDataDir =
      userDataDir || path.join(os.homedir(), '.autoapp-builder');

    const modelsDir = this.getModelsDirectory();
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }

    this.config = {
      mode: initialConfig?.mode || 'builtin-llama',
      selectedModelId:
        initialConfig?.selectedModelId || 'qwen2.5-coder-1.5b-q4_k_m',
      builtinLlamaUrl:
        initialConfig?.builtinLlamaUrl || 'http://127.0.0.1:8080',
      ollamaBaseUrl:
        initialConfig?.ollamaBaseUrl || 'http://127.0.0.1:11434',
      ollamaModelName:
        initialConfig?.ollamaModelName || 'qwen2.5-coder:1.5b',
      localServerUrl:
        initialConfig?.localServerUrl || 'http://127.0.0.1:1234/v1',
      customOpenAiUrl:
        initialConfig?.customOpenAiUrl || 'http://127.0.0.1:8000/v1',
      customOpenAiKey: initialConfig?.customOpenAiKey || '',
      maxHealAttempts: initialConfig?.maxHealAttempts ?? 4,
    };
  }

  /** Возвращает путь к директории хранения GGUF-моделей (userData/models) */
  public getModelsDirectory(): string {
    return path.join(this.userDataDir, 'models');
  }

  /** Возвращает текущую конфигурацию ИИ-движка */
  public getConfig(): AIProviderConfig {
    return { ...this.config };
  }

  /** Обновляет конфигурацию ИИ-провайдера */
  public updateConfig(partial: Partial<AIProviderConfig>): AIProviderConfig {
    this.config = {
      ...this.config,
      ...partial,
      maxHealAttempts: Math.min(
        4,
        Math.max(1, Number(partial.maxHealAttempts ?? this.config.maxHealAttempts)),
      ),
    };
    return this.getConfig();
  }

  /**
   * Возвращает список предустановленных моделей (до 3B) с актуальной отметкой,
   * скачана ли каждая модель на локальный диск в userData/models.
   */
  public getPresetModelsWithStatus(): PresetGGUFModel[] {
    const modelsDir = this.getModelsDirectory();
    return PRESET_GGUF_MODELS.map((model) => {
      const fullPath = path.join(modelsDir, model.fileName);
      let installed = false;
      let installedBytes = 0;

      if (fs.existsSync(fullPath)) {
        try {
          const stat = fs.statSync(fullPath);
          installed = stat.size > 1024;
          installedBytes = stat.size;
        } catch {
          installed = false;
        }
      }

      return {
        ...model,
        installed,
        installedBytes,
      };
    });
  }

  /**
   * Запускает встроенный бинарник llama-server на 127.0.0.1:8080 с выбранной GGUF-моделью,
   * если режим равен "builtin-llama" и бинарник присутствует в окружении.
   */
  public async ensureBuiltinLlamaServerRunning(): Promise<{
    running: boolean;
    message: string;
  }> {
    // Сначала проверяем, не отвечает ли уже запущенный llama-server на 127.0.0.1:8080
    const healthUrl = `${this.config.builtinLlamaUrl.replace(/\/$/, '')}/health`;
    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        return {
          running: true,
          message: `Встроенный сервер llama-server активен на ${this.config.builtinLlamaUrl}`,
        };
      }
    } catch {
      // Сервер еще не запущен — пробуем поднять локальный процесс
    }

    const selectedModel =
      PRESET_GGUF_MODELS.find((m) => m.id === this.config.selectedModelId) ||
      PRESET_GGUF_MODELS[1];
    const modelPath = path.join(this.getModelsDirectory(), selectedModel.fileName);

    if (!fs.existsSync(modelPath)) {
      return {
        running: false,
        message: `Модель ${selectedModel.fileName} еще не скачана в userData/models. Доступен детерминированный + локальный анализатор.`,
      };
    }

    const binaryName =
      process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const candidatePaths = [
      path.join(this.userDataDir, 'bin', binaryName),
      path.join(process.cwd(), 'bin', binaryName),
      binaryName,
    ];

    const binaryToRun =
      candidatePaths.find((p) => p !== binaryName && fs.existsSync(p)) ||
      binaryName;

    try {
      const cpuThreads = Math.max(2, Math.min(8, os.cpus().length));
      this.llamaServerProcess = spawn(
        binaryToRun,
        [
          '-m',
          modelPath,
          '--host',
          '127.0.0.1',
          '--port',
          '8080',
          '-c',
          '4096',
          '-t',
          String(cpuThreads),
        ],
        {
          stdio: 'ignore',
          detached: false,
        },
      );

      this.llamaServerProcess.on('error', () => {
        this.llamaServerProcess = null;
      });

      return {
        running: true,
        message: `Запущен процесс llama-server (${selectedModel.name}) на 127.0.0.1:8080`,
      };
    } catch (error) {
      return {
        running: false,
        message: `Не удалось запустить бинарник llama-server (${(error as Error).message}).`,
      };
    }
  }

  /** Останавливает дочерний процесс встроенного llama-server при выходе из приложения */
  public stopBuiltinLlamaServer(): void {
    if (this.llamaServerProcess && !this.llamaServerProcess.killed) {
      this.llamaServerProcess.kill('SIGTERM');
      this.llamaServerProcess = null;
    }
  }

  /**
   * Проверяет доступность выбранного ИИ-провайдера (ping/healthcheck).
   */
  public async testConnection(): Promise<{
    reachable: boolean;
    mode: string;
    endpoint: string;
    latencyMs: number;
    details: string;
  }> {
    const startTime = Date.now();
    const { mode } = this.config;

    try {
      if (mode === 'builtin-llama') {
        const endpoint = `${this.config.builtinLlamaUrl.replace(/\/$/, '')}/health`;
        const response = await fetch(endpoint, {
          method: 'GET',
          signal: AbortSignal.timeout(2500),
        });
        const latencyMs = Date.now() - startTime;
        if (response.ok) {
          return {
            reachable: true,
            mode,
            endpoint,
            latencyMs,
            details: 'Сервер llama-server (127.0.0.1:8080) готов к обработке запросов самоисцеления.',
          };
        }
      } else if (mode === 'ollama') {
        const endpoint = `${this.config.ollamaBaseUrl.replace(/\/$/, '')}/api/tags`;
        const response = await fetch(endpoint, {
          method: 'GET',
          signal: AbortSignal.timeout(2500),
        });
        const latencyMs = Date.now() - startTime;
        if (response.ok) {
          return {
            reachable: true,
            mode,
            endpoint,
            latencyMs,
            details: `Локальный демон Ollama доступен (выбрана модель: ${this.config.ollamaModelName}).`,
          };
        }
      } else if (mode === 'local-server') {
        const endpoint = `${this.config.localServerUrl.replace(/\/$/, '')}/models`;
        const response = await fetch(endpoint, {
          method: 'GET',
          signal: AbortSignal.timeout(2500),
        });
        const latencyMs = Date.now() - startTime;
        if (response.ok) {
          return {
            reachable: true,
            mode,
            endpoint,
            latencyMs,
            details: 'Локальный сервер (LM Studio / LocalAI) успешно ответил на запрос /v1/models.',
          };
        }
      } else if (mode === 'custom-openai') {
        const endpoint = `${this.config.customOpenAiUrl.replace(/\/$/, '')}/models`;
        const headers: Record<string, string> = {};
        if (this.config.customOpenAiKey) {
          headers['Authorization'] = `Bearer ${this.config.customOpenAiKey}`;
        }
        const response = await fetch(endpoint, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(3000),
        });
        const latencyMs = Date.now() - startTime;
        if (response.ok) {
          return {
            reachable: true,
            mode,
            endpoint,
            latencyMs,
            details: 'OpenAI-совместимый сервер успешно прошел проверку соединения.',
          };
        }
      }
    } catch {
      // Если локальный демон на машине еще не запущен, возвращаем честный статус с готовностью встроенного анализатора
    }

    const latencyMs = Date.now() - startTime;
    const activeEndpoint =
      mode === 'builtin-llama'
        ? this.config.builtinLlamaUrl
        : mode === 'ollama'
          ? this.config.ollamaBaseUrl
          : mode === 'local-server'
            ? this.config.localServerUrl
            : this.config.customOpenAiUrl;

    return {
      reachable: false,
      mode,
      endpoint: activeEndpoint,
      latencyMs,
      details: `Локальный демон по адресу ${activeEndpoint} сейчас не запущен. При сборке автоматически используется встроенный локальный движок правил самоисцеления.`,
    };
  }

  /**
   * Главный метод диагностики ошибки сборки: отправляет stderr в активный ИИ-провайдер
   * (builtin-llama, ollama, local-server или custom-openai) и парсит JSON-ответ:
   * {"fix_command": "...", "retry": true/false}.
   */
  public async requestErrorFix(params: {
    failedCommand: string;
    stderr: string;
    stdout: string;
    projectStack: string;
    attemptNumber: number;
  }): Promise<AIHealPrescription> {
    const userPrompt = [
      `Стек проекта: ${params.projectStack}`,
      `Попытка исправления: ${params.attemptNumber} из ${this.config.maxHealAttempts}`,
      `Упавшая команда: ${params.failedCommand}`,
      `Лог ошибки (stderr):`,
      params.stderr.slice(-3000),
    ].join('\n');

    try {
      let rawResponseText = '';

      if (this.config.mode === 'builtin-llama') {
        await this.ensureBuiltinLlamaServerRunning();
        const url = `${this.config.builtinLlamaUrl.replace(/\/$/, '')}/v1/chat/completions`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.selectedModelId,
            messages: [
              { role: 'system', content: SYSTEM_HEALER_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: 256,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          rawResponseText = data.choices?.[0]?.message?.content || '';
        }
      } else if (this.config.mode === 'ollama') {
        const url = `${this.config.ollamaBaseUrl.replace(/\/$/, '')}/api/chat`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.ollamaModelName || 'qwen2.5-coder:1.5b',
            messages: [
              { role: 'system', content: SYSTEM_HEALER_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            format: 'json',
            stream: false,
            options: { temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            message?: { content?: string };
          };
          rawResponseText = data.message?.content || '';
        }
      } else if (
        this.config.mode === 'local-server' ||
        this.config.mode === 'custom-openai'
      ) {
        const baseUrl =
          this.config.mode === 'local-server'
            ? this.config.localServerUrl
            : this.config.customOpenAiUrl;
        const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (
          this.config.mode === 'custom-openai' &&
          this.config.customOpenAiKey
        ) {
          headers['Authorization'] = `Bearer ${this.config.customOpenAiKey}`;
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: this.config.selectedModelId,
            messages: [
              { role: 'system', content: SYSTEM_HEALER_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: 256,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          rawResponseText = data.choices?.[0]?.message?.content || '';
        }
      }

      if (rawResponseText.trim()) {
        const parsed = this.parseJsonPrescription(rawResponseText);
        if (parsed) {
          return parsed;
        }
      }
    } catch {
      // Переходим к встроенному локальному эвристическому анализатору ошибок
    }

    return this.buildDeterministicLocalPrescription(
      params.failedCommand,
      params.stderr + '\n' + params.stdout,
    );
  }

  /**
   * Извлекает и валидирует JSON {"fix_command": "...", "retry": true/false} из ответа локальной модели.
   */
  private parseJsonPrescription(rawText: string): AIHealPrescription | null {
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      if (typeof obj.fix_command === 'string' && typeof obj.retry === 'boolean') {
        return {
          fix_command: obj.fix_command.trim(),
          retry: obj.retry,
          explanation:
            typeof obj.explanation === 'string'
              ? obj.explanation
              : 'Получено предписание от локальной ИИ-модели.',
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Локальный анализатор типовых ошибок компиляции (Node/npm, Python/pip, Rust/Cargo, Go, Gradle),
   * обеспечивающий 100% автономную работу даже при отсутствии запущенного внешнего демона.
   */
  private buildDeterministicLocalPrescription(
    failedCommand: string,
    combinedLog: string,
  ): AIHealPrescription {
    // 1. Отсутствующий npm-пакет: Cannot find module 'xyz' или Cannot find package 'xyz'
    const missingNodeModuleMatch =
      combinedLog.match(/Cannot find (?:module|package) ['"]([^'"]+)['"]/i) ||
      combinedLog.match(/Error: Failed to resolve import ["']([^"']+)["']/i);
    if (missingNodeModuleMatch && missingNodeModuleMatch[1]) {
      const pkgName = missingNodeModuleMatch[1];
      if (!pkgName.startsWith('.') && !pkgName.startsWith('/')) {
        return {
          fix_command: `npm install ${pkgName} --save --legacy-peer-deps`,
          retry: true,
          explanation: `Обнаружен отсутствующий пакет Node.js "${pkgName}". Выполняется автоматическая доустановка.`,
        };
      }
    }

    // 2. Конфликт дерева зависимостей npm (ERESOLVE)
    if (/ERESOLVE unable to resolve dependency tree/i.test(combinedLog)) {
      return {
        fix_command: 'npm install --legacy-peer-deps',
        retry: true,
        explanation: 'Конфликт peerDependencies в npm. Применяется флаг --legacy-peer-deps.',
      };
    }

    // 3. Отсутствует команда vite / tsc / electron-builder (не установлены devDependencies)
    if (
      /(?:vite|tsc|electron-builder|vue-tsc|next): (?:not found|command not found|не является внутренней)/i.test(
        combinedLog,
      )
    ) {
      return {
        fix_command: 'npm install --include=dev --legacy-peer-deps',
        retry: true,
        explanation: 'Не найдены CLI-утилиты сборки. Выполняется полная установка devDependencies.',
      };
    }

    // 4. Ошибка отсутствия модуля в Python (ModuleNotFoundError: No module named 'xxx')
    const missingPyModule = combinedLog.match(
      /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/i,
    );
    if (missingPyModule && missingPyModule[1]) {
      return {
        fix_command: `pip install ${missingPyModule[1]}`,
        retry: true,
        explanation: `Отсутствует Python-пакет "${missingPyModule[1]}". Выполняется установка через pip.`,
      };
    }

    // 5. Ошибка отсутствия PyInstaller
    if (/pyinstaller: (?:not found|command not found)/i.test(combinedLog)) {
      return {
        fix_command: 'pip install pyinstaller',
        retry: true,
        explanation: 'Утилита PyInstaller не найдена в окружении. Выполняется установка через pip.',
      };
    }

    // 6. Ошибка Go: missing go.sum entry
    if (/missing go\.sum entry/i.test(combinedLog)) {
      return {
        fix_command: 'go mod tidy',
        retry: true,
        explanation: 'Не синхронизированы контрольные суммы go.sum. Выполняется go mod tidy.',
      };
    }

    // 7. Ошибка прав запуска gradlew на Linux/macOS
    if (/gradlew: Permission denied/i.test(combinedLog)) {
      return {
        fix_command: 'chmod +x gradlew',
        retry: true,
        explanation: 'Отсутствуют права на исполнение скрипта gradlew. Выдаются права chmod +x.',
      };
    }

    // 8. Поврежденный кэш или сбой сборки npm build — пробуем переустановку зависимостей
    if (failedCommand.includes('npm') && !failedCommand.includes('--force')) {
      return {
        fix_command: 'npm install --legacy-peer-deps',
        retry: true,
        explanation: 'Сбой на этапе выполнения команды npm. Выполняется синхронизация node_modules.',
      };
    }

    return {
      fix_command: '',
      retry: false,
      explanation: 'Автоматическое исправление не смогло подобрать безопасную команду для данной ошибки.',
    };
  }
}
