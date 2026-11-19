import { SVGProps } from 'react';

type P = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;

export function RunnerIcon({ size = 44, strokeWidth = 3.5, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <circle cx="30" cy="9" r="4" />
      <path d="M27 16 L21 28 L29 33 L27 42 M21 28 L15 36 L8 38 M26 19 L17 22 L14 28 M26 19 L33 24 L38 22" />
    </svg>
  );
}

export function MicrosoftLogo({ size = 21 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="10" height="10" fill="#F25022" />
      <rect x="11" y="0" width="10" height="10" fill="#7FBA00" />
      <rect x="0" y="11" width="10" height="10" fill="#00A4EF" />
      <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

type Name = 'home' | 'award' | 'user';

export function Icon({ name, size = 22 }: { name: Name; size?: number }) {
  const paths: Record<Name, JSX.Element> = {
    home: (<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></>),
    award: (<><circle cx="12" cy="8" r="7" /><path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12" /></>),
    user: (<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
