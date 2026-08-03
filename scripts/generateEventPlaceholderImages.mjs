#!/usr/bin/env node
// Regenerates the default event-card images used when an event is saved
// without a photo (see shared/eventImages.js EVENT_TYPE_PLACEHOLDER_IMAGES).
// Each is a real, traditional quilt block pattern, not invented geometry.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../public/assets/event-placeholders');

const W = 800;
const H = 600;

// Shared neutrals every type's palette is built on top of, so the set
// reads as one family even though each type gets its own hue.
const NAVY = '#20303A';
const CREAM_LIGHT = '#FAF5EC';
const TAN = '#E7DCC9';

// One real, traditional quilt block per event type. Keys are the exact
// EVENT_TYPES values from src/data/eventOptions.js. For Sale is intentionally
// excluded - a for-sale item is nearly always photographed, and a decorative
// stand-in would misrepresent what is being sold.
//
// Business listings are keyed by business type rather than event type, so a
// directory page is scannable by group even before anyone uploads a photo.
// The blocks are chosen to suit their group: a spool for the longarm quilters,
// a log cabin for the retreat houses.
const TYPES = [
  { key: 'class-half-day', label: 'Class (Half Day)', hero: '#2E77A6', block: 'ninePatch' },
  { key: 'class-full-day', label: 'Class (Full Day)', hero: '#2E77A6', block: 'ninePatch' },
  { key: 'workshop', label: 'Workshop', hero: '#E1613C', block: 'churnDash' },
  { key: 'retreat', label: 'Retreat', hero: '#5C8F6B', block: 'ohioStar' },
  { key: 'lecture', label: 'Lecture', hero: '#7A5698', block: 'flyingGeese' },
  { key: 'challenges', label: 'Challenges', hero: '#C4433A', block: 'bearPaw' },
  { key: 'other', label: 'Other', hero: '#E3A83B', block: 'pinwheel' },
  { key: 'business-listing', label: 'Business Listing', hero: '#3F6B78', block: 'shooFly' },
  { key: 'business-longarm-quilters', label: 'Longarm Quilters', hero: '#A85751', block: 'spool' },
  { key: 'business-quilt-patterns', label: 'Quilt Patterns', hero: '#6E8B4A', block: 'drunkardsPath' },
  { key: 'business-retreat-facilities', label: 'Retreat Facilities', hero: '#8A6A3D', block: 'logCabin' }
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

function mix(hexA, hexB, amount) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * amount));
}

function tri(p1, p2, p3, color) {
  return `<polygon points="${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}" fill="${color}" />`;
}

function rect(x, y, w, h, color) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" />`;
}

// Centred on both axes, because every card crops these with object-fit:cover
// and only the middle survives. The containers run from 1:1 (the embed's
// agenda thumbnail) to about 1.6, against an image that is 4:3 - so a wide
// container crops the top and bottom away, and a square one crops the sides.
// A bottom-left label, which is what this was, loses its descenders in the
// first case and disappears completely in the second.
//
// Worst-case guaranteed-visible area across that range is the middle 75% of
// the width and 83% of the height, which a centred line of 42px type sits
// well inside.
function labelOverlay(label) {
  const bandHeight = 150;

  return `
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${NAVY}" stop-opacity="0" />
        <stop offset="30%" stop-color="${NAVY}" stop-opacity="0.78" />
        <stop offset="70%" stop-color="${NAVY}" stop-opacity="0.78" />
        <stop offset="100%" stop-color="${NAVY}" stop-opacity="0" />
      </linearGradient>
    </defs>
    <rect x="0" y="${H / 2 - bandHeight / 2}" width="${W}" height="${bandHeight}" fill="url(#scrim)" />
    <text
      x="${W / 2}" y="${H / 2 + 15}"
      text-anchor="middle"
      font-family="Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
      font-size="42" font-weight="700" fill="#fffdfa"
      style="letter-spacing: 0.01em;"
    >${label}</text>
  `;
}

function tonalPalette(hero) {
  const heroDark = mix(hero, NAVY, 0.55);
  const heroLight = mix(hero, CREAM_LIGHT, 0.55);
  return [
    [hero, CREAM_LIGHT],
    [heroDark, NAVY],
    [heroLight, TAN],
    [NAVY, hero]
  ];
}

