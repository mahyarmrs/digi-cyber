import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { defaultSettings, type AccountSummary, type Activity, type AppProfile, type Settings, type Session } from '../shared/types';

export interface Sealer {
  encrypt(text: string): string;
  decrypt(sealed: string): string;
}

interface StoredAccount {
  id: string;
  subLink: string;
  username: string;
  token: string;
  profile?: string;
}

interface StateFile {
  accounts?: StoredAccount[];
  activeAccountId?: string;
  deviceIdFallback?: string;
  settings?: Partial<Settings>;
  activity?: Activity;
  // Version 1.0 stored just one account at the top level; kept here only for migration.
  subLink?: string;
  username?: string;
  token?: string;
  profile?: string;
}

export function accountIdFor(subLink: string, username: string): string {
  return createHash('sha256').update(`${subLink.trim()}\n${username.trim()}`).digest('hex').slice(0, 24);
}

function isStoredAccount(value: unknown): value is StoredAccount {
  if (typeof value !== 'object' || value === null) return false;
  const account = value as Partial<StoredAccount>;
  return typeof account.id === 'string' && typeof account.subLink === 'string' && typeof account.username === 'string' && typeof account.token === 'string';
}

// Every account keeps its own sealed session token and profile.
export class Store {
  private state: StateFile;

  constructor(
    private readonly file: string,
    private readonly sealer: Sealer,
  ) {
    try {
      this.state = JSON.parse(fs.readFileSync(file, 'utf8')) as StateFile;
    } catch {
      this.state = {};
    }
    if (this.migrate()) this.save();
  }

  private migrate(): boolean {
    let changed = false;
    if (!Array.isArray(this.state.accounts)) {
      this.state.accounts = [];
      changed = true;
    } else {
      this.state.accounts = this.state.accounts.filter(isStoredAccount);
    }

    const { subLink, username, token, profile } = this.state;
    if (subLink && username && token) {
      const id = accountIdFor(subLink, username);
      const existing = this.state.accounts.find((account) => account.id === id);
      if (!existing) {
        this.state.accounts.push({ id, subLink, username, token, ...(profile ? { profile } : {}) });
        changed = true;
      } else if (profile && !existing.profile) {
        existing.profile = profile;
        changed = true;
      }
      if (!this.state.activeAccountId) {
        this.state.activeAccountId = id;
        changed = true;
      }
    }
    if (subLink !== undefined || username !== undefined || token !== undefined || profile !== undefined) {
      delete this.state.subLink;
      delete this.state.username;
      delete this.state.token;
      delete this.state.profile;
      changed = true;
    }

    const active = this.state.accounts.find((account) => account.id === this.state.activeAccountId);
    if (!active && this.state.accounts.length > 0) {
      this.state.activeAccountId = this.state.accounts[0].id;
      changed = true;
    } else if (!active && this.state.activeAccountId) {
      delete this.state.activeAccountId;
      changed = true;
    }
    return changed;
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }

  settings(): Settings {
    return { ...defaultSettings, ...this.state.settings };
  }

  saveSettings(patch: Partial<Settings>): Settings {
    this.state.settings = { ...this.settings(), ...patch };
    this.save();
    return this.settings();
  }

  activeAccountId(): string | null {
    return this.state.activeAccountId ?? null;
  }

  session(accountId?: string): (Session & { token: string }) | null {
    const id = accountId ?? this.state.activeAccountId;
    const account = this.state.accounts?.find((entry) => entry.id === id);
    if (!account || !account.subLink || !account.username || !account.token) return null;
    try {
      return { id: account.id, subLink: account.subLink, username: account.username, token: this.sealer.decrypt(account.token) };
    } catch {
      return null;
    }
  }

  sessions(): (Session & { token: string })[] {
    return (this.state.accounts ?? []).flatMap((account) => {
      const session = this.session(account.id);
      return session ? [session] : [];
    });
  }

  accounts(): AccountSummary[] {
    return this.sessions().map(({ id, username, subLink }) => {
      let label = '';
      try {
        label = new URL(subLink).host;
      } catch {
        // A malformed legacy link remains signed in, but has no safe display label.
      }
      return { id, username, label, active: id === this.state.activeAccountId };
    });
  }

  activateAccount(accountId: string): boolean {
    if (!this.session(accountId)) return false;
    this.state.activeAccountId = accountId;
    this.save();
    return true;
  }

  saveSession(subLink: string, username: string, token: string): string {
    const link = subLink.trim();
    const name = username.trim();
    const id = accountIdFor(link, name);
    const existing = this.state.accounts?.find((account) => account.id === id);
    const record: StoredAccount = { id, subLink: link, username: name, token: this.sealer.encrypt(token) };
    if (existing) {
      Object.assign(existing, record);
      delete existing.profile;
    } else {
      (this.state.accounts ??= []).push(record);
    }
    this.state.activeAccountId = id;
    this.save();
    return id;
  }

  clearSession(accountId?: string): void {
    const id = accountId ?? this.state.activeAccountId;
    if (!id) return;
    const wasActive = this.state.activeAccountId === id;
    this.state.accounts = (this.state.accounts ?? []).filter((account) => account.id !== id);
    if (wasActive) {
      const next = this.state.accounts.find((account) => this.session(account.id) !== null);
      if (next) this.state.activeAccountId = next.id;
      else delete this.state.activeAccountId;
    }
    this.save();
  }

  profile(accountId?: string): AppProfile | null {
    const id = accountId ?? this.state.activeAccountId;
    const account = this.state.accounts?.find((entry) => entry.id === id);
    if (!account?.profile) return null;
    try {
      return JSON.parse(this.sealer.decrypt(account.profile)) as AppProfile;
    } catch {
      return null;
    }
  }

  saveProfile(profile: AppProfile, accountId?: string): void {
    const id = accountId ?? this.state.activeAccountId;
    const account = this.state.accounts?.find((entry) => entry.id === id);
    if (!account) return;
    account.profile = this.sealer.encrypt(JSON.stringify(profile));
    this.save();
  }

  activity(): Activity {
    return { days: {}, recents: [], ...this.state.activity };
  }

  saveActivity(activity: Activity): void {
    this.state.activity = activity;
    this.save();
  }

  deviceIdFallback(): string | undefined {
    return this.state.deviceIdFallback;
  }

  saveDeviceIdFallback(id: string): void {
    this.state.deviceIdFallback = id;
    this.save();
  }
}
