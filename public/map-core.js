// Map builder core, shared by the browser editor and the server (SVG export): map document model, floor textures,
// path and text styles, and rendering of objects to SVG markup. Units are map pixels; a grid square is CELL px.

export const CELL = 64;
export const MAP_VERSION = 1;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n1 = (v) => Math.round(v * 10) / 10;

// ------------------------------------------------------------------ floor textures (square grid floors, backgrounds, area fills)
// A texture is a plain base (colour + clean structure: planks, cobbles, tiles…) plus generated detail (grass blades, stains,
// cracks, moss…). Each texture has VARIANTS versions of one square, made from seeded noise; painted squares show the base
// with one variant, picked per square, so large areas don't repeat. Derived textures ("Aged planks") change a texture's
// age, colour variation, tint and detail.

export const VARIANTS = 24;
const TILE = 12; // squares per side of the repeating tile that scatters the variants

// deterministic pseudo-random numbers, so textures are the same everywhere
function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const hashStr = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// colours
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgbHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
function toHsl([r, g, b]) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
}
function fromHsl([h, s, l]) {
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m];
}
const mix = (a, b, t) => rgbHex(hexRgb(a).map((v, i) => v + (hexRgb(b)[i] - v) * t));
/** Colour as this texture variant shows it: tint, age (greyer, darker), texture-wide hue/lightness shift, then per-variant jitter */
function paint(hex, def, j) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    let c = def.tint && def.tintAmount ? mix(hex, def.tint, def.tintAmount) : hex;
    let [h, sat, l] = toHsl(hexRgb(c));
    const age = def.age ?? 0;
    sat *= 1 - age * 0.45; l *= 1 - age * 0.12;
    h += (def.hue ?? 0) + j.h; l += (def.light ?? 0) + j.l; sat *= 1 + j.s;
    return rgbHex(fromHsl([h, sat, l]));
}

// clean structures: drawn once per variant (small seeded differences, e.g. where plank joints fall)
const STRUCTURES = {
    none: () => "",
    planks: (r, c) => {
        let s = "";
        for (let y = 0; y < 4; y++) {
            const j = 8 + r() * 44, j2 = r() < 0.4 ? Math.min(62, j + 18 + r() * 20) : null;
            const segs = [0, j, ...(j2 ? [j2] : []), 64];
            for (let i = 0; i < segs.length - 1; i++) s += `<rect x="${n1(segs[i])}" y="${y * 16}" width="${n1(segs[i + 1] - segs[i])}" height="16" fill="${c(c.base, r() * 0.06 - 0.03)}"/>`
                + `<path d="M${n1(segs[i] + 2)} ${y * 16 + 5 + r() * 6}h${n1(segs[i + 1] - segs[i] - 4)}" stroke="${c(c.line, 0.08)}" stroke-width=".6" opacity=".6"/>`;
            s += `<path d="M0 ${y * 16 + 16}H64${segs.slice(1, -1).map((x) => `M${n1(x)} ${y * 16}v16`).join("")}" stroke="${c(c.line)}" stroke-width="1.4"/>`;
        }
        return s;
    },
    parquet: (r, c) => { let s = ""; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { s += `<rect x="${i * 16}" y="${j * 16}" width="16" height="16" fill="${c(c.base, r() * 0.06 - 0.03)}"/>`; s += (i + j) % 2 ? `<path d="M${i * 16} ${j * 16}h16M${i * 16} ${j * 16 + 5.3}h16M${i * 16} ${j * 16 + 10.6}h16" stroke="${c(c.line)}" stroke-width="1"/>` : `<path d="M${i * 16} ${j * 16}v16M${i * 16 + 5.3} ${j * 16}v16M${i * 16 + 10.6} ${j * 16}v16" stroke="${c(c.line)}" stroke-width="1"/>`; } return s; },
    cobble: (r, c) => { let s = ""; for (let y = 0; y < 4; y++) for (let x = -1; x < 4; x++) s += `<rect x="${n1(x * 16 + (y % 2) * 8 + 1 + r() * 1.5)}" y="${n1(y * 16 + 1 + r() * 1.5)}" width="${n1(12.5 + r() * 1.5)}" height="${n1(12 + r() * 1.5)}" rx="${n1(4 + r() * 2)}" fill="${c(c.stone, r() * 0.12 - 0.06)}" stroke="${c(c.line)}" stroke-width=".8"/>`; return s; },
    flagstone: (r, c) => {
        const layouts = ["M0 22H30V0M30 22H64M22 22V44H0M22 44H64M44 44V64M44 22V44M12 44V64", "M0 30H40V0M40 30V64M0 30V64M40 18H64M18 30V64M18 50H40", "M0 20H64M24 0V20M44 20V44M0 44H64M14 44V64M38 44V64"];
        const L = layouts[Math.floor(r() * layouts.length)];
        return `<rect width="64" height="64" fill="${c(c.base, r() * 0.06 - 0.03)}"/><path d="${L}" stroke="${c(c.line)}" stroke-width="1.6" fill="none"/>`;
    },
    bricks: (r, c) => { let s = ""; for (let y = 0; y < 4; y++) for (let x = -1; x < 3; x++) s += `<rect x="${x * 32 + (y % 2) * 16 + 0.7}" y="${y * 16 + 0.7}" width="30.6" height="14.6" fill="${c(c.base, r() * 0.1 - 0.05)}" stroke="${c(c.line)}" stroke-width="1.4"/>`; return s; },
    tiles: (r, c) => [0, 32].flatMap((x) => [0, 32].map((y) => `<rect x="${x + 0.8}" y="${y + 0.8}" width="30.4" height="30.4" fill="${c(c.base, r() * 0.06 - 0.03)}"/>`)).join("") + `<path d="M0 32H64M32 0V64M0 0H64V64" stroke="${c(c.line)}" stroke-width="1.6" fill="none"/>`,
    joints: (r, c) => `<path d="M0 0H64V64" stroke="${c(c.line)}" stroke-width="1.4" fill="none"/>`,
    marble: (r, c) => `<rect width="32" height="32" fill="${c(c.dark)}"/><rect x="32" y="32" width="32" height="32" fill="${c(c.dark)}"/><path d="M${n1(r() * 30)} ${n1(r() * 30)}q${n1(r() * 20)} ${n1(r() * 20)} ${n1(10 + r() * 20)} ${n1(r() * 10)}M${n1(34 + r() * 28)} ${n1(r() * 30)}l${n1(r() * 10 - 5)} ${n1(10 + r() * 14)}" stroke="${c(c.line)}" stroke-width=".8" fill="none" opacity=".7"/>`,
    carpet: (r, c) => `<path d="M32 8L56 32L32 56L8 32Z" fill="none" stroke="${c(c.line)}" stroke-width="2"/><circle cx="32" cy="32" r="4" fill="${c(c.accent)}"/>`,
    plate: (r, c) => { let s = ""; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) s += `<path d="M${x * 16 + 4 + (y % 2) * 8} ${y * 16 + 10}l6 -6" stroke="${c(c.line, 0.12)}" stroke-width="2.4" stroke-linecap="round"/>`; return s + `<path d="M0 0H64V64" stroke="${c(c.line, -0.12)}" stroke-width="1.5" fill="none"/>`; },
    grating: (r, c) => `<path d="M0 8H64M0 24H64M0 40H64M0 56H64M8 0V64M24 0V64M40 0V64M56 0V64" stroke="${c(c.line)}" stroke-width="3"/>`,
    furrows: (r, c) => `<path d="M0 6H64M0 18H64M0 30H64M0 42H64M0 54H64" stroke="${c(c.line)}" stroke-width="3"/>`,
};