// --- Pinwheel: 4 triangles rotating around the block's center ---
function pinwheelBlock(x, y, size, focus, bg) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size / 2;
  const pts = [
    [cx, cy - r, cx + r, cy - r, cx, cy],
    [cx + r, cy - r, cx + r, cy + r, cx, cy],
    [cx + r, cy + r, cx - r, cy + r, cx, cy],
    [cx - r, cy + r, cx - r, cy - r, cx, cy]
  ];
  return pts.map((p, i) => tri([p[0], p[1]], [p[2], p[3]], [p[4], p[5]], i % 2 === 0 ? focus : bg)).join('');
}

// --- Nine Patch: 3x3 grid, alternating focus/bg, accent square-in-square center ---
function ninePatchBlock(x, y, size, focus, bg) {
  const cell = size / 3;
  const grid = [focus, bg, focus, bg, focus, bg, focus, bg, focus];
  let g = grid.map((color, i) => rect(x + (i % 3) * cell, y + Math.floor(i / 3) * cell, cell, cell, color)).join('');
  const inset = cell * 0.28;
  g += rect(x + cell + inset, y + cell + inset, cell - inset * 2, cell - inset * 2, bg === focus ? focus : NAVY);
  return g;
}

// --- Ohio Star: 3x3 grid, corner squares + center square + 4 star points ---
function ohioStarBlock(x, y, size, focus, bg) {
  const c = size / 3;
  let g = '';
  [[0, 0], [2, 0], [0, 2], [2, 2]].forEach(([col, row]) => {
    g += rect(x + col * c, y + row * c, c, c, bg);
  });
  g += rect(x + c, y + c, c, c, focus);
  g += tri([x + c, y + c], [x + 2 * c, y + c], [x + 1.5 * c, y], focus);
  g += tri([x + c, y], [x + 1.5 * c, y], [x + c, y + c], bg);
  g += tri([x + 2 * c, y], [x + 1.5 * c, y], [x + 2 * c, y + c], bg);
  g += tri([x + c, y + 2 * c], [x + 2 * c, y + 2 * c], [x + 1.5 * c, y + 3 * c], focus);
  g += tri([x + c, y + 3 * c], [x + 1.5 * c, y + 3 * c], [x + c, y + 2 * c], bg);
  g += tri([x + 2 * c, y + 3 * c], [x + 1.5 * c, y + 3 * c], [x + 2 * c, y + 2 * c], bg);
  g += tri([x + c, y + c], [x + c, y + 2 * c], [x, y + 1.5 * c], focus);
  g += tri([x, y + c], [x + c, y + c], [x, y + 1.5 * c], bg);
  g += tri([x, y + 2 * c], [x + c, y + 2 * c], [x, y + 1.5 * c], bg);
  g += tri([x + 2 * c, y + c], [x + 2 * c, y + 2 * c], [x + 3 * c, y + 1.5 * c], focus);
  g += tri([x + 3 * c, y + c], [x + 2 * c, y + c], [x + 3 * c, y + 1.5 * c], bg);
  g += tri([x + 3 * c, y + 2 * c], [x + 2 * c, y + 2 * c], [x + 3 * c, y + 1.5 * c], bg);
  return g;
}

// --- Flying Geese: rows of "goose" triangles, all pointing the same
// direction (the defining trait of the pattern - a strip of geese in
// formation, never alternating, or the shapes fuse into diamonds) ---
function flyingGeeseBlock(x, y, size, focus, bg) {
  const rows = 4;
  const bandH = size / rows;
  const unitW = size / 2;
  let g = '';
  for (let row = 0; row < rows; row += 1) {
    const by = y + row * bandH;
    const offset = row % 2 === 1 ? unitW / 2 : 0;
    for (let col = -1; col < 3; col += 1) {
      const bx = x + col * unitW + offset;
      g += tri([bx, by + bandH], [bx + unitW, by + bandH], [bx + unitW / 2, by], focus);
      g += tri([bx, by], [bx + unitW / 2, by], [bx, by + bandH], bg);
      g += tri([bx + unitW, by], [bx + unitW / 2, by], [bx + unitW, by + bandH], bg);
    }
  }
  return g;
}

