// The logo's speed lines, reused as meters.

const ion = [47, 211, 255];
const volt = [155, 107, 255];

function mix(a: number[], b: number[], t: number): string {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}

// A bar of dashes, filled from the start: cyan to violet, amber from 80% and red from 95%.
export function Dashes({ percent, count = 24, label }: { percent: number | null; count?: number; label: string }) {
  if (percent === null) {
    return (
      <div className="dashes unlimited" role="img" aria-label={label}>
        {Array.from({ length: count }, (_, i) => (
          <i key={i} />
        ))}
      </div>
    );
  }
  const lit = percent <= 0 ? 0 : Math.max(1, Math.round((percent / 100) * count));
  const level = percent >= 95 ? 'var(--bad)' : percent >= 80 ? 'var(--warn)' : null;
  return (
    <div className="dashes" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={i < lit ? { background: level ?? mix(ion, volt, count > 1 ? i / (count - 1) : 0) } : undefined} />
      ))}
    </div>
  );
}

export type PingKind = 'good' | 'mid' | 'slow' | 'off';

export function pingKind(ms: number | null): PingKind {
  if (ms === null) return 'off';
  return ms < 150 ? 'good' : ms < 300 ? 'mid' : 'slow';
}

// Three speed lines: all lit under 150 ms, two under 300 ms, one above.
export function Signal({ ms, measuring = false }: { ms: number | null; measuring?: boolean }) {
  const kind = measuring && ms === null ? 'measuring' : pingKind(ms);
  return (
    <span className={`signal ${kind}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

export function Ping({ ms, measuring = false }: { ms: number | null; measuring?: boolean }) {
  return (
    <span className="ping">
      <Signal ms={ms} measuring={measuring} />
      {ms === null ? (measuring ? '…' : '—') : `${ms} ms`}
    </span>
  );
}
