/**
 * @file src/main/orchestrator/healer.ts
 * @description Модуль рекурсивного цикла исправления ошибок сборки (Error Healing Loop).
 *              Перехватывает ненулевые коды возврата дочерних процессов, отправляет stderr
 *              активному локальному ИИ-провайдеру, проверяет безопасность предложенной команды
 *              {"fix_command": "...", "retry": true/false} и перезапускает шаг (до 4 попыток).
 */

import { LocalAIProvider } from '../ai/provider.ts';
import {
  ProcessRunner,
  CommandRunResult,
  StreamLogCallback,
} from './runner.ts';
import { SystemProcessLogger } from './process-logger.ts';

export interface HealedExecutionResult extends CommandRunResult {
  healAttemptsUsed: number;
  appliedFixes: string[];
}

export class ErrorHealer {
  private aiProvider: LocalAIProvider;
  private runner: ProcessRunner;
  private processLogger?: SystemProcessLogger;

  constructor(
    aiProvider: LocalAIProvider,
    runner: ProcessRunner,
    processLogger?: SystemProcessLogger,
  ) {
    this.aiProvider = aiProvider;
    this.runner = runner;
    this.processLogger = processLogger;
  }

  /**
   * Выполняет команду сборки с автоматическим циклом самоисцеления (до 4 попыток при ошибках).
   */
  public async runWithHealing(params: {
    command: string;
    cwd: string;
    projectStack: string;
    stepName: string;
    onLog?: StreamLogCallback;
    onHealAttemptChange?: (attempt: number, maxAttempts: number) => void;
    customFixHook?: (
      fixCommand: string,
      cwd: string,
      attempt: number,
    ) => Promise<boolean>;
  }): Promise<HealedExecutionResult> {
    const maxAttempts = this.aiProvider.getConfig().maxHealAttempts || 4;
    let attempt = 0;
    const appliedFixes: string[] = [];

    while (attempt <= maxAttempts) {
      const result = await this.runner.runCommand(
        params.command,
        params.cwd,
        params.onLog,
      );

      // Если шаг выполнен успешно (exitCode === 0) или отменен пользователем — выходим из цикла
      if (result.exitCode === 0 || result.cancelled) {
        if (attempt > 0 && result.exitCode === 0) {
          this.processLogger?.record({
            level: 'info',
            subsystem: 'ai-healer',
            processName: 'ErrorHealer.recovered',
            exitCode: 0,
            durationMs: result.durationMs,
            message: `Шаг "${params.stepName}" успешно восстановлен после ${attempt} попытки самоисцеления.`,
            command: params.command,
            cwd: params.cwd,
            technicalDetails: `Примененные исправления: ${appliedFixes.join(' -> ')}`,
          });
        }
        return {
          ...result,
          healAttemptsUsed: attempt,
          appliedFixes,
        };
      }

      attempt++;
      if (attempt > maxAttempts) {
        const exhaustedMsg = `[Healer] Исчерпан лимит попыток самоисцеления (${maxAttempts}). Шаг "${params.stepName}" завершился с кодом ${result.exitCode}.`;
        params.onLog?.('healer', exhaustedMsg);
        this.processLogger?.record({
          level: 'error',
          subsystem: 'ai-healer',
          processName: 'ErrorHealer.exhausted',
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          message: exhaustedMsg,
          command: params.command,
          cwd: params.cwd,
          technicalDetails: result.stderr || result.stdout,
        });
        return {
          ...result,
          healAttemptsUsed: attempt - 1,
          appliedFixes,
        };
      }

      params.onHealAttemptChange?.(attempt, maxAttempts);
      const interceptMsg = `[Healer · Попытка ${attempt}/${maxAttempts}] Перехвачен код возврата ${result.exitCode}. Передача stderr в локальный ИИ (${this.aiProvider.getConfig().mode})...`;
      params.onLog?.('healer', interceptMsg);

      this.processLogger?.record({
        level: 'warn',
        subsystem: 'ai-healer',
        processName: 'ErrorHealer.intercept',
        exitCode: result.exitCode,
        message: interceptMsg,
        command: params.command,
        cwd: params.cwd,
        technicalDetails: result.stderr || result.stdout,
      });

      const prescription = await this.aiProvider.requestErrorFix({
        failedCommand: params.command,
        stderr: result.stderr || 'Non-zero exit code without stderr output',
        stdout: result.stdout,
        projectStack: params.projectStack,
        attemptNumber: attempt,
      });

      params.onLog?.(
        'healer',
        `[Healer · ИИ Ответ] ${JSON.stringify({
          fix_command: prescription.fix_command,
          retry: prescription.retry,
        })} — ${prescription.explanation || ''}`,
      );

      this.processLogger?.record({
        level: 'info',
        subsystem: 'ai-healer',
        processName: 'ErrorHealer.prescription',
        exitCode: 0,
        message: `ИИ-движок предложил рецепт исправления: "${prescription.fix_command}" (retry: ${prescription.retry})`,
        command: prescription.fix_command,
        cwd: params.cwd,
        technicalDetails: prescription.explanation,
      });

      if (!prescription.retry || !prescription.fix_command.trim()) {
        params.onLog?.(
          'healer',
          `[Healer] ИИ сообщил, что автоматическое исправление невозможно (retry: false).`,
        );
        return {
          ...result,
          healAttemptsUsed: attempt,
          appliedFixes,
        };
      }

      if (!this.isCommandSafeForSandbox(prescription.fix_command)) {
        const secMsg = `[Healer · Security Guard] Отклонена потенциально опасная команда: "${prescription.fix_command}"`;
        params.onLog?.('healer', secMsg);
        this.processLogger?.record({
          level: 'critical',
          subsystem: 'ai-healer',
          processName: 'ErrorHealer.securityGuard',
          exitCode: 1,
          message: secMsg,
          command: prescription.fix_command,
          cwd: params.cwd,
        });
        return {
          ...result,
          healAttemptsUsed: attempt,
          appliedFixes,
        };
      }

      params.onLog?.(
        'healer',
        `[Healer] Применение исправления: $ ${prescription.fix_command}`,
      );

      if (params.customFixHook) {
        await params.customFixHook(
          prescription.fix_command,
          params.cwd,
          attempt,
        );
      }

      const fixRun = await this.runner.runCommand(
        prescription.fix_command,
        params.cwd,
        params.onLog,
      );

      appliedFixes.push(prescription.fix_command);

      if (fixRun.cancelled) {
        return {
          ...fixRun,
          healAttemptsUsed: attempt,
          appliedFixes,
        };
      }

      params.onLog?.(
        'healer',
        `[Healer] Исправление применено. Перезапуск шага "${params.stepName}"...`,
      );
    }

    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Превышено число попыток самоисцеления',
      durationMs: 0,
      cancelled: false,
      healAttemptsUsed: maxAttempts,
      appliedFixes,
    };
  }

  /**
   * Фильтр безопасности команд ИИ: блокирует форматирование дисков, удаление корневых папок
   * или обращение к системным директориям за пределами рабочей песочницы проекта.
   */
  public isCommandSafeForSandbox(cmd: string): boolean {
    const normalized = cmd.trim().toLowerCase();
    const forbiddenPatterns = [
      /rm\s+-rf\s+\/(\s|$)/,
      /rm\s+-rf\s+~(\s|\/|$)/,
      /mkfs/,
      /dd\s+if=/,
      /:(){ :|:& };:/,
      /format\s+[a-z]:/i,
      /del\s+\/s\s+\/q\s+c:\\/i,
      /shutdown/,
      /reboot/,
    ];

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(normalized)) {
        return false;
      }
    }
    return true;
  }
}
