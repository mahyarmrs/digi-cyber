import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { Store, type Sealer } from '../src/main/store';

const sealer: Sealer = {
  encrypt: (t) => Buffer.from(t).toString('base64'),
  decrypt: (s) => Buffer.from(s, 'base64').toString(),
};

describe('Store', () => {
  it('keeps the token and profile sealed on disk and reads them back', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-')), 'state.json');
    const store = new Store(file, sealer);
    store.saveSession('https://s/sub/x', 'dana', 'secret-token');
    store.saveProfile({ account: { username: 'dana' } as never, locations: [], configs: [{ protocol: 'l2tp', name: 'l', link: 'l2tp://dana:pw@h' }] });
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('secret-token');
    expect(raw).not.toContain('dana:pw');

    const reopened = new Store(file, sealer);
    expect(reopened.session()).toEqual({ subLink: 'https://s/sub/x', username: 'dana', token: 'secret-token' });
    expect(reopened.profile()?.configs[0].link).toBe('l2tp://dana:pw@h');
    reopened.clearSession();
    expect(new Store(file, sealer).session()).toBeNull();
  });

  it('fills settings it never saved from the defaults', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-')), 'state.json');
    const store = new Store(file, sealer);
    expect(store.saveSettings({ protocol: 'openvpn' })).toMatchObject({ protocol: 'openvpn', killSwitch: true, language: 'fa' });
  });
});
