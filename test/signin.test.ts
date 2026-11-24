import { describe, expect, it } from 'vitest';

import { buildSignIn, parseSignIn } from '../src/shared/signin';

describe('sign-in links', () => {
  it('reads the link and the username from the code the bot writes', () => {
    // PHP's rawurlencode, as the bot builds it.
    expect(parseSignIn('digicyber://login?sub=https%3A%2F%2Fsub.example.com%3A2096%2Fsub%2Fab12cd&user=z7b21tfbhc')).toEqual({
      subLink: 'https://sub.example.com:2096/sub/ab12cd',
      username: 'z7b21tfbhc',
    });
  });

  it('takes a plain subscription link and leaves the username to the user', () => {
    expect(parseSignIn('  http://1.2.3.4:2096/sub/ab12cd \n')).toEqual({ subLink: 'http://1.2.3.4:2096/sub/ab12cd', username: '' });
  });

  it('refuses what is not a sign-in link', () => {
    expect(parseSignIn('vless://uuid@host:443?type=tcp#x')).toBeNull();
    expect(parseSignIn('https://example.com/')).toBeNull();
    expect(parseSignIn('digicyber://login?user=dana')).toBeNull();
    expect(parseSignIn('digicyber://login?sub=ftp%3A%2F%2Fx%2Fsub&user=dana')).toBeNull();
  });

  it('reads back what it builds, spaces and Persian included', () => {
    const code = { subLink: 'https://s.example.com/sub/x?name=a+b', username: 'کاربر 1+2' };
    expect(parseSignIn(buildSignIn(code))).toEqual(code);
  });
});
