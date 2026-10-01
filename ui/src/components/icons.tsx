// A handful of inline SVG icons, so the UI needs no icon library.

type P = { size?: number; className?: string }
const base = (size = 14) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const Check = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M20 6 9 17l-5-5" /></svg>
)
export const Cross = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M18 6 6 18M6 6l12 12" /></svg>
)
export const Play = ({ size, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none"><path d="M7 4.5v15l13-7.5z" /></svg>
)
export const Pause = ({ size, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
)
export const Wrench = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></svg>
)
export const Sparkle = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>
)
export const Chevron = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="m9 18 6-6-6-6" /></svg>
)
export const Copy = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
)
export const Download = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
)
export const Upload = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 21V9M7 14l5-5 5 5M5 3h14" /></svg>
)
export const Fit = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
)
export const Sidebar = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
)
export const Minus = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M5 12h14" /></svg>
)
export const Plus = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>
)
export const Logo = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="6" cy="12" r="3" fill="#7c9cff" />
    <circle cx="18" cy="6" r="3" fill="#c084fc" />
    <circle cx="18" cy="18" r="3" fill="#22d3ee" />
    <path d="M9 11 15.5 7.2M9 13l6.5 3.8M18 9v6" stroke="#3f3f46" strokeWidth="1.6" />
  </svg>
)
export const Sun = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
)
export const Moon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
)
export const Activity = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M4 6h16M4 12h10M4 18h13" /></svg>
)
export const ChevronUp = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="m6 15 6-6 6 6" /></svg>
)
export const ChevronDown = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="m6 9 6 6 6-6" /></svg>
)
export const Thought = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M8 18h8a5 5 0 0 0 .9-9.9A6 6 0 0 0 5.3 9.6 4.3 4.3 0 0 0 8 18z" /><circle cx="6" cy="21.5" r="1" /></svg>
)
export const ArrowRight = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
export const Expand = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h10M7 17h6" /></svg>
)
