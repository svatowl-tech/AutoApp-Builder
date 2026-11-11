/**
 * @file src/main/orchestrator/runner.ts
 * @description Безопасный исполнитель дочерних процессов через child_process.spawn с поддержкой
 *              каскадного завершения дерева процессов (tree-kill) на Windows, macOS и Linux,
 *              а также автоматической подстановкой переменных единого кэша.
 */

import { spawn, spawnSync, ChildProcess } from 'child_process';
import { SharedCacheManager } from './cache-manager.ts';
import { SystemProcessLogger } from './process-logger.ts';

export interface CommandRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  cancelled: boolean;
}

export type StreamLogCallback = (
  stream: 'stdout' | 'stderr' | 'system' | 'healer',
  line: string,
) => void;

export class ProcessRunner {
  private cacheManager: SharedCacheManager;
  private processLogger?: SystemProcessLogger;
  private activeProcess: ChildProcess | null = null;
  private wasCancelled = false;

  constructor(
    cacheManager: SharedCacheManager,
    processLogger?: SystemProcessLogger,
  ) {
    this.cacheManager = cacheManager;
    this.processLogger = processLogger;
  }

  /**
   * Запускает команду в рабочей директории проекта через child_process.spawn,
   * транслируя построчно stdout/stderr в реальном времени и фиксируя телеметрию в SystemProcessLogger.
   */
  public async runCommand(
    commandLine: string,
    cwd: string,
    onLog?: StreamLogCallback,
    timeoutMs = 180_000,
  ): Promise<CommandRunResult> {
    this.wasCancelled = false;
    const startTime = Date.now();
    const envWithSharedCache = this.cacheManager.getCentralizedCacheEnv();

    onLog?.('system', `$ ${commandLine}`);

    return new Promise<CommandRunResult>((resolve) => {
      let stdoutAccumulator = '';
      let stderrAccumulator = '';

      const child = spawn(commandLine, {
        cwd,
        env: envWithSharedCache,
        shell: true,
        detached: process.platform !== 'win32',
      });

      this.activeProcess = child;

      this.processLogger?.record({
        level: 'info',
        subsystem: 'child-process',
        processName: 'ProcessRunner.spawn',
        pid: child.pid ?? null,
        message: `Запущен дочерний процесс: ${commandLine}`,
        command: commandLine,
        cwd,
      });

      const timer = setTimeout(() => {
        const timeoutMsg = `[ProcessRunner] Превышен таймаут ожидания (${Math.round(timeoutMs / 1000)} сек). Дерево процессов принудительно останавливается.`;
        onLog?.('stderr', timeoutMsg);
        this.processLogger?.record({
          level: 'error',
          subsystem: 'child-process',
          processName: 'ProcessRunner.timeout',
          pid: child.pid ?? null,
          exitCode: 124,
          durationMs: Date.now() - startTime,
          message: timeoutMsg,
          command: commandLine,
          cwd,
          technicalDetails: stderrAccumulator || stdoutAccumulator,
        });
        this.killProcessTree(child.pid);
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        stdoutAccumulator += text;
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          onLog?.('stdout', line);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        stderrAccumulator += text;
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          onLog?.('stderr', line);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const pid = child.pid ?? null;
        this.activeProcess = null;
        const errMsg = err.message || 'Ошибка запуска дочернего процесса';
        stderrAccumulator += `\n${errMsg}`;
        onLog?.('stderr', errMsg);

        this.processLogger?.record({
          level: 'error',
          subsystem: 'child-process',
          processName: 'ProcessRunner.error',
          pid,
          exitCode: 1,
          durationMs,
          message: `Ошибка запуска дочернего процесса: ${errMsg}`,
          command: commandLine,
          cwd,
          technicalDetails: err.stack || stderrAccumulator,
        });

        resolve({
          exitCode: 1,
          stdout: stdoutAccumulator,
          stderr: stderrAccumulator,
          durationMs,
          cancelled: this.wasCancelled,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const pid = child.pid ?? null;
        const finalExitCode = code ?? (this.wasCancelled ? 130 : 1);
        this.activeProcess = null;

        this.processLogger?.record({
          level:
            finalExitCode === 0
              ? 'info'
              : this.wasCancelled
                ? 'warn'
                : 'error',
          subsystem: 'child-process',
          processName: 'ProcessRunner.exit',
          pid,
          exitCode: finalExitCode,
          durationMs,
          message:
            finalExitCode === 0
              ? `Дочерний процесс успешно завершен за ${durationMs} мс: ${commandLine}`
              : `Дочерний процесс завершился с кодом ${finalExitCode} (${durationMs} мс): ${commandLine}`,
          command: commandLine,
          cwd,
          technicalDetails:
            finalExitCode !== 0
              ? [stderrAccumulator.trim(), stdoutAccumulator.trim()]
                  .filter(Boolean)
                  .join('\n---\n')
              : stdoutAccumulator.trim().slice(-600) || undefined,
        });

        resolve({
          exitCode: finalExitCode,
          stdout: stdoutAccumulator,
          stderr: stderrAccumulator,
          durationMs,
          cancelled: this.wasCancelled,
        });
      });
    });
  }

  /**
   * Принудительно завершает активный процесс и все порожденные им дочерние субпроцессы (tree-kill).
   */
  public cancelActiveProcess(): boolean {
    if (!this.activeProcess || !this.activeProcess.pid) {
      return false;
    }
    this.wasCancelled = true;
    this.killProcessTree(this.activeProcess.pid);
    this.activeProcess = null;
    return true;
  }

  /**
   * Кроссплатформенное уничтожение дерева процессов по PID:
   * - Windows: `taskkill /pid <PID> /T /F`
   * - macOS / Linux: отрицательный PID группы процессов `-pid` + `pkill -TERM -P <PID>`
   */
  public killProcessTree(pid?: number): void {
    if (!pid) return;

    this.processLogger?.record({
      level: 'warn',
      subsystem: 'child-process',
      processName: 'ProcessRunner.killProcessTree',
      pid,
      message: `Выполнен каскадный tree-kill для группы процессов PID ${pid} (${process.platform}).`,
    });

    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
          stdio: 'ignore',
        });
      } else {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          spawnSync('pkill', ['-TERM', '-P', String(pid)], { stdio: 'ignore' });
          process.kill(pid, 'SIGTERM');
        }
      }
    } catch {
      // Процесс уже завершился
    }
  }
}
