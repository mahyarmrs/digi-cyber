import { describe, expect, it } from 'vitest';

import { bannerNotices, noticeLog, unreadNotices } from '../src/shared/notices';
import type { AppNotice, AppProfile } from '../src/shared/types';

const notice = (id: number, level: AppNotice['level'], body = `notice ${id}`): AppNotice => ({ id, level, body, createdAt: 1_767_225_600_000 + id });

function profileWith(notices: AppNotice[] | undefined, announce = ''): AppProfile {
  return {
    account: { username: 'dana', enabled: true, expiryTime: 0, upload: 0, download: 0, total: 0, deviceLimit: 0, devices: 0 },
    announce,
    locations: [],
    configs: [],
    notices,
  };
}

describe('noticeLog', () => {
  it('lists the panel notices newest first, with the subscription announcement as an info entry', () => {
    const log = noticeLog(profileWith([notice(3, 'info'), notice(7, 'critical'), notice(5, 'warning')], 'Maintenance Friday'));
    expect(log.map((n) => [n.key, n.level])).toEqual([
      ['announce', 'info'],
      ['7', 'critical'],
      ['5', 'warning'],
      ['3', 'info'],
    ]);
  });

  it('works with a panel that sends no notices', () => {
    expect(noticeLog(profileWith(undefined))).toEqual([]);
  });

  it('drops entries an older or broken panel could send', () => {
    const broken = [notice(1, 'info'), { id: 2, level: 'loud', body: 'x', createdAt: 0 }, { id: 3, level: 'info', body: '  ', createdAt: 0 }] as AppNotice[];
    expect(noticeLog(profileWith(broken)).map((n) => n.key)).toEqual(['1']);
  });
});

describe('bannerNotices', () => {
  it('shows the warnings and criticals not closed yet, criticals first', () => {
    const log = noticeLog(profileWith([notice(9, 'warning'), notice(8, 'critical'), notice(6, 'info'), notice(4, 'critical')]));
    expect(bannerNotices(log, []).map((n) => n.key)).toEqual(['8', '4', '9']);
    expect(bannerNotices(log, ['8']).map((n) => n.key)).toEqual(['4', '9']);
  });
});

describe('unreadNotices', () => {
  it('counts what arrived after the bell was last opened, the announcement once per text', () => {
    const log = noticeLog(profileWith([notice(9, 'warning'), notice(8, 'critical'), notice(6, 'info')], 'Maintenance Friday'));
    expect(unreadNotices(log, { seenId: 0, seenAnnounce: '' })).toBe(4);
    expect(unreadNotices(log, { seenId: 8, seenAnnounce: 'Maintenance Friday' })).toBe(1);
    expect(unreadNotices(log, { seenId: 9, seenAnnounce: 'Maintenance Friday' })).toBe(0);
  });
});
