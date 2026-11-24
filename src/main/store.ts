import fs from 'node:fs';
import path from 'node:path';

import { defaultSettings, type Activity, type AppProfile, type Settings } from '../shared/types';

export interface Sealer {
  encrypt(text: string): string;
  decrypt(sealed: string): string;
}

interface StateFile {
  subLink?: string;
  username?: string;
  token?: string;
  profile?: string;
  deviceIdFallback?: string;
  settings?: Partial<Settings>;
  activity?: Activity;
}

// The token and the profile carry credentials, so they are stored sealed (DPAPI on Windows).
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

  session(): { subLink: string; username: string; token: string } | null {
    const { subLink, username, token } = this.state;
    if (!subLink || !username || !token) return null;
    try {
      return { subLink, username, token: this.sealer.decrypt(token) };
    } catch {
      return null;
    }
  }

  saveSession(subLink: string, username: string, token: string): void {
    Object.assign(this.state, { subLink, username, token: this.sealer.encrypt(token) });
    this.save();
  }

  clearSession(): void {
    delete this.state.token;
    delete this.state.profile;
    this.save();
  }

  profile(): AppProfile | null {
    if (!this.state.profile) return null;
    try {
      return JSON.parse(this.sealer.decrypt(this.state.profile)) as AppProfile;
    } catch {
      return null;
    }
  }

  saveProfile(profile: AppProfile): void {
    this.state.profile = this.sealer.encrypt(JSON.stringify(profile));
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
