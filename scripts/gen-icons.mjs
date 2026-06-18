import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}
function toHex([r, g, b]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Color stops around the ring: angle in degrees, 0° = 12 o'clock, clockwise
// Sweeps from deep navy (top) through orange-amber (bottom) back to navy
const colorStops = [
  { a: 0,   c: [10, 22, 100] },   // deep navy blue
  { a: 60,  c: [18, 48, 170] },   // royal blue
  { a: 100, c: [100, 55, 185] },  // blue-violet
  { a: 140, c: [185, 65, 28] },   // burnt orange
  { a: 170, c: [218, 108, 22] },  // orange
  { a: 200, c: [232, 160, 28] },  // amber (matches --accent)
  { a: 225, c: [244, 185, 18] },  // golden yellow
  { a: 255, c: [200, 95, 18] },   // back to amber
  { a: 275, c: [65, 50, 175] },   // purple-blue
  { a: 315, c: [16, 32, 135] },   // deep blue
  { a: 360, c: [10, 22, 100] },   // back to navy
];

function getColorAtAngle(angle) {
  for (let i = 0; i < colorStops.length - 1; i++) {
    if (angle >= colorStops[i].a && angle <= colorStops[i + 1].a) {
      const t = (angle - colorStops[i].a) / (colorStops[i + 1].a - colorStops[i].a);
      return lerpColor(colorStops[i].c, colorStops[i + 1].c, t);
    }
  }
  return colorStops[0].c;
}

const SIZE = 512;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 198;   // ring center radius
const SW = 68;   // stroke width (ring thickness)
const N = 180;   // segments (every 2°)

function polar(r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function f(n) { return n.toFixed(3); }

const segSize = 360 / N;
let paths = '';

for (let i = 0; i < N; i++) {
  const a0 = i * segSize - 0.6;       // slight overlap to avoid gaps
  const a1 = (i + 1) * segSize + 0.6;
  const aMid = (i + 0.5) * segSize;
  const col = toHex(getColorAtAngle(aMid));
  const p0 = polar(R, a0);
  const p1 = polar(R, a1);
  const largeArc = (a1 - a0) > 180 ? 1 : 0;
  paths += `<path d="M ${f(p0.x)} ${f(p0.y)} A ${R} ${R} 0 ${largeArc} 1 ${f(p1.x)} ${f(p1.y)}" fill="none" stroke="${col}" stroke-width="${SW}" stroke-linecap="butt"/>\n  `;
}

// Two overlapping D letters for the DD logo — second D offset slightly right
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#050506" rx="90"/>
  ${paths}
  <text x="${CX - 8}" y="${CY + 56}" text-anchor="middle"
    font-family="Arial Black, &quot;Arial Bold&quot;, Arial, sans-serif"
    font-weight="900" font-size="152" fill="white" letter-spacing="-6">DD</text>
</svg>`;

const sizes = [
  { name: 'icon-32.png',  size: 32  },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

for (const { name, size } of sizes) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(publicDir, name));
  console.log(`Generated public/${name}`);
}

console.log('All icons generated successfully.');