// generated detail: draw(rng, count, colour fn, colour, S = size, V = colour variation; 1 = normal) -> markup in one 64×64 square
const P = (r) => [n1(r() * 64), n1(r() * 64)];
const J = (r, amp, V) => (r() - 0.5) * 2 * amp * V; // colour jitter
export const DETAILS = {
    speckle: { name: "Speckle", max: 80, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<circle cx="${x}" cy="${y}" r="${n1((0.6 + r() * 1.6) * S)}" fill="${c(col, J(r, 0.08, V))}"/>`; }).join("") },
    blades: { name: "Grass blades", max: 40, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r), a = (r() - 0.5) * 0.9, l = (3 + r() * 5) * S; return `<path d="M${x} ${y}q${n1(Math.sin(a) * l * 0.4)} ${n1(-l * 0.6)} ${n1(Math.sin(a) * l)} ${n1(-l)}" stroke="${c(col, J(r, 0.07, V))}" stroke-width="${n1((0.8 + r() * 0.6) * Math.sqrt(S))}" stroke-linecap="round" fill="none"/>`; }).join("") },
    tufts: { name: "Tufts", max: 20, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<path d="M${x} ${y}l${n1(-2 * S)} ${n1(-5 * S)}M${x} ${y}l0 ${n1(-6 * S)}M${x} ${y}l${n1(2 * S)} ${n1(-5 * S)}" stroke="${c(col, J(r, 0.05, V))}" stroke-width="1.1" stroke-linecap="round" fill="none"/>`; }).join("") },
    flowers: { name: "Flowers", max: 10, fixedColour: true, draw: (r, n, c, col, S) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<circle cx="${x}" cy="${y}" r="${n1((1.2 + r() * 1) * S)}" fill="${["#e7d36a", "#e8e3f0", "#d8402e", "#b58fd6"][Math.floor(r() * 4)]}"/>`; }).join("") },
    stains: { name: "Stains", max: 6, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<ellipse cx="${x}" cy="${y}" rx="${n1((4 + r() * 10) * S)}" ry="${n1((3 + r() * 7) * S)}" transform="rotate(${Math.round(r() * 180)} ${x} ${y})" fill="${c(col, J(r, 0.05, V))}" opacity="${n1(0.12 + r() * 0.18)}"/>`; }).join("") },
    cracks: { name: "Cracks", max: 4, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { let [x, y] = P(r); let d = `M${x} ${y}`; const a0 = r() * Math.PI * 2; for (let i = 0; i < 4 + r() * 4; i++) { const a = a0 + (r() - 0.5) * 1.6; x = n1(x + Math.cos(a) * (3 + r() * 5) * S); y = n1(y + Math.sin(a) * (3 + r() * 5) * S); d += `L${x} ${y}`; } return `<path d="${d}" stroke="${c(col, J(r, 0.05, V))}" stroke-width="${n1(0.7 + r() * 0.6)}" fill="none" stroke-linejoin="round" opacity=".75"/>`; }).join("") },
    pebbles: { name: "Pebbles", max: 60, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); const f = c(col, J(r, 0.1, V)); return `<ellipse cx="${x}" cy="${y}" rx="${n1((1 + r() * 2.2) * S)}" ry="${n1((0.8 + r() * 1.8) * S)}" fill="${f}" stroke="${c(col, -0.2)}" stroke-width=".5"/>`; }).join("") },
    leaves: { name: "Leaves", max: 30, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<ellipse cx="${x}" cy="${y}" rx="${n1(2.8 * S)}" ry="${n1(1.3 * S)}" transform="rotate(${Math.round(r() * 180)} ${x} ${y})" fill="${c(col, J(r, 0.1, V))}"/>`; }).join("") },
    canopy: { name: "Tree shadow", max: 4, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<circle cx="${x}" cy="${y}" r="${n1((8 + r() * 8) * S)}" fill="${c(col, J(r, 0.04, V))}" opacity=".45"/>`; }).join("") },
    moss: { name: "Moss", max: 6, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return Array.from({ length: 5 }, () => `<circle cx="${n1(x + (r() * 8 - 4) * S)}" cy="${n1(y + (r() * 8 - 4) * S)}" r="${n1((1 + r() * 2) * S)}" fill="${c(col, J(r, 0.05, V))}" opacity=".7"/>`).join(""); }).join("") },
    puddles: { name: "Puddles", max: 4, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<ellipse cx="${x}" cy="${y}" rx="${n1((5 + r() * 7) * S)}" ry="${n1((2.5 + r() * 3.5) * S)}" fill="${c(col, J(r, 0.04, V))}" opacity=".55"/>`; }).join("") },
    scratches: { name: "Scratches", max: 10, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r), a = r() * Math.PI, l = (4 + r() * 10) * S; return `<path d="M${x} ${y}l${n1(Math.cos(a) * l)} ${n1(Math.sin(a) * l)}" stroke="${c(col, J(r, 0.05, V))}" stroke-width=".7" opacity=".55"/>`; }).join("") },
    knots: { name: "Wood knots", max: 4, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<ellipse cx="${x}" cy="${y}" rx="${n1(2.6 * S)}" ry="${n1(1.6 * S)}" fill="none" stroke="${c(col, J(r, 0.05, V))}" stroke-width=".9"/>`; }).join("") },
    rust: { name: "Rust", max: 6, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<circle cx="${x}" cy="${y}" r="${n1((2 + r() * 5) * S)}" fill="${c(col, J(r, 0.05, V))}" opacity="${n1(0.25 + r() * 0.3)}"/>`; }).join("") },
    soot: { name: "Soot", max: 6, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<ellipse cx="${x}" cy="${y}" rx="${n1((6 + r() * 10) * S)}" ry="${n1((4 + r() * 7) * S)}" fill="${c(col, J(r, 0.04, V))}" opacity="${n1(0.12 + r() * 0.15)}"/>`; }).join("") },
    ripples: { name: "Ripples", max: 10, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r), w = (6 + r() * 6) * S; return `<path d="M${x} ${y}q${n1(w / 2)} ${n1(-4 * S)} ${n1(w)} 0t${n1(w)} 0" stroke="${c(col, J(r, 0.05, V))}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`; }).join("") },
    sparkle: { name: "Sparkle", max: 20, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<circle cx="${x}" cy="${y}" r="${n1((0.6 + r() * 1) * S)}" fill="${c(col, J(r, 0.03, V))}"/>`; }).join("") },
    glow: { name: "Glowing cracks", max: 6, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { let [x, y] = P(r); let d = `M${x} ${y}`; for (let i = 0; i < 5; i++) { x = n1(x + (r() * 12 - 6) * S); y = n1(y + (r() * 12 - 6) * S); d += `L${x} ${y}`; } return `<path d="${d}" stroke="${c(col, J(r, 0.05, V))}" stroke-width="${n1(1.5 + r() * 1.5)}" fill="none" stroke-linecap="round"/>`; }).join("") },
    "map-trees": { name: "Tiny trees", max: 16, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r); return `<path d="M${x} ${n1(y - 7 * S)}l${n1(5 * S)} ${n1(9 * S)}h${n1(-10 * S)}z" fill="${c(col, J(r, 0.05, V))}" stroke="${c(col, -0.15)}" stroke-width="1"/><path d="M${x} ${n1(y + 2 * S)}v${n1(3 * S)}" stroke="#5e4b33" stroke-width="1.2"/>`; }).join("") },
    "map-hills": { name: "Tiny hills", max: 8, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r), w = (6 + r() * 6) * S; return `<path d="M${x} ${y}q${n1(w)} -${n1(w * 1.4)} ${n1(w * 2)} 0" stroke="${c(col, J(r, 0.05, V))}" stroke-width="1.6" fill="none"/>`; }).join("") },
    "map-peaks": { name: "Tiny peaks", max: 8, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r), w = (6 + r() * 6) * S; return `<path d="M${x} ${y}l${n1(w)} -${n1(w * 1.6)} ${n1(w)} ${n1(w * 1.6)}" stroke="${c(col, J(r, 0.05, V))}" stroke-width="1.6" fill="#ddd2b8"/>`; }).join("") },
};
// detail that grows with age
const WEAR = { stains: 1, cracks: 1, moss: 1, scratches: 1, soot: 1, rust: 1, puddles: 1, speckle: 0.3 };

/** Built-in textures. details: [kind, count per square, colour] (fractions are a chance per square). vary: colour variation 0..1 */
export const TEXTURES = {
    grass: { name: "Grass", group: "Outdoor", color: "#7fa05a", vary: 0.6, details: [["speckle", 18, "#8fb066"], ["blades", 14, "#5f8540"], ["blades", 6, "#9cbf6d"], ["stains", 0.6, "#6b8c48"]] },
    meadow: { name: "Meadow", group: "Outdoor", color: "#8fae5f", vary: 0.6, details: [["blades", 16, "#668c45"], ["tufts", 4, "#5f8540"], ["flowers", 2.5]] },
    "forest-floor": { name: "Forest floor", group: "Outdoor", color: "#55703f", vary: 0.5, details: [["speckle", 26, "#4a6236"], ["leaves", 8, "#7a6a3a"], ["canopy", 1.2, "#3f5c2d"], ["scratches", 3, "#6e5a3a"], ["moss", 0.6, "#6f9a4c"]] },
    dirt: { name: "Dirt", group: "Outdoor", color: "#9c7a52", vary: 0.5, details: [["speckle", 24, "#876843"], ["pebbles", 3, "#b8976a"], ["stains", 0.8, "#7d6040"]] },
    mud: { name: "Mud", group: "Outdoor", color: "#6e5a40", vary: 0.4, details: [["speckle", 18, "#5d4b34"], ["puddles", 0.6, "#7d8b8f"], ["stains", 1.2, "#56452f"]] },
    sand: { name: "Sand", group: "Outdoor", color: "#dcc791", vary: 0.4, details: [["speckle", 40, "#c9b27a"], ["ripples", 1, "#cbb57e"], ["pebbles", 0.4, "#bca372"]] },
    gravel: { name: "Gravel", group: "Outdoor", color: "#9d988e", vary: 0.3, details: [["pebbles", 34, "#86817a"], ["pebbles", 12, "#b8b3a8"]] },
    wasteland: { name: "Wasteland", group: "Outdoor", color: "#8f7f62", vary: 0.5, details: [["speckle", 20, "#7c6d52"], ["cracks", 1.4, "#5f533f"], ["pebbles", 3, "#a8977a"], ["tufts", 0.5, "#7d7a4a"]] },
    ash: { name: "Ash & soot", group: "Outdoor", color: "#6a6560", vary: 0.3, details: [["speckle", 36, "#57534f"], ["soot", 1.4, "#2f2c29"], ["speckle", 8, "#8a847d"]] },
    snow: { name: "Snow", group: "Outdoor", color: "#eef1f4", vary: 0.25, details: [["speckle", 12, "#d6dfe8"], ["sparkle", 6, "#ffffff"], ["stains", 0.4, "#dbe3ea"]] },
    farmland: { name: "Farmland", group: "Outdoor", color: "#8a6a3e", structure: "furrows", line: "#6e5230", vary: 0.4, details: [["tufts", 3, "#6f8f45"], ["speckle", 10, "#7a5c34"]] },
    ice: { name: "Ice", group: "Water", color: "#cfe5ee", vary: 0.2, details: [["cracks", 1.2, "#a9cbd8"], ["sparkle", 4, "#f4fbfd"]] },
    water: { name: "Water", group: "Water", color: "#6fa3b8", vary: 0.25, details: [["ripples", 3, "#9cc6d6"]] },
    "deep-water": { name: "Deep water", group: "Water", color: "#3f6f8a", vary: 0.2, details: [["ripples", 2, "#5c8ba4"]] },
    swamp: { name: "Swamp", group: "Water", color: "#5e6b44", vary: 0.5, details: [["puddles", 1.3, "#4d6a6a"], ["tufts", 8, "#3f5230"], ["speckle", 10, "#55603d"]] },
    lava: { name: "Lava", group: "Water", color: "#b8410f", vary: 0.3, details: [["glow", 2, "#f3a43a"], ["sparkle", 4, "#ffd479"]] },
    cobble: { name: "Cobblestones", group: "Street", color: "#4d4a44", structure: "cobble", stone: "#8d887d", line: "#3f3c37", vary: 0.3, details: [["stains", 0.5, "#3a3732"], ["moss", 0.25, "#5f7d45"], ["cracks", 0.1, "#3a3732"]] },
    flagstone: { name: "Flagstones", group: "Street", color: "#a8a294", structure: "flagstone", line: "#7d776c", vary: 0.3, details: [["speckle", 8, "#b8b2a4"], ["stains", 0.5, "#8d877b"], ["moss", 0.15, "#6f8a52"], ["cracks", 0.15, "#6d675d"]] },
    "brick-paving": { name: "Brick paving", group: "Street", color: "#a0553e", structure: "bricks", line: "#7a3d2b", vary: 0.35, details: [["stains", 0.4, "#7a3d2b"], ["cracks", 0.1, "#5e2e20"]] },
    macadam: { name: "Road (macadam)", group: "Street", color: "#57534d", vary: 0.25, details: [["speckle", 40, "#4b4843"], ["speckle", 14, "#6b675f"], ["cracks", 0.25, "#3a3833"], ["stains", 0.5, "#3d3a35"]] },
    concrete: { name: "Concrete", group: "Street", color: "#a7a39b", structure: "joints", line: "#8f8b83", vary: 0.2, details: [["speckle", 24, "#97938b"], ["cracks", 0.3, "#7f7b73"], ["stains", 0.5, "#8f8b83"]] },
    "rail-bed": { name: "Rail bed", group: "Street", color: "#77716a", vary: 0.3, details: [["pebbles", 40, "#615c56"], ["pebbles", 14, "#8d877f"]] },
    "wood-planks": { name: "Wood planks", group: "Indoor", color: "#b98a55", structure: "planks", line: "#8a6238", vary: 0.35, details: [["knots", 0.6, "#8a6238"], ["scratches", 0.6, "#9a6e40"], ["stains", 0.3, "#8a6238"]] },
    parquet: { name: "Parquet", group: "Indoor", color: "#a8743f", structure: "parquet", line: "#7f5326", vary: 0.3, details: [["scratches", 0.4, "#7f5326"]] },
    "stone-tiles": { name: "Stone tiles", group: "Indoor", color: "#b3ada2", structure: "tiles", line: "#8d877c", vary: 0.25, details: [["speckle", 6, "#c2bcb0"], ["stains", 0.3, "#9a9488"], ["cracks", 0.1, "#7d776c"]] },
    marble: { name: "Marble chequer", group: "Indoor", color: "#e8e4dc", structure: "marble", dark: "#2f2c29", line: "#c9c3b7", vary: 0.1, details: [] },
    carpet: { name: "Carpet (red)", group: "Indoor", color: "#8e2f2f", structure: "carpet", line: "#a84040", accent: "#c9a14a", vary: 0.15, details: [["stains", 0.15, "#6e2424"]] },
    "carpet-green": { name: "Carpet (green)", group: "Indoor", color: "#3f6b4a", structure: "carpet", line: "#4f805b", accent: "#c9a14a", vary: 0.15, details: [["stains", 0.15, "#2f5238"]] },
    "metal-plate": { name: "Metal plate", group: "Indoor", color: "#7c7f86", structure: "plate", line: "#8a8e95", vary: 0.2, details: [["rust", 0.4, "#8a4a26"], ["scratches", 0.6, "#a4a8ae"]] },
    grating: { name: "Iron grating", group: "Indoor", color: "#2f2f33", structure: "grating", line: "#5d5d66", vary: 0.1, details: [["rust", 0.3, "#7a4123"]] },
    cave: { name: "Cave floor", group: "Indoor", color: "#5a544c", vary: 0.4, details: [["speckle", 28, "#4b463f"], ["pebbles", 5, "#6e675d"], ["cracks", 0.3, "#3f3a34"]] },
    void: { name: "Darkness", group: "Indoor", color: "#1d1c1a", vary: 0, details: [] },
    parchment: { name: "Parchment", group: "Map", color: "#efe6cf", vary: 0.15, details: [["stains", 1, "#e2d5b5"], ["speckle", 8, "#e3d6b8"]] },
    sea: { name: "Sea", group: "Map", color: "#b9cfd2", vary: 0.1, details: [["ripples", 1.5, "#9db8bc"]] },
    "map-forest": { name: "Forest (map)", group: "Map", color: "#c9d3a8", vary: 0.15, details: [["map-trees", 6, "#6d8a4c"]] },
    "map-hills": { name: "Hills (map)", group: "Map", color: "#ddd0ad", vary: 0.15, details: [["map-hills", 2.5, "#8a7a5c"]] },
    "map-mountains": { name: "Highlands (map)", group: "Map", color: "#cfc4ac", vary: 0.15, details: [["map-peaks", 2, "#6e604a"]] },
};

/**
 * A texture by id: built-in, or a derived one from `custom` ({id: {name, from, age, vary, tint, tintAmount, hue, light, density, add}}).
 * Derived textures start from their `from` texture and change age, colour and detail.
 */
export function resolveTexture(id, custom = {}, depth = 0) {
    const c = custom?.[id];
    if (!c || depth > 6) return TEXTURES[id] ? { id, ...TEXTURES[id] } : null;
    const base = resolveTexture(c.from, custom, depth + 1) ?? { id: c.from, ...TEXTURES.void };
    const density = c.density ?? 1;
    // `details` (made in the texture editor) lists every detail with its own settings; older textures add to the base's
    const details = (Array.isArray(c.details)
        ? c.details.filter((d) => d && d.on !== false && DETAILS[d.kind]).map((d) => [d.kind, d.n ?? 1, d.color, { size: d.size, vary: d.vary }])
        : [...(base.details ?? []), ...(c.add ?? []).map((k) => [k, k === "speckle" ? 10 : 0.8, DETAIL_COLORS[k] ?? "#4b463f"])])
        .map(([k, n, col, o]) => [k, n * density, col, o]);
    return {
        ...base, id, name: c.name || id, group: "My textures", from: c.from,
        age: Math.min(1, (base.age ?? 0) + (c.age ?? 0)), vary: c.vary ?? base.vary,
        tint: c.tint ?? base.tint, tintAmount: c.tint ? c.tintAmount ?? 0.3 : base.tintAmount,
        hue: (base.hue ?? 0) + (c.hue ?? 0), light: (base.light ?? 0) + (c.light ?? 0), details,
    };
}
export const DETAIL_COLORS = { stains: "#3d3a35", cracks: "#3a3732", moss: "#5f7d45", scratches: "#5d5850", soot: "#2b2926", rust: "#8a4a26", puddles: "#6f8a92", leaves: "#7a6a3a", pebbles: "#7d776c", blades: "#5f8540", tufts: "#5f8540", speckle: "#4b463f", flowers: "#e7d36a", knots: "#6e4826", ripples: "#9cc6d6", sparkle: "#ffffff", canopy: "#3f5c2d" };

/** A texture's details as editable rows (for the texture editor) */
export function detailRows(id, custom = {}) {
    const t = resolveTexture(id, custom);
    return (t?.details ?? []).map(([kind, n, color, o]) => ({ kind, n: Math.round(n * 100) / 100, color: color ?? DETAIL_COLORS[kind] ?? "#4b463f", size: o?.size ?? 1, vary: o?.vary ?? 0.5, on: true }));
}

/** Catalogue for menus: built-ins plus derived textures */
export function textureCatalog(custom = {}) {
    const out = {};
    for (const [k, t] of Object.entries(TEXTURES)) out[k] = { name: t.name, group: t.group, color: t.color };
    for (const k of Object.keys(custom ?? {})) { const t = resolveTexture(k, custom); if (t) out[k] = { name: t.name, group: "My textures", color: t.color, from: t.from }; }
    return out;
}

/** One variant of one square: {base: colour + structure, over: blotches + details (may spill over the edge)} */
function variantParts(t, k) {
    const r = rng(hashStr(`${t.id}:${t.age ?? 0}:${t.tint ?? ""}:${k}`) || 1);
    const v = t.vary ?? 0.3;
    // structured floors (planks, tiles…) shift colour per square; natural ground barely does, its variation comes
    // from soft blotches that spill over square edges, so no patchwork shows
    const natural = (t.structure ?? "none") === "none";
    const k0 = natural ? 0.15 : 0.5;
    const j = { h: (r() - 0.5) * 12 * v * k0, l: (r() - 0.5) * 0.08 * v * k0, s: (r() - 0.5) * 0.3 * v * k0 };
    const col = (hex, dl = 0) => paint(hex, t, { ...j, l: j.l + dl });
    const c = Object.assign((hex, dl) => col(hex, dl), { base: t.color, line: t.line ?? t.color, stone: t.stone ?? t.color, dark: t.dark ?? "#2f2c29", accent: t.accent ?? "#c9a14a" });
    const base = `<rect width="64" height="64" fill="${col(t.color)}"/>` + (STRUCTURES[t.structure ?? "none"] ?? STRUCTURES.none)(r, c);
    let s = "";
    if (natural && v > 0) for (let i = 0, m = Math.round(1 + v * 2); i < m; i++) {
        const [x, y] = P(r);
        s += `<ellipse cx="${x}" cy="${y}" rx="${n1(16 + r() * 22)}" ry="${n1(12 + r() * 16)}" transform="rotate(${Math.round(r() * 180)} ${x} ${y})" fill="${col(t.color, (r() < 0.5 ? -1 : 1) * (0.03 + r() * 0.05) * v)}" opacity=".4"/>`;
    }
    const age = t.age ?? 0;
    const details = [...(t.details ?? [])];
    if (age > 0 && !details.some((d) => d[0] === "cracks") && t.structure !== "none") details.push(["cracks", 0, "#3a3732"]);
    if (age > 0 && !details.some((d) => d[0] === "stains")) details.push(["stains", 0, "#3d3a35"]);
    for (const [kind, n0, color, o] of details) {
        const n = n0 * (1 + (WEAR[kind] ?? 0) * age * 3) + (WEAR[kind] ? age * (kind === "cracks" ? 0.5 : 0.8) : 0);
        const count = Math.floor(n) + (r() < n % 1 ? 1 : 0);
        if (count > 0) s += DETAILS[kind]?.draw(r, count, col, color ?? DETAIL_COLORS[kind] ?? "#4b463f", o?.size ?? 1, (o?.vary ?? 0.5) * 2) ?? "";
    }
    return { base, over: s };
}

/** Defs for a texture: VARIANTS symbols and the repeating tile `f-<id>` that scatters them */
export function texturePattern(id, custom = {}) {
    const t = resolveTexture(id, custom) ?? { id, ...TEXTURES.void };
    const n = (t.vary ?? 0) === 0 && !(t.details ?? []).length && (t.age ?? 0) === 0 ? 1 : VARIANTS;
    let s = "";
    // bases first, then details for every square: details may spill over a square's edge onto its neighbours, hiding the seams
    for (let k = 0; k < n; k++) {
        const v = variantParts(t, k);
        s += `<symbol id="fb-${id}-${k}" viewBox="0 0 64 64">${v.base}</symbol><symbol id="fv-${id}-${k}" viewBox="0 0 64 64" overflow="visible">${v.over}</symbol>`;
    }
    const r = rng(hashStr(`${id}:tile`) || 1);
    const pick = [];
    let bases = "", overs = "";
    const use = (pre, k, x, y) => `<use href="#${pre}-${id}-${k}" xlink:href="#${pre}-${id}-${k}" x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}"/>`;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        let k = Math.floor(r() * n);
        if (n > 2) while (k === pick[(y * TILE) + x - 1] || k === pick[(y - 1) * TILE + x]) k = (k + 1) % n;
        pick[y * TILE + x] = k;
        bases += use("fb", k, x, y);
        overs += use("fv", k, x, y);
    }
    return `${s}<pattern id="f-${id}" width="${TILE * CELL}" height="${TILE * CELL}" patternUnits="userSpaceOnUse">${bases}${overs}</pattern>`;
}
const patternCache = new Map();
/** texturePattern, cached by the texture's definition */
export function texturePatternCached(id, custom = {}) {
    const key = `${id}|${JSON.stringify(custom?.[id] ? [custom[id], custom[custom[id].from]] : null)}`;
    if (!patternCache.has(key)) patternCache.set(key, texturePattern(id, custom));
    return patternCache.get(key);
}
export const texturesDefs = (ids, custom) => [...new Set(ids)].filter(Boolean).map((id) => texturePatternCached(id, custom)).join("");

