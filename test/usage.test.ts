import { describe, expect, it } from 'vitest';

import { usageOf } from '../src/shared/usage';

const GB = 1024 ** 3;
const account = { username: 'dana', enabled: true, expiryTime: 0, deviceLimit: 0, devices: 0 };

describe('usageOf', () => {
  it('gives what is left and how full the plan is', () => {
    expect(usageOf({ ...account, upload: 2 * GB, download: 8 * GB, total: 50 * GB })).toEqual({
      used: 10 * GB,
      total: 50 * GB,
      left: 40 * GB,
      percent: 20,
      level: 'ok',
    });
  });

  it('warns from 80% and calls it critical from 95%, never past 100', () => {
    expect(usageOf({ ...account, upload: 0, download: 41 * GB, total: 50 * GB }).level).toBe('warn');
    expect(usageOf({ ...account, upload: 0, download: 48 * GB, total: 50 * GB }).level).toBe('bad');
    const over = usageOf({ ...account, upload: 0, download: 60 * GB, total: 50 * GB });
    expect([over.percent, over.left]).toEqual([100, 0]);
  });

  it('treats a total of 0 as unlimited', () => {
    expect(usageOf({ ...account, upload: GB, download: GB, total: 0 })).toEqual({ used: 2 * GB, total: 0, left: null, percent: null, level: 'ok' });
  });
});
