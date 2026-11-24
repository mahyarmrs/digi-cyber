import { EventEmitter } from 'node:events';
import net from 'node:net';

import { lineSplitter, type HelperMessage, type HelperMethod } from '../shared/helperProtocol';
import type { AppProfile, Settings, Status } from '../shared/types';

// An error the helper answered with, as opposed to a helper that could not be reached.
class HelperReply extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// The helper's side of the Vpn class, for Linux and macOS: the same calls and status events.
export class RemoteVpn extends EventEmitter {
  private socket: net.Socket | null = null;
  private connecting: Promise<net.Socket> | null = null;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private current: Status = { state: 'disconnected' };

  // unreachable: the error code when the helper is not running (its text tells how to start it on that system).
  constructor(
    private readonly socketPath: string,
    private readonly unreachable = 'helper_unreachable',
  ) {
    super();
  }

  status(): Status {
    return this.current;
  }

  private set(status: Status): Status {
    this.current = status;
    this.emit('status', status);
    return status;
  }

  private open(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const socket = net.connect(this.socketPath);
      socket.once('connect', () => {
        this.socket = socket;
        this.connecting = null;
        resolve(socket);
      });
      socket.once('error', (err) => {
        this.connecting = null;
        reject(err);
      });
      socket.on('data', lineSplitter((line) => this.onMessage(JSON.parse(line) as HelperMessage), () => socket.destroy()));
      socket.on('close', () => {
        this.socket = null;
        for (const p of this.pending.values()) p.reject(new Error('helper_unreachable'));
        this.pending.clear();
      });
    });
    return this.connecting;
  }

  private onMessage(message: HelperMessage): void {
    if ('event' in message) {
      this.set(message.value);
      return;
    }
    const waiting = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.ok) waiting?.resolve(message.value);
    else waiting?.reject(new HelperReply(message.code));
  }

  private async call(method: HelperMethod, params?: unknown): Promise<unknown> {
    const socket = await this.open();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  // Reads the helper's state, so a tunnel left up before the app started shows as connected.
  async sync(): Promise<void> {
    try {
      this.set((await this.call('status')) as Status);
    } catch {
      // The helper is not running; connect will say so.
    }
  }

  async connect(profile: AppProfile, settings: Settings, locationId: number | null, latency?: Map<string, number | null>): Promise<Status> {
    try {
      return this.set((await this.call('connect', { profile, settings, locationId, latency: latency ? [...latency] : [] })) as Status);
    } catch (err) {
      // A running helper that refused or failed says why; anything else means it is not there.
      return this.set({ state: 'disconnected', locationId, error: err instanceof HelperReply ? err.code : this.unreachable });
    }
  }

  // The helper's log; empty when it cannot be reached (or is older than this request).
  async logs(): Promise<string> {
    try {
      const text = await Promise.race([this.call('logs'), new Promise((r) => setTimeout(() => r(''), 5000))]);
      return typeof text === 'string' ? text : '';
    } catch {
      return '';
    }
  }

  async disconnect(): Promise<Status> {
    try {
      return this.set((await this.call('disconnect')) as Status);
    } catch {
      return this.set({ state: 'disconnected' });
    }
  }
}
