import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { app } from 'electron';

import type { Os } from '../../shared/platform';
import { run } from './run';

const taskName = 'Digi Cyber';
const desktopFile = () => path.join(os.homedir(), '.config', 'autostart', 'digi-cyber.desktop');

export async function setAutostart(system: Os, enabled: boolean, exePath: string): Promise<void> {
  if (system === 'windows') {
    // The app runs as administrator, which a Run key cannot start without a UAC prompt; a task can.
    if (enabled) await run('schtasks.exe', ['/Create', '/F', '/TN', taskName, '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/TR', `"${exePath}" --hidden`]);
    else await run('schtasks.exe', ['/Delete', '/F', '/TN', taskName]);
  } else if (system === 'macos') {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  } else if (enabled) {
    fs.mkdirSync(path.dirname(desktopFile()), { recursive: true });
    fs.writeFileSync(desktopFile(), `[Desktop Entry]\nType=Application\nName=Digi Cyber\nExec="${exePath}" --hidden\nIcon=digi-cyber\nX-GNOME-Autostart-enabled=true\n`);
  } else {
    fs.rmSync(desktopFile(), { force: true });
  }
}
