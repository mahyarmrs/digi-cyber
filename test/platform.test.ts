import { describe, expect, it } from 'vitest';

import { executableName, osOf } from '../src/shared/platform';

describe('platform executable paths', () => {
  it('uses Windows executable suffixes for packaged engine binaries', () => {
    expect(executableName(osOf('win32'), 'xray')).toBe('xray.exe');
    expect(executableName(osOf('win32'), 'sing-box')).toBe('sing-box.exe');
  });

  it('keeps Unix engine names extensionless', () => {
    expect(executableName(osOf('linux'), 'xray')).toBe('xray');
    expect(executableName(osOf('darwin'), 'xray')).toBe('xray');
  });
});
