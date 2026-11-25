// The app API of a Manifold panel, as far as the emulator tests need it: two subscriptions for
// multi-account tests, the subscription summaries, sign-in, protocol outbounds, and support reports.
// The emulator reaches it as http://10.0.2.2:2096/sub/demo. Usage: node mock-panel.mjs <outbounds-dir> [port]
import fs from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';

const dir = process.argv[2];
const port = Number(process.argv[3] ?? 2096);
const accounts = {
  demo: { username: 'demo-user', token: 'test-session-token' },
  other: { username: 'other-user', token: 'test-session-token-other' },
};
const outbound = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8'));
const linkFile = (name) => (fs.existsSync(`${dir}/${name}.link`) ? fs.readFileSync(`${dir}/${name}.link`, 'utf8').trim() : null);
const reports = [];
const day = 86_400_000;

const locations = [
  { id: 1, name: 'Germany', countryCode: 'DE', city: 'Frankfurt', timezone: 'Europe/Berlin', protocol: 'vless' },
  { id: 2, name: 'Netherlands', countryCode: 'NL', city: 'Amsterdam', timezone: 'Europe/Amsterdam', protocol: 'vmess' },
  { id: 3, name: 'Finland', countryCode: 'FI', city: 'Helsinki', timezone: 'Europe/Helsinki', protocol: 'trojan' },
  { id: 4, name: 'Turkey', countryCode: 'TR', city: 'Istanbul', timezone: 'Europe/Istanbul', protocol: 'shadowsocks' },
  { id: 5, name: 'UAE', countryCode: 'AE', city: 'Dubai', timezone: 'Asia/Dubai', protocol: 'wireguard' },
  { id: 6, name: 'United States', countryCode: 'US', city: 'New York', timezone: 'America/New_York', protocol: 'vless' },
  { id: 7, name: 'United States', countryCode: 'US', city: 'Los Angeles', timezone: 'America/Los_Angeles', protocol: 'vless' },
  // VLESS without TLS to a public name (a relay in the country), which Xray 26.7+ refuses unless the app carries it.
  { id: 8, name: 'Armenia', countryCode: 'AM', city: 'Yerevan', timezone: 'Asia/Yerevan', protocol: 'vless', file: 'vless-plain', host: '10-0-2-2.sslip.io', port: 8082 },
];

function profile(username) {
  const now = Date.now();
  return {
    account: { username, enabled: true, expiryTime: now + 23 * day + 3_600_000, upload: 1_310_720_000, download: 13_958_643_712, total: 53_687_091_200, deviceLimit: 3, devices: 1 },
    title: 'Digi Cyber',
    supportUrl: 'https://example.com/support',
    announce: 'سرویس شما فعال است. برای تمدید از ربات استفاده کنید.',
    locations: locations.map(({ protocol, ...l }) => l),
    configs: locations.map((l) => ({
      protocol: l.protocol,
      name: `${l.protocol}-${l.countryCode.toLowerCase()}-${l.id}`,
      link:
        linkFile(l.file ?? l.protocol) ??
        `${l.protocol}://test-${l.id}@${l.host ?? '10.0.2.2'}:${l.port ?? { vless: 8443, vmess: 8080, trojan: 8081, shadowsocks: 8388, wireguard: 51820 }[l.protocol]}#${encodeURIComponent(l.city)}`,
      locationId: l.id,
      outbound: outbound(l.file ?? l.protocol),
    })),
    notices: [
      { id: 2, body: 'به‌روزرسانی سرورهای آلمان امشب ساعت ۲ بامداد انجام می‌شود و چند دقیقه قطعی خواهیم داشت.', level: 'warning', createdAt: now - 2 * 3_600_000 },
      { id: 1, body: 'لوکیشن جدید امارات به سرویس‌ها اضافه شد.', level: 'info', createdAt: now - 2 * day },
    ],
  };
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

http.createServer((req, res) => {
  let body = '';
  req.setEncoding('latin1');
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    console.log(new Date().toISOString(), req.method, path, req.headers['user-agent'] ?? '');
    if (path === '/connectivity/generate_204') {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (path === '/connectivity/not-204') return send(res, 200, { ok: true });

    const match = path.match(/^\/sub\/([^/]+)(?:\/app\/v1\/(.*))?$/);
    const account = match ? accounts[match[1]] : null;
    if (!match || !account) return send(res, 404, { error: 'not_found' });
    if (!match[2] && url.searchParams.get('format') === 'info') return send(res, 200, { emails: [account.username], total: 53_687_091_200 });
    if (!match[2]) return send(res, 404, { error: 'not_found' });

    const call = match[2];
    if (call === 'login' && req.method === 'POST') {
      const login = JSON.parse(body || '{}');
      if (login.username !== account.username) return send(res, 401, { error: 'bad_login' });
      if (!login.deviceId) return send(res, 400, { error: 'bad_device' });
      return send(res, 200, { token: account.token });
    }
    if (req.headers.authorization !== `Bearer ${account.token}`) return send(res, 401, { error: 'bad_session' });
    if (call === 'profile' && req.method === 'GET') return send(res, 200, profile(account.username));
    if (call === 'logout' && req.method === 'POST') return send(res, 200, {});
    // A support report, gzipped JSON; the test reads back what arrived from the panel.
    if (call === 'report' && req.method === 'POST') {
      let report = null;
      try {
        report = JSON.parse(zlib.gunzipSync(Buffer.from(body, 'latin1')).toString('utf8'));
      } catch {
        return send(res, 400, { error: 'bad_request' });
      }
      reports.push({ account: account.username, encoding: req.headers['content-encoding'] ?? '', message: report.message, logChars: String(report.log ?? '').length, os: report.os, appVersion: report.appVersion });
      return send(res, 200, { id: reports.length });
    }
    if (call === 'reports' && req.method === 'GET') return send(res, 200, reports);
    return send(res, 404, { error: 'not_found' });
  });
}).listen(port, '0.0.0.0', () => console.log(`mock panel on :${port}`));