export const TILE_PX = TILE * CELL;
/** The texture's repeating tile as a stand-alone SVG (TILE_PX square, drawn at `scale`), for turning into one bitmap */
export function textureTileSvg(id, custom = {}, scale = 1) {
    const px = TILE_PX * scale;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${TILE_PX} ${TILE_PX}" width="${px}" height="${px}"><defs>${texturePatternCached(id, custom)}</defs><rect width="${TILE_PX}" height="${TILE_PX}" fill="url(#f-${id})"/></svg>`;
}

/** A small stand-alone SVG of a texture (n × n squares), for previews */
export function texturePreview(id, custom = {}, n = 3) {
    const t = resolveTexture(id, custom) ?? { id, ...TEXTURES.void };
    const parts = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) parts.push([x, y, variantParts(t, (y * n + x * 7) % VARIANTS)]);
    const s = parts.map(([x, y, v]) => `<g transform="translate(${x * 64} ${y * 64})">${v.base}</g>`).join("") + parts.map(([x, y, v]) => `<g transform="translate(${x * 64} ${y * 64})">${v.over}</g>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n * 64} ${n * 64}" width="${n * 64}" height="${n * 64}">${s}</svg>`;
}

// compatibility names used by the editor
export const FLOORS = textureCatalog();
export const floorIds = Object.keys(TEXTURES);

/** Default terrain of a square-grid map: fills every square no layer paints */
export const TERRAINS = {
    urban: { name: "Urban (cobbles)", floor: "cobble" }, industrial: { name: "Industrial (soot)", floor: "ash" }, street: { name: "Paved road", floor: "macadam" },
    grassland: { name: "Grassland", floor: "grass" }, meadow: { name: "Meadow", floor: "meadow" }, forest: { name: "Forest", floor: "forest-floor" },
    farmland: { name: "Farmland", floor: "farmland" }, wasteland: { name: "Wasteland", floor: "wasteland" }, desert: { name: "Desert", floor: "sand" },
    snow: { name: "Snowfield", floor: "snow" }, swamp: { name: "Swamp", floor: "swamp" }, water: { name: "Open water", floor: "water" },
    cave: { name: "Cave", floor: "cave" }, interior: { name: "Interior (darkness)", floor: "void" },
};
/** Freeform map backgrounds */
export const BACKDROPS = { parchment: "Parchment", sea: "Sea", "map-forest": "Forest", grass: "Grass", sand: "Sand", snow: "Snow", void: "Dark" };

// ------------------------------------------------------------------ path styles

// Each style is a stack of strokes drawn bottom to top. `snap` lines snap to grid corners on square-grid maps.
export const PATH_STYLES = {
    road: { name: "Road", modes: "both", smooth: true, layers: [{ c: "#6b5b45", w: 14 }, { c: "#c9b48a", w: 10 }] },
    street: { name: "Paved street", modes: "both", smooth: true, layers: [{ c: "#3b3935", w: 34 }, { c: "#5d5952", w: 30 }, { c: "#e8e2d0", w: 1.5, dash: "14 12" }] },
    trail: { name: "Trail", modes: "both", smooth: true, layers: [{ c: "#8a6a44", w: 3, dash: "9 6" }] },
    route: { name: "Travel route", modes: "both", smooth: true, layers: [{ c: "#b3261e", w: 3, dash: "12 7", cap: "round" }] },
    river: { name: "River", modes: "both", smooth: true, layers: [{ c: "#5b8aa0", w: 14 }, { c: "#8fbdd0", w: 9 }] },
    stream: { name: "Stream", modes: "both", smooth: true, layers: [{ c: "#6f9db2", w: 4 }] },
    canal: { name: "Canal", modes: "both", smooth: false, snap: true, layers: [{ c: "#55524d", w: 30 }, { c: "#6fa3b8", w: 22 }] },
    "border-realm": { name: "Border (realm)", modes: "freeform", smooth: true, layers: [{ c: "#5e2a52", w: 6, dash: "0.1 10", cap: "round" }] },
    "border-nation": { name: "Border (nation)", modes: "freeform", smooth: true, layers: [{ c: "#7a3a6b", w: 3, dash: "12 4 2 4" }] },
    "border-province": { name: "Border (province)", modes: "freeform", smooth: true, layers: [{ c: "#8d6b86", w: 2, dash: "4 4" }] },
    "wall-stone": { name: "Stone wall", modes: "both", smooth: false, snap: true, layers: [{ c: "#2b211a", w: 12, cap: "square" }, { c: "#5d5750", w: 6, cap: "square" }] },
    "wall-brick": { name: "Brick wall", modes: "grid", smooth: false, snap: true, layers: [{ c: "#2b211a", w: 12, cap: "square" }, { c: "#9b4a35", w: 7, cap: "square" }] },
    "wall-wood": { name: "Wooden wall", modes: "grid", smooth: false, snap: true, layers: [{ c: "#4a3522", w: 9, cap: "square" }, { c: "#8a6238", w: 5, cap: "square" }] },
    "wall-iron": { name: "Iron wall", modes: "grid", smooth: false, snap: true, layers: [{ c: "#2b2b30", w: 11, cap: "square" }, { c: "#6f727a", w: 5, cap: "square" }, { c: "#9aa0a8", w: 2, dash: "2 14" }] },
    "city-wall": { name: "City wall", modes: "freeform", smooth: false, layers: [{ c: "#4a3f33", w: 9 }, { c: "#b8ab90", w: 5 }, { c: "#4a3f33", w: 14, dash: "4 26" }] },
    fence: { name: "Fence", modes: "both", smooth: false, snap: true, layers: [{ c: "#6e4826", w: 3 }, { c: "#6e4826", w: 10, dash: "3 13" }] },
    "iron-railing": { name: "Iron railing", modes: "grid", smooth: false, snap: true, layers: [{ c: "#2b2b30", w: 2.5 }, { c: "#2b2b30", w: 8, dash: "2 6", cap: "round" }] },
    hedge: { name: "Hedge", modes: "both", smooth: true, layers: [{ c: "#355a27", w: 16, cap: "round" }, { c: "#4f7a3a", w: 11, dash: "7 3", cap: "round" }] },
    cliff: { name: "Cliff edge", modes: "both", smooth: true, layers: [{ c: "#3b342c", w: 24, dash: "3 4", opacity: 0.55 }, { c: "#8a7f6d", w: 12, cap: "round" }, { c: "#3b342c", w: 4, cap: "round" }] },
    chasm: { name: "Chasm", modes: "both", smooth: true, layers: [{ c: "#4b443b", w: 32, cap: "round" }, { c: "#1d1c1a", w: 22, cap: "round" }] },
    rail: { name: "Railway", modes: "both", smooth: true, layers: [{ c: "#6e4826", w: 26, dash: "5 9" }, { c: "#8f949b", w: 14 }, { c: "#77716a", w: 10 }] },
    pipe: { name: "Steam pipe", modes: "grid", smooth: false, snap: true, layers: [{ c: "#2b211a", w: 13 }, { c: "#b8673a", w: 9 }, { c: "#d99267", w: 2 }] },
    cable: { name: "Cable", modes: "both", smooth: true, layers: [{ c: "#2b211a", w: 2 }] },
    coast: { name: "Coastline", modes: "freeform", smooth: true, layers: [{ c: "#9dbcc2", w: 14, opacity: 0.6 }, { c: "#5e4b33", w: 3 }] },
};
export const pathStyleIds = Object.keys(PATH_STYLES);

// ------------------------------------------------------------------ text styles

export const TEXT_STYLES = {
    label: { name: "Label", font: "Newsreader, Georgia, serif", italic: true, size: 22, color: "#3b2a1a" },
    region: { name: "Region name", font: "Newsreader, Georgia, serif", caps: true, spacing: 0.35, size: 36, color: "#5e4b33", weight: 600 },
    title: { name: "Title", font: "Newsreader, Georgia, serif", size: 48, color: "#2b211a", weight: 600 },
    note: { name: "Note (boxed)", font: "system-ui, sans-serif", size: 16, color: "#23211d", box: "#fffaf0", border: "#5e4b33" },
    sign: { name: "Sign (dark box)", font: "system-ui, sans-serif", size: 16, color: "#f5ecd8", box: "#2b211a", border: "#c9a14a" },
    gm: { name: "GM note (not exported)", font: "system-ui, sans-serif", size: 15, color: "#3d3200", box: "#fff3a8", border: "#c9a400", hidden: true },
};

// ------------------------------------------------------------------ documents

export function newMap(kind = "freeform", opts = {}) {
    const grid = kind === "grid";
    return {
        v: MAP_VERSION, kind,
        width: grid ? CELL * (opts.cols ?? 30) : opts.width ?? 2400,
        height: grid ? CELL * (opts.rows ?? 20) : opts.height ?? 1600,
        terrain: grid ? opts.terrain ?? "urban" : undefined,
        backdrop: grid ? undefined : opts.backdrop ?? "parchment",
        units: grid ? { amount: 5, unit: "ft", per: CELL } : { amount: 10, unit: "km", per: 100 },
        showGrid: grid, snap: grid,
        layers: [{ id: "l1", name: grid ? "Ground" : "Land", objects: [], floor: {} }],
        active: "l1", view: "faded",
    };
}

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Layers drawn in the current view: everything below the active layer (faded or solid) plus the active one; layers above are hidden */
export function viewLayers(doc, { exportAll = false } = {}) {
    const i = Math.max(0, doc.layers.findIndex((l) => l.id === doc.active));
    return doc.layers.map((l, j) => ({
        layer: l,
        shown: !l.hidden && (exportAll || (j === i || (j < i && doc.view !== "current"))),
        faded: !exportAll && j < i && doc.view === "faded",
        active: j === i,
    }));
}

// ------------------------------------------------------------------ geometry

/** Smooth (Catmull-Rom) or straight path through points */
export function pathD(pts, smooth = false, closed = false) {
    if (!pts?.length) return "";
    if (pts.length < 3 || !smooth) return `M${pts.map((p) => `${n1(p[0])} ${n1(p[1])}`).join("L")}${closed ? "Z" : ""}`;
    const P = closed ? [pts.at(-1), ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts.at(-1)];
    let d = `M${n1(P[1][0])} ${n1(P[1][1])}`;
    for (let i = 1; i < P.length - 2; i++) {
        const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
        d += `C${n1(p1[0] + (p2[0] - p0[0]) / 6)} ${n1(p1[1] + (p2[1] - p0[1]) / 6)} ${n1(p2[0] - (p3[0] - p1[0]) / 6)} ${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${n1(p2[0])} ${n1(p2[1])}`;
    }
    return d + (closed ? "Z" : "");
}

// ------------------------------------------------------------------ curves and ribbons (curved strips with their own grid)

/** Dense points along a path (same curve pathD draws), each with the index of the control-point span it lies on */
export function sampleCurve(pts, smooth = true, closed = false, step = 4) {
    if (!pts?.length) return [];
    if (pts.length < 2) return [{ p: pts[0], span: 0 }];
    const out = [];
    const spans = closed ? pts.length : pts.length - 1;
    const P = closed ? [pts.at(-1), ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts.at(-1)];
    for (let i = 0; i < spans; i++) {
        const [p0, p1, p2, p3] = [P[i], P[i + 1], P[i + 2], P[i + 3]];
        const b1 = smooth && pts.length > 2 ? [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6] : p1;
        const b2 = smooth && pts.length > 2 ? [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6] : p2;
        const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
        for (let k = i ? 1 : 0; k <= n; k++) {
            const t = k / n, u = 1 - t;
            out.push({ p: [u * u * u * p1[0] + 3 * u * u * t * b1[0] + 3 * u * t * t * b2[0] + t * t * t * p2[0], u * u * u * p1[1] + 3 * u * u * t * b1[1] + 3 * u * t * t * b2[1] + t * t * t * p2[1]], span: i });
        }
    }
    return out;
}

/** Arc-length geometry of a curve: at(s) -> {p, n (left normal), a (degrees)}, offset(d) -> path data */
export function curveGeom(pts, smooth = true) {
    const sm = sampleCurve(pts, smooth, false, 3);
    const s = [0];
    for (let i = 1; i < sm.length; i++) s.push(s[i - 1] + Math.hypot(sm[i].p[0] - sm[i - 1].p[0], sm[i].p[1] - sm[i - 1].p[1]));
    const L = s.at(-1) ?? 0;
    const tan = sm.map((_, i) => {
        const a = sm[Math.max(0, i - 1)].p, b = sm[Math.min(sm.length - 1, i + 1)].p;
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    });
    const at = (x) => {
        x = Math.max(0, Math.min(L, x));
        let lo = 0, hi = s.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= x) lo = m; else hi = m; }
        const f = s[hi] > s[lo] ? (x - s[lo]) / (s[hi] - s[lo]) : 0;
        const p = [sm[lo].p[0] + (sm[hi].p[0] - sm[lo].p[0]) * f, sm[lo].p[1] + (sm[hi].p[1] - sm[lo].p[1]) * f];
        const t = [tan[lo][0] + (tan[hi][0] - tan[lo][0]) * f, tan[lo][1] + (tan[hi][1] - tan[lo][1]) * f];
        const l = Math.hypot(t[0], t[1]) || 1;
        return { p, n: [-t[1] / l, t[0] / l], a: (Math.atan2(t[1], t[0]) * 180) / Math.PI };
    };
    const off = (i, d) => [sm[i].p[0] - tan[i][1] * d, sm[i].p[1] + tan[i][0] * d];
    /** points of the offset curve between arc lengths a and b */
    const offsetPts = (d, a = 0, b = L) => {
        const out = [];
        const A = at(a); out.push([A.p[0] + A.n[0] * d, A.p[1] + A.n[1] * d]);
        for (let i = 0; i < sm.length; i++) if (s[i] > a && s[i] < b) out.push(off(i, d));
        const B = at(b); out.push([B.p[0] + B.n[0] * d, B.p[1] + B.n[1] * d]);
        return out;
    };
    const line = (P) => `M${P.map((q) => `${n1(q[0])} ${n1(q[1])}`).join("L")}`;
    return { L, at, offsetPts, offset: (d, a, b) => line(offsetPts(d, a, b)), line };
}

