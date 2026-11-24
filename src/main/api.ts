import { gzipSync } from 'node:zlib';

import type { AppProfile } from '../shared/types';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  os: string;
  osVersion: string;
  appVersion: string;
}

// code is the panel's error code (bad_login, device_limit, ...) or network / bad_response.
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

type Fetch = typeof fetch;

const timeoutMs = 15_000;

// What a support report carries besides the session: the user's words and the app's log.
export interface ReportBody {
  message: string;
  log: string;
  deviceId: string;
  deviceName: string;
  os: string;
  osVersion: string;
  appVersion: string;
}

async function call(fetchImpl: Fetch, url: string, init: RequestInit, timeout = timeoutMs): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new ApiError('network', 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code = (body as { error?: unknown } | null)?.error;
    throw new ApiError(typeof code === 'string' ? code : res.status === 404 ? 'not_found' : 'bad_response', res.status);
  }
  return body;
}

// Signing in needs one of the subscription's account names; the subscription's own summary
// (<link>?format=info) lists them, so a customer signs in with the link alone.
export async function subscriptionAccount(subInfoUrl: string, userAgent: string, fetchImpl: Fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(subInfoUrl, { headers: { Accept: 'application/json', 'User-Agent': userAgent }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ApiError('network', 0);
  }
  if (res.status === 404 || res.status === 403 || res.status === 410) throw new ApiError('bad_sub', res.status);
  if (!res.ok) throw new ApiError('bad_response', res.status);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // A panel without the summary answers with the subscription itself.
    throw new ApiError('link_login_unsupported', res.status);
  }
  const emails = (body as { emails?: unknown } | null)?.emails;
  if (!Array.isArray(emails)) throw new ApiError('link_login_unsupported', res.status);
  const name = emails.find((e): e is string => typeof e === 'string' && e.trim() !== '');
  if (!name) throw new ApiError('bad_sub', res.status);
  return name.trim();
}

export class AppApi {
  constructor(
    private readonly base: string,
    private readonly userAgent: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async login(username: string, device: DeviceInfo): Promise<string> {
    const body = await call(this.fetchImpl, `${this.base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': this.userAgent },
      body: JSON.stringify({ username, ...device }),
    });
    const token = (body as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || token === '') throw new ApiError('bad_response', 200);
    return token;
  }

  async profile(token: string, deviceId: string): Promise<AppProfile> {
    const body = await call(this.fetchImpl, `${this.base}/profile`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'X-HWID': deviceId, 'User-Agent': this.userAgent },
    });
    if (!isProfile(body)) throw new ApiError('bad_response', 200);
    return body;
  }

  // POST /report (Manifold 0.20+): the panel files it under the session's account and answers its number.
  // The JSON is sent gzipped, since a log is large and compresses well.
  async report(token: string, body: ReportBody): Promise<string | null> {
    let answer: unknown;
    try {
      answer = await call(
        this.fetchImpl,
        `${this.base}/report`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'X-HWID': body.deviceId, 'User-Agent': this.userAgent, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
          body: new Uint8Array(gzipSync(Buffer.from(JSON.stringify(body)))),
        },
        90_000,
      );
    } catch (err) {
      // A panel without the endpoint answers 404 or 405.
      if (err instanceof ApiError && (err.status === 404 || err.status === 405 || err.status === 501)) throw new ApiError('report_unsupported', err.status);
      throw err;
    }
    const id = (answer as { id?: unknown } | null)?.id;
    if (typeof answer !== 'object' || answer === null || !('id' in answer || 'ok' in answer)) throw new ApiError('report_unsupported', 200);
    return typeof id === 'number' || typeof id === 'string' ? String(id) : null;
  }

  // POST /disconnected: this device has left the protocol it used at that location. WireGuard tells
  // the server nothing when a peer goes, so without this the panel holds the account's seat until the
  // peer has been quiet for a while. OpenVPN's goodbye takes the server five seconds, so its tunnel
  // address goes along: it names the session among an account's several, for the panel to close it.
  // A panel without the endpoint answers 404 or 405, which is fine: it then waits as before.
  async disconnected(token: string, deviceId: string, left: { protocol: string; locationId: number | null; address?: string }): Promise<void> {
    try {
      await call(
        this.fetchImpl,
        `${this.base}/disconnected`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'X-HWID': deviceId, 'User-Agent': this.userAgent, 'Content-Type': 'application/json' },
          body: JSON.stringify({ protocol: left.protocol, locationId: left.locationId, ...(left.address ? { address: left.address } : {}) }),
        },
        5000,
      );
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 405 || err.status === 501)) return;
      throw err;
    }
  }

  async logout(token: string, deviceId: string): Promise<void> {
    await call(this.fetchImpl, `${this.base}/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-HWID': deviceId, 'User-Agent': this.userAgent },
    });
  }
}

function isProfile(v: unknown): v is AppProfile {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Partial<AppProfile>;
  return typeof p.account === 'object' && p.account !== null && Array.isArray(p.locations) && Array.isArray(p.configs);
}
