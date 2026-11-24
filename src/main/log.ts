import fs from 'node:fs';
import path from 'node:path';

import { redact } from '../shared/redact';

export type LogFn = (source: string, text: string) => void;

function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// Everything the app and its engines said since it started, redacted as it is written: kept in memory
// (the newest maxBytes) for the support report, and in a file so the previous run can be read too.
export class SessionLog {
  private lines: string[] = [];
  private bytes = 0;
  private readonly secrets = new Set<string>();
  private file: string | null = null;
  private previousFile: string | null = null;

  constructor(private readonly maxBytes = 1_500_000) {}

  // Moves the last run's file aside and starts a new one.
  open(file: string): void {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const prev = file.replace(/\.log$/, '') + '.prev.log';
      if (fs.existsSync(file)) fs.renameSync(file, prev);
      this.previousFile = prev;
      fs.writeFileSync(file, this.lines.join(''), { mode: 0o600 });
      this.file = file;
    } catch {
      this.file = null;
    }
  }

  // A value that must not appear in the log (a token, a subscription link); earlier lines are redacted again.
  secret(...values: string[]): void {
    let added = false;
    for (const v of values) {
      if (v && v.length >= 4 && !this.secrets.has(v)) {
        this.secrets.add(v);
        added = true;
      }
    }
    if (added) this.lines = this.lines.map((l) => redact(l, this.secrets));
  }

  write: LogFn = (source, text) => {
    const at = stamp();
    let chunk = '';
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line) continue;
      chunk += `${at} [${source}] ${redact(line, this.secrets)}\n`;
    }
    if (!chunk) return;
    this.lines.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes > this.maxBytes && this.lines.length > 1) this.bytes -= this.lines.shift()!.length;
    if (this.file) {
      try {
        fs.appendFileSync(this.file, chunk);
      } catch {
        this.file = null;
      }
    }
  };

  text(): string {
    return this.lines.join('');
  }

  // The end of the previous run's log, for a crash that ended it.
  previous(maxBytes = 200_000): string {
    if (!this.previousFile) return '';
    try {
      const text = fs.readFileSync(this.previousFile, 'utf8');
      return redact(text.length > maxBytes ? text.slice(text.indexOf('\n', text.length - maxBytes) + 1) : text, this.secrets);
    } catch {
      return '';
    }
  }
}

// The keep-the-newest end of a text, cut at a line.
export function tail(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  const cut = text.indexOf('\n', text.length - maxBytes);
  return `… (${text.length - maxBytes} earlier characters left out)\n${text.slice(cut + 1)}`;
}
