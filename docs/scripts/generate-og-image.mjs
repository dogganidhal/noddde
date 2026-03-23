import sharp from "sharp";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "../public/og-image.png");

const WIDTH = 1200;
const HEIGHT = 630;

const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0a0a0a"/>

  <!-- Logo: mark + "noddde" text, scaled 2.5x and centered -->
  <g transform="translate(310, 170) scale(2.5)">
    <g transform="translate(10, 30)">
      <line x1="0" y1="0" x2="18" y2="-16" stroke="#7C3AED" stroke-width="1.5" stroke-opacity="0.5"/>
      <line x1="18" y1="-16" x2="36" y2="0" stroke="#7C3AED" stroke-width="1.5" stroke-opacity="0.5"/>
      <line x1="0" y1="0" x2="36" y2="0" stroke="#FAFAFA" stroke-width="1.5" stroke-opacity="0.15"/>
      <circle cx="0" cy="0" r="5" fill="#FAFAFA"/>
      <circle cx="18" cy="-16" r="6" fill="#7C3AED"/>
      <circle cx="36" cy="0" r="5" fill="#FAFAFA"/>
    </g>
    <text x="62" y="42"
      font-family="'Helvetica Neue', 'Inter', system-ui, sans-serif"
      font-size="38" font-weight="600" letter-spacing="-1"
      fill="#FAFAFA">noddde</text>
  </g>

  <!-- Tagline -->
  <text x="600" y="380"
    text-anchor="middle"
    font-family="'Helvetica Neue', 'Inter', system-ui, sans-serif"
    font-size="24" fill="#a1a1aa">
    Domain modeling for TypeScript that stays out of your way.
  </text>

  <!-- Keywords -->
  <text x="600" y="420"
    text-anchor="middle"
    font-family="'Helvetica Neue', 'Inter', system-ui, sans-serif"
    font-size="18" fill="#71717a">
    DDD \u00B7 CQRS \u00B7 Event Sourcing \u00B7 Decider Pattern
  </text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(OUTPUT);
console.log(`OG image written to ${OUTPUT}`);
