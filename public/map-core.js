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

export const VARIANTS = 32;
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
    // carpets: fine, low-contrast weaves that line up across square edges
    loop: (r, c) => `<path d="${Array.from({ length: 16 }, (_, i) => `M${i % 2 ? 2 : 0} ${i * 4 + 2}H64`).join("")}" stroke="${c(c.line)}" stroke-width="1.6" stroke-dasharray="2 2" opacity=".5"/>`,
    ribbed: (r, c) => `<path d="${Array.from({ length: 16 }, (_, i) => `M${i * 4 + 1} 0V64`).join("")}" stroke="${c(c.line)}" stroke-width="1.4" opacity=".45"/>`,
    "carpet-tiles": (r, c) => `<rect width="64" height="64" fill="${c(c.base, r() * 0.06 - 0.03)}"/><path d="${r() < 0.5 ? Array.from({ length: 8 }, (_, i) => `M2 ${i * 8 + 4}H62`).join("") : Array.from({ length: 8 }, (_, i) => `M${i * 8 + 4} 2V62`).join("")}" stroke="${c(c.base, 0.035)}" stroke-width="3" opacity=".45"/><path d="M0 0H64V64" stroke="${c(c.line)}" stroke-width=".8" fill="none" opacity=".7"/>`,
    plate: (r, c) => { let s = ""; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) s += `<path d="M${x * 16 + 4 + (y % 2) * 8} ${y * 16 + 10}l6 -6" stroke="${c(c.line, 0.12)}" stroke-width="2.4" stroke-linecap="round"/>`; return s + `<path d="M0 0H64V64" stroke="${c(c.line, -0.12)}" stroke-width="1.5" fill="none"/>`; },
    grating: (r, c) => `<path d="M0 8H64M0 24H64M0 40H64M0 56H64M8 0V64M24 0V64M40 0V64M56 0V64" stroke="${c(c.line)}" stroke-width="3"/>`,
    furrows: (r, c) => `<path d="M0 6H64M0 18H64M0 30H64M0 42H64M0 54H64" stroke="${c(c.line)}" stroke-width="3"/>`,
};

