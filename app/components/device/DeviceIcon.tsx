import { useId } from "react";

// A plump, domed pebble: one rounded outline, deeper below than above, with
// no separate edge band. Shading does the rounding: a ball-like falloff to
// the outline, a soft highlight on the dome and a shadow along the bottom.
const CX = 20;
const CY = 15;
const RADIUS = 18;
const TOP_DEPTH = 13;
const BOTTOM_DEPTH = 15.5;
// The grooves lie on the dome, which faces up slightly above the middle of
// the outline and curves away toward the rim, so they sit high and short.
const FACE_Y = 13.8;
const TILT = 0.72;
const TURN = -15;
const LED_AT = [6.2, 8.6, 11];

/** A small black-and-white drawing of the device for the wordmark. */
export function DeviceIcon({ className }: { className?: string }) {
  // useId can contain characters that break a url(#…) reference.
  const id = useId().replace(/[^\w-]/g, "");
  const body = `${id}-body`;
  const under = `${id}-under`;
  const glow = `${id}-glow`;
  const clip = `${id}-clip`;
  const outline = `M${CX - RADIUS},${CY} A${RADIUS},${TOP_DEPTH} 0 0 1 ${CX + RADIUS},${CY} A${RADIUS},${BOTTOM_DEPTH} 0 0 1 ${CX - RADIUS},${CY} Z`;

  return (
    <svg
      viewBox={`0 0 40 ${Math.ceil(CY + BOTTOM_DEPTH + 1)}`}
      aria-hidden="true"
      className={className}
    >
      <defs>
        {/* Lit from the top left and darkening right out to the outline,
            like a ball rather than a flat face. */}
        <radialGradient id={body} cx="0.42" cy="0.36" r="0.68">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#efefef" />
          <stop offset="0.85" stopColor="#cdcdcd" />
          <stop offset="1" stopColor="#b1b1b1" />
        </radialGradient>
        <linearGradient id={under} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.55" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.14" />
        </linearGradient>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <clipPath id={clip}>
          <path d={outline} />
        </clipPath>
      </defs>

      <path d={outline} fill={`url(#${body})`} />
      <g clipPath={`url(#${clip})`}>
        <path d={outline} fill={`url(#${under})`} />
        {/* The light caught on top of the dome. */}
        <ellipse
          cx={CX - 4}
          cy={CY - 7}
          rx="9"
          ry="4"
          fill="#ffffff"
          opacity="0.9"
          filter={`url(#${glow})`}
        />
      </g>

      <g transform={`translate(${CX} ${FACE_Y}) scale(1 ${TILT}) rotate(${TURN})`}>
        {[0, 90, 180, 270].map((angle) => (
          <g key={angle} transform={`rotate(${angle})`}>
            <rect x="4.6" y="-1.9" width="8.3" height="3.8" rx="1.9" fill="#bdbdbd" />
            {LED_AT.map((x) => (
              <circle key={x} cx={x} cy="0" r="0.95" fill="#ffffff" />
            ))}
          </g>
        ))}
        <circle r="2.7" fill="none" stroke="#b3b3b3" strokeWidth="0.6" />
      </g>
    </svg>
  );
}
