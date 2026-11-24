import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EngineProcess } from '../src/main/engines/process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-proc-'));
const node = (name: string, script: string) => new EngineProcess(name, process.execPath, ['-e', script], path.join(dir, `${name}.log`));

describe('an engine that the app makes end itself', () => {
  it('reports its own exit as the app stopping it, not as a dropped connection', async () => {
    const proc = node('ends', 'setTimeout(() => {}, 300)');
    const exits: boolean[] = [];
    proc.on('exit', ({ expected }: { expected: boolean }) => exits.push(expected));
    proc.start();
    proc.expectExit();
    expect(await proc.exited(5000)).toBe(true);
    expect(proc.alive).toBe(false);
    expect(exits).toEqual([true]);
  });

  it('is waited for only as long as asked, then stopped', async () => {
    const proc = node('stays', 'setInterval(() => {}, 1000)');
    proc.start();
    proc.expectExit();
    expect(await proc.exited(200)).toBe(false);
    expect(proc.alive).toBe(true);
    await proc.stop(2000);
    expect(proc.alive).toBe(false);
    expect(await proc.exited(10)).toBe(true);
  });

  it('still reports an exit nobody asked for as unexpected', async () => {
    const proc = node('drops', 'process.exit(3)');
    const exits: boolean[] = [];
    proc.on('exit', ({ expected }: { expected: boolean }) => exits.push(expected));
    proc.start();
    expect(await proc.exited(5000)).toBe(true);
    expect(exits).toEqual([false]);
  });
});
