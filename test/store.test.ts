import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { accountIdFor, Store, type Sealer } from '../src/main/store';

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
    expect(reopened.session()).toEqual({ id: accountIdFor('https://s/sub/x', 'dana'), subLink: 'https://s/sub/x', username: 'dana', token: 'secret-token' });
    expect(reopened.profile()?.configs[0].link).toBe('l2tp://dana:pw@h');
    reopened.clearSession();
    expect(new Store(file, sealer).session()).toBeNull();
  });

  it('keeps multiple sealed accounts and switches without losing their profiles', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-')), 'state.json');
    const store = new Store(file, sealer);
    const first = store.saveSession('https://s/sub/one', 'dana', 'token-one');
    store.saveProfile({ account: { username: 'dana' } as never, locations: [], configs: [] });
    const second = store.saveSession('https://s/sub/two', 'lee', 'token-two');
    store.saveProfile({ account: { username: 'lee' } as never, locations: [], configs: [] });

    expect(store.accounts()).toEqual([
      { id: first, username: 'dana', label: 's', active: false },
      { id: second, username: 'lee', label: 's', active: true },
    ]);
    expect(store.activateAccount(first)).toBe(true);
    expect(store.profile()?.account.username).toBe('dana');
    expect(store.session()?.token).toBe('token-one');

    store.clearSession();
    expect(store.session()?.id).toBe(second);
    expect(store.profile()?.account.username).toBe('lee');
    expect(store.accounts()).toEqual([{ id: second, username: 'lee', label: 's', active: true }]);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('token-two');
  });

  it('migrates the version-one single-account state file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-')), 'state.json');
    const profile = { account: { username: 'legacy' }, locations: [], configs: [] };
    fs.writeFileSync(
      file,
      JSON.stringify({
        subLink: 'https://s/sub/legacy',
        username: 'legacy',
        token: sealer.encrypt('legacy-token'),
        profile: sealer.encrypt(JSON.stringify(profile)),
      }),
    );
    const store = new Store(file, sealer);
    expect(store.session()?.username).toBe('legacy');
    expect(store.profile()?.account.username).toBe('legacy');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(saved.accounts).toHaveLength(1);
    expect(saved).not.toHaveProperty('token');
  });

  it('fills settings it never saved from the defaults', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-')), 'state.json');
    const store = new Store(file, sealer);
    expect(store.saveSettings({ protocol: 'openvpn' })).toMatchObject({ protocol: 'openvpn', killSwitch: true, language: 'fa' });
  });
});
