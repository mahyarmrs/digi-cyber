import net from 'node:net';

export const connectivityTestUrl = 'http://google.com/generate_204';

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

function requestPath(url: URL): string {
  return `${url.pathname || '/'}${url.search}`;
}

function is204(line: string): boolean {
  return /^HTTP\/1\.[01] 204(?:\s|$)/i.test(line);
}

function elapsedMs(started: number): number {
  return Math.max(1, Math.round(performance.now() - started));
}

// Requests the Google generate_204 page using the system route and DNS. Used to verify a tunnel
// that carries the whole system, and to measure the currently active non-Xray tunnel.
export function pingDirect(timeoutMs = 10_000, testUrl = connectivityTestUrl): Promise<number | null> {
  let url: URL;
  try {
    url = new URL(testUrl);
  } catch {
    return Promise.resolve(null);
  }
  if (url.protocol !== 'http:' || !url.hostname) return Promise.resolve(null);

  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    const socket = net.connect({ host: url.hostname, port: Number(url.port) || 80 });
    const finish = (ms: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ms);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.once('error', () => finish(null));
    socket.once('connect', () => {
      socket.write(`GET ${requestPath(url)} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`);
    });
    let reply = '';
    socket.on('data', (chunk: Buffer) => {
      reply += chunk.toString('latin1');
      const end = reply.indexOf('\r\n');
      if (end >= 0) finish(is204(reply.slice(0, end)) ? elapsedMs(started) : null);
    });
  });
}

// Tries again while a tunnel's routes and DNS settle; its actual RTT is measured elsewhere.
export async function probeDirect(timeoutMs = 10_000, host = 'google.com'): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await pingDirect(deadline - Date.now(), `http://${host}/generate_204`)) !== null) return true;
    if (deadline - Date.now() > 300) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

// Requests the Google endpoint through a local HTTP proxy and returns that request's round trip.
export function pingThroughProxy(httpPort: number, timeoutMs = 10_000, testUrl = connectivityTestUrl): Promise<number | null> {
  let url: URL;
  try {
    url = new URL(testUrl);
  } catch {
    return Promise.resolve(null);
  }
  if (url.protocol !== 'http:' || !url.hostname) return Promise.resolve(null);

  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    const socket = net.connect({ host: '127.0.0.1', port: httpPort });
    const finish = (ms: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ms);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.once('error', () => finish(null));
    socket.once('connect', () => {
      // An HTTP proxy receives an absolute-form URL; unlike HTTPS, this needs no CONNECT or TLS.
      socket.write(`GET ${url.href} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`);
    });
    let reply = '';
    socket.on('data', (chunk: Buffer) => {
      reply += chunk.toString('latin1');
      const end = reply.indexOf('\r\n');
      if (end >= 0) finish(is204(reply.slice(0, end)) ? elapsedMs(started) : null);
    });
  });
}

export async function probeThroughProxy(httpPort: number, timeoutMs = 10_000): Promise<boolean> {
  return (await pingThroughProxy(httpPort, timeoutMs)) !== null;
}
