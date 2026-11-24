import type { AppProfile, NoticeLevel } from './types';

export interface NoticeEntry {
  key: string;
  id: number;
  body: string;
  level: NoticeLevel;
  createdAt: number | null;
}

const levels: NoticeLevel[] = ['info', 'warning', 'critical'];

// The bell's list: the subscription's own announcement on top, then the panel's notices newest first.
export function noticeLog(profile: AppProfile): NoticeEntry[] {
  const out: NoticeEntry[] = [];
  const announce = profile.announce?.trim();
  if (announce) out.push({ key: 'announce', id: 0, body: announce, level: 'info', createdAt: null });
  const notices = (profile.notices ?? [])
    .filter((n) => typeof n.id === 'number' && levels.includes(n.level) && typeof n.body === 'string' && n.body.trim() !== '')
    .sort((a, b) => b.id - a.id);
  for (const n of notices) out.push({ key: String(n.id), id: n.id, body: n.body.trim(), level: n.level, createdAt: n.createdAt });
  return out;
}

export function bannerNotices(log: NoticeEntry[], dismissed: string[]): NoticeEntry[] {
  const open = log.filter((n) => n.level !== 'info' && !dismissed.includes(n.key));
  return [...open.filter((n) => n.level === 'critical'), ...open.filter((n) => n.level === 'warning')];
}

export function unreadNotices(log: NoticeEntry[], seen: { seenId: number; seenAnnounce: string }): number {
  return log.filter((n) => (n.key === 'announce' ? n.body !== seen.seenAnnounce : n.id > seen.seenId)).length;
}
