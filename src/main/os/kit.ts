import type { Os } from '../../shared/platform';
import type { L2tpAccount } from '../configs/l2tp';
import type { LogFn } from '../log';

export interface L2tpDriver {
  // notice is a message for the user, such as a restart Windows needs once.
  connect(account: L2tpAccount, log?: LogFn): Promise<{ ok: boolean; notice?: string }>;
  isUp(): Promise<boolean>;
  disconnect(): Promise<void>;
}

// What connecting needs from the system the engines run on.
export interface SystemKit {
  os: Os;
  exe(name: string): string;
  // null when this system has no OpenVPN the app can run.
  openvpnBinary(binDir: string): string | null;
  // Sets up what OpenVPN needs before it starts (Windows: its adapters); true when Data Channel Offload is there.
  openvpnPrepare?(binDir: string, log: LogFn): Promise<boolean>;
  // The tunnel's resolvers; Linux leaves DNS to the system unless told.
  openvpnUp(dns: string[]): Promise<void>;
  l2tp: L2tpDriver | null;
  applyZone(iana: string): Promise<string | null>;
  restoreZone(previous: string | null): Promise<void>;
  protectWebrtc(): Promise<Record<string, string | null>>;
  restoreWebrtc(backup: Record<string, string | null>): Promise<void>;
  tunName?: string;
}
