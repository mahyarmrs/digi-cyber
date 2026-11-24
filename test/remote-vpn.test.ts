import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RemoteVpn } from '../src/main/remoteVpn';
import type { AppProfile, Settings } from '../src/shared/types';

const profile = { account: {}, locations: [], configs: [] } as unknown as AppProfile;
const settings = {} as Settings;

let dir = '';
let server: net.Server | null = null;
const open = new Set<net.Socket>();

function socketPath(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-helper-'));
  return path.join(dir, 'helper.sock');
}

// A helper that answers every request with the given reply.
function fakeHelper(at: string, reply: (id: number) => object): Promise<void> {
  server = net.createServer((socket) => {
    open.add(socket);
    socket.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        const { id } = JSON.parse(line) as { id: number };
        socket.write(`${JSON.stringify(reply(id))}\n`);
      }
    });
  });
  return new Promise((resolve) => server!.listen(at, resolve));
}

afterEach(async () => {
  for (const socket of open) socket.destroy();
  open.clear();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = null;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('RemoteVpn', () => {
  it('says the helper is not running when nothing listens on its socket', async () => {
    const status = await new RemoteVpn(socketPath()).connect(profile, settings, 3);
    expect(status).toEqual({ state: 'disconnected', locationId: 3, error: 'helper_unreachable' });
  });

  it("uses the system's own code for a missing helper (macOS has its own text)", async () => {
    const status = await new RemoteVpn(socketPath(), 'helper_unreachable_macos').connect(profile, settings, 3);
    expect(status.error).toBe('helper_unreachable_macos');
  });

  // 1.1.1 showed "the service is not running" for a running helper that failed the request.
  it("passes on the error of a helper that answered, instead of saying it isn't running", async () => {
    const at = socketPath();
    await fakeHelper(at, (id) => ({ id, ok: false, code: 'helper_error' }));
    const status = await new RemoteVpn(at, 'helper_unreachable_macos').connect(profile, settings, 3);
    expect(status).toEqual({ state: 'disconnected', locationId: 3, error: 'helper_error' });
  });

  it("returns the helper's status when it connects", async () => {
    const at = socketPath();
    await fakeHelper(at, (id) => ({ id, ok: true, value: { state: 'connected', locationId: 3, protocol: 'vless' } }));
    const status = await new RemoteVpn(at).connect(profile, settings, 3);
    expect(status).toEqual({ state: 'connected', locationId: 3, protocol: 'vless' });
  });
});
