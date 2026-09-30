import type { CSSProperties, ReactNode } from "react";

/** 通用图标外壳（线性风格，与原版一致） */
export function Ic({
  children,
  size = 15,
  sw = 1.8,
  className,
  style,
}: {
  children: ReactNode;
  size?: number;
  sw?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const P = {
  logo: <path d="M4 12h3l2-5 3 10 2-5h6" strokeWidth={2.2} />,
  serial: (
    <>
      <rect x="3" y="7" width="18" height="11" rx="2" />
      <path d="M7 7V4M11 7V4M15 7V4M19 7V4M7 14h.01M11 14h.01M15 14h.01M17.5 15h.01" />
    </>
  ),
  can: (
    <>
      <rect x="2" y="9" width="6" height="6" rx="1.5" />
      <rect x="16" y="9" width="6" height="6" rx="1.5" />
      <path d="M8 12h8M12 12v0" />
    </>
  ),
  net: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.8 2.6 4 5.6 4 9s-1.2 6.4-4 9c-2.8-2.6-4-5.6-4-9s1.2-6.4 4-9z" />
    </>
  ),
  mqtt: (
    <>
      <path d="M4 20a13 13 0 0 1 16 0M7.5 15.5a8 8 0 0 1 9 0M11 11.5a3.5 3.5 0 0 1 2 0" />
      <circle cx="12" cy="19.4" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  proto: <path d="M8 6l-5 6 5 6M16 6l5 6-5 6M13 4l-2 16" />,
  queue: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19 12a7 7 0 0 0-.15-1.4l2-1.55-2-3.46-2.35.95a7 7 0 0 0-2.4-1.4L13.7 2.6h-3.4l-.4 2.54a7 7 0 0 0-2.4 1.4l-2.35-.95-2 3.46 2 1.55A7 7 0 0 0 5 12c0 .48.05.94.15 1.4l-2 1.55 2 3.46 2.35-.95a7 7 0 0 0 2.4 1.4l.4 2.54h3.4l.4-2.54a7 7 0 0 0 2.4-1.4l2.35.95 2-3.46-2-1.55c.1-.46.15-.92.15-1.4z" />
    </>
  ),
  send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />,
  play: <path d="M5 3l14 9-14 9V3z" fill="currentColor" stroke="none" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5" />
    </>
  ),
  bolt: <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />,
  filter: (
    <>
      <path d="M3 5h18M3 12h18M3 19h18" opacity=".4" />
      <path d="M7 5v14" />
    </>
  ),
  options: <path d="M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5" />,
  box: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 9h6v6H9z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v.01M12 11v5" />
    </>
  ),
  lines: <path d="M4 7h16M4 12h16M4 17h16" />,
  code: <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" />,
  slip: <path d="M4 12h16M4 7h10M4 17h10" />,
  layers: <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />,
  terminal: <path d="M4 17l6-6-6-6M12 19h8" />,
  pen: <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />,
  reload: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </>
  ),
  chevDown: <path d="M6 9l6 6 6-6" />,
};
