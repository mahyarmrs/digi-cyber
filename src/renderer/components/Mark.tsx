import { useId } from 'react';

// The Digi Cyber mark from the logo: the open D, its speed lines and the shield, cyan to violet.
// brand/mark.py draws the same shapes for the icons.
export function Mark({ className = 'mark' }: { className?: string }) {
  const id = `dg${useId().replace(/:/g, '')}`;
  return (
    <svg className={className} viewBox="60 110 400 290" aria-hidden>
      <defs>
        <linearGradient id={id} x1="80" y1="140" x2="430" y2="380" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--cyan)' }} />
          <stop offset="0.5" style={{ stopColor: 'var(--blue)' }} />
          <stop offset="1" style={{ stopColor: 'var(--violet)' }} />
        </linearGradient>
      </defs>
      <g transform="translate(6 0)" fill={`url(#${id})`}>
        <path d="M176 132H300A124 124 0 0 1 300 380H176L214 330H300A74 74 0 0 0 300 182H214Z" />
        <rect x="154" y="208" width="92" height="20" rx="10" />
        <rect x="114" y="246" width="126" height="20" rx="10" />
        <rect x="162" y="284" width="84" height="20" rx="10" />
        <circle cx="130" cy="218" r="10" />
        <circle cx="90" cy="256" r="10" />
        <circle cx="138" cy="294" r="10" />
        <path d="M306 206L348 221V256C348 284 330 302 306 310C282 302 264 284 264 256V221Z" fill="none" stroke={`url(#${id})`} strokeWidth="12" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark />
      <span>
        digi<b>cyber</b>
      </span>
    </span>
  );
}
