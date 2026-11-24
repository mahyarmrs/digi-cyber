import type { AppAccount } from './types';

export interface Usage {
  used: number;
  total: number;
  // null when the plan has no traffic cap.
  left: number | null;
  percent: number | null;
  level: 'ok' | 'warn' | 'bad';
}

export function usageOf(account: AppAccount): Usage {
  const used = account.upload + account.download;
  if (account.total <= 0) return { used, total: 0, left: null, percent: null, level: 'ok' };
  const percent = Math.min(100, Math.round((used / account.total) * 1000) / 10);
  return {
    used,
    total: account.total,
    left: Math.max(0, account.total - used),
    percent,
    level: percent >= 95 ? 'bad' : percent >= 80 ? 'warn' : 'ok',
  };
}
