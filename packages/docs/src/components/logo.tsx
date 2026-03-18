import type { SVGProps } from "react";

export function LogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 56 40"
      fill="none"
      {...props}
    >
      <line
        x1="8"
        y1="30"
        x2="28"
        y2="8"
        stroke="#7C3AED"
        strokeWidth="1.5"
        strokeOpacity="0.5"
      />
      <line
        x1="28"
        y1="8"
        x2="48"
        y2="30"
        stroke="#7C3AED"
        strokeWidth="1.5"
        strokeOpacity="0.5"
      />
      <line
        x1="8"
        y1="30"
        x2="48"
        y2="30"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.15"
      />
      <circle cx="8" cy="30" r="5" fill="currentColor" />
      <circle cx="28" cy="8" r="6" fill="#7C3AED" />
      <circle cx="48" cy="30" r="5" fill="currentColor" />
    </svg>
  );
}

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 380 60"
      fill="none"
      {...props}
    >
      {/* Symbol — scaled to match text cap height */}
      <g transform="translate(10, 30)">
        <line
          x1="0"
          y1="0"
          x2="18"
          y2="-16"
          stroke="#7C3AED"
          strokeWidth="1.5"
          strokeOpacity="0.5"
        />
        <line
          x1="18"
          y1="-16"
          x2="36"
          y2="0"
          stroke="#7C3AED"
          strokeWidth="1.5"
          strokeOpacity="0.5"
        />
        <line
          x1="0"
          y1="0"
          x2="36"
          y2="0"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeOpacity="0.15"
        />
        <circle cx="0" cy="0" r="5" fill="currentColor" />
        <circle cx="18" cy="-16" r="6" fill="#7C3AED" />
        <circle cx="36" cy="0" r="5" fill="currentColor" />
      </g>
      <text
        x="62"
        y="42"
        fontFamily="'Inter', system-ui, -apple-system, sans-serif"
        fontSize="38"
        fontWeight="600"
        letterSpacing="-1"
        fill="currentColor"
      >
        noddde
      </text>
    </svg>
  );
}