// Structures whose pieces cross square edges (planks, cobbles, bricks, flagstones) are laid out as one continuous,
// seamless piece of floor over P × P px instead of square by square, so a plank keeps one shade along its whole length.
// Each piece gets its own random shade; the layout wraps at its edges so it repeats without a seam.
const wrapRect = (P, x, y, w, h, attrs) => { const a = `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" ${attrs}/>`; return x + w > P ? a + `<rect x="${n1(x - P)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" ${attrs}/>` : a; };
/** lengths in [min, max] (multiples of q) that add up to exactly P */
function runs(r, P, min, max, q = 1) {
    const out = [];
    let left = P;
    while (left > 0) {
        let l = Math.round((min + r() * (max - min)) / q) * q;
        if (left - l < min) l = left; // last piece takes the rest (or merges a too-short remainder)
        out.push(l); left -= l;
    }
    return out;
}
const TILE_STRUCTURES = {
    // ---- roofs (rows run left to right; turn the room or strip to turn the roof)
    rooftiles: { period: 6, draw: (r, c, P) => {
        // overlapping rows of round-ended clay tiles, each row half a tile along from the last
        let s = "";
        for (let y = -6, row = 0; y < P; y += 14, row++) for (let x0 = 0; x0 < P; x0 += 16) {
            const x = (x0 + (row % 2) * 8) % P, f = c(c.stone, r() * 0.12 - 0.06), d = (xx) => `M${n1(xx)} ${y}h16v12q-8 9 -16 0z`;
            for (const xx of x + 16 > P ? [x, x - P] : [x]) s += `<path d="${d(xx)}" fill="${f}" stroke="${c(c.line)}" stroke-width=".8"/><path d="M${n1(xx + 3)} ${y + 3}v8" stroke="${c(c.stone, 0.1)}" stroke-width="1.2" opacity=".6"/>`;
        }
        return s;
    } },
    slates: { period: 6, draw: (r, c, P) => {
        let s = "";
        for (let y = 0; y < P; y += 12) {
            let x = r() * P;
            for (const w of runs(r, P, 16, 28)) { s += wrapRect(P, x % P, y, w - 1, 13, `fill="${c(c.stone, r() * 0.1 - 0.05)}" stroke="${c(c.line)}" stroke-width=".8"`); x += w; }
        }
        return s + `<path d="${Array.from({ length: P / 12 }, (_, i) => `M0 ${i * 12 + 12.5}H${P}`).join("")}" stroke="${c(c.line, -0.05)}" stroke-width="1.6" opacity=".6"/>`;
    } },
    shingles: { period: 6, draw: (r, c, P) => {
        let s = "";
        for (let y = 0; y < P; y += 12) {
            let x = r() * P;
            for (const w of runs(r, P, 9, 30)) { s += wrapRect(P, x % P, y, w - 1.2, 12, `fill="${c(c.stone, r() * 0.14 - 0.07)}"`); x += w; }
        }
        return s + `<path d="${Array.from({ length: P / 12 }, (_, i) => `M0 ${i * 12 + 12}H${P}`).join("")}" stroke="${c(c.line)}" stroke-width="1.4"/>`;
    } },
    corrugated: { period: 12, draw: (r, c, P) => {
        // sheets two squares wide, each its own shade, with ridges every 8 px
        let s = "";
        for (let y = 0; y < P; y += 128) for (let x = 0; x < P; x += 128) {
            const sh = r() * 0.1 - 0.05;
            s += `<rect x="${x}" y="${y}" width="128" height="128" fill="${c(c.stone, sh)}"/>`;
            let d1 = "", d2 = "";
            for (let i = 0; i < 16; i++) { d1 += `M${x + i * 8 + 2} ${y}v128`; d2 += `M${x + i * 8 + 6} ${y}v128`; }
            s += `<path d="${d1}" stroke="${c(c.stone, sh + 0.12)}" stroke-width="2.4"/><path d="${d2}" stroke="${c(c.stone, sh - 0.12)}" stroke-width="2.4"/>`;
        }
        return s + `<path d="${Array.from({ length: P / 128 }, (_, i) => `M0 ${i * 128}H${P}M${i * 128} 0V${P}`).join("")}" stroke="${c(c.line)}" stroke-width="1.6"/>`;
    } },
    seam: { period: 12, draw: (r, c, P) => {
        // standing-seam metal: panels with raised seams between them
        let s = "", seams = "";
        for (let x = 0; x < P; x += 24) { s += `<rect x="${x}" y="0" width="24" height="${P}" fill="${c(c.stone, r() * 0.08 - 0.04)}"/>`; seams += `M${x + 0.5} 0V${P}`; }
        return s + `<path d="${seams}" stroke="${c(c.line)}" stroke-width="3"/><path d="${seams.replace(/M(\d+(\.\d+)?) /g, (m, x) => `M${+x + 1.6} `)}" stroke="${c(c.stone, 0.15)}" stroke-width="1"/>`;
    } },
    glass: { period: 12, draw: (r, c, P) => {
        // glazed roof: panes in an iron frame, each pane its own tint, with a highlight
        let s = "";
        for (let y = 0; y < P; y += 48) for (let x = 0; x < P; x += 32) {
            s += `<rect x="${x}" y="${y}" width="32" height="48" fill="${c(c.stone, r() * 0.08 - 0.04)}"/><path d="M${x + 6} ${y + 38}L${x + 24} ${y + 8}" stroke="#ffffff" stroke-width="2" opacity="${n1(0.15 + r() * 0.25)}"/>`;
        }
        let d = "";
        for (let x = 0; x <= P; x += 32) d += `M${x} 0V${P}`;
        for (let y = 0; y <= P; y += 48) d += `M0 ${y}H${P}`;
        return s + `<path d="${d}" stroke="${c(c.line)}" stroke-width="3"/>`;
    } },
    rolls: { period: 12, draw: (r, c, P) => {
        // flat roof felt or lead in rolls, with overlapping seams
        let s = "";
        for (let y = 0; y < P; y += 48) {
            s += `<rect x="0" y="${y}" width="${P}" height="48" fill="${c(c.base, r() * 0.06 - 0.03)}"/>`;
            let x = r() * P;
            for (const w of runs(r, P, 96, 240)) { s += `<path d="M${n1(x % P)} ${y}v48" stroke="${c(c.line)}" stroke-width="1.2" opacity=".8"/>`; x += w; }
            s += `<path d="M0 ${y + 47}H${P}" stroke="${c(c.line)}" stroke-width="2.2"/><path d="M0 ${y + 45}H${P}" stroke="${c(c.base, 0.06)}" stroke-width="1"/>`;
        }
        return s;
    } },
    planks: { period: 12, draw: (r, c, P) => {
        let s = "", lines = "";
        for (let y = 0; y < P; y += 16) {
            let x = r() * P;
            for (const len of runs(r, P, 40, 170)) {
                const shade = r() * 0.1 - 0.05;
                s += wrapRect(P, x % P, y, len, 16, `fill="${c(c.base, shade)}"`);
                const gy = y + 4 + r() * 8;
                s += wrapRect(P, (x + 3) % P, gy, len - 6, 0.7, `fill="${c(c.line, 0.08)}" opacity=".55"`);
                lines += `M${n1(x % P)} ${y}v16`;
                x += len;
            }
            lines += `M0 ${y + 16}H${P}`;
        }
        return s + `<path d="${lines}" stroke="${c(c.line)}" stroke-width="1.4" fill="none"/>`;
    } },
    cobble: { period: 6, draw: (r, c, P) => {
        let s = "";
        for (let y = 0, row = 0; y < P; y += 16, row++) for (let x0 = 0; x0 < P; x0 += 16) {
            const x = (x0 + (row % 2) * 8 + 1 + r() * 1.5) % P;
            s += wrapRect(P, x, y + 1 + r() * 1.5, 12.5 + r() * 1.5, 12 + r() * 1.5, `rx="${n1(4 + r() * 2)}" fill="${c(c.stone, r() * 0.12 - 0.06)}" stroke="${c(c.line)}" stroke-width=".8"`);
        }
        return s;
    } },
    bricks: { period: 12, draw: (r, c, P) => {
        let s = "";
        for (let y = 0, row = 0; y < P; y += 16, row++) for (let x0 = 0; x0 < P; x0 += 32) s += wrapRect(P, (x0 + (row % 2) * 16 + 0.7) % P, y + 0.7, 30.6, 14.6, `fill="${c(c.base, r() * 0.1 - 0.05)}" stroke="${c(c.line)}" stroke-width="1.4"`);
        return s;
    } },
    flagstone: { period: 12, draw: (r, c, P) => {
        let s = "";
        let y = 0;
        for (const h of runs(r, P, 16, 48, 8)) {
            let x = Math.floor(r() * P / 8) * 8;
            for (const w of runs(r, P, 24, 72, 8)) { s += wrapRect(P, x % P, y, w, h, `fill="${c(c.base, r() * 0.08 - 0.04)}" stroke="${c(c.line)}" stroke-width="1.6"`); x += w; }
            y += h;
        }
        return s;
    } },
    // ---- building faces (front views: rows run left to right, as a wall stands)
    clapboard: { period: 12, draw: (r, c, P) => {
        // overlapping weatherboards: each board its own shade, a shadow under each lap, butt joints here and there
        let s = "", joints = "", laps = "", tops = "";
        for (let y = 0; y < P; y += 12) {
            let x = r() * P;
            for (const w of runs(r, P, 192, 640)) { s += wrapRect(P, x % P, y, w, 12, `fill="${c(c.base, r() * 0.06 - 0.03)}"`); joints += `M${n1(x % P)} ${y}v12`; x += w; }
            laps += `M0 ${y + 11}H${P}`; tops += `M0 ${y + 1}H${P}`;
        }
        return s + `<path d="${laps}" stroke="${c(c.line)}" stroke-width="2.2"/><path d="${tops}" stroke="${c(c.base, 0.08)}" stroke-width="1"/><path d="${joints}" stroke="${c(c.line)}" stroke-width="1"/>`;
    } },
    battens: { period: 6, draw: (r, c, P) => {
        // vertical boards with narrow battens over the seams
        let s = "", bat = "";
        for (let x = 0; x < P; x += 16) { s += `<rect x="${x}" y="0" width="16" height="${P}" fill="${c(c.base, r() * 0.07 - 0.035)}"/>`; bat += `M${x} 0V${P}`; }
        return s + `<path d="${bat}" stroke="${c(c.base, 0.06)}" stroke-width="4"/><path d="${bat.replace(/M(\d+) /g, (m, x) => `M${+x + 2.5} `)}" stroke="${c(c.line)}" stroke-width="1.2"/>`;
    } },
    brickwork: { period: 6, draw: (r, c, P) => {
        // facade-scale bricks in stretcher bond (16 × 6 px, a pixel of mortar); the texture colour is the mortar
        let s = "";
        for (let y = 0, row = 0; y < P; y += 6, row++) for (let x0 = 0; x0 < P; x0 += 16) s += wrapRect(P, (x0 + (row % 2) * 8) % P, y, 15, 5, `fill="${c(c.stone, r() * 0.16 - 0.08)}"`);
        return s;
    } },
    ashlar: { period: 6, draw: (r, c, P) => {
        // dressed stone blocks in courses of 16 or 24 px, joints in a light mortar
        let s = "", y = 0;
        for (const h of runs(r, P, 16, 24, 8)) {
            let x = r() * P;
            for (const w of runs(r, P, 32, 72, 8)) { s += wrapRect(P, x % P, y, w, h, `fill="${c(c.stone, r() * 0.08 - 0.04)}" stroke="${c(c.line)}" stroke-width="1.2"`); x += w; }
            y += h;
        }
        return s;
    } },
    rubble: { period: 6, draw: (r, c, P) => {
        // rough stones of mixed sizes set in mortar (the texture colour)
        let s = "";
        for (let y = 0; y < P; y += 12) {
            let x = r() * P;
            for (const w of runs(r, P, 12, 30)) {
                const h = 9 + r() * 6, oy = y + r() * 3 - 1.5;
                s += wrapRect(P, (x + 1) % P, oy, w - 2, h, `rx="${n1(3 + r() * 3)}" fill="${c(c.stone, r() * 0.18 - 0.09)}" stroke="${c(c.line)}" stroke-width=".8"`);
                x += w;
            }
        }
        return s;
    } },
    timberframe: { period: 6, draw: (r, c, P) => {
        // half-timbering: posts every square, rails every two squares, and a brace or two in some bays
        let infill = "", beams = "";
        for (let y = 0; y < P; y += 128) for (let x = 0; x < P; x += 64) {
            infill += `<rect x="${x + 4}" y="${y + 4}" width="56" height="120" fill="${c(c.base, r() * 0.05 - 0.025)}"/>`;
            const kind = Math.floor(r() * 5);
            if (kind === 1) beams += `M${x + 4} ${y + 124}L${x + 60} ${y + 4}`;
            else if (kind === 2) beams += `M${x + 4} ${y + 4}L${x + 60} ${y + 124}`;
            else if (kind === 3) beams += `M${x + 4} ${y + 4}L${x + 60} ${y + 124}M${x + 60} ${y + 4}L${x + 4} ${y + 124}`;
            else if (kind === 4) beams += `M${x + 4} ${y + 64}H${x + 60}`;
        }
        let frame = "";
        for (let x = 0; x < P; x += 64) frame += `M${x} 0V${P}`;
        for (let y = 0; y < P; y += 128) frame += `M0 ${y}H${P}`;
        return infill + `<path d="${beams}" stroke="${c(c.line)}" stroke-width="5"/><path d="${frame}" stroke="${c(c.line)}" stroke-width="8"/>`;
    } },
    logs: { period: 6, draw: (r, c, P) => {
        // horizontal logs: rounded with a highlight on top and shadow beneath, a knot now and then
        let s = "";
        for (let y = 0; y < P; y += 14) {
            s += `<rect x="0" y="${y}" width="${P}" height="14" fill="${c(c.base, r() * 0.08 - 0.04)}"/><path d="M0 ${y + 3}H${P}" stroke="${c(c.base, 0.1)}" stroke-width="2" opacity=".7"/><path d="M0 ${y + 13}H${P}" stroke="${c(c.line)}" stroke-width="2.4"/>`;
            for (let i = 0, n = Math.floor(r() * 3); i < n; i++) s += `<ellipse cx="${n1(r() * P)}" cy="${y + 7}" rx="2.2" ry="1.6" fill="${c(c.line, 0.05)}" opacity=".8"/>`;
        }
        return s;
    } },
    panels: { period: 6, draw: (r, c, P) => {
        // precast concrete panels with joints and form-tie holes
        let s = "", holes = "", y = 0;
        for (const h of runs(r, P, 48, 96, 48)) {
            let x = Math.floor(r() * P / 32) * 32;
            for (const w of runs(r, P, 96, 192, 32)) {
                s += wrapRect(P, x % P, y, w, h, `fill="${c(c.base, r() * 0.06 - 0.03)}" stroke="${c(c.line)}" stroke-width="1.6"`);
                for (const [dx, dy] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) holes += `<circle cx="${n1((x + dx) % P)}" cy="${y + dy}" r="1.6" fill="${c(c.line, -0.05)}" opacity=".7"/>`;
                x += w;
            }
            y += h;
        }
        return s + holes;
    } },
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
    pile: { name: "Carpet pile", max: 160, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r), a = r() * Math.PI * 2, l = (0.8 + r() * 1.4) * S; return `<path d="M${x} ${y}l${n1(Math.cos(a) * l)} ${n1(Math.sin(a) * l)}" stroke="${c(col, J(r, 0.05, V))}" stroke-width=".8" stroke-linecap="round" opacity=".55"/>`; }).join("") },
    straw: { name: "Straw", max: 120, draw: (r, n, c, col, S, V) => Array.from({ length: n }, () => { const [x, y] = P(r), l = (6 + r() * 8) * S, a = 1.3 + (r() - 0.5) * 0.5; return `<path d="M${x} ${y}l${n1(Math.cos(a) * l)} ${n1(Math.sin(a) * l)}" stroke="${c(col, J(r, 0.09, V))}" stroke-width="${n1(0.8 + r() * 0.5)}" stroke-linecap="round"/>`; }).join("") },
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
    carpet: { name: "Carpet (red)", group: "Carpet", color: "#8e2f2f", structure: "carpet", line: "#a84040", accent: "#c9a14a", vary: 0.15, details: [["stains", 0.15, "#6e2424"]] },
    "carpet-green": { name: "Carpet (green)", group: "Carpet", color: "#3f6b4a", structure: "carpet", line: "#4f805b", accent: "#c9a14a", vary: 0.15, details: [["stains", 0.15, "#2f5238"]] },
    // carpets: plain pile (soft: no per-square colour shift, so no patchwork), a few quiet weaves, carpet tiles
    "carpet-wine": { name: "Plain carpet (wine)", group: "Carpet", color: "#6e2630", vary: 0.2, details: [["pile", 70, "#83313c"], ["pile", 40, "#5a1e27"], ["stains", 0.04, "#4f1a22"]] },
    "carpet-crimson": { name: "Plain carpet (crimson)", group: "Carpet", color: "#9a2b2b", vary: 0.2, details: [["pile", 70, "#b03636"], ["pile", 40, "#7f2323"], ["stains", 0.04, "#6a1d1d"]] },
    "carpet-navy": { name: "Plain carpet (navy)", group: "Carpet", color: "#283a5c", vary: 0.2, details: [["pile", 70, "#33496f"], ["pile", 40, "#1f2e4a"], ["stains", 0.04, "#1a263d"]] },
    "carpet-moss": { name: "Plain carpet (moss green)", group: "Carpet", color: "#4a5e3a", vary: 0.2, details: [["pile", 70, "#576d45"], ["pile", 40, "#3d4f30"], ["stains", 0.04, "#334228"]] },
    "carpet-teal": { name: "Plain carpet (teal)", group: "Carpet", color: "#2f6461", vary: 0.2, details: [["pile", 70, "#3a7572"], ["pile", 40, "#26524f"], ["stains", 0.04, "#1f4442"]] },
    "carpet-plum": { name: "Plain carpet (plum)", group: "Carpet", color: "#5a3450", vary: 0.2, details: [["pile", 70, "#6a3f5f"], ["pile", 40, "#4a2a42"], ["stains", 0.04, "#3d2337"]] },
    "carpet-ochre": { name: "Plain carpet (ochre)", group: "Carpet", color: "#b08a3e", vary: 0.2, details: [["pile", 70, "#c29a4b"], ["pile", 40, "#977532"], ["stains", 0.04, "#7f622a"]] },
    "carpet-brown": { name: "Plain carpet (brown)", group: "Carpet", color: "#5e4433", vary: 0.2, details: [["pile", 70, "#6d503d"], ["pile", 40, "#4e382a"], ["stains", 0.04, "#3f2d22"]] },
    "carpet-beige": { name: "Plain carpet (beige)", group: "Carpet", color: "#c9b896", vary: 0.2, details: [["pile", 70, "#d6c6a5"], ["pile", 40, "#b5a37f"], ["stains", 0.04, "#a39070"]] },
    "carpet-cream": { name: "Plain carpet (cream)", group: "Carpet", color: "#e6dcc6", vary: 0.15, details: [["pile", 70, "#efe7d4"], ["pile", 40, "#d4c8ae"], ["stains", 0.04, "#c6b998"]] },
    "carpet-grey": { name: "Plain carpet (grey)", group: "Carpet", color: "#8a8885", vary: 0.15, details: [["pile", 70, "#999794"], ["pile", 40, "#777572"], ["stains", 0.04, "#666461"]] },
    "carpet-charcoal": { name: "Plain carpet (charcoal)", group: "Carpet", color: "#3d3c3c", vary: 0.15, details: [["pile", 70, "#4a4949"], ["pile", 40, "#323131"], ["stains", 0.04, "#2a2929"]] },
    "carpet-worn": { name: "Worn carpet (red)", group: "Carpet", color: "#7d3030", vary: 0.35, age: 0.35, details: [["pile", 60, "#8f3a3a"], ["pile", 30, "#663030"], ["stains", 0.6, "#5a2424"], ["scratches", 0.6, "#9a6a5a"]] },
    "carpet-berber": { name: "Loop pile (oatmeal)", group: "Carpet", color: "#bfb39a", structure: "loop", soft: true, line: "#a69a80", vary: 0.12, details: [["pile", 30, "#cdc2aa"], ["stains", 0.1, "#9c9076"]] },
    "carpet-berber-grey": { name: "Loop pile (grey)", group: "Carpet", color: "#7f7e7a", structure: "loop", soft: true, line: "#6a6965", vary: 0.12, details: [["pile", 30, "#8e8d89"], ["stains", 0.1, "#5f5e5a"]] },
    "carpet-ribbed": { name: "Ribbed carpet (sage)", group: "Carpet", color: "#7d8a6a", structure: "ribbed", soft: true, line: "#6b7759", vary: 0.12, details: [["pile", 30, "#8a9777"], ["stains", 0.1, "#5f6a4f"]] },
    "carpet-tiles": { name: "Carpet tiles (grey)", group: "Carpet", color: "#6c6e72", structure: "carpet-tiles", line: "#55575b", vary: 0.2, details: [["pile", 40, "#7a7c80"], ["stains", 0.15, "#56585c"]] },
    "carpet-tiles-blue": { name: "Carpet tiles (blue)", group: "Carpet", color: "#3e4f6b", structure: "carpet-tiles", line: "#2f3d55", vary: 0.2, details: [["pile", 40, "#4a5c7a"], ["stains", 0.15, "#2f3d55"]] },
    "metal-plate": { name: "Metal plate", group: "Indoor", color: "#7c7f86", structure: "plate", line: "#8a8e95", vary: 0.2, details: [["rust", 0.4, "#8a4a26"], ["scratches", 0.6, "#a4a8ae"]] },
    grating: { name: "Iron grating", group: "Indoor", color: "#2f2f33", structure: "grating", line: "#5d5d66", vary: 0.1, details: [["rust", 0.3, "#7a4123"]] },
    cave: { name: "Cave floor", group: "Indoor", color: "#5a544c", vary: 0.4, details: [["speckle", 28, "#4b463f"], ["pebbles", 5, "#6e675d"], ["cracks", 0.3, "#3f3a34"]] },
    void: { name: "Darkness", group: "Indoor", color: "#1d1c1a", vary: 0, details: [] },
    // roofs
    "roof-clay": { name: "Clay tiles", group: "Roof", color: "#6e2f1c", structure: "rooftiles", stone: "#b5552f", line: "#5e2716", vary: 0.35, details: [["moss", 0.15, "#6f7d45"], ["stains", 0.3, "#4a2214"]] },
    "roof-clay-brown": { name: "Clay tiles (brown)", group: "Roof", color: "#4e3424", structure: "rooftiles", stone: "#8a5a3a", line: "#3e281b", vary: 0.35, details: [["moss", 0.2, "#6f7d45"], ["stains", 0.3, "#2f2016"]] },
    "roof-slate": { name: "Slate", group: "Roof", color: "#2f343b", structure: "slates", stone: "#58616c", line: "#262a30", vary: 0.4, details: [["moss", 0.12, "#5f7348"], ["stains", 0.25, "#3a4048"]] },
    "roof-shingle": { name: "Wooden shingles", group: "Roof", color: "#4e3520", structure: "shingles", stone: "#94673e", line: "#3a2816", vary: 0.45, details: [["moss", 0.25, "#5f7d45"], ["stains", 0.3, "#3a2816"]] },
    "roof-thatch": { name: "Thatch", group: "Roof", color: "#a8864e", vary: 0.4, details: [["straw", 45, "#c2a062"], ["straw", 22, "#8a6a38"], ["stains", 0.5, "#7d6338"]] },
    "roof-corrugated": { name: "Corrugated iron", group: "Roof", color: "#7f858c", structure: "corrugated", stone: "#9aa0a8", line: "#5d6268", vary: 0.3, details: [["rust", 0.15, "#8a4a26"], ["stains", 0.2, "#6f747b"]] },
    "roof-corrugated-rust": { name: "Rusty corrugated iron", group: "Roof", color: "#6e4026", structure: "corrugated", stone: "#8a5434", line: "#4a2a18", vary: 0.5, details: [["rust", 1.2, "#a0522d"], ["stains", 0.6, "#4a2a18"]] },
    "roof-copper": { name: "Copper (verdigris)", group: "Roof", color: "#4f8f7c", structure: "seam", stone: "#6aa592", line: "#3c6f60", vary: 0.4, details: [["stains", 0.5, "#8fbfae"], ["rust", 0.15, "#a8743f"]] },
    "roof-zinc": { name: "Zinc standing seam", group: "Roof", color: "#8d949b", structure: "seam", stone: "#a3a9b0", line: "#6f757c", vary: 0.25, details: [["stains", 0.3, "#7d838a"]] },
    "roof-glass": { name: "Glazed roof", group: "Roof", color: "#8fb8c4", structure: "glass", stone: "#a9cfd8", line: "#2b2b30", vary: 0.3, details: [["stains", 0.25, "#6f8f97"]] },
    "roof-felt": { name: "Felt (flat roof)", group: "Roof", color: "#3d3d42", structure: "rolls", line: "#2a2a2e", vary: 0.25, details: [["pebbles", 6, "#6e6a62"], ["puddles", 0.15, "#5d7580"], ["stains", 0.4, "#2f2f33"]] },
    "roof-lead": { name: "Lead (flat roof)", group: "Roof", color: "#7d8590", structure: "rolls", line: "#5e6570", vary: 0.25, details: [["stains", 0.5, "#9aa3ad"]] },
    "roof-gravel": { name: "Gravel roof", group: "Roof", color: "#77736b", vary: 0.25, details: [["pebbles", 20, "#8d877f"], ["pebbles", 9, "#5f5b55"], ["puddles", 0.1, "#5d7580"]] },
    // building faces: for drawing a building from the front (rows run as a wall stands)
    "facade-weatherboard": { name: "Weatherboard (white)", group: "Facade", color: "#e6e1d6", structure: "clapboard", line: "#a39d8f", vary: 0.25, details: [["stains", 0.12, "#c9c3b5"]] },
    "facade-weatherboard-blue": { name: "Weatherboard (blue)", group: "Facade", color: "#7f9db1", structure: "clapboard", line: "#4f6a7d", vary: 0.3, details: [["stains", 0.12, "#6c889b"]] },
    "facade-weatherboard-grey": { name: "Weatherboard (weathered)", group: "Facade", color: "#9c9a93", structure: "clapboard", line: "#686660", vary: 0.45, details: [["stains", 0.3, "#85837c"], ["cracks", 0.15, "#5f5d57"]] },
    "facade-battens": { name: "Board and batten (barn red)", group: "Facade", color: "#8e3b30", structure: "battens", line: "#5e2620", vary: 0.35, details: [["stains", 0.25, "#7a3229"]] },
    "facade-battens-timber": { name: "Board and batten (timber)", group: "Facade", color: "#a77c4f", structure: "battens", line: "#6e5032", vary: 0.4, details: [["knots", 0.4, "#6e5032"], ["stains", 0.2, "#8a6640"]] },
    "facade-brick": { name: "Brickwork (red)", group: "Facade", color: "#b8ad9b", structure: "brickwork", stone: "#9b4a35", line: "#7a3a2a", vary: 0.35, details: [["stains", 0.2, "#7a3a2a"]] },
    "facade-brick-yellow": { name: "Brickwork (yellow stock)", group: "Facade", color: "#d8cfbd", structure: "brickwork", stone: "#c7a668", line: "#9a7f48", vary: 0.35, details: [["stains", 0.25, "#a68a55"]] },
    "facade-brick-sooty": { name: "Brickwork (sooty)", group: "Facade", color: "#857d72", structure: "brickwork", stone: "#5e4136", line: "#3f2c25", vary: 0.4, details: [["soot", 0.5, "#2f2a26"], ["stains", 0.3, "#4a3a32"]] },
    "facade-ashlar": { name: "Ashlar stone", group: "Facade", color: "#d6cdb9", structure: "ashlar", stone: "#cfc5ae", line: "#a39a86", vary: 0.3, details: [["stains", 0.2, "#b8ae98"], ["moss", 0.04, "#7d8f5a"]] },
    "facade-ashlar-grey": { name: "Ashlar (granite)", group: "Facade", color: "#a6a6a1", structure: "ashlar", stone: "#9a9a95", line: "#6c6c68", vary: 0.3, details: [["speckle", 10, "#8a8a85"], ["stains", 0.2, "#86867f"]] },
    "facade-rubble": { name: "Rubble stone", group: "Facade", color: "#b5ad9d", structure: "rubble", stone: "#8f8676", line: "#5f584d", vary: 0.45, details: [["moss", 0.1, "#6f8a52"], ["stains", 0.2, "#7d7568"]] },
    "facade-render": { name: "Render (cream)", group: "Facade", color: "#e9dfc9", vary: 0.25, details: [["speckle", 10, "#ddd2ba"], ["stains", 0.2, "#d4c8ae"]] },
    "facade-render-pink": { name: "Render (pastel pink)", group: "Facade", color: "#e6c8bf", vary: 0.25, details: [["speckle", 10, "#dcbcb2"], ["stains", 0.2, "#d3b1a6"]] },
    "facade-render-grey": { name: "Render (grey, aged)", group: "Facade", color: "#b9b6ae", vary: 0.4, details: [["speckle", 12, "#a9a69e"], ["stains", 0.5, "#9a978f"], ["cracks", 0.25, "#7d7a73"], ["soot", 0.15, "#5a5752"]] },
    "facade-timber-frame": { name: "Timber frame", group: "Facade", color: "#ece2cc", structure: "timberframe", line: "#3a2a1e", vary: 0.2, details: [["stains", 0.15, "#d6cbb2"]] },
    "facade-logs": { name: "Log wall", group: "Facade", color: "#8f6640", structure: "logs", line: "#5a3c24", vary: 0.35, details: [["scratches", 0.3, "#6e4e30"]] },
    "facade-concrete": { name: "Concrete panels", group: "Facade", color: "#aaa9a4", structure: "panels", line: "#7d7c77", vary: 0.25, details: [["stains", 0.3, "#94938e"], ["speckle", 6, "#9c9b96"]] },
    "facade-glass": { name: "Glass curtain wall", group: "Facade", color: "#6f8f9f", structure: "glass", stone: "#86a8b8", line: "#3a4650", vary: 0.3, details: [] },
    "facade-corrugated": { name: "Corrugated cladding (green)", group: "Facade", color: "#5f7a62", structure: "corrugated", stone: "#6f8f72", line: "#3f5442", vary: 0.3, details: [["rust", 0.08, "#8a4a26"]] },
    "facade-metal": { name: "Metal cladding", group: "Facade", color: "#6f7880", structure: "seam", stone: "#7d8790", line: "#4a5158", vary: 0.25, details: [["stains", 0.15, "#636b72"]] },
    "facade-hung-tiles": { name: "Hung tiles", group: "Facade", color: "#a5583e", structure: "rooftiles", stone: "#b0603f", line: "#6e3524", vary: 0.35, details: [["moss", 0.06, "#6f8a52"]] },
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
    const natural = (t.structure ?? "none") === "none" || !!t.soft;
    const continuous = !!TILE_STRUCTURES[t.structure];
    const k0 = natural ? 0.15 : 0.3;
    const j = { h: (r() - 0.5) * 12 * v * k0, l: (r() - 0.5) * 0.08 * v * k0, s: (r() - 0.5) * 0.3 * v * k0 };
    const col = (hex, dl = 0) => paint(hex, t, { ...j, l: j.l + dl });
    const c = Object.assign((hex, dl) => col(hex, dl), { base: t.color, line: t.line ?? t.color, stone: t.stone ?? t.color, dark: t.dark ?? "#2f2c29", accent: t.accent ?? "#c9a14a" });
    const base = continuous ? "" : `<rect width="64" height="64" fill="${col(t.color)}"/>` + (STRUCTURES[t.structure ?? "none"] ?? STRUCTURES.none)(r, c);
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