/** What a ribbon is made of: a base floor texture and parts drawn along it. Parts take the ribbon width W and box size B. */
export const RIBBON_PARTS = {
    sleepers: { name: "Sleepers", draw: (g, W, B) => { let d = ""; for (let x = B / 4; x < g.L; x += B / 2) { const q = g.at(x); d += `M${n1(q.p[0] - q.n[0] * W * 0.42)} ${n1(q.p[1] - q.n[1] * W * 0.42)}L${n1(q.p[0] + q.n[0] * W * 0.42)} ${n1(q.p[1] + q.n[1] * W * 0.42)}`; } return `<path d="${d}" stroke="#3e2a17" stroke-width="${n1(B * 0.2)}"/><path d="${d}" stroke="#7a5532" stroke-width="${n1(B * 0.15)}"/>`; } },
    rails: { name: "Rails", draw: (g, W, B) => [-1, 1].map((k) => `<path d="${g.offset(k * W * 0.24)}" fill="none" stroke="#2f2f35" stroke-width="${n1(B * 0.1 + 2)}"/><path d="${g.offset(k * W * 0.24)}" fill="none" stroke="#b3b9c1" stroke-width="${n1(B * 0.06)}"/>`).join("") },
    "rails-flush": { name: "Rails set in the street", draw: (g, W) => [-1, 1].map((k) => `<path d="${g.offset(k * W * 0.24)}" fill="none" stroke="#2b2b30" stroke-width="5"/><path d="${g.offset(k * W * 0.24)}" fill="none" stroke="#9aa0a8" stroke-width="2"/>`).join("") },
    shadow: { name: "Shadow", draw: (g, W) => `<path d="${g.offset(0)}" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="${n1(W * 0.5)}" stroke-linecap="round" transform="translate(8 10)"/>` },
    pylons: { name: "Pylons", draw: (g, W, B) => { let s = ""; for (let x = B * 1.5; x < g.L; x += B * 3) { const q = g.at(x); s += `<rect x="${n1(q.p[0] - W * 0.17)}" y="${n1(q.p[1] - W * 0.17)}" width="${n1(W * 0.34)}" height="${n1(W * 0.34)}" rx="3" fill="#7d776c" stroke="#3b342c" stroke-width="2" transform="rotate(${n1(q.a)} ${n1(q.p[0])} ${n1(q.p[1])})"/>`; } return s; } },
    beam: { name: "Monorail beam", draw: (g, W) => `<path d="${g.offset(0)}" fill="none" stroke="#5f5a52" stroke-width="${n1(W * 0.46)}"/><path d="${g.offset(0)}" fill="none" stroke="#b9b4aa" stroke-width="${n1(W * 0.36)}"/><path d="${g.offset(0)}" fill="none" stroke="#8a857b" stroke-width="2" stroke-dasharray="10 6"/>` },
    curbs: { name: "Curbs", draw: (g, W) => [-1, 1].map((k) => `<path d="${g.offset(k * (W / 2 - 4))}" fill="none" stroke="#4b4740" stroke-width="9"/><path d="${g.offset(k * (W / 2 - 4))}" fill="none" stroke="#b7b1a5" stroke-width="6"/>`).join("") },
    "centre-dash": { name: "Centre line", draw: (g, W, B) => `<path d="${g.offset(0)}" fill="none" stroke="#e8e2d0" stroke-width="3" stroke-dasharray="${n1(B * 0.5)} ${n1(B * 0.4)}"/>` },
    ruts: { name: "Wheel ruts", draw: (g, W) => [-1, 1].map((k) => `<path d="${g.offset(k * W * 0.22)}" fill="none" stroke="#5a4328" stroke-opacity=".65" stroke-width="${n1(Math.max(3, W * 0.07))}" stroke-linecap="round"/>`).join("") },
    "edges-soft": { name: "Soft edges", draw: (g, W) => [-1, 1].map((k) => `<path d="${g.offset(k * W / 2)}" fill="none" stroke="#6e6656" stroke-width="2" stroke-dasharray="3 3"/>`).join("") },
    banks: { name: "Banks", draw: (g, W) => [-1, 1].map((k) => `<path d="${g.offset(k * W / 2)}" fill="none" stroke="#6e5a40" stroke-width="7"/><path d="${g.offset(k * (W / 2 - 5))}" fill="none" stroke="#a8cbd8" stroke-width="3" stroke-opacity=".8"/>`).join("") },
    railings: { name: "Railings", draw: (g, W, B) => { let s = [-1, 1].map((k) => `<path d="${g.offset(k * (W / 2 - 3))}" fill="none" stroke="#3a2a1e" stroke-width="4"/>`).join(""); for (let x = 0; x <= g.L; x += B / 2) { const q = g.at(x); for (const k of [-1, 1]) s += `<circle cx="${n1(q.p[0] + q.n[0] * k * (W / 2 - 3))}" cy="${n1(q.p[1] + q.n[1] * k * (W / 2 - 3))}" r="3.5" fill="#5a4026" stroke="#2b211a" stroke-width="1"/>`; } return s; } },
    rollers: { name: "Rollers", draw: (g, W, B) => { let d = ""; for (let x = B / 6; x < g.L; x += B / 3) { const q = g.at(x); d += `M${n1(q.p[0] - q.n[0] * W * 0.44)} ${n1(q.p[1] - q.n[1] * W * 0.44)}L${n1(q.p[0] + q.n[0] * W * 0.44)} ${n1(q.p[1] + q.n[1] * W * 0.44)}`; } return `<path d="${d}" stroke="#3a3a40" stroke-width="7"/><path d="${d}" stroke="#c0c4ca" stroke-width="4"/>`; } },
    "edges-iron": { name: "Iron edges", draw: (g, W) => [-1, 1].map((k) => `<path d="${g.offset(k * (W / 2 - 3))}" fill="none" stroke="#2b2b30" stroke-width="6"/>`).join("") },
    pipes: { name: "Pipes", draw: (g, W, B) => { let s = ""; for (let x = B; x < g.L; x += B * 2) { const q = g.at(x); s += `<path d="M${n1(q.p[0] - q.n[0] * W * 0.42)} ${n1(q.p[1] - q.n[1] * W * 0.42)}L${n1(q.p[0] + q.n[0] * W * 0.42)} ${n1(q.p[1] + q.n[1] * W * 0.42)}" stroke="#3a3a40" stroke-width="6"/>`; } return s + [-1, 1].map((k) => `<path d="${g.offset(k * W * 0.2)}" fill="none" stroke="#2b211a" stroke-width="${n1(W * 0.3)}"/><path d="${g.offset(k * W * 0.2)}" fill="none" stroke="#b8673a" stroke-width="${n1(W * 0.23)}"/><path d="${g.offset(k * W * 0.2 - W * 0.05)}" fill="none" stroke="#d99267" stroke-width="${n1(W * 0.05)}"/>`).join(""); } },
    wire: { name: "Wire", draw: (g) => `<path d="${g.offset(0)}" fill="none" stroke="#2b211a" stroke-width="1.5"/>` },
    poles: { name: "Poles", draw: (g, W, B) => { let s = ""; for (let x = B; x < g.L; x += B * 3) { const q = g.at(x); s += `<path d="M${n1(q.p[0] - q.n[0] * W * 0.3)} ${n1(q.p[1] - q.n[1] * W * 0.3)}L${n1(q.p[0] + q.n[0] * W * 0.3)} ${n1(q.p[1] + q.n[1] * W * 0.3)}" stroke="#4a3522" stroke-width="4"/><circle cx="${n1(q.p[0])}" cy="${n1(q.p[1])}" r="6" fill="#7a5532" stroke="#2b211a" stroke-width="1.5"/>`; } return s; } },
};
/** Ribbon presets; `floor` is the base texture (null: none), `parts` drawn in order */
export const RIBBONS = {
    railway: { name: "Railway", floor: "rail-bed", parts: ["sleepers", "rails"], cols: 2 },
    tramway: { name: "Tram rails in cobbles", floor: "cobble", parts: ["rails-flush"], cols: 2 },
    monorail: { name: "Monorail", floor: null, parts: ["shadow", "pylons", "beam"], cols: 1 },
    road: { name: "Road", floor: "macadam", parts: ["curbs", "centre-dash"], cols: 3 },
    street: { name: "Cobbled street", floor: "cobble", parts: ["curbs"], cols: 3 },
    "dirt-track": { name: "Dirt track", floor: "dirt", parts: ["ruts"], cols: 2 },
    footpath: { name: "Footpath", floor: "gravel", parts: ["edges-soft"], cols: 1 },
    river: { name: "River or canal", floor: "water", parts: ["banks"], cols: 3 },
    "bridge-deck": { name: "Bridge deck", floor: "wood-planks", parts: ["railings"], cols: 2 },
    conveyor: { name: "Conveyor belt", floor: "metal-plate", parts: ["rollers", "edges-iron"], cols: 1 },
    pipeline: { name: "Pipeline", floor: null, parts: ["pipes"], cols: 1 },
    "telegraph-line": { name: "Telegraph line", floor: null, parts: ["wire", "poles"], cols: 1 },
    strip: { name: "Plain strip (floor only)", floor: "flagstone", parts: [], cols: 2 },
};
const angleBucket = (a) => ((Math.round(a / 5) * 5) % 360 + 360) % 360;

