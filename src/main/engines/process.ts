import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';

// One engine program: its output goes to a log file and to 'line' listeners.
export class EngineProcess extends EventEmitter {
  private child: ChildProcess | null = null;
  private stopping = false;
  exitCode: number | null = null;

  constructor(
    readonly name: string,
    private readonly exe: string,
    private readonly args: string[],
    private readonly logFile: string,
    private readonly cwd?: string,
  ) {
    super();
  }

  start(): void {
    if (!fs.existsSync(this.exe)) throw new Error(`engine_missing:${this.name}`);
    const log = fs.createWriteStream(this.logFile, { flags: 'w' });
    const child = spawn(this.exe, this.args, { cwd: this.cwd, windowsHide: true });
    this.child = child;
    let partial = '';
    const onData = (d: Buffer) => {
      log.write(d);
      partial += d.toString();
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() ?? '';
      for (const line of lines) this.emit('line', line);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => log.write(`\n${String(err)}\n`));
    child.on('exit', (code) => {
      this.exitCode = code ?? -1;
      this.child = null;
      log.end();
      this.emit('exit', { code, expected: this.stopping });
    });
  }

  get alive(): boolean {
    return this.child !== null;
  }

  // The app is about to make the program end itself (OpenVPN's SIGTERM over its management port), so
  // its exit is the app's doing and not a dropped connection.
  expectExit(): void {
    if (this.child) this.stopping = true;
  }

  // Resolves true once the program has exited, false when it is still running after timeoutMs.
  exited(timeoutMs: number): Promise<boolean> {
    const child = this.child;
    if (!child) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.off('exit', done);
        resolve(false);
      }, timeoutMs);
      child.once('exit', done);
    });
  }

  async stop(timeoutMs = 5000): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill();
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    await exited;
    clearTimeout(timer);
  }
}

export function waitForLine(proc: EngineProcess, ok: RegExp, fail: RegExp, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      proc.off('line', onLine);
      proc.off('exit', onExit);
    };
    const onLine = (line: string) => {
      if (ok.test(line)) {
        cleanup();
        resolve(true);
      } else if (fail.test(line)) {
        cleanup();
        resolve(false);
      }
    };
    const onExit = () => {
      cleanup();
      resolve(false);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    proc.on('line', onLine);
    proc.on('exit', onExit);
  });
}
