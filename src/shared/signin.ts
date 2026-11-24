// What a sign-in link or a pasted text holds: the subscription link, and the username when it carries
// both, as digicyber://login?sub=…&user=… (the bot's QR code and button, the panel's sign-in link) does.
export interface SignInCode {
  subLink: string;
  username: string;
}

export const signInScheme = 'digicyber';

// The rule the app API's address is built with: http(s), a host and a path.
export function isSubLink(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.host !== '' && url.pathname.split('/').some((p) => p !== '');
  } catch {
    return false;
  }
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch {
    return part;
  }
}

export function parseSignIn(text: string): SignInCode | null {
  const raw = text.trim();
  if (raw === '') return null;
  if (raw.toLowerCase().startsWith(`${signInScheme}:`)) {
    const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1).split('#')[0] : '';
    const params = new Map<string, string>();
    for (const part of query.split('&')) {
      const i = part.indexOf('=');
      if (i > 0) params.set(decode(part.slice(0, i)), decode(part.slice(i + 1)));
    }
    const subLink = (params.get('sub') ?? '').trim();
    if (!isSubLink(subLink)) return null;
    return { subLink, username: (params.get('user') ?? '').trim() };
  }
  return isSubLink(raw) ? { subLink: raw, username: '' } : null;
}

export function buildSignIn(code: SignInCode): string {
  return `${signInScheme}://login?sub=${encodeURIComponent(code.subLink)}&user=${encodeURIComponent(code.username)}`;
}