/** A ribbon: its floor texture in slices that turn with the curve, its own curved grid, then its parts */
export function ribbonSvg(o, ctx) {
    const preset = RIBBONS[o.style] ?? RIBBONS.strip;
    const B = o.box ?? CELL, W = (o.cols ?? preset.cols ?? 2) * B;
    if (!o.pts || o.pts.length < 2) return "";
    const g = curveGeom(o.pts, o.smooth ?? true);
    if (g.L < 1) return "";
    const hit = ctx.edit ? `<path d="${g.line([...g.offsetPts(-W / 2), ...g.offsetPts(W / 2).reverse()])}Z" fill="transparent" stroke="none" pointer-events="all"/>` : "";
    // the editor draws finished ribbons from bitmaps of their pieces
    const img = ctx.ribbonImage?.(o);
    if (img) return `<g data-id="${esc(o.id)}">${img}${hit}</g>`;
    return `<g${ctx.edit ? ` data-id="${esc(o.id)}"` : ""}>${ribbonBody(o, g)}${hit}</g>`;
}

/** A ribbon's markup along geometry g (the whole ribbon, or one piece of it) */
function ribbonBody(o, g) {
    const preset = RIBBONS[o.style] ?? RIBBONS.strip;
    const B = o.box ?? CELL, W = (o.cols ?? preset.cols ?? 2) * B;
    const floor = o.floor === undefined ? preset.floor : o.floor;
    let defs = "", body = "";
    if (floor) {
        const used = new Set();
        const k = B / CELL, ks = k === 1 ? "" : `-s${Math.round(k * 1000)}`;
        for (let x = 0; x < g.L; x += B) {
            const b = Math.min(g.L, x + B + 0.8);
            const bucket = angleBucket(g.at((x + b) / 2).a);
            used.add(bucket);
            const P = [...g.offsetPts(-W / 2, x, b), ...g.offsetPts(W / 2, x, b).reverse()];
            body += `<path d="${g.line(P)}Z" fill="url(#rp-${floor}-${bucket}${ks})"/>`;
        }
        defs = [...used].map((b) => scaledPattern(`rp-${floor}-${b}${ks}`, floor, `rotate(${b})${k === 1 ? "" : ` scale(${n1r(k)})`}`)).join("");
    }
    if (o.grid ?? true) {
        const cols = Math.round(W / B);
        let d = "";
        for (let j = 0; j <= cols; j++) d += g.offset(-W / 2 + j * B);
        for (let x = 0; x <= g.L + 0.5; x += B) { const q = g.at(x); d += `M${n1(q.p[0] - q.n[0] * W / 2)} ${n1(q.p[1] - q.n[1] * W / 2)}L${n1(q.p[0] + q.n[0] * W / 2)} ${n1(q.p[1] + q.n[1] * W / 2)}`; }
        body += `<path d="${d}" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1"/>`;
    }
    const off = new Set(o.off ?? []);
    for (const part of preset.parts) if (!off.has(part)) body += RIBBON_PARTS[part]?.draw(g, W, B) ?? "";
    for (const part of o.extra ?? []) if (!preset.parts.includes(part)) body += RIBBON_PARTS[part]?.draw(g, W, B) ?? "";
    return `${defs ? `<defs>${defs}</defs>` : ""}${body}`;
}

