/** Inline SVG so the CSP can forbid external images and inline styles alike. */

const base = {
  xmlns: "http://www.w3.org/2000/svg",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export const LockIcon = ({ size = 18 }: { size?: number }) => (
  <svg {...base} width={size} height={size} viewBox="0 0 24 24">
    <rect x="4" y="10.5" width="16" height="10" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </svg>
);

export const WarningIcon = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size} viewBox="0 0 24 24">
    <path d="M12 3.5 21 19.5H3z" />
    <path d="M12 10v4" />
    <path d="M12 17.2h.01" />
  </svg>
);

export const CheckIcon = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size} viewBox="0 0 24 24">
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
);

export const CopyIcon = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size} viewBox="0 0 24 24">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" />
  </svg>
);
