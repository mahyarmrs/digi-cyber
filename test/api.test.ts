import { describe, expect, it } from 'vitest';

import { ApiError, AppApi, subscriptionAccount } from '../src/main/api';
import { appApiBase, LinkError, subInfoUrl } from '../src/main/link';

const device = { deviceId: 'device-0123456789', deviceName: 'pc', os: 'windows', osVersion: '10.0', appVersion: '0.1.0' };

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

describe('appApiBase', () => {
  it('builds the API under the link the customer pasted', () => {
    expect(appApiBase(' https://sub.example.com:2096/sub/abc123?name=x#me ')).toBe('https://sub.example.com:2096/sub/abc123/app/v1');
    expect(appApiBase('https://cdn.example.com/json/abc123/')).toBe('https://cdn.example.com/json/abc123/app/v1');
  });

  it('refuses what is not a subscription link', () => {
    for (const link of ['vless://abc@host:443', 'https://sub.example.com/', 'not a link']) {
      expect(() => appApiBase(link)).toThrow(LinkError);
    }
  });
});

describe('AppApi', () => {
  it('sends the username and device and returns the token', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const api = new AppApi('https://s/sub/x/app/v1', 'DigiCyber/0.1.0', fakeFetch(200, { token: 'tok' }, seen));
    expect(await api.login('dana', device)).toBe('tok');
    expect(seen.url).toBe('https://s/sub/x/app/v1/login');
    expect(JSON.parse(String(seen.init?.body))).toEqual({ username: 'dana', ...device });
  });

  it('turns the panel error code into an ApiError', async () => {
    const api = new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(403, { error: 'device_limit' }));
    await expect(api.login('dana', device)).rejects.toEqual(new ApiError('device_limit', 403));
  });

  it('reads a panel without the app API as not_found', async () => {
    const api = new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(404, null));
    await expect(api.login('dana', device)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('asks for the profile with the token and the device id', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const profile = { account: { username: 'dana' }, locations: [], configs: [] };
    const api = new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(200, profile, seen));
    expect(await api.profile('tok', 'device-0123456789')).toEqual(profile);
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['X-HWID']).toBe('device-0123456789');
  });

  it('refuses a profile without its account', async () => {
    const api = new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(200, { configs: [] }));
    await expect(api.profile('tok', 'd')).rejects.toMatchObject({ code: 'bad_response' });
  });
});

describe('telling the panel this device left', () => {
  it('names the protocol and the location it left, with the session', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const api = new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(200, { ok: true }, seen));
    await api.disconnected('tok', 'device-0123456789', { protocol: 'wireguard', locationId: 3 });
    expect(seen.url).toBe('https://s/sub/x/app/v1/disconnected');
    expect(seen.init?.method).toBe('POST');
    expect(JSON.parse(String(seen.init?.body))).toEqual({ protocol: 'wireguard', locationId: 3 });
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['X-HWID']).toBe('device-0123456789');
  });

  it('names the OpenVPN session by its tunnel address', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    await new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(200, { ok: true }, seen)).disconnected('tok', 'd', { protocol: 'openvpn', locationId: 2, address: '10.8.0.6' });
    expect(JSON.parse(String(seen.init?.body))).toEqual({ protocol: 'openvpn', locationId: 2, address: '10.8.0.6' });
  });

  it('is nothing to worry about on a panel without the endpoint', async () => {
    for (const status of [404, 405, 501]) {
      await expect(new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(status, null)).disconnected('tok', 'd', { protocol: 'openvpn', locationId: null })).resolves.toBeUndefined();
    }
  });

  it('still reports an ended session', async () => {
    const api = new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(401, { error: 'bad_session' }));
    await expect(api.disconnected('tok', 'd', { protocol: 'wireguard', locationId: 1 })).rejects.toMatchObject({ code: 'bad_session' });
  });
});

describe('signing in with the subscription link alone', () => {
  it('asks the subscription for its summary, keeping the link\'s own query', () => {
    expect(subInfoUrl(' https://sub.example.com:2096/sub/abc123 ')).toBe('https://sub.example.com:2096/sub/abc123?format=info');
    expect(subInfoUrl('https://sub.example.com/sub/abc123?name=x')).toBe('https://sub.example.com/sub/abc123?name=x&format=info');
    expect(() => subInfoUrl('vless://abc@host:443')).toThrow(LinkError);
  });

  it('takes the first account the subscription names', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const name = await subscriptionAccount('https://s/sub/x?format=info', 'ua', fakeFetch(200, { emails: ['', 'dana', 'dana-2'], total: 0 }, seen));
    expect(name).toBe('dana');
    expect(seen.url).toBe('https://s/sub/x?format=info');
    expect((seen.init?.headers as Record<string, string>).Accept).toBe('application/json');
  });

  it('says what went wrong', async () => {
    await expect(subscriptionAccount('https://s/sub/x?format=info', 'ua', fakeFetch(404, {}))).rejects.toEqual(new ApiError('bad_sub', 404));
    await expect(subscriptionAccount('https://s/sub/x?format=info', 'ua', fakeFetch(200, { emails: [] }))).rejects.toEqual(new ApiError('bad_sub', 200));
    await expect(subscriptionAccount('https://s/sub/x?format=info', 'ua', fakeFetch(200, { total: 1 }))).rejects.toEqual(new ApiError('link_login_unsupported', 200));
    const plain = (async () => new Response('dmxlc3M6Ly8=', { status: 200 })) as typeof fetch;
    await expect(subscriptionAccount('https://s/sub/x?format=info', 'ua', plain)).rejects.toEqual(new ApiError('link_login_unsupported', 200));
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(subscriptionAccount('https://s/sub/x?format=info', 'ua', down)).rejects.toEqual(new ApiError('network', 0));
  });
});