/**
 * A ribbon cut into pieces of 6 boxes along its length, each a stand-alone SVG over its own small box, so the editor
 * can turn every piece into a bitmap. Returns [{x, y, w, h, svg}] or [] for a ribbon too short to draw.
 */
export function ribbonPieces(o, custom = {}, scale = 2) {
    const preset = RIBBONS[o.style] ?? RIBBONS.strip;
    const B = o.box ?? CELL, W = (o.cols ?? preset.cols ?? 2) * B;
    if (!o.pts || o.pts.length < 2) return [];
    const g = curveGeom(o.pts, o.smooth ?? true);
    if (g.L < 1) return [];
    const floor = o.floor === undefined ? preset.floor : o.floor;
    const defs = floor ? texturesDefs([floor], custom) : "";
    const len = B * 6, pad = 18;
    const out = [];
    for (let s0 = 0; s0 < g.L; s0 += len) {
        const s1 = Math.min(g.L, s0 + len);
        // geometry of just this stretch, measured from its start (s0 is a whole number of boxes, so parts keep their rhythm)
        const sub = { L: s1 - s0, at: (x) => g.at(s0 + x), offsetPts: (d, a = 0, b = s1 - s0) => g.offsetPts(d, s0 + a, s0 + Math.min(b, s1 - s0)), offset: (d, a = 0, b = s1 - s0) => g.offset(d, s0 + a, s0 + Math.min(b, s1 - s0)), line: g.line };
        const edge = [...g.offsetPts(-W / 2 - pad, s0, s1), ...g.offsetPts(W / 2 + pad, s0, s1)];
        const xs = edge.map((p) => p[0]), ys = edge.map((p) => p[1]);
        const x = Math.floor(Math.min(...xs) - pad), y = Math.floor(Math.min(...ys) - pad);
        const w = Math.ceil(Math.max(...xs) + pad - x), h = Math.ceil(Math.max(...ys) + pad - y);
        out.push({ x, y, w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${x} ${y} ${w} ${h}" width="${Math.ceil(w * scale)}" height="${Math.ceil(h * scale)}"><defs>${defs}</defs>${ribbonBody(o, sub)}</svg>` });
    }
    return out;
}

export function textLines(o) { return String(o.text ?? "").split("\n"); }
export function textBox(o) {
    const st = TEXT_STYLES[o.style] ?? TEXT_STYLES.label;
    const size = o.size ?? st.size;
    const lines = textLines(o);
    const chars = Math.max(1, ...lines.map((l) => l.length));
    const w = chars * size * (st.caps ? 0.62 + (st.spacing ?? 0) : 0.52) + (st.box ? 20 : 0);
    const h = lines.length * size * 1.25 + (st.box ? 14 : 0);
    return { x: o.x - w / 2, y: o.y - size, w, h };
}

/** Axis-aligned bounds of an object (before rotation) */
export function bounds(o) {
    if (o.type === "room") { const e = roomExtent(o); return { x: o.x + e.x, y: o.y + e.y, w: e.w, h: e.h }; }
    if (o.type === "stamp") return { x: o.x, y: o.y, w: o.w, h: o.h };
    if (o.type === "text") return textBox(o);
    if (o.type === "pin") return { x: o.x - 14, y: o.y - 36, w: 28, h: 36 };
    const xs = o.pts.map((p) => p[0]), ys = o.pts.map((p) => p[1]);
    const pad = o.type === "ribbon" ? ((o.cols ?? RIBBONS[o.style]?.cols ?? 2) * (o.box ?? CELL)) / 2 : 0;
    const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

export function moveObject(o, dx, dy) {
    if (o.pts) return { ...o, pts: o.pts.map(([x, y]) => [x + dx, y + dy]) };
    return { ...o, x: o.x + dx, y: o.y + dy };
}

// ------------------------------------------------------------------ rendering

/**
 * SVG markup of one object. ctx: {stampHref(o) -> href, use: bool (export: <use> of a symbol), edit: bool (hit areas, data-id),
 * pinLabel(o) -> text}
 */
export function objectSvg(o, ctx) {
    const id = ctx.edit ? ` data-id="${esc(o.id)}"` : "";
    if (o.type === "stamp") {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        const tf = [o.rot ? `rotate(${n1(o.rot)} ${n1(cx)} ${n1(cy)})` : "", o.flip ? `translate(${n1(2 * cx)} 0) scale(-1 1)` : ""].filter(Boolean).join(" ");
        const href = esc(ctx.stampHref(o));
        const el = ctx.use
            ? `<use href="${href}" x="${n1(o.x)}" y="${n1(o.y)}" width="${n1(o.w)}" height="${n1(o.h)}"/>`
            : `<image href="${href}" x="${n1(o.x)}" y="${n1(o.y)}" width="${n1(o.w)}" height="${n1(o.h)}" preserveAspectRatio="none"/>`;
        return `<g${id}${tf ? ` transform="${tf}"` : ""}${o.opacity != null && o.opacity < 1 ? ` opacity="${o.opacity}"` : ""}>${el}</g>`;
    }
    if (o.type === "ribbon") return ribbonSvg(o, ctx);
    if (o.type === "room") return roomSvg(o, ctx);
    if (o.type === "path" || o.type === "area") {
        const style = PATH_STYLES[o.style];
        const smooth = o.smooth ?? style?.smooth ?? true;
        const closed = o.type === "area" || o.closed;
        const d = pathD(o.pts, smooth, closed);
        let s = "";
        if (o.type === "area") s += `<path d="${d}" fill="url(#f-${esc(o.fill ?? "parchment")})" stroke="none"/>`;
        if (style) for (const l of style.layers) s += `<path d="${d}" fill="none" stroke="${l.c}" stroke-width="${l.w * (o.scale ?? 1)}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ""} stroke-linecap="${l.cap ?? "butt"}" stroke-linejoin="round"${l.opacity ? ` opacity="${l.opacity}"` : ""}/>`;
        if (ctx.edit) s += `<path d="${d}" fill="${o.type === "area" ? "transparent" : "none"}" stroke="transparent" stroke-width="${Math.max(14, ...(style?.layers ?? [{ w: 4 }]).map((l) => l.w + 8))}" pointer-events="${o.type === "area" ? "all" : "stroke"}"/>`;
        return `<g${id}>${s}</g>`;
    }
    if (o.type === "text") {
        const st = TEXT_STYLES[o.style] ?? TEXT_STYLES.label;
        if (st.hidden && !ctx.edit) return "";
        const size = o.size ?? st.size;
        const lines = textLines(o);
        const b = textBox(o);
        const box = st.box ? `<rect x="${n1(b.x)}" y="${n1(b.y - 4)}" width="${n1(b.w)}" height="${n1(b.h)}" rx="4" fill="${st.box}" stroke="${st.border}" stroke-width="1.5"/>` : "";
        const halo = st.box ? "" : ` paint-order="stroke" stroke="${o.halo === false ? "none" : "rgba(255,250,235,.75)"}" stroke-width="${n1(size / 6)}" stroke-linejoin="round"`;
        const tspans = lines.map((l, i) => `<tspan x="${n1(o.x)}" dy="${i ? n1(size * 1.25) : 0}">${esc(st.caps ? l.toUpperCase() : l)}</tspan>`).join("");
        const rot = o.rot ? ` transform="rotate(${n1(o.rot)} ${n1(o.x)} ${n1(o.y)})"` : "";
        return `<g${id}${rot}>${box}<text x="${n1(o.x)}" y="${n1(o.y + (st.box ? 6 : 0))}" text-anchor="middle" font-family="${esc(st.font)}" font-size="${size}" fill="${o.color ?? st.color}"${st.italic ? ' font-style="italic"' : ""}${st.weight ? ` font-weight="${st.weight}"` : ""}${st.spacing ? ` letter-spacing="${n1(size * st.spacing)}"` : ""}${halo}>${tspans}</text></g>`;
    }
    if (o.type === "pin") {
        const label = ctx.pinLabel?.(o) ?? "";
        return `<g${id} transform="translate(${n1(o.x)} ${n1(o.y)})"><path d="M0 0c0-12 13-15 13-26a13 13 0 0 0-26 0c0 11 13 14 13 26z" fill="${o.color ?? "#6a4fc4"}" stroke="#fff" stroke-width="2"/><circle cy="-26" r="4.5" fill="#fff"/>${label && !o.hideLabel ? `<text y="16" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#23211d" paint-order="stroke" stroke="#fff" stroke-width="4" stroke-linejoin="round">${esc(label)}</text>` : ""}</g>`;
    }
    return "";
}

/** Painted squares of a layer, one path per floor type */
export function floorSvg(floor, size = CELL, fill = (f) => `url(#f-${esc(f)})`) {
    const by = new Map();
    for (const [k, f] of Object.entries(floor ?? {})) {
        const [c, r] = k.split(",").map(Number);
        if (!by.has(f)) by.set(f, []);
        by.get(f).push(`M${c * size} ${r * size}h${size}v${size}h-${size}z`);
    }
    return [...by].map(([f, d]) => `<path d="${d.join("")}" fill="${fill(f)}" shape-rendering="crispEdges"/>`).join("");
}

/** Floor-like objects (area fills, ribbons, rooms) sit with the painted floor, below everything else on their layer */
export const isFloorLevel = (o) => o.type === "area" || o.type === "ribbon" || o.type === "room";
const floorFirst = (objs) => [...objs.filter(isFloorLevel), ...objs.filter((o) => !isFloorLevel(o))];

/**
 * A room: a box with its own floor, grid (box size `box`) and walls, holding child objects in its own coordinates
 * (0..w, 0..h). It rotates about its centre, and everything inside turns with it.
 */
export function roomSvg(o, ctx, part = "all") {
    const cx = o.w / 2, cy = o.h / 2;
    const tf = `translate(${n1(o.x)} ${n1(o.y)})${o.rot ? ` rotate(${n1(o.rot)} ${n1(cx)} ${n1(cy)})` : ""}`;
    // contents are drawn in a second pass (after every room's floor), so a neighbouring room never covers them
    if (part === "contents") return (o.children ?? []).length ? `<g transform="${tf}">${floorFirst(o.children).map((c) => objectSvg(c, ctx)).join("")}</g>` : "";
    const base = roomBase(o);
    // the editor draws a room's floor, painted squares, grid and walls from one bitmap once it is ready
    const img = ctx.roomImage?.(o, base);
    let s = img ?? `${base.defs ? `<defs>${base.defs}</defs>` : ""}${base.body}`;
    if (ctx.edit) s += `<path d="${base.outline}" fill="transparent" stroke="none" pointer-events="all"/>`;
    if (part === "all") s += floorFirst(o.children ?? []).map((c) => objectSvg(c, ctx)).join("");
    return `<g${ctx.edit ? ` data-id="${esc(o.id)}"` : ""} transform="${tf}">${s}</g>`;
}

/** A room's own drawing (room coordinates): floor, painted squares, grid, walls. {defs, body, outline, box: area plus walls, floors} */
export function roomBase(o) {
    const B = o.box ?? CELL;
    const shaped = (o.shapes ?? []).some((sh) => sh.op !== "open");
    const e = roomExtent(o);
    const mid = `r${hashStr(String(o.id)).toString(36)}`;
    let defs = "", s = "";
    // the room's area: its rectangle plus added shapes minus removed ones, in order (a mask for the floor)
    if (shaped) defs += `<mask id="${mid}a" maskUnits="userSpaceOnUse" x="${e.x - 2}" y="${e.y - 2}" width="${e.w + 4}" height="${e.h + 4}"><rect width="${n1(o.w)}" height="${n1(o.h)}" fill="#fff"/>${(o.shapes ?? []).filter((sh) => sh.op !== "open").map((sh) => shapeSvg(sh, sh.op === "sub" ? "#000" : "#fff")).join("")}</mask>`;
    // textures fit the room's boxes: one texture square per box (scaled from the map's 64 px squares)
    const k = B / CELL;
    const floors = [...new Set([o.floor, ...Object.values(o.cells ?? {})].filter(Boolean))];
    const tex = (f) => (k === 1 ? `url(#f-${esc(f)})` : `url(#${mid}f-${esc(f)})`);
    if (k !== 1) for (const f of floors) defs += scaledPattern(`${mid}f-${f}`, f, `scale(${n1r(k)})`);
    let floor = `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="${o.floor ? tex(o.floor) : "transparent"}"/>`;
    floor += floorSvg(o.cells, B, tex).replace(/shape-rendering="crispEdges"/g, "");
    if (o.grid ?? true) {
        let d = "";
        const x0 = Math.floor(e.x / B) * B, y0 = Math.floor(e.y / B) * B;
        for (let x = x0 + B; x < e.x + e.w - 0.5; x += B) d += `M${n1(x)} ${n1(e.y)}V${n1(e.y + e.h)}`;
        for (let y = y0 + B; y < e.y + e.h - 0.5; y += B) d += `M${n1(e.x)} ${n1(y)}H${n1(e.x + e.w)}`;
        floor += `<path d="${d}" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1"/>`;
    }
    s += shaped ? `<g mask="url(#${mid}a)">${floor}</g>` : floor;
    // walls follow the outline of that area; openings cut gaps in them
    const wall = PATH_STYLES[o.wall];
    const outline = shaped ? roomOutline(o).d : `M0 0H${n1(o.w)}V${n1(o.h)}H0Z`;
    const ww = wall ? Math.max(...wall.layers.map((l) => l.w)) : 0;
    if (wall) {
        const opens = (o.shapes ?? []).filter((sh) => sh.op === "open");
        if (opens.length) defs += `<mask id="${mid}o" maskUnits="userSpaceOnUse" x="${e.x - ww}" y="${e.y - ww}" width="${e.w + ww * 2}" height="${e.h + ww * 2}"><rect x="${e.x - ww}" y="${e.y - ww}" width="${e.w + ww * 2}" height="${e.h + ww * 2}" fill="#fff"/>${opens.map((sh) => shapeSvg(sh, "#000")).join("")}</mask>`;
        const strokes = wall.layers.map((l) => `<path d="${outline}" fill="none" stroke="${l.c}" stroke-width="${l.w}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ""} stroke-linejoin="miter"/>`).join("");
        s += opens.length ? `<g mask="url(#${mid}o)">${strokes}</g>` : strokes;
    }
    const pad = ww / 2 + 2;
    return { defs, body: s, outline, floors, box: { x: Math.floor(e.x - pad), y: Math.floor(e.y - pad), w: Math.ceil(e.w + pad * 2) + 1, h: Math.ceil(e.h + pad * 2) + 1 } };
}
/** What decides a room's bitmap (not its position or angle, so moving and turning it reuse the image) */
export const roomLookKey = (o) => JSON.stringify([o.id, o.w, o.h, o.box, o.floor, o.wall, o.grid, o.cells, o.shapes]);
/** A room's base drawing as a stand-alone SVG (for one bitmap); textures from `custom` */
export function roomBaseSvg(o, custom = {}, scale = 2) {
    const b = roomBase(o);
    return { ...b.box, svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${b.box.x} ${b.box.y} ${b.box.w} ${b.box.h}" width="${Math.ceil(b.box.w * scale)}" height="${Math.ceil(b.box.h * scale)}"><defs>${texturesDefs(b.floors, custom)}${b.defs}</defs>${b.body}</svg>` };
}

const n1r = (v) => Math.round(v * 10000) / 10000;
/** A pattern that reuses texture `f-<floor>` with a transform (rotated for ribbons, scaled for small or large boxes) */
const scaledPattern = (id, floor, transform) => `<pattern id="${id}" href="#f-${floor}" xlink:href="#f-${floor}" patternTransform="${transform}"/>`;

/** Markup of a room shape (in room coordinates): rect {x, y, w, h}, circle {cx, cy, r}, poly {pts}, open {cx, cy, len, thick, rot} */
export function shapeSvg(sh, fill) {
    if (sh.shape === "circle") return `<circle cx="${n1(sh.cx)}" cy="${n1(sh.cy)}" r="${n1(sh.r)}" fill="${fill}"/>`;
    if (sh.shape === "poly") return `<path d="M${sh.pts.map((p) => `${n1(p[0])} ${n1(p[1])}`).join("L")}Z" fill="${fill}"/>`;
    if (sh.op === "open") return `<rect x="${n1(sh.cx - sh.len / 2)}" y="${n1(sh.cy - sh.thick / 2)}" width="${n1(sh.len)}" height="${n1(sh.thick)}" fill="${fill}" transform="rotate(${n1(sh.rot ?? 0)} ${n1(sh.cx)} ${n1(sh.cy)})"/>`;
    return `<rect x="${n1(sh.x)}" y="${n1(sh.y)}" width="${n1(sh.w)}" height="${n1(sh.h)}" fill="${fill}"/>`;
}
const inShape = (sh, [x, y]) => {
    if (sh.shape === "circle") return Math.hypot(x - sh.cx, y - sh.cy) <= sh.r;
    if (sh.shape === "poly") { let inside = false; const P = sh.pts; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1] || 1e-9) + P[i][0]) inside = !inside; return inside; }
    return x >= sh.x && y >= sh.y && x <= sh.x + sh.w && y <= sh.y + sh.h;
};
const shapeBox = (sh) => (sh.shape === "circle" ? { x: sh.cx - sh.r, y: sh.cy - sh.r, w: sh.r * 2, h: sh.r * 2 }
    : sh.shape === "poly" ? (() => { const xs = sh.pts.map((p) => p[0]), ys = sh.pts.map((p) => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; })()
    : { x: sh.x, y: sh.y, w: sh.w, h: sh.h });
/** Is a point (room coordinates) inside the room's area? */
export function roomInside(o, p) {
    let inside = p[0] >= 0 && p[1] >= 0 && p[0] <= o.w && p[1] <= o.h;
    for (const sh of o.shapes ?? []) {
        if (sh.op === "add") inside = inside || inShape(sh, p);
        else if (sh.op === "sub") inside = inside && !inShape(sh, p);
    }
    return inside;
}
/** Bounding box of the room's area in room coordinates */
export function roomExtent(o) {
    let x0 = 0, y0 = 0, x1 = o.w, y1 = o.h;
    for (const sh of o.shapes ?? []) if (sh.op === "add") { const b = shapeBox(sh); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Douglas-Peucker for closed outlines
function simplifyPts(pts, tol) {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts.at(-1)];
    let max = 0, idx = 0;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i];
        const d = L > 1e-9 ? Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]) / L : Math.hypot(p[0] - a[0], p[1] - a[1]);
        if (d > max) { max = d; idx = i; }
    }
    if (max <= tol) return [a, b];
    return [...simplifyPts(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplifyPts(pts.slice(idx), tol)];
}
const outlineCache = new Map();
/**
 * Outline of a room's area (traced with marching squares over the room, then simplified): {loops: [[[x, y]…]], d}.
 * Walls are drawn along it, so they follow every added and removed shape.
 */
