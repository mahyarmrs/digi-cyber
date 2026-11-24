import { regQuery, regSet } from './run';

const key = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\PolicyAgent';
const value = 'AssumeUDPEncapsulationContextOnSendRule';

// Windows refuses L2TP/IPsec to a server behind NAT until this is 2 and Windows restarted.
export async function allowL2tpBehindNat(): Promise<boolean> {
  const current = await regQuery(key, value);
  if (current === '0x2') return false;
  return regSet(key, value, 'REG_DWORD', '2');
}
