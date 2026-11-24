import { spawn } from 'node:child_process';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Arguments go to the program as a list: nothing passes through a shell.
export function run(command: string, args: string[], timeoutMs = 30_000, env?: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, env: env ? { ...process.env, ...env } : undefined });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// A script file from the app's own folder, its values in the environment: no encoded command.
export function powershellFile(file: string, env: Record<string, string>, timeoutMs = 60_000): Promise<RunResult> {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], timeoutMs, env);
}

export async function regQuery(key: string, value: string): Promise<string | null> {
  const res = await run('reg.exe', ['query', key, '/v', value]);
  if (res.code !== 0) return null;
  const match = new RegExp(`${value}\\s+REG_\\w+\\s+(.*)`).exec(res.stdout);
  return match ? match[1].trim() : null;
}

export async function regSet(key: string, value: string, type: 'REG_SZ' | 'REG_DWORD', data: string): Promise<boolean> {
  const res = await run('reg.exe', ['add', key, '/v', value, '/t', type, '/d', data, '/f']);
  return res.code === 0;
}

export async function regDelete(key: string, value: string): Promise<void> {
  await run('reg.exe', ['delete', key, '/v', value, '/f']);
}