export function roomOutline(o) {
    const key = JSON.stringify([o.w, o.h, (o.shapes ?? []).filter((s) => s.op !== "open")]);
    if (outlineCache.has(key)) return outlineCache.get(key);
    const e = roomExtent(o);
    const res = Math.max(2, Math.min(6, Math.max(e.w, e.h) / 300));
    const nx = Math.ceil(e.w / res) + 3, ny = Math.ceil(e.h / res) + 3;
    const ox = e.x - res * 1.5, oy = e.y - res * 1.5;
    const inside = new Uint8Array((nx + 1) * (ny + 1));
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) inside[j * (nx + 1) + i] = roomInside(o, [ox + i * res, oy + j * res]) ? 1 : 0;
    const at = (i, j) => inside[j * (nx + 1) + i];
    // segments between edge midpoints, keyed in half-steps so shared points match exactly
    const adj = new Map();
    const link = (a, b) => { for (const [p, q] of [[a, b], [b, a]]) { if (!adj.has(p)) adj.set(p, []); adj.get(p).push(q); } };
    const T = { 1: [["l", "b"]], 2: [["b", "r"]], 3: [["l", "r"]], 4: [["t", "r"]], 5: [["l", "t"], ["b", "r"]], 6: [["t", "b"]], 7: [["l", "t"]], 8: [["l", "t"]], 9: [["t", "b"]], 10: [["t", "r"], ["l", "b"]], 11: [["t", "r"]], 12: [["l", "r"]], 13: [["b", "r"]], 14: [["l", "b"]] };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = at(i, j) * 8 + at(i + 1, j) * 4 + at(i + 1, j + 1) * 2 + at(i, j + 1);
        if (!T[c]) continue;
        const E = { t: `${2 * i + 1},${2 * j}`, r: `${2 * i + 2},${2 * j + 1}`, b: `${2 * i + 1},${2 * j + 2}`, l: `${2 * i},${2 * j + 1}` };
        for (const [a, b] of T[c]) link(E[a], E[b]);
    }
    const seen = new Set(), loops = [];
    for (const start of adj.keys()) {
        if (seen.has(start)) continue;
        const loop = [];
        let prev = null, cur = start;
        while (cur && !seen.has(cur)) {
            seen.add(cur);
            const [hx, hy] = cur.split(",").map(Number);
            loop.push([ox + (hx * res) / 2, oy + (hy * res) / 2]);
            const next = (adj.get(cur) ?? []).find((q) => q !== prev && !seen.has(q));
            prev = cur; cur = next;
        }
        if (loop.length > 2) loops.push(simplifyPts([...loop, loop[0]], res * 0.7).slice(0, -1));
    }
    const out = { loops, d: loops.map((l) => `M${l.map((p) => `${n1(p[0])} ${n1(p[1])}`).join("L")}Z`).join("") };
    if (outlineCache.size > 500) outlineCache.clear();
    outlineCache.set(key, out);
    return out;
}
/** Nearest point on a room's wall (room coordinates) to p: {p, angle, dist} */
export function nearestWall(o, p) {
    const loops = (o.shapes ?? []).some((sh) => sh.op !== "open") ? roomOutline(o).loops : [[[0, 0], [o.w, 0], [o.w, o.h], [0, o.h]]];
    let best = null;
    for (const loop of loops) for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
        const q = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (!best || d < best.dist) best = { p: q, angle: (Math.atan2(dy, dx) * 180) / Math.PI, dist: d };
    }
    return best;
}

