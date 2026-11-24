// A stand-in for the main process (window.dc) with a demo account, for looking at the window in a
// browser: scripts/preview/shoot.mjs injects it before the app loads. Not part of the app.
(() => {
  const q = new URLSearchParams(location.search);
  const now = Date.now();
  const out = (tag) => ({ protocol: 'vless', name: tag, link: `vless://${tag}`, locationId: null, outbound: { protocol: 'vless' } });
  const loc = [
    [1, 'Germany', 'DE', 'Frankfurt'], [2, 'Germany', 'DE', 'Berlin'], [3, 'Netherlands', 'NL', 'Amsterdam'], [4, 'Finland', 'FI', 'Helsinki'],
    [5, 'Turkey', 'TR', 'Istanbul'], [6, 'United States', 'US', 'New York'], [7, 'United Kingdom', 'GB', 'London'], [8, 'UAE', 'AE', 'Dubai'],
  ].map(([id, name, countryCode, city]) => ({ id, name, countryCode, city, timezone: 'UTC' }));
  const configs = [];
  for (const l of loc) {
    configs.push({ ...out(`vless-${l.id}`), locationId: l.id, link: `vless://${l.id}` });
    if (l.id % 2) configs.push({ protocol: 'wireguard', name: `wg-${l.id}`, link: `wireguard://${l.id}`, locationId: l.id, outbound: { protocol: 'wireguard' } });
    if (l.id < 5) configs.push({ protocol: 'openvpn', name: `ovpn-${l.id}`, link: `openvpn://${l.id}`, locationId: l.id });
    if (l.id === 1 || l.id === 3) configs.push({ protocol: 'l2tp', name: `l2tp-${l.id}`, link: `l2tp://${l.id}`, locationId: l.id });
  }
  const profile = {
    account: { username: 'demo', enabled: true, expiryTime: now + 23 * 86400000 + 3600000, upload: 2.1e9, download: 17.6e9, total: q.get('traffic') === 'high' ? 21e9 : 50 * 1024 ** 3, deviceLimit: 3, devices: 2 },
    title: 'Digi Cyber Pro', supportUrl: 'https://example.com/support', announce: '',
    locations: loc, configs,
    notices: q.get('notice') ? [
      { id: 3, body: 'سرورهای آلمان امشب از ساعت ۲ تا ۳ بامداد برای به‌روزرسانی در دسترس نیستند.', level: 'critical', createdAt: now - 3600000 },
      { id: 2, body: 'لوکیشن جدید امارات اضافه شد.', level: 'info', createdAt: now - 86400000 },
    ] : [],
  };
  const pingMs = { 1: 48, 2: 61, 3: 72, 4: 95, 5: 132, 6: 212, 7: 88, 8: 350 };
  const pings = configs.map((c) => ({ link: c.link, ms: pingMs[c.locationId] ?? null }));
  const state = q.get('state') || 'disconnected';
  const status = state === 'connected'
    ? { state, locationId: 1, serverId: 1, configName: 'DE-Frankfurt-Reality', protocol: 'vless', since: now - 754000 }
    : state === 'connecting' ? { state, locationId: 1, serverId: 1, protocol: 'vless' }
    : state === 'error' ? { state: 'disconnected', error: 'all_failed' } : { state: 'disconnected' };
  const days = {};
  for (let i = 0; i < 7; i++) { const d = new Date(now - i * 86400000); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; days[k] = [3.2, 5.1, 0, 7.5, 2.4, 6.1, 1.2][i] * 3600; }
  let settings = {
    language: q.get('lang') || 'fa', theme: q.get('theme') || 'dark', protocol: 'auto', killSwitch: true, autoReconnect: true, webrtcProtection: true, timezoneSpoof: false,
    iranDirect: true, adBlock: false, dns: '', splitTunneling: false, splitApps: [], connectOnStart: false, startWithWindows: false, launchMinimized: false,
    notifications: true, locationId: state === 'disconnected' ? 1 : null, dismissedAnnounce: '', dismissedNotices: [], seenNoticeId: 0, seenAnnounce: '',
  };
  const signedIn = q.get('signedout') === null;
  const ok = (v) => Promise.resolve(v);
  window.dc = {
    os: q.get('os') || 'windows',
    session: () => ok(signedIn ? { subLink: 'https://sub.example.com/sub/abc', username: 'demo' } : null),
    login: () => new Promise((_, rej) => setTimeout(() => rej(new Error('bad_sub')), 600)),
    logout: () => ok(), profile: () => ok(signedIn ? profile : null), refresh: () => ok({ profile, fetchedAt: now }),
    settings: () => ok(settings), saveSettings: (p) => { settings = { ...settings, ...p }; return ok(settings); },
    connect: () => ok(status), disconnect: () => ok({ state: 'disconnected' }), status: () => ok(status), ping: () => ok(pings),
    activity: () => ok({ days, recents: [1, 3, 5] }), pickApp: () => ok(null), appIcon: () => ok(null), openExternal: () => ok(),
    onStatus: () => () => {}, onProfile: () => () => {}, onSignedOut: () => () => {}, takeSignIn: () => ok(null), onSignInLink: () => () => {},
    logText: () => ok('[app] Digi Cyber 1.0.0 started\n'), sendReport: () => ok({ id: '42' }), saveLog: () => ok(true), log: () => {},
  };
})();
