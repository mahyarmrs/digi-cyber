import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { missingDownloads, render } from '../scripts/hub-page.mjs';

const repo = 'DigiCyber/downloads';
const template = fs.readFileSync(path.join(__dirname, '..', 'hub', 'README.md'), 'utf8');

function shotsDir(groups: Record<string, string[]>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'));
  for (const [group, files] of Object.entries(groups)) {
    fs.mkdirSync(path.join(dir, group));
    for (const f of files) fs.writeFileSync(path.join(dir, group, f), '');
  }
  return dir;
}

// The names the v1.1.0 release actually carried, for a version the page is rendered for.
const releaseFiles = (v: string) => [
  `Digi-Cyber-Setup-${v}.exe`,
  ...['arm64-v8a', 'armeabi-v7a', 'universal', 'x86', 'x86_64'].map((abi) => `Digi-Cyber-${v}-android-${abi}.apk`),
  `Digi-Cyber-${v}-linux-amd64.deb`, `Digi-Cyber-${v}-linux-arm64.deb`,
  `Digi-Cyber-${v}-linux-x86_64.rpm`, `Digi-Cyber-${v}-linux-aarch64.rpm`,
  `Digi-Cyber-${v}-linux-x64.pacman`, `Digi-Cyber-${v}-linux-aarch64.pacman`,
  `Digi-Cyber-${v}-mac-arm64.pkg`, `Digi-Cyber-${v}-mac-x64.pkg`,
  'SHA256SUMS.txt',
];

describe('download page', () => {
  it('links every download to a file the release has, and nothing is left unfilled', () => {
    const page = render(template, { tag: 'v2.3.4', repo, screenshotsDir: shotsDir({ android: ['01-home.png'] }) });
    expect(missingDownloads(page, { tag: 'v2.3.4', repo, files: releaseFiles('2.3.4') })).toEqual([]);
    expect(page).not.toMatch(/\{\{|<!-- \/?section/);
    expect(page).toContain(`https://github.com/${repo}/releases/download/v2.3.4/Digi-Cyber-Setup-2.3.4.exe`);
  });

  it('reports a link to an installer the release lacks', () => {
    const page = render(template, { tag: 'v2.3.4', repo, screenshotsDir: shotsDir({}) });
    const files = releaseFiles('2.3.4').filter((f) => !f.endsWith('mac-x64.pkg'));
    expect(missingDownloads(page, { tag: 'v2.3.4', repo, files })).toEqual(['Digi-Cyber-2.3.4-mac-x64.pkg']);
  });

  it('shows a screenshots section only for a folder that has pictures', () => {
    const page = render(template, { tag: 'v1.0.0', repo, screenshotsDir: shotsDir({ android: ['02-home.png', '01-welcome.png'], desktop: [] }) });
    expect(page).toContain('تصاویر اندروید');
    expect(page).not.toContain('تصاویر ویندوز');
    expect(page.indexOf('screenshots/android/01-welcome.png')).toBeLessThan(page.indexOf('screenshots/android/02-home.png'));
  });
});
