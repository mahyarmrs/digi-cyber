// What a log line must never carry when it leaves the device: config links, ids, keys, passwords and tokens.
// The account's username stays, since support needs to know whose log it is.

const shareLink = /\b(vless|vmess|trojan|ss|ssr|hysteria2?|hy2|tuic|wireguard|wg|openvpn|l2tp|digicyber):\/\/[^\s"'<>]+/gi;
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// A 32-byte key in base64 (WireGuard and REALITY keys): 43 characters and padding, or 43 url-safe ones.
const key32 = /(?<![A-Za-z0-9+/_-])(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9_-]{43})(?![A-Za-z0-9+/=_-])/g;
const bearer = /\bBearer\s+[^\s"']+/gi;
const named = /\b(password|passwd|pass|psk|secret|secretKey|privateKey|preSharedKey|token)(["']?\s*[:=]\s*["']?)[^\s"',&;]+/gi;
// OpenVPN logs the session token a server pushes (PUSH_REPLY,…,auth-token SESS_ID_…).
const authToken = /\bauth-token(\s+|,)[^\s,']+/gi;

export const redacted = '‹hidden›';

export function redact(text: string, secrets: Iterable<string> = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join(redacted);
  }
  return out
    .replace(shareLink, (_m, scheme: string) => `${scheme}://${redacted}`)
    .replace(bearer, `Bearer ${redacted}`)
    .replace(named, (_m, name: string, sep: string) => `${name}${sep}${redacted}`)
    .replace(authToken, (_m, sep: string) => `auth-token${sep}${redacted}`)
    .replace(uuid, '‹id›')
    .replace(key32, '‹key›');
}

// The secret a subscription link carries: its last path segment (the subscription id), so the host
// stays readable; the whole link when it has no such segment.
export function linkSecrets(link: string): string[] {
  try {
    const url = new URL(link.trim());
    const id = url.pathname.split('/').filter(Boolean).pop();
    if (id && id.length >= 6) return [id, decodeURIComponent(id)];
  } catch {
    // Not a URL: the text itself is all there is.
  }
  return [link.trim()];
}
