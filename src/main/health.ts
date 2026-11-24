import net from 'node:net';
import tls from 'node:tls';

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export function tcpPing(host: string, port: number, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = net.connect({ host, port });
    const done = (ms: number | null) => {
      socket.destroy();
      resolve(ms);
    };
    socket.setTimeout(timeoutMs, () => done(null));
    socket.once('connect', () => done(Math.round(performance.now() - started)));
    socket.once('error', () => done(null));
  });
}

export async function waitForPort(port: number, timeoutMs: number, alive: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && alive()) {
    if ((await tcpPing('127.0.0.1', port, 500)) !== null) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// Fetches the same empty page with the system's own routes and resolver, for a tunnel that carries
// the whole system (WireGuard's tunnel service). Tries again until the deadline, since routes and
// DNS settle a moment after the tunnel comes up.
export async function probeDirect(timeoutMs = 10_000, host = 'www.gstatic.com'): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const left = deadline - Date.now();
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        secure.destroy();
        resolve(result);
      };
      const timer = setTimeout(() => finish(false), left);
      const secure = tls.connect({ host, port: 443, servername: host });
      secure.once('error', () => finish(false));
      secure.once('secureConnect', () => secure.write(`GET /generate_204 HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
      let reply = '';
      secure.on('data', (d: Buffer) => {
        reply += d.toString('latin1');
        if (reply.includes('\r\n')) finish(/^HTTP\/1\.[01] 204/.test(reply));
      });
    });
    if (ok) return true;
    if (deadline - Date.now() > 500) await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Fetches an empty page through the HTTP proxy inbound: the config works only if this answers.
export function probeThroughProxy(httpPort: number, timeoutMs = 10_000, host = 'www.gstatic.com'): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const socket = net.connect({ host: '127.0.0.1', port: httpPort });
    socket.once('error', () => finish(false));
    socket.once('connect', () => socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`));
    let head = '';
    const onData = (chunk: Buffer) => {
      head += chunk.toString('latin1');
      if (!head.includes('\r\n\r\n')) return;
      socket.off('data', onData);
      if (!/^HTTP\/1\.[01] 200/.test(head)) return finish(false);
      const secure = tls.connect({ socket, servername: host });
      secure.once('error', () => finish(false));
      secure.once('secureConnect', () => secure.write(`GET /generate_204 HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
      let reply = '';
      secure.on('data', (d: Buffer) => {
        reply += d.toString('latin1');
        if (reply.includes('\r\n')) finish(/^HTTP\/1\.[01] 204/.test(reply));
      });
    };
    socket.on('data', onData);
  });
}
