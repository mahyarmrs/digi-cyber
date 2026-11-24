import type { Translate } from './i18n';

export function bytes(n: number): string {
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 2 : i === 0 ? 0 : 1)} ${units[i]}`;
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function spent(t: Translate, seconds: number): string {
  if (seconds >= 3600) return t('hoursShort', { n: (seconds / 3600).toFixed(seconds >= 36_000 ? 0 : 1) });
  return t('minutesShort', { n: Math.round(seconds / 60) });
}

export function daysLeft(expiry: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiry - now) / 86_400_000));
}
