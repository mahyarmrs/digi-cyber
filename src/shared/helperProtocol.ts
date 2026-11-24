import type { Os } from './platform';
import type { Status } from './types';

// On Linux and macOS the engines run in a root helper (a systemd service or a LaunchDaemon);
// the app talks to it with one JSON message per line over this socket.
export const helperSocket: Record<Exclude<Os, 'windows'>, string> = {
  linux: '/run/digi-cyber/helper.sock',
  macos: '/var/run/digi-cyber.sock',
};

export const helperProtocolVersion = 1;

export type HelperMethod = 'hello' | 'status' | 'connect' | 'disconnect' | 'logs';

export interface HelperRequest {
  id: number;
  method: HelperMethod;
  params?: unknown;
}

export type HelperMessage = { id: number; ok: true; value: unknown } | { id: number; ok: false; code: string } | { event: 'status'; value: Status };

// Splits a byte stream into lines; a line longer than maxBytes ends the stream.
export function lineSplitter(onLine: (line: string) => void, onOverflow: () => void, maxBytes = 4 << 20): (chunk: Buffer) => void {
  let buffered = '';
  return (chunk) => {
    buffered += chunk.toString('utf8');
    let at: number;
    while ((at = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      if (line.trim()) onLine(line);
    }
    if (buffered.length > maxBytes) {
      buffered = '';
      onOverflow();
    }
  };
}
