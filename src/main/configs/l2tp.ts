export interface L2tpAccount {
  host: string;
  username: string;
  password: string;
  psk: string;
}

export const l2tpConnectionName = 'Digi Cyber L2TP';

// l2tp://user:password@host?ipsec=1&psk=key#remark, as the panel writes it.
export function l2tpAccount(link: string): L2tpAccount {
  const url = new URL(link);
  if (url.protocol !== 'l2tp:') throw new Error('not an L2TP link');
  const account = {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    psk: url.searchParams.get('psk') ?? '',
  };
  if (!account.host || !account.username) throw new Error('not an L2TP account');
  return account;
}

// Read by build/windows/l2tp-connection.ps1: the values reach PowerShell as data, never as script text.
export const l2tpScriptFile = 'l2tp-connection.ps1';

export function l2tpScriptEnv(account: L2tpAccount, name = l2tpConnectionName): Record<string, string> {
  return { DC_L2TP_NAME: name, DC_L2TP_SERVER: account.host, DC_L2TP_PSK: account.psk };
}
