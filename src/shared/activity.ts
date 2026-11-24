import type { Activity } from './types';

export function dayKey(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const keepDays = 31;
const keepRecents = 8;

// Books a connected span on the local days it covers, keeping the last month.
export function addSpan(days: Record<string, number>, start: number, end: number): Record<string, number> {
  const out = { ...days };
  let cursor = start;
  while (cursor < end) {
    const next = new Date(cursor);
    next.setHours(24, 0, 0, 0);
    const stop = Math.min(end, next.getTime());
    const key = dayKey(cursor);
    out[key] = (out[key] ?? 0) + Math.round((stop - cursor) / 1000);
    cursor = stop;
  }
  const oldest = dayKey(end - keepDays * 86_400_000);
  for (const key of Object.keys(out)) if (key < oldest) delete out[key];
  return out;
}

export function pushRecent(recents: (number | null)[], locationId: number | null): (number | null)[] {
  return [locationId, ...recents.filter((id) => id !== locationId)].slice(0, keepRecents);
}

// The last n days, oldest first, with the seconds connected on each.
export function lastDays(activity: Activity, n: number, now = Date.now()): { key: string; seconds: number }[] {
  const out: { key: string; seconds: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dayKey(d.getTime());
    out.push({ key, seconds: activity.days[key] ?? 0 });
  }
  return out;
}