// --- Churn Dash: 3x3 grid - bg center, corner HSTs, split-rectangle edges ---
function churnDashBlock(x, y, size, focus, bg) {
  const c = size / 3;
  let g = rect(x + c, y + c, c, c, bg);
  g += tri([x, y], [x + c, y], [x, y + c], focus);
  g += tri([x + c, y], [x + c, y + c], [x, y + c], bg);
  g += tri([x + 2 * c, y], [x + 3 * c, y], [x + 3 * c, y + c], focus);
  g += tri([x + 2 * c, y], [x + 3 * c, y + c], [x + 2 * c, y + c], bg);
  g += tri([x, y + 2 * c], [x, y + 3 * c], [x + c, y + 3 * c], focus);
  g += tri([x, y + 2 * c], [x + c, y + 3 * c], [x + c, y + 2 * c], bg);
  g += tri([x + 3 * c, y + 2 * c], [x + 3 * c, y + 3 * c], [x + 2 * c, y + 3 * c], focus);
  g += tri([x + 3 * c, y + 2 * c], [x + 2 * c, y + 3 * c], [x + 2 * c, y + 2 * c], bg);
  g += rect(x + c, y, c, c / 2, bg);
  g += rect(x + c, y + c / 2, c, c / 2, focus);
  g += rect(x + c, y + 2.5 * c, c, c / 2, bg);
  g += rect(x + c, y + 2 * c, c, c / 2, focus);
  g += rect(x, y + c, c / 2, c, bg);
  g += rect(x + c / 2, y + c, c / 2, c, focus);
  g += rect(x + 2.5 * c, y + c, c / 2, c, bg);
  g += rect(x + 2 * c, y + c, c / 2, c, focus);
  return g;
}

// --- Bear Paw: center square, 4 sashing strips, 4 corner "claw" clusters ---
function bearPawCorner(x, y, size, focus, bg, flipX, flipY) {
  const ts = (size / 7) * 3;
  const fw = size / 7;
  const tx = flipX ? x + size - ts : x;
  const ty = flipY ? y + size - ts : y;
  const at = (lx, ly) => [flipX ? tx + ts - lx : tx + lx, flipY ? ty + ts - ly : ty + ly];

  let g = '';
  for (let r = 0; r < 2; r += 1) {
    for (let cIdx = 0; cIdx < 2; cIdx += 1) {
      const bx = cIdx * fw;
      const by = r * fw;
      g += tri(at(bx, by), at(bx + fw, by), at(bx, by + fw), focus);
      g += tri(at(bx + fw, by), at(bx + fw, by + fw), at(bx, by + fw), bg);
    }
  }
  g += (() => {
    const p1 = at(2 * fw, 2 * fw);
    const p2 = at(3 * fw, 2 * fw);
    const p3 = at(3 * fw, 3 * fw);
    const p4 = at(2 * fw, 3 * fw);
    return `<polygon points="${p1} ${p2} ${p3} ${p4}" fill="${focus}" />`;
  })();
  [[2, 0], [2, 1], [0, 2], [1, 2]].forEach(([lc, lr]) => {
    const p1 = at(lc * fw, lr * fw);
    const p2 = at((lc + 1) * fw, lr * fw);
    const p3 = at((lc + 1) * fw, (lr + 1) * fw);
    const p4 = at(lc * fw, (lr + 1) * fw);
    g += `<polygon points="${p1} ${p2} ${p3} ${p4}" fill="${bg}" />`;
  });
  return g;
}

function bearPawBlock(x, y, size, focus, bg) {
  const fw = size / 7;
  let g = rect(x, y, size, size, bg);
  g += rect(x + 3 * fw, y + 3 * fw, fw, fw, focus);
  g += bearPawCorner(x, y, size, focus, bg, false, false);
  g += bearPawCorner(x, y, size, focus, bg, true, false);
  g += bearPawCorner(x, y, size, focus, bg, false, true);
  g += bearPawCorner(x, y, size, focus, bg, true, true);
  return g;
}

// --- Shoo Fly: 3x3, half-square triangles at the corners around a center square ---
function shooFlyBlock(x, y, size, focus, bg) {
  const c = size / 3;
  let g = rect(x, y, size, size, bg);
  const corners = [
    [0, 0, [0, 0], [1, 0], [0, 1]],
    [2, 0, [3, 0], [3, 1], [2, 0]],
    [0, 2, [0, 2], [0, 3], [1, 3]],
    [2, 2, [3, 3], [2, 3], [3, 2]]
  ];
  corners.forEach(([, , p1, p2, p3]) => {
    g += tri([x + p1[0] * c, y + p1[1] * c], [x + p2[0] * c, y + p2[1] * c], [x + p3[0] * c, y + p3[1] * c], focus);
  });
  g += rect(x + c, y + c, c, c, focus);
  return g;
}

