import { memo } from 'react'

export const KeepIndexLogo = memo(function KeepIndexLogo() {
  return (
    <h1 className="flex shrink-0 items-center gap-2.5" aria-label="KeepIndex">
      <svg
        className="keepindex-mark"
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="2" y="2" width="60" height="60" rx="14" className="keepindex-mark-field" />
        <g className="keepindex-mark-inputs">
          <path d="M13 11h10v18h7" />
          <path d="M13 53h10V35h7" />
          <path d="M52 11h-5L33 28" />
          <path d="M53 32H36" />
        </g>
        <path d="M32 35l15 18h6" className="keepindex-mark-answer" />
        <path d="M29 29h6v6h-6z" className="keepindex-mark-weave" />
        <path d="M30 32h4" className="keepindex-mark-bridge" />
      </svg>
      <span className="brand-type text-xl font-semibold tracking-[-0.055em]">keepindex</span>
    </h1>
  )
})
