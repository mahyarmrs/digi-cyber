import { BoltIcon } from './Icons';

// A country's flag as a round token; the bolt stands for the fastest location.
export function Flag({ code, size = 30 }: { code: string | null; size?: number }) {
  const style = { width: size, height: size };
  if (code === null) {
    return (
      <span className="flag flag-fastest" style={style} aria-hidden>
        <BoltIcon />
      </span>
    );
  }
  if (!/^[A-Za-z]{2}$/.test(code)) return <span className="flag flag-empty" style={style} aria-hidden />;
  return <span className={`flag fi fis fi-${code.toLowerCase()}`} style={style} aria-hidden />;
}