// --- Spool: two flanges and a body, with the wound thread reading as a gap ---
function spoolBlock(x, y, size, focus, bg) {
  const t = size / 4;
  let g = rect(x, y, size, size, bg);
  g += `<polygon points="${x},${y} ${x + size},${y} ${x + size - t},${y + t} ${x + t},${y + t}" fill="${focus}" />`;
  g += `<polygon points="${x},${y + size} ${x + size},${y + size} ${x + size - t},${y + size - t} ${x + t},${y + size - t}" fill="${focus}" />`;
  g += rect(x + t, y + t, size - 2 * t, size - 2 * t, focus);
  g += rect(x + size / 2 - t * 0.22, y + t, t * 0.44, size - 2 * t, bg);
  return g;
}

// --- Log Cabin: strips added around a center square, light half against dark ---
function logCabinBlock(x, y, size, focus, bg) {
  const strips = 4;
  const w = size / (strips * 2 + 1);
  let g = rect(x, y, size, size, bg);
  let left = x;
  let top = y;
  let right = x + size;
  let bottom = y + size;

  for (let i = 0; i < strips; i += 1) {
    const light = i % 2 === 0 ? focus : bg;
    const dark = i % 2 === 0 ? bg : focus;

    g += rect(left, top, right - left, w, light);
    top += w;
    g += rect(right - w, top, w, bottom - top, light);
    right -= w;
    g += rect(left, bottom - w, right - left, w, dark);
    bottom -= w;
    g += rect(left, top, w, bottom - top, dark);
    left += w;
  }

  g += rect(left, top, right - left, bottom - top, focus);
  return g;
}

// --- Drunkard's Path: quarter circles, the one curved block in the set ---
function drunkardsPathBlock(x, y, size, focus, bg) {
  const c = size / 2;
  let g = rect(x, y, size, size, bg);
  g += `<path d="M ${x} ${y + c} A ${c} ${c} 0 0 1 ${x + c} ${y} L ${x} ${y} Z" fill="${focus}" />`;
  g += `<path d="M ${x + c} ${y} A ${c} ${c} 0 0 1 ${x + size} ${y + c} L ${x + size} ${y} Z" fill="${focus}" />`;
  g += `<path d="M ${x} ${y + c} A ${c} ${c} 0 0 0 ${x + c} ${y + size} L ${x} ${y + size} Z" fill="${focus}" />`;
  g += `<path d="M ${x + size} ${y + c} A ${c} ${c} 0 0 0 ${x + c} ${y + size} L ${x + size} ${y + size} Z" fill="${focus}" />`;
  return g;
}

const BLOCK_BUILDERS = {
  pinwheel: { fn: pinwheelBlock, size: 150 },
  ninePatch: { fn: ninePatchBlock, size: 150 },
  ohioStar: { fn: ohioStarBlock, size: 180 },
  flyingGeese: { fn: flyingGeeseBlock, size: 160 },
  churnDash: { fn: churnDashBlock, size: 180 },
  bearPaw: { fn: bearPawBlock, size: 210 },
  shooFly: { fn: shooFlyBlock, size: 165 },
  spool: { fn: spoolBlock, size: 155 },
  logCabin: { fn: logCabinBlock, size: 190 },
  drunkardsPath: { fn: drunkardsPathBlock, size: 145 }
};

function buildBlockImage(label, hero, blockKey) {
  const { fn, size: blockSize } = BLOCK_BUILDERS[blockKey];
  const cols = Math.ceil(W / blockSize) + 1;
  const rows = Math.ceil(H / blockSize) + 1;
  const palettes = tonalPalette(hero);
  let blocks = '';
  let i = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const [focus, bg] = palettes[i % palettes.length];
      blocks += `<g>${fn(col * blockSize, row * blockSize, blockSize, focus, bg)}</g>`;
      i += 1;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${TAN}" />
    ${blocks}
    ${labelOverlay(label)}
  </svg>`;
}

for (const { key, label, hero, block } of TYPES) {
  const output = path.join(OUT_DIR, `${key}.svg`);
  writeFileSync(output, buildBlockImage(label, hero, block));
  console.log(output);
}