/** The continuous floor layer of a texture whose structure crosses squares: pattern `fl-<id>` of period × period squares */
function continuousLayer(t) {
    const ts = TILE_STRUCTURES[t.structure];
    if (!ts) return null;
    const P = ts.period * CELL;
    const r = rng(hashStr(`${t.id}:${t.age ?? 0}:${t.tint ?? ""}:floor`) || 1);
    const col = (hex, dl = 0) => paint(hex, t, { h: 0, l: dl, s: 0 });
    const c = Object.assign((hex, dl) => col(hex, dl), { base: t.color, line: t.line ?? t.color, stone: t.stone ?? t.color, dark: t.dark ?? "#2f2c29", accent: t.accent ?? "#c9a14a" });
    // the variation setting widens how far each piece's shade can drift
    const v = (t.vary ?? 0.3) / 0.3;
    const cv = Object.assign((hex, dl = 0) => col(hex, dl * v), c);
    return `<pattern id="fl-${t.id}" width="${P}" height="${P}" patternUnits="userSpaceOnUse"><rect width="${P}" height="${P}" fill="${col(t.color)}"/>${ts.draw(r, cv, P)}</pattern>`;
}

/** Defs for a texture: VARIANTS symbols and the repeating tile `f-<id>` that scatters them */
const variantCount = (t) => ((t.vary ?? 0) === 0 && !(t.details ?? []).length && (t.age ?? 0) === 0 ? 1 : VARIANTS);
export function texturePattern(id, custom = {}) {
    const t = resolveTexture(id, custom) ?? { id, ...TEXTURES.void };
    const layer = continuousLayer(t);
    const n = variantCount(t);
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
        if (!layer) bases += use("fb", k, x, y);
        overs += use("fv", k, x, y);
    }
    if (layer) bases = `<rect width="${TILE * CELL}" height="${TILE * CELL}" fill="url(#fl-${id})"/>`;
    return `${s}${layer ?? ""}<pattern id="f-${id}" width="${TILE * CELL}" height="${TILE * CELL}" patternUnits="userSpaceOnUse">${bases}${overs}</pattern>`;
}
// ------------------------------------------------------------------ floors square by square
// The repeating tile (f-<id>) shows a pattern from far away. Painted floors and terrain are instead drawn square by
// square: each square's base and variation are picked from its own position, so nothing repeats, and soft light and
// dark patches placed by position (macroSvg) break up large areas. Uses the same symbols as the tile.
const hash3 = (a, b, c) => { let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
const texInfo = (f, custom, cache) => {
    let t = cache.get(f);
    if (!t) { const tx = resolveTexture(f, custom); t = { n: tx ? variantCount(tx) : 1, cont: !!(tx && TILE_STRUCTURES[tx.structure]), h: hashStr(f) }; cache.set(f, t); }
    return t;
};
/** cells: [[c, r, floorId]] → markup (bases of every square, then their details, which may spill over edges; clipId keeps them inside) */
export function floorCellsSvg(cells, custom = {}, size = CELL, clipId = null) {
    const info = new Map();
    let bases = "", overs = "";
    for (const [c, r, f] of cells) {
        const t = texInfo(f, custom, info), k = hash3(c, r, t.h) % t.n, x = c * size, y = r * size;
        const ref = (pre) => `href="#${pre}-${f}-${k}" xlink:href="#${pre}-${f}-${k}" x="${x}" y="${y}" width="${size}" height="${size}"`;
        bases += t.cont ? `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="url(#fl-${f})"/>` : `<use ${ref("fb")}/>`;
        overs += `<use ${ref("fv")}/>`;
    }
    return bases + (clipId ? `<g clip-path="url(#${clipId})">${overs}</g>` : overs);
}
export const MACRO_DEFS = `<radialGradient id="mgl"><stop offset="0" stop-color="#fff" stop-opacity=".055"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><radialGradient id="mgd"><stop offset="0" stop-color="#000" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`;
const MACRO = CELL * 4;
/** Soft light and dark patches over {x, y, w, h}, placed by position (seamless between neighbouring areas) */
/** The patches over an area: [{cx, cy, rx, ry, rot, dark}] (the same everywhere they are drawn) */
export function macroBlobs(x, y, w, h) {
    const out = [];
    for (let gy = Math.floor(y / MACRO) - 1; gy <= Math.ceil((y + h) / MACRO); gy++) for (let gx = Math.floor(x / MACRO) - 1; gx <= Math.ceil((x + w) / MACRO); gx++) {
        const r = rng(hash3(gx, gy, 9173) || 1);
        for (let i = 0, m = 1 + Math.floor(r() * 2); i < m; i++) {
            const cx = (gx + r()) * MACRO, cy = (gy + r()) * MACRO, rx = MACRO * (0.6 + r() * 0.9), ry = MACRO * (0.5 + r() * 0.8);
            out.push({ cx, cy, rx, ry, rot: Math.round(r() * 180), dark: r() < 0.5 });
        }
    }
    return out;
}
/** k: patchStrength of the floor underneath */
export function macroSvg(x, y, w, h, k = { light: 1, dark: 1 }) {
    return macroBlobs(x, y, w, h).map((b) => {
        const a = b.dark ? k.dark : k.light;
        if (a <= 0) return "";
        return `<ellipse cx="${n1(b.cx)}" cy="${n1(b.cy)}" rx="${n1(b.rx)}" ry="${n1(b.ry)}" transform="rotate(${b.rot} ${n1(b.cx)} ${n1(b.cy)})" fill="url(#mg${b.dark ? "d" : "l"})"${a !== 1 ? ` opacity="${+a.toFixed(3)}"` : ""}/>`;
    }).join("");
}
export const MACRO_ALPHA = { light: 0.055, dark: 0.06 };
const strengthCache = new Map();
/**
 * How strong a floor's patches are ({light, dark}, multipliers of MACRO_ALPHA). Light patches fade on dark floors:
 * on near-black even a faint light patch reads as a glow, so Darkness keeps only a trace. A texture's `patches`
 * (a number) multiplies both.
 */
export function patchStrength(id, custom = {}) {
    const key = `${id}|${JSON.stringify(custom?.[id] ?? null)}`;
    if (strengthCache.has(key)) return strengthCache.get(key);
    const t = resolveTexture(id, custom);
    let hex = /^#[0-9a-f]{3,6}$/i.test(t?.color ?? "") ? t.color : "#808080";
    if (hex.length === 4) hex = `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
    const [r, g, b] = hexRgb(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const m = typeof t?.patches === "number" ? t.patches : 1;
    const out = { light: m * Math.min(1, Math.max(0.12, lum / 0.12)), dark: m };
    strengthCache.set(key, out);
    return out;
}

// ---- for drawing floors on a canvas (the editor): sprite sheets of a texture's variations
/** which variation a square shows: (c, r, floorId) -> {k, n, cont} */
export function squarePicker(custom = {}) {
    const info = new Map();
    return (c, r, f) => { const t = texInfo(f, custom, info); return { k: hash3(c, r, t.h) % t.n, n: t.n, cont: t.cont }; };
}
/** period of a texture's continuous floor layer in map px (planks, cobbles…), or 0 */
export function continuousPeriod(id, custom = {}) { const t = resolveTexture(id, custom); return t && TILE_STRUCTURES[t.structure] ? TILE_STRUCTURES[t.structure].period * CELL : 0; }
export const SHEET = { cols: 8, rows: 4, overPad: 32 };
/**
 * A texture's variations as one sheet (map units, drawn at `scale`): bases in a cols × rows grid of 64 squares at the top
 * (y 0..256), details below (y 256..) in a grid of 128 squares, each detail drawn 32 in from its box so spill fits.
 */
export function spriteSheetSvg(id, custom = {}, scale = 1) {
    const W = SHEET.cols * 128, H = SHEET.rows * 64 + SHEET.rows * 128;
    let uses = "";
    for (let k = 0; k < SHEET.cols * SHEET.rows; k++) {
        const cx = k % SHEET.cols, cy = Math.floor(k / SHEET.cols);
        const ref = (pre, x, y) => `<use href="#${pre}-${id}-${k}" xlink:href="#${pre}-${id}-${k}" x="${x}" y="${y}" width="64" height="64"/>`;
        uses += ref("fb", cx * 64, cy * 64) + ref("fv", cx * 128 + SHEET.overPad, SHEET.rows * 64 + cy * 128 + SHEET.overPad);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${Math.ceil(W * scale)}" height="${Math.ceil(H * scale)}"><defs>${texturePatternCached(id, custom)}</defs>${uses}</svg>`;
}
/** One layer of a texture as a stand-alone SVG: "fl" (continuous floor, period × period) or "f" (the repeating tile) */
export function textureLayerSvg(id, custom = {}, which = "f", scale = 1) {
    const P = which === "fl" ? continuousPeriod(id, custom) : TILE_PX;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${P} ${P}" width="${Math.ceil(P * scale)}" height="${Math.ceil(P * scale)}"><defs>${texturePatternCached(id, custom)}</defs><rect width="${P}" height="${P}" fill="url(#${which}-${id})"/></svg>`;
}
/** Painted squares (a layer's `floor`, or a list) with their patches, clipped to the squares */
export function paintedFloorSvg(entries, custom = {}, clipId = "pf") {
    if (!entries.length) return "";
    const cells = entries.map(([k, f]) => { const [c, r] = k.split(",").map(Number); return [c, r, f]; });
    const xs = cells.map((q) => q[0]), ys = cells.map((q) => q[1]);
    const box = { x: Math.min(...xs) * CELL, y: Math.min(...ys) * CELL, w: (Math.max(...xs) - Math.min(...xs) + 1) * CELL, h: (Math.max(...ys) - Math.min(...ys) + 1) * CELL };
    const sq = (list) => list.map(([c, r]) => `M${c * CELL} ${r * CELL}h${CELL}v${CELL}h-${CELL}z`).join("");
    // patches per floor, as strong as that floor allows
    const byFloor = new Map();
    for (const q of cells) { if (!byFloor.has(q[2])) byFloor.set(q[2], []); byFloor.get(q[2]).push(q); }
    const patches = [...byFloor].map(([f, list], i) => {
        const id = `${clipId}-${i}`;
        return `<clipPath id="${id}"><path d="${sq(list)}"/></clipPath><g clip-path="url(#${id})">${macroSvg(box.x, box.y, box.w, box.h, patchStrength(f, custom))}</g>`;
    }).join("");
    return `<clipPath id="${clipId}"><path d="${sq(cells)}"/></clipPath>${floorCellsSvg(cells, custom, CELL, clipId)}${patches}`;
}
/** The terrain of a grid map (or backdrop of a freeform map) square by square over {x, y, w, h}, with patches */
export function terrainCellsSvg(floorId, x, y, w, h, custom = {}) {
    const cells = [];
    for (let r = Math.floor(y / CELL); r < Math.ceil((y + h) / CELL); r++) for (let c = Math.floor(x / CELL); c < Math.ceil((x + w) / CELL); c++) cells.push([c, r, floorId]);
    return floorCellsSvg(cells, custom) + macroSvg(x, y, w, h, patchStrength(floorId, custom));
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
    if (TILE_STRUCTURES[t.structure]) return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${n * 64} ${n * 64}" width="${n * 64}" height="${n * 64}"><defs>${texturePattern(id, custom)}</defs><rect width="${n * 64}" height="${n * 64}" fill="url(#f-${id})"/></svg>`;
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
    "wall-plaster": { name: "Plastered wall", modes: "grid", smooth: false, snap: true, layers: [{ c: "#2b211a", w: 10, cap: "square" }, { c: "#e6dfcf", w: 6, cap: "square" }] },
    "wall-tiled": { name: "Tiled wall", modes: "grid", smooth: false, snap: true, layers: [{ c: "#2b211a", w: 10, cap: "square" }, { c: "#dfe8ea", w: 6, cap: "square" }, { c: "#93a9ae", w: 6, dash: "1 7" }] },
    "wall-concrete": { name: "Concrete wall", modes: "grid", smooth: false, snap: true, layers: [{ c: "#2e2e2c", w: 14, cap: "square" }, { c: "#8e8d87", w: 10, cap: "square" }, { c: "#74736d", w: 10, dash: "1 31" }] },
    "wall-log": { name: "Log wall", modes: "grid", smooth: false, snap: true, layers: [{ c: "#3a2a1e", w: 14, cap: "square" }, { c: "#7a5434", w: 10, cap: "square" }, { c: "#5a3c24", w: 10, dash: "2 12" }] },
    "wall-partition": { name: "Thin partition", modes: "grid", smooth: false, snap: true, layers: [{ c: "#2b211a", w: 6, cap: "square" }, { c: "#cfc6b2", w: 3, cap: "square" }] },
    "wall-glass": { name: "Glass wall", modes: "grid", smooth: false, snap: true, layers: [{ c: "#4f6f7a", w: 5, cap: "square", opacity: 0.85 }, { c: "#cfe9ef", w: 3, cap: "square", opacity: 0.75 }, { c: "#ffffff", w: 1, dash: "10 22", opacity: 0.8 }] },
    "wall-glass-framed": { name: "Framed glass screen", modes: "grid", smooth: false, snap: true, layers: [{ c: "#4f6f7a", w: 5, cap: "square", opacity: 0.85 }, { c: "#cfe9ef", w: 3, cap: "square", opacity: 0.75 }, { c: "#3a3a41", w: 7, dash: "3 29" }] },
    "wall-curtain": { name: "Shower curtain", modes: "grid", smooth: false, snap: true, layers: [{ c: "#8d949b", w: 1.5 }, { c: "#e8eef0", w: 4, dash: "5 2", opacity: 0.9 }] },
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

/**
 * Layers drawn in the current view. current: only the active layer; faded / solid: the layers below it too (faded or not);
 * all: every layer, above and below, solid (you still only edit the active one). Hidden layers never show.
 */
export function viewLayers(doc, { exportAll = false } = {}) {
    const i = Math.max(0, doc.layers.findIndex((l) => l.id === doc.active));
    const all = exportAll || doc.view === "all";
    return doc.layers.map((l, j) => ({
        layer: l,
        shown: !l.hidden && (all || (j === i || (j < i && doc.view !== "current"))),
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
function ribbonBody(o, g, { noFloor = false } = {}) {
    const preset = RIBBONS[o.style] ?? RIBBONS.strip;
    const B = o.box ?? CELL, W = (o.cols ?? preset.cols ?? 2) * B;
    const floor = o.floor === undefined ? preset.floor : o.floor;
    let defs = "", body = "";
    if (floor && !noFloor) {
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
export function ribbonPieces(o, custom = {}, scale = 2, { noFloor = false } = {}) {
    const preset = RIBBONS[o.style] ?? RIBBONS.strip;
    const B = o.box ?? CELL, W = (o.cols ?? preset.cols ?? 2) * B;
    if (!o.pts || o.pts.length < 2) return [];
    const g = curveGeom(o.pts, o.smooth ?? true);
    if (g.L < 1) return [];
    const floor = o.floor === undefined ? preset.floor : o.floor;
    const defs = floor && !noFloor ? texturesDefs([floor], custom) : "";
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
        // floor slices of this piece (for painting the floor elsewhere): polygon + texture angle
        const slices = [];
        if (floor) for (let a = s0; a < s1; a += B) { const b = Math.min(s1, a + B + 0.8); slices.push({ pts: [...g.offsetPts(-W / 2, a, b), ...g.offsetPts(W / 2, a, b).reverse()], angle: angleBucket(g.at((a + b) / 2).a) }); }
        out.push({ x, y, w, h, floor, k: B / CELL, slices, svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${x} ${y} ${w} ${h}" width="${Math.ceil(w * scale)}" height="${Math.ceil(h * scale)}"><defs>${defs}</defs>${ribbonBody(o, sub, { noFloor })}</svg>` });
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

/** Where a stamp's whole image goes (before turning): its box, or for a cropped stamp (`crop` [x, y, w, h] in
 * fractions of the image) the larger area the image fills around that box */
export function stampImageBox(o) {
    if (!o.crop) return { x: o.x, y: o.y, w: o.w, h: o.h };
    const [cx, cy, cw, ch] = o.crop, w = o.w / cw, h = o.h / ch;
    return { x: o.x - cx * w, y: o.y - cy * h, w, h };
}
/**
 * A stamp with its box fitted to `crop` (the part of its image the picture is in, fractions of the whole image), the
 * picture staying exactly where it was however the stamp is turned or flipped. Ports follow.
 */
export function fitStampBox(o, crop) {
    const im = stampImageBox(o), [cx, cy, cw, ch] = crop;
    const w = cw * im.w, h = ch * im.h;
    // the new box's middle, from the old one, in the stamp's own (unturned, unflipped) frame
    let dx = im.x + (cx + cw / 2) * im.w - (o.x + o.w / 2), dy = im.y + (cy + ch / 2) * im.h - (o.y + o.h / 2);
    if (o.flip) dx = -dx;
    const a = ((o.rot ?? 0) * Math.PI) / 180, c = [o.x + o.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), o.y + o.h / 2 + dx * Math.sin(a) + dy * Math.cos(a)];
    const old = o.crop ?? [0, 0, 1, 1];
    const ports = o.ports?.map(([u, v]) => [(old[0] + u * old[2] - cx) / cw, (old[1] + v * old[3] - cy) / ch]);
    return { ...o, x: c[0] - w / 2, y: c[1] - h / 2, w, h, crop: crop.map((v) => Math.round(v * 1e5) / 1e5), ...(ports ? { ports } : {}) };
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
        // a cropped stamp's box is the part of the image with the picture in it; the whole image is drawn around it
        const im = stampImageBox(o);
        const pe = o.crop && ctx.edit ? ' pointer-events="none"' : "";
        const el = ctx.use
            ? `<use href="${href}" x="${n1(im.x)}" y="${n1(im.y)}" width="${n1(im.w)}" height="${n1(im.h)}"${pe}/>`
            : `<image href="${href}" x="${n1(im.x)}" y="${n1(im.y)}" width="${n1(im.w)}" height="${n1(im.h)}" preserveAspectRatio="none"${pe}/>`;
        const hit = pe ? `<rect x="${n1(o.x)}" y="${n1(o.y)}" width="${n1(o.w)}" height="${n1(o.h)}" fill="transparent"/>` : "";
        return `<g${id}${tf ? ` transform="${tf}"` : ""}${o.opacity != null && o.opacity < 1 ? ` opacity="${o.opacity}"` : ""}>${el}${hit}</g>`;
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

/**
 * A room: a box with its own floor, grid (box size `box`) and walls, holding child objects in its own coordinates
 * (0..w, 0..h). It rotates about its centre, and everything inside turns with it.
 */
export function roomSvg(o, ctx, part = "all") {
    if (part === "all") return roomSvg(o, ctx, "base") + roomSvg(o, ctx, "contents");
    const cx = o.w / 2, cy = o.h / 2;
    const tf = `translate(${n1(o.x)} ${n1(o.y)})${o.rot ? ` rotate(${n1(o.rot)} ${n1(cx)} ${n1(cy)})` : ""}`;
    // contents are drawn in a second pass (after every room's floor), so a neighbouring room never covers them;
    // rooms inside a room do the same among themselves: their floors, then what stands in them, then the rest
    if (part === "contents") {
        const kids = o.children ?? [];
        if (!kids.length) return "";
        const rooms = kids.filter((c) => c.type === "room");
        const inner = kids.filter((c) => c.type !== "room" && isFloorLevel(c)).map((c) => objectSvg(c, ctx)).join("")
            + rooms.map((c) => roomSvg(c, ctx, "base")).join("") + rooms.map((c) => roomSvg(c, ctx, "contents")).join("")
            + kids.filter((c) => !isFloorLevel(c)).map((c) => objectSvg(c, ctx)).join("");
        return `<g transform="${tf}">${inner}</g>`;
    }
    // the editor draws a room's floor, painted squares, grid and walls from bitmaps once they are ready
    const img = ctx.roomImage?.(o);
    let s, outline;
    if (img) { s = img; outline = (o.shapes ?? []).some((sh) => !isWallShape(sh)) ? roomOutline(o).d : `M0 0H${n1(o.w)}V${n1(o.h)}H0Z`; }
    else { const base = roomBase(o); s = `${base.defs ? `<defs>${base.defs}</defs>` : ""}${base.body}`; outline = base.outline; }
    if (ctx.edit) s += `<path d="${outline}" fill="transparent" stroke="none" pointer-events="all"/>`;
    return `<g${ctx.edit ? ` data-id="${esc(o.id)}"` : ""} transform="${tf}">${s}</g>`;
}

/** A room's own drawing (room coordinates): floor, painted squares, grid, walls. {defs, body, outline, box: area plus walls, floors} */
export function roomBase(o) {
    const B = o.box ?? CELL;
    const shaped = (o.shapes ?? []).some((sh) => !isWallShape(sh));
    const e = roomExtent(o);
    const mid = `r${hashStr(String(o.id)).toString(36)}`;
    let defs = "", s = "";
    // the room's area: its rectangle plus added shapes minus removed ones, in order (a mask for the floor)
    if (shaped) defs += `<mask id="${mid}a" maskUnits="userSpaceOnUse" x="${e.x - 2}" y="${e.y - 2}" width="${e.w + 4}" height="${e.h + 4}"><rect width="${n1(o.w)}" height="${n1(o.h)}" fill="#fff"/>${(o.shapes ?? []).filter((sh) => !isWallShape(sh)).map((sh) => shapeSvg(sh, sh.op === "sub" ? "#000" : "#fff")).join("")}</mask>`;
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
    // walls follow the outline of that area, left out where openings are
    const wall = roomWallStyle(o);
    const outline = shaped ? roomOutline(o).d : `M0 0H${n1(o.w)}V${n1(o.h)}H0Z`;
    const ww = wall ? Math.max(...wall.layers.map((l) => l.w)) : 0;
    if (wall) {
        const { paths, loose: opens } = roomWalls(o, wall);
        if (opens.length) defs += `<mask id="${mid}o" maskUnits="userSpaceOnUse" x="${e.x - ww}" y="${e.y - ww}" width="${e.w + ww * 2}" height="${e.h + ww * 2}"><rect x="${e.x - ww}" y="${e.y - ww}" width="${e.w + ww * 2}" height="${e.h + ww * 2}" fill="#fff"/>${opens.map((sh) => shapeSvg(sh, "#000")).join("")}</mask>`;
        const strokes = wall.layers.map((l, j) => (paths[j] ? `<path d="${paths[j]}" fill="none" stroke="${l.c}" stroke-width="${l.w}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ""}${l.opacity ? ` opacity="${l.opacity}"` : ""} stroke-linejoin="miter"/>` : "")).join("");
        s += opens.length ? `<g mask="url(#${mid}o)">${strokes}</g>` : strokes;
    }
    const pad = ww / 2 + 2;
    return { defs, body: s, outline, floors, box: { x: Math.floor(e.x - pad), y: Math.floor(e.y - pad), w: Math.ceil(e.w + pad * 2) + 1, h: Math.ceil(e.h + pad * 2) + 1 } };
}
/** What decides a room's bitmap (not its position or angle, so moving and turning it reuse the image) */
export const roomLookKey = (o) => JSON.stringify([o.id, o.w, o.h, o.box, o.floor, o.wall, o.wallScale, o.grid, o.cells, o.shapes]);
/** A room's wall style with its thickness applied (`wallScale` multiplies every layer's width; null without walls) */
export function roomWallStyle(o) {
    const w = PATH_STYLES[o.wall];
    const k = o.wallScale ?? 1;
    if (!w || k === 1) return w ?? null;
    return { ...w, layers: w.layers.map((l) => ({ ...l, w: l.w * k })) };
}
/** A room's base drawing as a stand-alone SVG (for one bitmap); textures from `custom` */
export function roomBaseSvg(o, custom = {}, scale = 2) {
    const b = roomBase(o);
    return { ...b.box, svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${b.box.x} ${b.box.y} ${b.box.w} ${b.box.h}" width="${Math.ceil(b.box.w * scale)}" height="${Math.ceil(b.box.h * scale)}"><defs>${texturesDefs(b.floors, custom)}${b.defs}</defs>${b.body}</svg>` };
}

const n1r = (v) => Math.round(v * 10000) / 10000;
/** A pattern that reuses texture `f-<floor>` with a transform (rotated for ribbons, scaled for small or large boxes) */
const scaledPattern = (id, floor, transform) => `<pattern id="${id}" href="#f-${floor}" xlink:href="#f-${floor}" patternTransform="${transform}"/>`;

/**
 * A window drawn for its size: w along the wall, h across it (the wall line through the middle), `panes` panes of
 * glass. Frame sizes follow h (one box deep), so a wide window keeps a slim frame. As a data URI for a stamp's src.
 */
export function windowStampSrc(w, h, panes) {
    const k = h / CELL, j = 6 * k, cy = h / 2, n = Math.max(1, Math.round(panes)), pane = (w - 2 * j) / n;
    const mullions = Array.from({ length: n - 1 }, (_, i) => `M${n1(j + pane * (i + 1))} ${n1(cy - 4 * k)}V${n1(cy + 4 * k)}`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n1(w)} ${n1(h)}" width="${n1(w)}" height="${n1(h)}">`
        + `<rect x="0" y="${n1(cy - 6 * k)}" width="${n1(j)}" height="${n1(12 * k)}" fill="#2b211a"/><rect x="${n1(w - j)}" y="${n1(cy - 6 * k)}" width="${n1(j)}" height="${n1(12 * k)}" fill="#2b211a"/>`
        + `<rect x="${n1(j)}" y="${n1(cy - 4 * k)}" width="${n1(w - 2 * j)}" height="${n1(8 * k)}" rx="${n1(k)}" fill="#bcdde4" stroke="#2b211a" stroke-width="${n1(1.5 * k)}"/>`
        + (mullions ? `<path d="${mullions}" stroke="#2b211a" stroke-width="${n1(1.5 * k)}" stroke-linecap="round"/>` : "") + `</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
/** What doors placed by the opening tool are made of */
export const DOOR_MATERIALS = {
    wood: { name: "Wood", fill: "#9a6a3a", line: "#2b211a" },
    oak: { name: "Light wood", fill: "#c08e55", line: "#2b211a" },
    "dark-wood": { name: "Dark wood", fill: "#5e3d22", line: "#1e1712" },
    glass: { name: "Glass", fill: "#bcdde4", line: "#4f6f7a", opacity: 0.7, glint: true },
    frosted: { name: "Frosted glass", fill: "#e3ecee", line: "#7d969c", opacity: 0.9 },
    steel: { name: "Steel", fill: "#9aa0a8", line: "#2b2b30" },
    iron: { name: "Iron", fill: "#4a4a52", line: "#1c1c20" },
    brass: { name: "Brass", fill: "#c9a14a", line: "#5e4518" },
    paper: { name: "Paper screen", fill: "#f1ead8", line: "#6e4826", lattice: true },
};
/**
 * A door drawn for its opening: L wide (along the wall), box size B (frame sizes follow B), made of `material`.
 * {svg, src (data URI), w, h, ox}: the stamp is w × h with the wall line through its middle, the opening running from
 * ox to ox + L. Sliding doors are drawn half open: the panel covers the whole opening when closed, so half of it
 * runs on past the opening (along the wall face, or into the wall for pocket doors). A glass sliding door fills the
 * opening with `panels` glass panels (2-4) in frames of `material`: the end ones fixed, the inner ones sliding over
 * them on a second track.
 */
export function doorStamp(kind, L, B, material = "wood", panels = 2) {
    const k = B / CELL, j = 6 * k, clear = L - 2 * j, m = DOOR_MATERIALS[material] ?? DOOR_MATERIALS.wood, K = "#2b211a";
    const jamb = (x, cy) => `<rect x="${n1(x)}" y="${n1(cy - 6 * k)}" width="${n1(j)}" height="${n1(12 * k)}" fill="${K}"/>`;
    // a panel; `hidden` ones (inside a wall) are dashed and faint
    const panel = (x, y, w, h, hidden = false) => {
        if (w < 0.5 || h < 0.5) return "";
        let out = `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" rx="${n1(k)}" fill="${m.fill}"${m.opacity || hidden ? ` fill-opacity="${hidden ? 0.45 : m.opacity}"` : ""} stroke="${m.line}" stroke-width="${n1(1.3 * k)}"${hidden ? ` stroke-dasharray="${n1(4 * k)} ${n1(2 * k)}"` : ""}/>`;
        if (hidden) return out;
        const long = Math.max(w, h), along = w >= h, n = Math.floor(long / (12 * k));
        if (m.lattice && n > 1) out += `<path d="${Array.from({ length: n - 1 }, (_, i) => { const t = (long / n) * (i + 1); return along ? `M${n1(x + t)} ${n1(y)}V${n1(y + h)}` : `M${n1(x)} ${n1(y + t)}H${n1(x + w)}`; }).join("")}" stroke="${m.line}" stroke-width="${n1(0.8 * k)}"/>`;
        if (m.glint) out += along ? `<path d="M${n1(x + w * 0.15)} ${n1(y + h / 2)}H${n1(x + w * 0.35)}" stroke="#fff" stroke-width="${n1(0.9 * k)}" opacity=".8"/>`
            : `<path d="M${n1(x + w / 2)} ${n1(y + h * 0.15)}V${n1(y + h * 0.35)}" stroke="#fff" stroke-width="${n1(0.9 * k)}" opacity=".8"/>`;
        return out;
    };
    const arrow = (x0, x1, y) => { const d = Math.sign(x1 - x0) * 4 * k; return `<path d="M${n1(x0)} ${n1(y)}H${n1(x1)}M${n1(x1 - d)} ${n1(y - 3 * k)}L${n1(x1)} ${n1(y)}L${n1(x1 - d)} ${n1(y + 3 * k)}" fill="none" stroke="${K}" stroke-width="${n1(1.2 * k)}" stroke-linecap="round"/>`; };
    const track = (x0, x1, y, c = K, w = 1) => `<path d="M${n1(x0)} ${n1(y)}H${n1(x1)}" stroke="${c}" stroke-width="${n1(w * k)}"${c === K ? ` stroke-dasharray="${n1(2 * k)} ${n1(3 * k)}"` : ""}/>`;
    // a panel from a to b (along the wall, at y..y+t), dashed where it runs inside the wall (beyond lo..hi)
    const inWall = (a, b, y, t, lo, hi) => panel(Math.max(a, lo), y, Math.min(b, hi) - Math.max(a, lo), t) + panel(a, y, Math.min(b, lo) - a, t, true) + panel(Math.max(a, hi), y, b - Math.max(a, hi), t, true);
    let W, H, ox = 0, body;
    switch (kind) {
        case "door": {
            H = 2 * L; W = L; const cy = L;
            body = jamb(0, cy) + jamb(L - j, cy) + `<path d="M${n1(L - j)} ${n1(cy)}A${n1(clear)} ${n1(clear)} 0 0 0 ${n1(j)} ${n1(cy - clear)}" fill="none" stroke="${K}" stroke-width="${n1(1.2 * k)}" stroke-dasharray="${n1(3 * k)} ${n1(3 * k)}"/>`
                + panel(j, cy - clear, 7 * k, clear);
            break;
        }
        case "double-door": {
            H = L; W = L; const cy = L / 2, leaf = clear / 2;
            body = jamb(0, cy) + jamb(L - j, cy) + `<path d="M${n1(L / 2)} ${n1(cy)}A${n1(leaf)} ${n1(leaf)} 0 0 0 ${n1(j)} ${n1(cy - leaf)}M${n1(L / 2)} ${n1(cy)}A${n1(leaf)} ${n1(leaf)} 0 0 1 ${n1(L - j)} ${n1(cy - leaf)}" fill="none" stroke="${K}" stroke-width="${n1(1.2 * k)}" stroke-dasharray="${n1(3 * k)} ${n1(3 * k)}"/>`
                + panel(j, cy - leaf, 7 * k, leaf) + panel(L - j - 7 * k, cy - leaf, 7 * k, leaf);
            break;
        }
        case "sliding-door": {
            // one panel on the room side of the wall, overlapping both jambs
            H = B; const cy = B / 2, P = clear + 4 * k, x = j - 2 * k + P / 2;
            W = x + P + 2 * k;
            body = jamb(0, cy) + jamb(L - j, cy) + track(j, W - 2 * k, cy + 9.5 * k) + panel(x, cy + 7 * k, P, 5 * k) + arrow(j + 4 * k, j + 4 * k + clear / 3, cy + 19 * k);
            break;
        }
        case "double-sliding-door": {
            // two panels parting in the middle, each sliding half its length away from it
            H = B; const cy = B / 2, P = L / 2 - j + 2 * k;
            ox = Math.max(0, P / 2 - j + 4 * k); W = L + 2 * ox;
            const a = ox + j - 2 * k - P / 2, b = ox + L / 2 + P / 2;
            body = jamb(ox, cy) + jamb(ox + L - j, cy) + track(2 * k, W - 2 * k, cy + 9.5 * k) + panel(a, cy + 7 * k, P, 5 * k) + panel(b, cy + 7 * k, P, 5 * k)
                + arrow(ox + L / 2 - 4 * k, ox + L / 2 - 4 * k - clear / 4, cy + 19 * k) + arrow(ox + L / 2 + 4 * k, ox + L / 2 + 4 * k + clear / 4, cy + 19 * k);
            break;
        }
        case "pocket-door": {
            // the panel slides into a pocket in the wall beyond the opening; the part inside the wall is dashed
            H = B; const cy = B / 2, P = clear + 2 * k, x = j + P / 2;
            W = x + P + 4 * k;
            body = jamb(0, cy) + `<rect x="${n1(L - j)}" y="${n1(cy - 3.5 * k)}" width="${n1(W - L + j - 2 * k)}" height="${n1(7 * k)}" fill="none" stroke="${K}" stroke-width="${n1(0.8 * k)}" stroke-dasharray="${n1(2 * k)} ${n1(2 * k)}"/>`
                + inWall(x, x + P, cy - 2.5 * k, 5 * k, j, L - j) + arrow(j + 4 * k, j + 4 * k + clear / 3, cy + 16 * k);
            break;
        }
        case "double-pocket-door": {
            H = B; const cy = B / 2, P = clear / 2 + k;
            ox = P + 4 * k; W = L + 2 * ox;
            const lo = ox + j, hi = ox + L - j, a = lo - P / 2, b = ox + L / 2 + P / 2;
            body = `<rect x="${n1(lo - P - 2 * k)}" y="${n1(cy - 3.5 * k)}" width="${n1(P + 2 * k)}" height="${n1(7 * k)}" fill="none" stroke="${K}" stroke-width="${n1(0.8 * k)}" stroke-dasharray="${n1(2 * k)} ${n1(2 * k)}"/>`
                + `<rect x="${n1(hi)}" y="${n1(cy - 3.5 * k)}" width="${n1(P + 2 * k)}" height="${n1(7 * k)}" fill="none" stroke="${K}" stroke-width="${n1(0.8 * k)}" stroke-dasharray="${n1(2 * k)} ${n1(2 * k)}"/>`
                + inWall(a, a + P, cy - 2.5 * k, 5 * k, lo, hi) + inWall(b, b + P, cy - 2.5 * k, 5 * k, lo, hi)
                + arrow(ox + L / 2 - 4 * k, ox + L / 2 - 4 * k - clear / 4, cy + 16 * k) + arrow(ox + L / 2 + 4 * k, ox + L / 2 + 4 * k + clear / 4, cy + 16 * k);
            break;
        }
        case "barn-door": {
            // a panel hanging from a rail on the wall face, wider than the opening
            H = B; const cy = B / 2, P = clear + 8 * k, x = j - 4 * k + P / 2;
            W = x + P + 4 * k;
            body = jamb(0, cy) + jamb(L - j, cy) + track(2 * k, W - 2 * k, cy + 9 * k, "#3a3a41", 2.5) + panel(x, cy + 8 * k, P, 8 * k)
                + `<circle cx="${n1(x + 6 * k)}" cy="${n1(cy + 9 * k)}" r="${n1(2.5 * k)}" fill="#5d5d66" stroke="${K}" stroke-width="${n1(k)}"/><circle cx="${n1(x + P - 6 * k)}" cy="${n1(cy + 9 * k)}" r="${n1(2.5 * k)}" fill="#5d5d66" stroke="${K}" stroke-width="${n1(k)}"/>`
                + arrow(j + 4 * k, j + 4 * k + clear / 3, cy + 24 * k);
            break;
        }
        case "glass-sliding-door": {
            H = B; W = L; const cy = B / 2, n = Math.max(2, Math.min(4, Math.round(panels))), p = clear / n + 2 * k;
            const frame = material === "glass" ? "#7d8a8f" : m.fill;
            const pane = (x, y) => `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(p)}" height="${n1(4 * k)}" fill="#bcdde4" fill-opacity=".75" stroke="${frame}" stroke-width="${n1(1.6 * k)}"/>`
                + `<path d="M${n1(x + p * 0.2)} ${n1(y + 2 * k)}H${n1(x + p * 0.4)}" stroke="#fff" stroke-width="${n1(0.8 * k)}" opacity=".8"/>`;
            // which panels slide and which way (half their width, over the fixed ones); the rest stay put
            const moves = n === 2 ? [1, 0] : n === 3 ? [0, 1, 0] : [0, -1, 1, 0];
            const x0 = (i) => j + (i * clear) / n - k;
            body = jamb(0, cy) + jamb(L - j, cy)
                + moves.map((d, i) => (d ? "" : pane(x0(i), cy - 4.5 * k))).join("")
                + moves.map((d, i) => (d ? pane(x0(i) + (d * p) / 2, cy + 0.5 * k) : "")).join("")
                + moves.map((d, i) => (d ? arrow(x0(i) + p / 2, x0(i) + p / 2 + (d * p) / 3, cy + 14 * k) : "")).join("");
            break;
        }
        default: return null;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n1(W)} ${n1(H)}" width="${n1(W)}" height="${n1(H)}">${body}</svg>`;
    return { svg, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, w: W, h: H, ox };
}
/** Openings and wall pieces ({op: open | wall, cx, cy, len, thick, rot}) change the walls, not the room's area */
export const isWallShape = (sh) => sh.op === "open" || sh.op === "wall";
/** Markup of a room shape (in room coordinates): rect {x, y, w, h}, circle {cx, cy, r}, poly {pts}, open/wall {cx, cy, len, thick, rot} */
export function shapeSvg(sh, fill) {
    if (sh.shape === "circle") return `<circle cx="${n1(sh.cx)}" cy="${n1(sh.cy)}" r="${n1(sh.r)}" fill="${fill}"/>`;
    if (sh.shape === "poly") return `<path d="M${sh.pts.map((p) => `${n1(p[0])} ${n1(p[1])}`).join("L")}Z" fill="${fill}"/>`;
    if (isWallShape(sh)) return `<rect x="${n1(sh.cx - sh.len / 2)}" y="${n1(sh.cy - sh.thick / 2)}" width="${n1(sh.len)}" height="${n1(sh.thick)}" fill="${fill}" transform="rotate(${n1(sh.rot ?? 0)} ${n1(sh.cx)} ${n1(sh.cy)})"/>`;
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
    const key = JSON.stringify([o.w, o.h, (o.shapes ?? []).filter((s) => !isWallShape(s))]);
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
// spans [lo, hi] along one wall: add one (merging what it touches), or cut one out
const addSpan = (spans, lo, hi) => {
    const out = [];
    for (const [a, b] of spans) { if (b < lo || a > hi) out.push([a, b]); else { lo = Math.min(lo, a); hi = Math.max(hi, b); } }
    return [...out, [lo, hi]].sort((x, y) => x[0] - y[0]);
};
const cutSpan = (spans, lo, hi) => spans.flatMap(([a, b]) => (b <= lo || a >= hi ? [[a, b]] : [...(a < lo ? [[a, lo]] : []), ...(b > hi ? [[hi, b]] : [])]));
/**
 * A room's walls along its outline, with the gaps its openings cut left out: {paths: one path per wall layer (room
 * coordinates), loose: openings that no longer sit on any wall, masked as before}. A gap stays on the wall it sits on
 * and stops half a wall short of that wall's ends, so the wall meeting it there stays whole; gaps that reach a corner
 * from both sides take the corner with them. At every cut end the inner layers stop short of the outer one, so the
 * wall's border closes over the end. Openings only ever take wall away (overlapping ones merge into one gap); a wall
 * piece (op: wall) puts it back where it lies, in the order they were placed.
 */
export function roomWalls(o, wall) {
    const ww = Math.max(...wall.layers.map((l) => l.w));
    const loops = (o.shapes ?? []).some((sh) => !isWallShape(sh)) ? roomOutline(o).loops : [[[0, 0], [o.w, 0], [o.w, o.h], [0, o.h]]];
    const pt = (p) => `${n1(p[0])} ${n1(p[1])}`;
    const pieces = (o.shapes ?? []).filter(isWallShape);
    if (!pieces.some((sh) => sh.op === "open")) { const d = loops.map((l) => `M${l.map(pt).join("L")}Z`).join(""); return { paths: wall.layers.map(() => d), loose: [] }; }
    const spans = loops.map((loop) => loop.map(() => [])), loose = [];
    for (const sh of pieces) {
        const a = ((sh.rot ?? 0) * Math.PI) / 180, u = [Math.cos(a), Math.sin(a)];
        // the wall segment the piece lies along: parallel to it and nearest its centre
        let best = null;
        loops.forEach((loop, li) => { for (let i = 0; i < loop.length; i++) {
            const p = loop[i], q = loop[(i + 1) % loop.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
            if (l < 1e-6 || Math.abs((dx * u[1] - dy * u[0]) / l) > 0.02) continue;
            const dist = Math.abs((sh.cx - p[0]) * u[1] - (sh.cy - p[1]) * u[0]);
            if (dist > sh.thick / 2 || (best && dist >= best.dist)) continue;
            best = { li, i, dist, p, d: [dx / l, dy / l], l };
        } });
        if (!best) { if (sh.op === "open") loose.push(sh); continue; }
        const list = spans[best.li], t = (sh.cx - best.p[0]) * best.d[0] + (sh.cy - best.p[1]) * best.d[1];
        if (sh.op === "wall") { list[best.i] = cutSpan(list[best.i], t - sh.len / 2, t + sh.len / 2); continue; }
        const lo = Math.max(t - sh.len / 2, ww / 2), hi = Math.min(t + sh.len / 2, best.l - ww / 2);
        if (hi - lo >= 0.5) list[best.i] = addSpan(list[best.i], lo, hi);
    }
    const paths = wall.layers.map(() => []);
    loops.forEach((loop, li) => {
        const n = loop.length, len = loop.map((p, i) => { const q = loop[(i + 1) % n]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
        const sp = spans[li].map((list) => list.filter(([lo, hi]) => hi - lo >= 0.5).map((x) => [...x]));
        // gaps reaching a corner from both sides take the corner with them
        const near = ww / 2 + 0.5;
        for (let i = 0; i < n; i++) {
            const k = (i - 1 + n) % n, a = sp[k].at(-1), b = sp[i][0];
            if (a && b && a[1] >= len[k] - near && b[0] <= near) { a[1] = len[k]; b[0] = 0; }
        }
        // the gaps along the whole loop (arc length from its first point), merged
        const start = [0];
        for (let i = 0; i < n; i++) start.push(start[i] + len[i]);
        const total = start[n];
        const gaps = [];
        for (const [lo, hi] of sp.flatMap((list, i) => list.map(([a, b]) => [start[i] + a, start[i] + b])).sort((x, y) => x[0] - y[0])) {
            if (gaps.length && lo <= gaps.at(-1)[1] + 1e-6) gaps.at(-1)[1] = Math.max(gaps.at(-1)[1], hi); else gaps.push([lo, hi]);
        }
        if (!gaps.length) { const d = `M${loop.map(pt).join("L")}Z`; paths.forEach((p) => p.push(d)); return; }
        const at = (s) => {
            s = ((s % total) + total) % total;
            let i = 0;
            while (i < n - 1 && s > start[i + 1]) i++;
            const p = loop[i], q = loop[(i + 1) % n], f = len[i] ? (s - start[i]) / len[i] : 0;
            return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
        };
        // the wall left between one gap and the next, each layer trimmed so the outer one closes over its ends
        gaps.forEach((g, k) => {
            const a = g[1], b = k + 1 < gaps.length ? gaps[k + 1][0] : gaps[0][0] + total;
            wall.layers.forEach((l, j) => {
                const tr = (ww - l.w) / 2, a1 = a + tr, b1 = b - tr;
                if (b1 - a1 < 0.5) return;
                const corners = [...start.slice(0, n).map((v, i) => [v, i]), ...start.slice(0, n).map((v, i) => [v + total, i])]
                    .filter(([v]) => v > a1 + 1e-6 && v < b1 - 1e-6).sort((x, y) => x[0] - y[0]);
                paths[j].push(`M${[at(a1), ...corners.map(([, i]) => loop[i]), at(b1)].map(pt).join("L")}`);
            });
        });
    });
    return { paths: paths.map((p) => p.join("")), loose };
}
/** Nearest point on a room's wall (room coordinates) to p: {p, angle, dist} */
export function nearestWall(o, p) {
    const loops = (o.shapes ?? []).some((sh) => !isWallShape(sh)) ? roomOutline(o).loops : [[[0, 0], [o.w, 0], [o.w, o.h], [0, o.h]]];
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
/**
 * A room inside other rooms as seen on the map: the same room with x, y and rot combined with the room around it
 * (`parent`, itself already on the map, or null), so toRoom / fromRoom / inRoom work at any depth.
 */
export function worldRoom(room, parent) {
    if (!parent) return room;
    const c = fromRoom(parent, [room.x + room.w / 2, room.y + room.h / 2]);
    return { ...room, x: c[0] - room.w / 2, y: c[1] - room.h / 2, rot: ((((parent.rot ?? 0) + (room.rot ?? 0)) % 360) + 360) % 360 };
}
/** every object of a list, with the things inside rooms (at any depth) */
export const allObjects = (objs) => (objs ?? []).flatMap((o) => (o.type === "room" ? [o, ...allObjects(o.children)] : [o]));

/** Anchor point of an object (where it "is" when deciding which room holds it) */
export function anchorOf(o) {
    if (o.type === "stamp" || o.type === "room") return [o.x + o.w / 2, o.y + o.h / 2];
    if (o.pts) { const b = bounds(o); return [b.x + b.w / 2, b.y + b.h / 2]; }
    return [o.x, o.y];
}
/** Re-express an object from one room's coordinates (null = the map) in another's */
export function rehome(o, from, to) {
    const conv = (p) => { const w = from ? fromRoom(from, p) : p; return to ? toRoom(to, w) : w; };
    const dRot = (from?.rot ?? 0) - (to?.rot ?? 0);
    if (o.pts) return { ...o, pts: o.pts.map(conv) };
    // stamps and rooms turn about their centre (a room's contents stay in its own coordinates and come along)
    if (o.type === "stamp" || o.type === "room") { const c = conv([o.x + o.w / 2, o.y + o.h / 2]); return { ...o, x: c[0] - o.w / 2, y: c[1] - o.h / 2, rot: (((o.rot ?? 0) + dRot) % 360 + 360) % 360 || undefined }; }
    const c = conv([o.x, o.y]);
    return { ...o, x: c[0], y: c[1], ...(o.type === "text" ? { rot: (((o.rot ?? 0) + dRot) % 360 + 360) % 360 || undefined } : {}) };
}

/**
 * An object mirrored across the line x = c (axis "h", left-right) or y = c ("v", top-bottom), in the coordinates it
 * is in. Mirroring turns things the other way. A room mirrors what it holds in its own coordinates (shapes, painted
 * squares, contents); stamps only have a left-right flip, so top-bottom is that plus half a turn.
 */
export function flipObject(o, axis, c) {
    const m = mirrorFn(axis, c);
    const turn = (r) => (((-(r ?? 0) % 360) + 360) % 360) || undefined;
    if (o.pts) return { ...o, pts: o.pts.map(m) };
    if (o.type === "stamp" || o.type === "room") {
        const [cx, cy] = m([o.x + o.w / 2, o.y + o.h / 2]);
        const moved = { ...o, x: cx - o.w / 2, y: cy - o.h / 2 };
        if (o.type === "stamp") return { ...moved, flip: !o.flip || undefined, rot: turn(axis === "h" ? o.rot : (o.rot ?? 0) + 180) };
        return { ...moved, rot: turn(o.rot), ...flipRoomInside(o, axis) };
    }
    const [x, y] = m([o.x, o.y]);
    return { ...o, x, y, ...(o.type === "text" ? { rot: turn(o.rot) } : {}) };
}
/**
 * An object turned by `deg` (clockwise on screen) about c, in the coordinates it is in. A square-set room turned by
 * quarter turns is turned for real (width and height swap, what it holds turns inside it), so it stays on its grid;
 * other rooms, stamps and text turn by their `rot`.
 */
export function turnObject(o, deg, c) {
    const turn = (p) => rotateAbout(p, c, deg);
    const add = (r) => ((((r ?? 0) + deg) % 360) + 360) % 360 || undefined;
    if (o.pts) return { ...o, pts: o.pts.map(turn) };
    if (o.type === "stamp" || o.type === "room") {
        const [cx, cy] = turn([o.x + o.w / 2, o.y + o.h / 2]);
        if (o.type === "room" && !o.rot && deg % 90 === 0) {
            const odd = Math.abs(deg / 90) % 2 === 1, w = odd ? o.h : o.w, h = odd ? o.w : o.h;
            return { ...o, ...turnRoomInside(o, deg, w, h), x: cx - w / 2, y: cy - h / 2, w, h };
        }
        return { ...o, x: cx - o.w / 2, y: cy - o.h / 2, rot: add(o.rot) };
    }
    const [x, y] = turn([o.x, o.y]);
    return { ...o, x, y, ...(o.type === "text" ? { rot: add(o.rot) } : {}) };
}
/** p turned about c (exact for quarter turns, so grid positions stay whole numbers) */
const rotateAbout = ([x, y], [cx, cy], deg) => {
    const q = deg % 90 === 0 ? ((deg / 90) % 4 + 4) % 4 : -1;
    const [cos, sin] = q >= 0 ? [[1, 0], [0, 1], [-1, 0], [0, -1]][q] : [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
    return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
};
/** A room's shapes, painted squares and contents turned a quarter turn (or more) into its new w × h box */
function turnRoomInside(o, deg, w, h) {
    const c = [o.w / 2, o.h / 2], dx = (w - o.w) / 2, dy = (h - o.h) / 2, B = o.box ?? CELL;
    const m = (p) => { const [x, y] = rotateAbout(p, c, deg); return [x + dx, y + dy]; };
    const out = { children: (o.children ?? []).map((ch) => moveObject(turnObject(ch, deg, c), dx, dy)) };
    if (o.shapes) out.shapes = o.shapes.map((sh) => {
        if (sh.shape === "poly") return { ...sh, pts: sh.pts.map(m) };
        if (sh.shape === "circle" || isWallShape(sh)) { const [cx, cy] = m([sh.cx, sh.cy]); return { ...sh, cx, cy, ...(isWallShape(sh) ? { rot: ((((sh.rot ?? 0) + deg) % 360) + 360) % 360 } : {}) }; }
        const a = m([sh.x, sh.y]), b = m([sh.x + sh.w, sh.y + sh.h]);
        return { ...sh, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    });
    if (o.cells) out.cells = Object.fromEntries(Object.entries(o.cells).map(([k, f]) => {
        const [col, row] = k.split(",").map(Number), [x, y] = m([(col + 0.5) * B, (row + 0.5) * B]);
        return [`${Math.floor(x / B)},${Math.floor(y / B)}`, f];
    }));
    return out;
}
const mirrorFn = (axis, c) => (axis === "h" ? ([x, y]) => [2 * c - x, y] : ([x, y]) => [x, 2 * c - y]);
/** A room's shapes, painted squares and contents mirrored about its own middle */
function flipRoomInside(o, axis) {
    const h = axis === "h", B = o.box ?? CELL, c = (h ? o.w : o.h) / 2, n = Math.round((h ? o.w : o.h) / B), m = mirrorFn(axis, c);
    const out = { children: (o.children ?? []).map((ch) => flipObject(ch, axis, c)) };
    if (o.shapes) out.shapes = o.shapes.map((sh) => {
        if (sh.shape === "poly") return { ...sh, pts: sh.pts.map(m) };
        if (sh.shape === "circle" || isWallShape(sh)) { const [cx, cy] = m([sh.cx, sh.cy]); return { ...sh, cx, cy, ...(isWallShape(sh) ? { rot: -(sh.rot ?? 0) || 0 } : {}) }; }
        return h ? { ...sh, x: 2 * c - sh.x - sh.w } : { ...sh, y: 2 * c - sh.y - sh.h };
    });
    if (o.cells) out.cells = Object.fromEntries(Object.entries(o.cells).map(([k, f]) => {
        const [col, row] = k.split(",").map(Number);
        return [h ? `${n - 1 - col},${row}` : `${col},${n - 1 - row}`, f];
    }));
    return out;
}

/** A layer in two parts: painted squares, then objects (floor-level ones first). The map grid goes between them on the top layer. */
export function layerParts(layer, ctx, region) {
    // ctx.cellFloors: painted squares drawn one by one (the saved SVG); otherwise as pattern-filled paths
    const objs = region ? (layer.objects ?? []).filter((o) => visibleIn(o, region)) : layer.objects ?? [];
    const floor = region ? Object.fromEntries(Object.entries(layer.floor ?? {}).filter(([k]) => {
        const [c, r] = k.split(",").map(Number);
        return (c + 1) * CELL >= region.x && c * CELL <= region.x + region.w && (r + 1) * CELL >= region.y && r * CELL <= region.y + region.h;
    })) : layer.floor;
    // floor (area fills) > tracks and strips > rooms (floors, then what stands in them) > everything else
    const of = (t) => objs.filter((o) => o.type === t);
    const rooms = of("room");
    const markup = of("area").map((o) => objectSvg(o, ctx)).join("")
        + of("ribbon").map((o) => objectSvg(o, ctx)).join("")
        + rooms.map((o) => roomSvg(o, ctx, "base")).join("") + rooms.map((o) => roomSvg(o, ctx, "contents")).join("")
        + objs.filter((o) => !isFloorLevel(o)).map((o) => objectSvg(o, ctx)).join("");
    const entries = Object.entries(floor ?? {});
    return { floor: ctx.cellFloors && entries.length <= 20000 ? paintedFloorSvg(entries, ctx.custom, `pf-${esc(layer.id)}`) : floorSvg(floor), objects: markup };
}
/** Does a selection box {x, y, w, h} touch the object itself (lines, tracks and areas by their shape, not their bounds)? */
export function touchesBox(o, box) {
    const inBox = (p, pad = 0) => p[0] >= box.x - pad && p[0] <= box.x + box.w + pad && p[1] >= box.y - pad && p[1] <= box.y + box.h + pad;
    if (o.type === "path" || o.type === "ribbon") {
        const pad = o.type === "ribbon" ? ((o.cols ?? RIBBONS[o.style]?.cols ?? 2) * (o.box ?? CELL)) / 2 : Math.max(2, ...(PATH_STYLES[o.style]?.layers ?? [{ w: 4 }]).map((l) => l.w * (o.scale ?? 1))) / 2;
        return sampleCurve(o.pts, o.smooth ?? PATH_STYLES[o.style]?.smooth ?? true, !!o.closed, 4).some((q) => inBox(q.p, pad));
    }
    if (o.type === "area") {
        const poly = sampleCurve(o.pts, o.smooth ?? true, true, 6).map((q) => q.p);
        if (poly.some((p) => inBox(p))) return true;
        // the box may sit wholly inside the area
        const inside = ([x, y]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > y) !== (poly[j][1] > y) && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1] || 1e-9) + poly[i][0]) c = !c; return c; };
        return inside([box.x, box.y]) || inside([box.x + box.w / 2, box.y + box.h / 2]);
    }
    const b = bounds(o);
    return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
}

/** Is an object wholly inside a box {x, y, w, h}? (lines, strips and areas by their shape, the rest by their bounds) */
export function insideBox(o, box) {
    const inBox = (p, pad = 0) => p[0] - pad >= box.x && p[0] + pad <= box.x + box.w && p[1] - pad >= box.y && p[1] + pad <= box.y + box.h;
    if (o.type === "path" || o.type === "ribbon" || o.type === "area") {
        const pad = o.type === "ribbon" ? ((o.cols ?? RIBBONS[o.style]?.cols ?? 2) * (o.box ?? CELL)) / 2 : 0;
        return sampleCurve(o.pts, o.smooth ?? PATH_STYLES[o.style]?.smooth ?? true, o.type === "area" || !!o.closed, 6).every((q) => inBox(q.p, pad));
    }
    const b = bounds(o);
    return b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h;
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
        for (const o of allObjects(l.objects)) {
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
    const cx = { ...ctx, cellFloors: true, custom: doc.textures };
    const layers = shown.map((x, i) => `<g data-layer="${esc(x.layer.name)}"${x.faded ? ' opacity="0.35"' : ""}>${layerSvg(x.layer, cx, i === shown.length - 1 ? gridSvg(doc) : "")}</g>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${doc.width} ${doc.height}" width="${doc.width}" height="${doc.height}">
<metadata id="books-meta-map"><![CDATA[${json}]]></metadata>
<defs>${texturesDefs(usedFloors(doc), doc.textures)}${MACRO_DEFS}${ctx.defs ?? ""}</defs>
${(doc.width / CELL) * (doc.height / CELL) <= 20000 ? terrainCellsSvg(doc.kind === "grid" ? TERRAINS[doc.terrain]?.floor ?? "void" : doc.backdrop ?? "parchment", 0, 0, doc.width, doc.height, doc.textures) : backgroundSvg(doc)}
${layers || gridSvg(doc)}
</svg>
`;
}

/**
 * A blueprint (a saved group of map objects: {objects, w, h, grid, textures}, its box from 0,0 to w,h) as a
 * self-contained SVG: a preview of the objects, the blueprint itself in <metadata id="books-meta-blueprint">.
 */
export function renderBlueprintSvg(bp, ctx) {
    const json = JSON.stringify(bp).replace(/]]>/g, "]]]]><![CDATA[>");
    const pad = 8, w = Math.ceil(bp.w + pad * 2), h = Math.ceil(bp.h + pad * 2);
    const layer = { objects: bp.objects, floor: {} };
    const floors = objectFloors(bp.objects, bp.textures);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${-pad} ${-pad} ${w} ${h}" width="${w}" height="${h}">
<metadata id="books-meta-blueprint"><![CDATA[${json}]]></metadata>
<defs>${texturesDefs(floors, bp.textures)}${MACRO_DEFS}${ctx.defs ?? ""}</defs>
${layerSvg(layer, { ...ctx, cellFloors: true, custom: bp.textures })}
</svg>
`;
}
/** Floor ids the objects of a blueprint (or any list of objects) need */
export const objectFloors = (objects, custom) => usedFloors({ kind: "freeform", backdrop: "-", layers: [{ objects, floor: {} }] }, custom);

/** Map document (or with id "books-meta-blueprint", a blueprint) from a saved SVG, or null */
export function parseMapSvg(text, id = "books-meta-map") {
    const m = String(text ?? "").match(new RegExp(`<metadata id="${id}"><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/metadata>`));
    if (!m) return null;
    try { return JSON.parse(m[1].replace(/]]]]><!\[CDATA\[>/g, "]]>")); } catch { return null; }
}