/** Point in a room's own coordinates, and back */
export function toRoom(room, [x, y]) {
    let p = [x - room.x, y - room.y];
    if (room.rot) { const a = (-room.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), cx = room.w / 2, cy = room.h / 2; p = [cx + (p[0] - cx) * c - (p[1] - cy) * s, cy + (p[0] - cx) * s + (p[1] - cy) * c]; }
    return p;
}
export function fromRoom(room, [x, y]) {
    let p = [x, y];
    if (room.rot) { const a = (room.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), cx = room.w / 2, cy = room.h / 2; p = [cx + (p[0] - cx) * c - (p[1] - cy) * s, cy + (p[0] - cx) * s + (p[1] - cy) * c]; }
    return [p[0] + room.x, p[1] + room.y];
}
export const inRoom = (room, p) => roomInside(room, toRoom(room, p));

/** Anchor point of an object (where it "is" when deciding which room holds it) */
export function anchorOf(o) {
    if (o.type === "stamp") return [o.x + o.w / 2, o.y + o.h / 2];
    if (o.pts) { const b = bounds(o); return [b.x + b.w / 2, b.y + b.h / 2]; }
    return [o.x, o.y];
}
/** Re-express an object from one room's coordinates (null = the map) in another's */
export function rehome(o, from, to) {
    const conv = (p) => { const w = from ? fromRoom(from, p) : p; return to ? toRoom(to, w) : w; };
    const dRot = (from?.rot ?? 0) - (to?.rot ?? 0);
    if (o.pts) return { ...o, pts: o.pts.map(conv) };
    if (o.type === "stamp") { const c = conv([o.x + o.w / 2, o.y + o.h / 2]); return { ...o, x: c[0] - o.w / 2, y: c[1] - o.h / 2, rot: (((o.rot ?? 0) + dRot) % 360 + 360) % 360 || undefined }; }
    const c = conv([o.x, o.y]);
    return { ...o, x: c[0], y: c[1], ...(o.type === "text" ? { rot: (((o.rot ?? 0) + dRot) % 360 + 360) % 360 || undefined } : {}) };
}

/** A layer in two parts: painted squares, then objects (floor-level ones first). The map grid goes between them on the top layer. */
export function layerParts(layer, ctx, region) {
    const objs = region ? (layer.objects ?? []).filter((o) => visibleIn(o, region)) : layer.objects ?? [];
    const floor = region ? Object.fromEntries(Object.entries(layer.floor ?? {}).filter(([k]) => {
        const [c, r] = k.split(",").map(Number);
        return (c + 1) * CELL >= region.x && c * CELL <= region.x + region.w && (r + 1) * CELL >= region.y && r * CELL <= region.y + region.h;
    })) : layer.floor;
    // floor-level things (areas, ribbons, room floors), then what stands in rooms, then everything else
    const low = objs.filter(isFloorLevel), high = objs.filter((o) => !isFloorLevel(o));
    const markup = low.map((o) => (o.type === "room" ? roomSvg(o, ctx, "base") : objectSvg(o, ctx))).join("")
        + low.filter((o) => o.type === "room").map((o) => roomSvg(o, ctx, "contents")).join("")
        + high.map((o) => objectSvg(o, ctx)).join("");
    return { floor: floorSvg(floor), objects: markup };
}
/** Does an object show anywhere in a region {x, y, w, h}? (generous: rotation and stroke widths count) */
export function visibleIn(o, region) {
    const b = bounds(o);
    const pad = o.type === "stamp" || o.type === "room" || o.type === "text" ? Math.max(b.w, b.h) * 0.25 + 4 : o.pts ? 40 : 30;
    return b.x - pad <= region.x + region.w && b.x + b.w + pad >= region.x && b.y - pad <= region.y + region.h && b.y + b.h + pad >= region.y;
}
export function layerSvg(layer, ctx, between = "") {
    const p = layerParts(layer, ctx);
    return p.floor + between + p.objects;
}

/** Floor ids a document needs patterns for */
export function usedFloors(doc, custom = doc.textures) {
    const s = new Set([doc.kind === "grid" ? TERRAINS[doc.terrain]?.floor ?? "void" : doc.backdrop ?? "parchment"]);
    for (const l of doc.layers) {
        for (const f of Object.values(l.floor ?? {})) s.add(f);
        for (const o of l.objects.flatMap((x) => (x.type === "room" ? [x, ...(x.children ?? [])] : [x]))) {
            if (o.type === "room") { if (o.floor) s.add(o.floor); for (const f of Object.values(o.cells ?? {})) s.add(f); }
            if (o.type === "area") s.add(o.fill ?? "parchment");
            if (o.type === "ribbon") { const f = o.floor === undefined ? RIBBONS[o.style]?.floor : o.floor; if (f) s.add(f); }
        }
    }
    return [...s].filter((f) => TEXTURES[f] || custom?.[f]);
}

export function backgroundSvg(doc) {
    const f = doc.kind === "grid" ? TERRAINS[doc.terrain]?.floor ?? "void" : doc.backdrop ?? "parchment";
    return `<rect width="${doc.width}" height="${doc.height}" fill="url(#f-${f})"/>`;
}

export function gridSvg(doc) {
    if (!doc.showGrid) return "";
    return `<defs><pattern id="grid-lines" width="${CELL}" height="${CELL}" patternUnits="userSpaceOnUse"><path d="M${CELL} 0H0V${CELL}" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1"/></pattern></defs><rect width="${doc.width}" height="${doc.height}" fill="url(#grid-lines)" pointer-events="none"/>`;
}

/** Scale bar text from the map's units */
export const unitsPerPx = (doc) => (doc.units?.amount ?? 1) / (doc.units?.per ?? CELL);

/**
 * Full, self-contained SVG (what Obsidian shows). symbols: {href -> symbol markup id}, given as ctx.symbolOf(o) and ctx.defs.
 * The document itself rides along as JSON in <metadata> so the editor can reopen it.
 */
export function renderMapSvg(doc, ctx) {
    const json = JSON.stringify(doc).replace(/]]>/g, "]]]]><![CDATA[>");
    const shown = viewLayers(doc).filter((x) => x.shown);
    const layers = shown.map((x, i) => `<g data-layer="${esc(x.layer.name)}"${x.faded ? ' opacity="0.35"' : ""}>${layerSvg(x.layer, ctx, i === shown.length - 1 ? gridSvg(doc) : "")}</g>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${doc.width} ${doc.height}" width="${doc.width}" height="${doc.height}">
<metadata id="books-meta-map"><![CDATA[${json}]]></metadata>
<defs>${texturesDefs(usedFloors(doc), doc.textures)}${ctx.defs ?? ""}</defs>
${backgroundSvg(doc)}
${layers || gridSvg(doc)}
</svg>
`;
}

/** Map document from a saved SVG, or null */
export function parseMapSvg(text) {
    const m = String(text ?? "").match(/<metadata id="books-meta-map"><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/);
    if (!m) return null;
    try { return JSON.parse(m[1].replace(/]]]]><!\[CDATA\[>/g, "]]>")); } catch { return null; }
}
