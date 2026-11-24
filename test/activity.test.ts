import { describe, expect, it } from 'vitest';

import { addSpan, dayKey, lastDays, pushRecent } from '../src/shared/activity';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('addSpan', () => {
  it('splits a session that runs past midnight between the two days', () => {
    const days = addSpan({}, at(2026, 11, 16, 23, 30), at(2026, 11, 17, 1, 0));
    expect(days).toEqual({ '2026-11-16': 1800, '2026-11-17': 3600 });
  });

  it('adds to what a day already has and forgets days older than a month', () => {
    const days = addSpan({ '2026-11-17': 60, '2026-09-01': 999 }, at(2026, 11, 17, 10), at(2026, 11, 17, 10, 1));
    expect(days).toEqual({ '2026-11-17': 120 });
  });
});

describe('pushRecent', () => {
  it('moves a location to the front once and keeps eight', () => {
    expect(pushRecent([3, 1, 2], 1)).toEqual([1, 3, 2]);
    expect(pushRecent([1, 2, 3, 4, 5, 6, 7, 8], 9)).toEqual([9, 1, 2, 3, 4, 5, 6, 7]);
    expect(pushRecent([2], null)).toEqual([null, 2]);
  });
});

describe('lastDays', () => {
  it('lists the last days oldest first, empty days as zero', () => {
    const now = at(2026, 11, 17, 12);
    expect(lastDays({ days: { [dayKey(now)]: 30, '2026-11-15': 10 }, recents: [] }, 3, now)).toEqual([
      { key: '2026-11-15', seconds: 10 },
      { key: '2026-11-16', seconds: 0 },
      { key: '2026-11-17', seconds: 30 },
    ]);
  });
});
