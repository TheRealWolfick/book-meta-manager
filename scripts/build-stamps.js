// Builds public/stamps/manifest.json (the map builder's stamp library) and the generated stamp files:
// steampunk top-down stamps (drawn here) and game-icons tokens/markers (from a game-icons.net SVG download).
// Usage: node scripts/build-stamps.js [--game-icons <dir with author folders of .svg>]
// Sources and licences: public/stamps/CREDITS.md
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doorStamp } from "../public/map-core.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "stamps");
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), text); };

// ------------------------------------------------------------------ steampunk top-down set (1 cell = 64 units)

const K = "#2b211a";
const P = {
    wood: "#9a6a3a", woodD: "#6e4826", woodL: "#c08e55", brass: "#c9a14a", brassD: "#8d6b26", copper: "#b8673a", copperD: "#7f4123",
    iron: "#5d5d66", ironD: "#3a3a41", steel: "#9aa0a8", leather: "#7a3b2a", red: "#9b3030", green: "#3f6b4a", velvet: "#5d2b4c",
    glass: "#bcdde4", paper: "#efe6cf", brick: "#9b4a35", stone: "#aaa498", stoneD: "#7d776c", cloth: "#d9cdb1", glow: "#ffd479", water: "#7fb0c4",
    leaf: "#4f7a3a", leafD: "#355a27", leafL: "#6f9a4c",
};
const ol = (w = 2.5) => `stroke="${K}" stroke-width="${w}" stroke-linejoin="round"`;
const rect = (x, y, w, h, fill, rx = 0, sw = 2.5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${ol(sw)}/>`;
const circ = (cx, cy, r, fill, sw = 2.5) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${ol(sw)}/>`;
const path_ = (d, fill = "none", sw = 2.5) => `<path d="${d}" fill="${fill}" ${ol(sw)}/>`;
const line = (d, color = K, w = 2, extra = "") => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`;
const shadow = (inner) => `<g transform="translate(3 4)" opacity=".2">${inner.replace(/fill="[^"]*"/g, 'fill="#000"').replace(/stroke="[^"]*"/g, 'stroke="none"')}</g>`;
const withShadow = (inner) => shadow(inner) + inner;
/** a leaf from (cx, cy) pointing at `ang` degrees (0 = up), len long, w wide */
const leaf = (cx, cy, len, w, ang, fill, rib = P.leafD) => `<g transform="translate(${cx} ${cy}) rotate(${ang})"><path d="M0 0Q${w} ${-len * 0.5} 0 ${-len}Q${-w} ${-len * 0.5} 0 0Z" fill="${fill}" ${ol(1.1)}/>${rib ? `<path d="M0 -2V${-len + 3}" stroke="${rib}" stroke-width="0.9" fill="none"/>` : ""}</g>`;
/** a round plant pot with soil, seen from above */
const pot = (cx, cy, r, fill = P.copper) => withShadow(circ(cx, cy, r, fill, 2)) + circ(cx, cy, r - 3, "#5a3c24", 1);
/** a palm frond: a midrib with leaflets */
const frond = (cx, cy, len, ang) => `<g transform="translate(${cx} ${cy}) rotate(${ang})">${line(Array.from({ length: Math.floor(len / 6) - 1 }, (_, i) => { const t = 6 + i * 6, s = 3 + 9 * (1 - t / len); return `M0 ${-t}L${s} ${-t - 7}M0 ${-t}L${-s} ${-t - 7}`; }).join(""), P.leaf, 2.6)}${line(`M0 0V${-len}`, P.leafD, 1.6)}</g>`;
/** a flower head */
const bloom = (cx, cy, r, petal, heart = "#e8c24a") => Array.from({ length: 5 }, (_, i) => { const a = (i * 2 * Math.PI) / 5; return circ(cx + r * 0.55 * Math.cos(a), cy + r * 0.55 * Math.sin(a), r * 0.5, petal, 0.8); }).join("") + circ(cx, cy, r * 0.35, heart, 0.6);
/** shower head holes in a disc of radius r */
const showerHoles = (cx, cy, r) => { let d = ""; for (let y = -r; y <= r; y += 3.5) for (let x = -r; x <= r; x += 3.5) if (x * x + y * y <= r * r) d += `M${(cx + x).toFixed(1)} ${(cy + y).toFixed(1)}h0`; return line(d, K, 1.4); };
/** round drain grate */
const drainGrate = (cx, cy, r) => circ(cx, cy, r, "#8d949b", 1.5) + line(Array.from({ length: 3 }, (_, i) => `M${cx - r * 0.6} ${cy + (i - 1) * r * 0.45}H${cx + r * 0.6}`).join(""), K, 1.4);
/** shower tray w × h falling to a drain at dx, dy */
const showerTray = (w, h, dx, dy) => withShadow(rect(2, 2, w - 4, h - 4, P.paper, 4)) + rect(8, 8, w - 16, h - 16, "#e9eef0", 3, 1)
    + line(`M8 8L${dx} ${dy}M${w - 8} 8L${dx} ${dy}M8 ${h - 8}L${dx} ${dy}M${w - 8} ${h - 8}L${dx} ${dy}`, "#c3ccd0", 1) + drainGrate(dx, dy, 6);
/** a basin set into a vanity top, tap at the wall */
const vanityBasin = (cx) => `<ellipse cx="${cx}" cy="24" rx="22" ry="13" fill="${P.paper}" ${ol(1.5)}/>` + `<ellipse cx="${cx}" cy="25" rx="16" ry="8" fill="#e9eef0" stroke="none"/>` + circ(cx, 26, 2, P.steel, 1) + rect(cx - 3, 3, 6, 10, P.brass, 1, 1.2);
const rivets = (pts) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="${P.brassD}"/>`).join("");
const gear = (cx, cy, r, teeth, fill) => {
    let d = "";
    for (let i = 0; i < teeth * 2; i++) {
        const a = (Math.PI * i) / teeth, rr = i % 2 ? r : r + r * 0.22;
        const a2 = (Math.PI * (i + 1)) / teeth;
        d += `${i ? "L" : "M"}${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}L${(cx + rr * Math.cos(a2)).toFixed(1)} ${(cy + rr * Math.sin(a2)).toFixed(1)}`;
    }
    return path_(`${d}Z`, fill) + circ(cx, cy, r * 0.32, P.ironD, 2);
};
const planks = (x, y, w, h, n, vertical = false) => Array.from({ length: n - 1 }, (_, i) => vertical
    ? line(`M${x + (w * (i + 1)) / n} ${y + 2}V${y + h - 2}`, P.woodD, 1.5)
    : line(`M${x + 2} ${y + (h * (i + 1)) / n}H${x + w - 2}`, P.woodD, 1.5)).join("");
const wheel = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${P.ironD}" ${ol(2)}/>`;

const STEAM = [
    // furniture
    ["furniture", "table-round", "Round table", 2, 2, () => withShadow(circ(64, 64, 48, P.wood)) + circ(64, 64, 40, P.woodL, 1.5) + circ(64, 64, 8, P.paper, 1.5)],
    ["furniture", "table-long", "Dining table", 3, 1, () => withShadow(rect(6, 10, 180, 44, P.wood, 4)) + planks(6, 10, 180, 44, 3) + rect(80, 22, 32, 20, P.paper, 3, 1.5)],
    ["furniture", "chair", "Chair", 1, 1, () => withShadow(rect(16, 18, 32, 32, P.wood, 4)) + rect(14, 10, 36, 9, P.woodD, 3) + rect(21, 24, 22, 20, P.leather, 3, 1.5)],
    ["furniture", "armchair", "Leather armchair", 1, 1, () => withShadow(rect(8, 8, 48, 48, P.leather, 10)) + rect(8, 8, 48, 13, "#5e2c1f", 8) + rect(8, 16, 10, 40, "#5e2c1f", 5) + rect(46, 16, 10, 40, "#5e2c1f", 5) + rivets([[24, 34], [32, 40], [40, 34]])],
    ["furniture", "sofa", "Chesterfield sofa", 2, 1, () => withShadow(rect(6, 8, 116, 48, P.leather, 10)) + rect(6, 8, 116, 14, "#5e2c1f", 8) + rect(6, 16, 14, 40, "#5e2c1f", 6) + rect(108, 16, 14, 40, "#5e2c1f", 6) + line("M64 24V54", "#5e2c1f", 2) + rivets([[34, 30], [44, 38], [84, 30], [94, 38], [54, 30], [74, 30]])],
    ["furniture", "bed-single", "Bed (single)", 1, 2, () => withShadow(rect(8, 4, 48, 120, P.woodD, 4)) + rect(12, 10, 40, 22, P.paper, 6, 1.5) + rect(10, 36, 44, 84, P.red, 3) + line("M10 52H54", "#7a2424", 2)],
    ["furniture", "bed-double", "Bed (double)", 2, 2, () => withShadow(rect(6, 4, 116, 120, P.woodD, 4)) + rect(12, 10, 48, 22, P.paper, 6, 1.5) + rect(68, 10, 48, 22, P.paper, 6, 1.5) + rect(10, 38, 108, 82, P.velvet, 3) + line("M10 54H118", "#47213a", 2)],
    ["furniture", "wardrobe", "Wardrobe", 2, 1, () => withShadow(rect(6, 12, 116, 42, P.wood, 3)) + line("M64 14V52", P.woodD, 2) + circ(58, 34, 3, P.brass, 1) + circ(70, 34, 3, P.brass, 1)],
    ["furniture", "bookshelf", "Bookshelf", 2, 1, () => withShadow(rect(4, 16, 120, 34, P.woodD, 2)) + ["#8e2f2f", "#3f6b4a", "#2f4a7a", "#c9a14a", "#5d2b4c", "#8e2f2f", "#3f6b4a", "#7a3b2a", "#2f4a7a", "#c9a14a", "#3f6b4a", "#5d2b4c", "#8e2f2f", "#2f4a7a"].map((c, i) => `<rect x="${8 + i * 8.2}" y="20" width="7" height="${22 + (i % 3) * 3}" fill="${c}" stroke="${K}" stroke-width="1"/>`).join("")],
    ["furniture", "desk", "Writing desk", 2, 1, () => withShadow(rect(4, 10, 120, 44, P.wood, 3)) + rect(16, 20, 26, 20, P.paper, 1, 1.2) + line("M20 26H38M20 31H36M20 36H34", "#8c7a5a", 1) + circ(58, 26, 5, K, 1) + circ(98, 30, 12, P.brass, 2) + circ(98, 30, 6, P.glow, 1)],
    ["furniture", "rug", "Persian rug", 3, 2, () => rect(6, 6, 180, 116, "#8e2f2f", 2) + rect(16, 16, 160, 96, "#2f4a7a", 0, 1.5) + rect(28, 28, 136, 72, "#b5793a", 0, 1.5) + path_("M96 40L136 64L96 88L56 64Z", "#8e2f2f", 1.5) + circ(96, 64, 8, P.paper, 1) + line("M6 14V114M186 14V114", P.cloth, 3, 'stroke-dasharray="2 4"')],
    ["furniture", "piano", "Grand piano", 2, 2, () => withShadow(path_("M10 14H90Q120 14 118 60Q116 98 92 112Q70 122 60 104L56 70Q50 60 10 58Z", K)) + rect(10, 14, 20, 44, P.paper, 1, 1.5) + Array.from({ length: 7 }, (_, i) => `<rect x="12" y="${17 + i * 6}" width="10" height="3" fill="${K}"/>`).join("") + rect(26, 72, 20, 14, P.woodD, 2)],
    ["furniture", "grandfather-clock", "Grandfather clock", 1, 1, () => withShadow(rect(14, 18, 36, 30, P.woodD, 3)) + circ(32, 33, 10, P.paper, 1.5) + line("M32 33V26M32 33L37 35", K, 1.5)],
    ["furniture", "fireplace", "Fireplace", 2, 1, () => withShadow(rect(4, 6, 120, 34, P.brick, 2)) + line("M4 18H124M4 29H124M24 6V18M54 6V18M84 6V18M114 6V18M39 18V29M69 18V29M99 18V29", "#6e3324", 1.2) + path_("M34 40H94V58H34Z", "#2b211a") + path_("M50 56Q56 42 64 50Q70 40 78 56Z", "#f08a2c", 1)],
    ["furniture", "strongbox", "Strongbox", 1, 1, () => withShadow(rect(10, 14, 44, 36, P.wood, 3)) + rect(10, 14, 44, 10, P.woodD, 3) + line("M18 14V50M46 14V50", P.ironD, 4) + rect(28, 28, 8, 9, P.brass, 1, 1.5)],
    // indoor plants
    ["decor", "monstera", "Monstera", 1, 1, () => pot(32, 32, 13) + [0, 52, 104, 156, 208, 260, 312].map((a, i) => leaf(32, 32, 27, 13, a, i % 2 ? P.leaf : P.leafL) + `<g transform="translate(32 32) rotate(${a})"><path d="M4 -14L9 -15M4 -20L8 -21M-4 -12L-9 -13M-4 -19L-8 -20" stroke="#2a4a20" stroke-width="1.2"/></g>`).join("")],
    ["decor", "snake-plant", "Snake plant", 1, 1, () => withShadow(rect(17, 17, 30, 30, "#d8d2c4", 4)) + rect(20, 20, 24, 24, "#5a3c24", 3, 1) + [-60, -25, 10, 40, 75, 115, 150, 200, 240, 290].map((a, i) => leaf(32, 32, 18 + (i % 3) * 4, 3.5, a, i % 2 ? "#4f7a3a" : "#6a8f3e", "#c9b44a")).join(""), { crop: [7, 4, 51, 51] }],
    ["decor", "fiddle-leaf-fig", "Fiddle-leaf fig", 1, 1, () => pot(32, 32, 12, "#e2d6b8") + [[0, 26], [45, 22], [95, 25], [140, 21], [185, 26], [230, 22], [275, 25], [320, 21], [20, 14], [160, 14], [290, 14]].map(([a, l], i) => leaf(32, 32, l, 9, a, i % 3 ? P.leaf : P.leafD, "#9bbf7a")).join("")],
    ["decor", "kentia-palm", "Kentia palm", 2, 2, () => pot(64, 64, 18, "#d8d2c4") + [0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => frond(64, 64, 52 + (i % 2) * 8, a + 20)).join("") + circ(64, 64, 5, P.leafD, 1)],
    ["decor", "succulent", "Succulent", 1, 1, () => pot(32, 32, 12, "#d8d2c4") + Array.from({ length: 9 }, (_, i) => leaf(32, 32, 11, 4.5, i * 40, "#8fb08a", "#6f8f6a")).join("") + Array.from({ length: 5 }, (_, i) => leaf(32, 32, 6, 3, i * 72 + 20, "#a9c7a0", null)).join(""), { crop: [18, 18, 30, 31] }],
    ["decor", "cactus-pot", "Potted cactus", 1, 1, () => pot(32, 32, 12, "#c97b63") + circ(32, 32, 8, "#5f8a4a", 1.2) + line("M32 24V40M24 32H40M26 26L38 38M38 26L26 38", "#466b37", 1) + line("M32 23.5h0M40.5 32h0M32 40.5h0M23.5 32h0M38 26h0M26 38h0", "#f1ead8", 1.6), { crop: [18, 18, 30, 31] }],
    ["decor", "trailing-plant", "Trailing pothos", 1, 1, () => pot(32, 22, 11, "#e2d6b8") + [[-14, 0], [-6, 6], [6, 4], [15, -2]].map(([dx, bend], i) => `<path d="M${32 + dx * 0.4} 26Q${32 + dx + bend} 44 ${32 + dx} 62" fill="none" stroke="${P.leafD}" stroke-width="1.2"/>` + [36, 46, 56].map((y, j) => leaf(32 + dx + bend * 0.5 * (j % 2 ? 1 : -1), y, 7, 4, (j % 2 ? 50 : -50) + 180, i % 2 ? P.leafL : P.leaf, null)).join("")).join("")
        + Array.from({ length: 6 }, (_, i) => leaf(32, 22, 10, 5, i * 60, i % 2 ? P.leaf : P.leafL, null)).join("")],
    ["decor", "planter-box", "Planter box", 2, 1, () => withShadow(rect(4, 14, 120, 36, P.woodD, 3)) + rect(9, 19, 110, 26, "#5a3c24", 2, 1) + [[18, 30, 9], [34, 26, 8], [50, 34, 9], [68, 28, 10], [86, 34, 8], [102, 27, 9], [112, 36, 6]].map(([x, y, r], i) => circ(x, y, r, [P.leaf, P.leafL, P.leafD][i % 3], 1.2)).join("")
        + bloom(40, 30, 6, "#d8648a") + bloom(78, 32, 6, "#e8c24a", "#b3261e") + bloom(106, 30, 5, "#f1ead8"), { crop: [1, 11, 127, 44] }],
    ["decor", "bonsai", "Bonsai", 1, 1, () => withShadow(rect(14, 22, 36, 22, "#3f4f6b", 3)) + rect(17, 25, 30, 16, "#6f6a62", 2, 1) + line("M32 33L26 26M32 33L40 28M32 33L30 38", "#5a3c24", 2.4) + circ(24, 24, 7, P.leafD, 1) + circ(41, 26, 8, P.leaf, 1) + circ(31, 30, 5, P.leafL, 1), { crop: [11, 15, 43, 34] }],
    // things for tables, desks and cabinets
    ["decor", "plate", "Plate", 1, 1, () => withShadow(circ(32, 32, 14, P.paper, 1.5)) + circ(32, 32, 9, "#ece4d2", 1), { crop: [16, 16, 34, 35] }],
    ["decor", "place-setting", "Place setting", 1, 1, () => withShadow(circ(32, 34, 13, P.paper, 1.5)) + circ(32, 34, 8, "#ece4d2", 1) + line("M12 24V46M10 24V29M14 24V29", "#9aa0a8", 1.6) + line("M52 24V46", "#9aa0a8", 2) + circ(48, 16, 5, P.glass, 1), { crop: [8, 9, 47, 43] }],
    ["decor", "fruit-bowl", "Bowl of fruit", 1, 1, () => withShadow(circ(32, 32, 15, "#e2d6b8", 1.5)) + circ(27, 29, 5.5, "#b3261e", 1) + circ(37, 28, 5, "#e8962e", 1) + circ(33, 37, 5, "#8fb04a", 1) + [[24, 37], [27, 40], [23, 41], [26, 44]].map(([x, y]) => circ(x, y, 2.2, "#6b3a6e", 0.6)).join("") + `<path d="M38 36Q44 38 42 44" fill="none" stroke="#e8c24a" stroke-width="3.5" stroke-linecap="round"/>`, { crop: [15, 15, 36, 37] }],
    ["decor", "tea-set", "Tea set on a tray", 1, 1, () => withShadow(rect(6, 10, 52, 44, "#c4c9cf", 4)) + circ(26, 28, 9, P.paper, 1.5) + line("M35 28H41", P.paper, 3) + `<path d="M17 24Q11 28 17 32" fill="none" stroke="${K}" stroke-width="1.2"/>` + circ(26, 28, 3, "#e9eef0", 0.8)
        + circ(46, 22, 5.5, P.paper, 1) + circ(46, 22, 3.5, "#a0632e", 0.6) + circ(44, 42, 5.5, P.paper, 1) + circ(44, 42, 3.5, "#a0632e", 0.6), { crop: [3, 7, 59, 52] }],
    ["decor", "wine-and-glass", "Wine bottle and glass", 1, 1, () => withShadow(circ(26, 32, 8, "#2f4a2f", 1.5)) + circ(26, 32, 3, "#1e2e1e", 1) + circ(26, 32, 1.8, P.cloth, 0.6) + circ(42, 34, 6, P.glass, 1) + circ(42, 34, 4, "#7a2030", 0.6), { crop: [16, 22, 34, 23] }],
    ["decor", "candelabra", "Candelabra", 1, 1, () => `<circle cx="32" cy="32" r="22" fill="${P.glow}" opacity=".25"/>` + withShadow(circ(32, 32, 7, P.brass, 1.5)) + line("M14 32H50M32 14V50", P.brass, 2.5) + [[14, 32], [50, 32], [32, 14], [32, 50], [32, 32]].map(([x, y]) => circ(x, y, 3.5, P.paper, 1) + circ(x, y, 1.3, "#e8962e", 0)).join("")],
    ["decor", "candle", "Candle", 1, 1, () => `<circle cx="32" cy="32" r="12" fill="${P.glow}" opacity=".3"/>` + withShadow(circ(32, 32, 7, P.brass, 1.2)) + circ(32, 32, 4, P.paper, 1) + circ(32, 32, 1.4, "#e8962e", 0), { crop: [19, 19, 26, 26] }],
    ["decor", "book-stack", "Stack of books", 1, 1, () => withShadow(`<g transform="rotate(-6 32 32)">${rect(16, 20, 32, 24, "#7a2424", 1.5, 1.5)}</g>`) + `<g transform="rotate(5 32 32)">${rect(18, 22, 28, 20, "#2f4a7a", 1.5, 1.5)}</g>` + `<g transform="rotate(-2 32 32)">${rect(20, 24, 24, 17, "#3f6b4a", 1.5, 1.5) + line("M23 29H40M23 33H36", P.brass, 1)}</g>`, { crop: [13, 16, 41, 35] }],
    ["decor", "open-book", "Open book", 1, 1, () => withShadow(path_("M10 22Q21 18 32 23Q43 18 54 22V44Q43 40 32 45Q21 40 10 44Z", P.paper, 1.5)) + line("M32 23V45", K, 1) + line("M14 27H28M14 31H28M14 35H26M36 27H50M36 31H50M36 35H48", "#a49b88", 1), { crop: [8, 18, 50, 32] }],
    ["decor", "flat-tv", "Flat TV on a stand", 2, 1, () => withShadow(rect(46, 30, 36, 12, "#3a3a41", 3)) + withShadow(rect(8, 24, 112, 7, "#141418", 1.5, 1.5)) + line("M14 27.5H116", "#3a3a48", 1), { crop: [6, 22, 118, 25] }],
    ["decor", "wall-tv", "Wall-mounted TV", 2, 1, () => rect(40, 0, 48, 4, "#3a3a41", 1, 1) + withShadow(rect(8, 3, 112, 6, "#141418", 1.5, 1.5)) + line("M14 6H116", "#3a3a48", 1), { crop: [6, 0, 118, 14] }],
    ["decor", "crt-tv", "Television (old)", 1, 1, () => withShadow(path_("M18 12H46L50 40H14Z", "#5a4632", 1.8)) + line("M23 18H41M22 23H42M21 28H43", "#3e3022", 1.4) + rect(10, 40, 44, 12, "#4a3a2a", 2, 1.8) + rect(14, 42, 26, 8, "#5f7f8f", 2, 1) + line("M17 44.5H24", "#a9c4cf", 1) + circ(46, 46, 2.2, P.brass, 0.8), { crop: [8, 10, 49, 45] }],
    ["decor", "radio", "Valve radio", 1, 1, () => withShadow(rect(14, 20, 36, 24, P.wood, 6, 1.5)) + rect(18, 24, 18, 16, "#e2d6b8", 3, 1) + line("M20 28H34M20 32H34M20 36H34", "#a49b88", 1) + circ(43, 28, 3, P.brass, 1) + circ(43, 37, 3, P.brass, 1), { crop: [12, 18, 42, 31] }],
    ["decor", "table-lamp", "Table lamp", 1, 1, () => `<circle cx="32" cy="32" r="20" fill="${P.glow}" opacity=".25"/>` + withShadow(circ(32, 32, 11, "#efe2c0", 1.5)) + circ(32, 32, 7, "#f6ecd2", 0.8) + circ(32, 32, 2, P.brass, 0.8), { crop: [11, 11, 42, 42] }],
    ["decor", "desk-lamp", "Desk lamp", 1, 1, () => withShadow(circ(22, 42, 7, "#2f4a2f", 1.5)) + line("M22 42L30 28L40 24", P.brass, 2.2) + `<circle cx="44" cy="26" r="10" fill="${P.glow}" opacity=".3"/>` + withShadow(`<ellipse cx="42" cy="24" rx="7" ry="5" fill="#2f4a2f" ${ol(1.2)}/>`), { crop: [13, 15, 42, 39] }],
    ["decor", "vase-flowers", "Vase of flowers", 1, 1, () => withShadow(circ(32, 32, 8, "#3f6b8a", 1.5)) + leaf(32, 32, 14, 3.5, 200, P.leaf, null) + leaf(32, 32, 14, 3.5, 80, P.leafL, null) + leaf(32, 32, 12, 3.5, 320, P.leaf, null)
        + bloom(26, 26, 6, "#d8648a") + bloom(38, 27, 6, "#f1ead8") + bloom(33, 37, 6, "#e8962e") + bloom(25, 37, 5, "#b47a9e"), { crop: [16, 16, 34, 34] }],
    ["decor", "laptop", "Laptop", 1, 1, () => withShadow(rect(14, 26, 36, 22, "#9aa0a8", 2, 1.5)) + rect(14, 20, 36, 7, "#3a3a41", 1.5, 1.5) + rect(18, 29, 28, 10, "#c4c9cf", 1, 0.8) + line("M19 32H45M19 35H45", "#9aa0a8", 1, 'stroke-dasharray="2 1"') + rect(27, 41, 10, 5, "#b0b5bb", 1, 0.6), { crop: [12, 18, 42, 35] }],
    ["decor", "telephone", "Telephone", 1, 1, () => withShadow(rect(18, 22, 28, 22, "#1e1e22", 5, 1.5)) + rect(16, 18, 32, 7, "#2b2b30", 3, 1.2) + circ(32, 36, 7, P.paper, 1) + circ(32, 36, 2.5, "#1e1e22", 0) + Array.from({ length: 10 }, (_, i) => { const a = (i * Math.PI) / 6 - Math.PI / 2; return `<circle cx="${(32 + 5 * Math.cos(a)).toFixed(1)}" cy="${(36 + 5 * Math.sin(a)).toFixed(1)}" r="0.9" fill="${K}"/>`; }).join(""), { crop: [14, 16, 36, 33] }],
    ["decor", "mantel-clock", "Mantel clock", 1, 1, () => withShadow(rect(16, 24, 32, 14, P.woodD, 4, 1.5)) + circ(32, 26, 8, P.brass, 1.2) + circ(32, 26, 6, P.paper, 0.8) + line("M32 26V22M32 26L35 27", K, 1), { crop: [14, 16, 38, 27] }],
    ["decor", "globe", "Globe", 1, 1, () => withShadow(circ(32, 32, 13, P.brass, 1.5)) + circ(32, 32, 11, "#4f7fa0", 1) + path_("M25 24Q30 22 32 27Q29 31 25 30Z", "#8fa86a", 0.8) + path_("M34 33Q40 31 41 36Q37 41 34 38Z", "#8fa86a", 0.8) + line("M21 32H43", "#2f5a78", 0.6), { crop: [17, 17, 32, 33] }],
    ["decor", "chessboard", "Chessboard", 1, 1, () => withShadow(rect(12, 12, 40, 40, P.woodD, 1, 1.5)) + Array.from({ length: 64 }, (_, i) => (i + Math.floor(i / 8)) % 2 ? `<rect x="${14 + (i % 8) * 4.5}" y="${14 + Math.floor(i / 8) * 4.5}" width="4.5" height="4.5" fill="#efe2c0"/>` : "").join("")
        + [[16, 16], [25, 16], [34, 16], [43, 16], [20, 20], [29, 20]].map(([x, y]) => circ(x + 0.5, y + 0.5, 1.6, "#1e1e22", 0.4)).join("") + [[16, 47], [25, 47], [38, 47], [47, 43], [29, 43]].map(([x, y]) => circ(x + 0.5, y + 0.5, 1.6, "#f6f1e6", 0.4)).join(""), { crop: [10, 10, 46, 46] }],
    ["decor", "mug", "Mug", 1, 1, () => withShadow(circ(30, 32, 7, "#c97b63", 1.5)) + circ(30, 32, 5, "#4a2e1c", 0.6) + `<path d="M37 29Q42 32 37 35" fill="none" stroke="${K}" stroke-width="1.5"/>`, { crop: [21, 23, 21, 21] }],
    ["decor", "decanter-tray", "Decanter and glasses", 1, 1, () => withShadow(rect(8, 12, 48, 40, "#c4c9cf", 3)) + circ(24, 32, 9, P.glass, 1.5) + circ(24, 32, 6, "#b5793a", 0.8) + circ(24, 32, 2.5, P.glass, 0.8) + [[42, 22], [46, 34], [40, 44]].map(([x, y]) => circ(x, y, 4, P.glass, 1) + circ(x, y, 2.3, "#b5793a", 0.5)).join(""), { crop: [5, 9, 55, 48] }],
    // rugs
    ["rugs", "rug-round", "Round rug", 2, 2, () => circ(64, 64, 58, "#6b2f3a", 2) + circ(64, 64, 50, "#d9c49a", 1) + circ(64, 64, 40, "#6b2f3a", 1) + circ(64, 64, 30, "#2f4a5a", 1) + Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return circ(64 + 45 * Math.cos(a), 64 + 45 * Math.sin(a), 3, "#6b2f3a", 0.6); }).join("") + circ(64, 64, 10, "#d9c49a", 1)],
    ["rugs", "rug-braided", "Braided oval rug", 3, 2, () => [[90, 58, "#7a4a3a"], [80, 50, "#b5793a"], [70, 42, "#5d6b4a"], [60, 34, "#8e2f2f"], [50, 26, "#b5793a"], [40, 18, "#5d6b4a"], [30, 10, "#7a4a3a"]].map(([rx, ry, c]) => `<ellipse cx="96" cy="64" rx="${rx}" ry="${ry}" fill="${c}" stroke="#3a2a1e" stroke-width="1" stroke-dasharray="3 2"/>`).join("")],
    ["rugs", "rug-runner", "Hall runner", 1, 3, () => rect(6, 4, 52, 184, "#7a2424", 2, 1.5) + rect(12, 10, 40, 172, "#d9c49a", 0, 1) + rect(16, 14, 32, 164, "#2f4a5a", 0, 1) + [40, 72, 104, 136, 168].map((y) => path_(`M32 ${y - 14}L44 ${y}L32 ${y + 14}L20 ${y}Z`, "#b5793a", 1) + circ(32, y, 3, "#7a2424", 0.6)).join("") + line("M10 4V0M18 4V0M26 4V0M34 4V0M42 4V0M50 4V0M10 188V192M18 188V192M26 188V192M34 188V192M42 188V192M50 188V192", P.cloth, 1.5)],
    ["rugs", "rug-kilim", "Kilim rug", 2, 3, () => rect(6, 6, 116, 180, "#b5793a", 1, 1.5) + [0, 1, 2, 3, 4].map((i) => { const y = 16 + i * 34; return rect(6, y, 116, 22, ["#8e2f2f", "#2f4a5a", "#3f6b4a", "#8e2f2f", "#2f4a5a"][i], 0, 0) + line(`M6 ${y + 11}${Array.from({ length: 10 }, (_, j) => `L${6 + j * 11.6 + 5.8} ${y + (j % 2 ? 4 : 18)}`).join("")}L122 ${y + 11}`, "#efe2c0", 2); }).join("") + rect(6, 6, 116, 180, "none", 1, 1.5)],
    ["rugs", "rug-geometric", "Modern geometric rug", 2, 2, () => rect(6, 6, 116, 116, "#e8e2d4", 2, 1.5) + path_("M6 6L64 64L6 122Z", "#3f5f6b", 0) + path_("M122 6L64 64L122 122Z", "#c97b63", 0) + path_("M6 6H122L64 64Z", "#d9b45a", 0) + path_("M40 86H88L64 122H40Z", "#2f3a42", 0) + rect(6, 6, 116, 116, "none", 2, 1.5)],
    ["rugs", "rug-shag", "Shag rug", 2, 2, () => rect(10, 10, 108, 108, "#e6dfcf", 14, 0) + `<rect x="10" y="10" width="108" height="108" rx="14" fill="none" stroke="#cfc6b2" stroke-width="6" stroke-dasharray="1 3" stroke-linecap="round"/>` + Array.from({ length: 70 }, (_, i) => { const x = 18 + ((i * 37) % 92), y = 18 + ((i * 53) % 92); return `<path d="M${x} ${y}l${(i % 3) - 1} 3" stroke="#d2c9b4" stroke-width="1.6" stroke-linecap="round"/>`; }).join("")],
    ["rugs", "rug-hide", "Animal hide rug", 2, 2, () => path_("M40 14Q64 4 88 14L100 8L104 26Q120 40 114 64Q120 88 104 102L100 120L88 114Q64 124 40 114L28 120L24 102Q8 88 14 64Q8 40 24 26L28 8Z", "#f1ead8", 1.5) + path_("M44 34Q58 28 62 42Q56 56 42 50Z", "#3a2a1e", 0) + path_("M76 58Q92 52 96 66Q90 80 74 74Z", "#3a2a1e", 0) + path_("M38 76Q50 72 52 84Q46 94 36 88Z", "#3a2a1e", 0) + path_("M70 26Q80 22 84 30Q80 38 70 34Z", "#3a2a1e", 0)],
    ["rugs", "rug-persian-blue", "Persian rug (blue)", 3, 2, () => rect(6, 6, 180, 116, "#2a3f66", 2) + rect(16, 16, 160, 96, "#d9c49a", 0, 1.5) + rect(24, 24, 144, 80, "#3d5a8a", 0, 1.5) + path_("M96 34L146 64L96 94L46 64Z", "#d9c49a", 1.5) + path_("M96 46L126 64L96 82L66 64Z", "#8e2f2f", 1) + circ(96, 64, 6, "#d9c49a", 1)
        + [[34, 34], [158, 34], [34, 94], [158, 94]].map(([x, y]) => circ(x, y, 5, "#8e2f2f", 1)).join("") + line("M6 14V114M186 14V114", P.cloth, 3, 'stroke-dasharray="2 4"')],
    ["rugs", "rug-striped", "Striped rug", 3, 2, () => rect(6, 10, 180, 108, "#e8e2d4", 2, 1.5) + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rect(6 + 14 + i * 20, 10, 8, 108, ["#3f5f6b", "#c97b63", "#d9b45a"][i % 3], 0, 0)).join("") + rect(6, 10, 180, 108, "none", 2, 1.5)],
    ["rugs", "rug-checker", "Checked rug", 2, 2, () => rect(8, 8, 112, 112, "#3a3a41", 2, 1.5) + Array.from({ length: 49 }, (_, i) => ((i % 7) + Math.floor(i / 7)) % 2 ? `<rect x="${14 + (i % 7) * 14.3}" y="${14 + Math.floor(i / 7) * 14.3}" width="14.3" height="14.3" fill="#d9c49a"/>` : `<rect x="${14 + (i % 7) * 14.3}" y="${14 + Math.floor(i / 7) * 14.3}" width="14.3" height="14.3" fill="#7a2424"/>`).join("") + rect(14, 14, 100, 100, "none", 0, 1)],
    ["rugs", "rug-sheepskin", "Sheepskin", 1, 1, () => `<path d="M18 10Q32 4 46 10Q56 20 52 32Q58 44 46 54Q32 60 18 54Q6 44 12 32Q6 20 18 10Z" fill="#f6f1e6" stroke="#cfc6b2" stroke-width="3" stroke-dasharray="1.5 2.5" stroke-linecap="round"/>`
        + Array.from({ length: 24 }, (_, i) => `<path d="M${16 + ((i * 29) % 32)} ${14 + ((i * 17) % 38)}q2 1 1 3" fill="none" stroke="#e2d9c6" stroke-width="1.2" stroke-linecap="round"/>`).join(""), { crop: [7, 4, 50, 56] }],
    ["furniture", "potted-plant", "Potted fern", 1, 1, () => withShadow(circ(32, 34, 14, P.copper)) + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i * Math.PI) / 4; return path_(`M32 34Q${32 + 18 * Math.cos(a + 0.4)} ${34 + 18 * Math.sin(a + 0.4)} ${32 + 26 * Math.cos(a)} ${34 + 26 * Math.sin(a)}Q${32 + 12 * Math.cos(a - 0.3)} ${34 + 12 * Math.sin(a - 0.3)} 32 34Z`, i % 2 ? P.leaf : P.leafL, 1.2); }).join("")],
    ["furniture", "side-table-lamp", "Side table with oil lamp", 1, 1, () => withShadow(circ(32, 32, 22, P.wood)) + circ(32, 32, 11, P.brass, 2) + circ(32, 32, 6, P.glow, 1)],
    // kitchen & bath
    ["kitchen", "stove", "Cast-iron stove", 1, 1, () => withShadow(rect(6, 8, 52, 48, P.ironD, 4)) + circ(20, 22, 7, P.iron, 1.5) + circ(44, 22, 7, P.iron, 1.5) + circ(20, 42, 7, P.iron, 1.5) + circ(44, 42, 7, "#a33a1d", 1.5) + rect(26, 0, 12, 10, P.ironD, 1, 2)],
    ["kitchen", "washstand", "Washstand", 1, 1, () => withShadow(rect(6, 14, 52, 38, P.woodL, 3)) + `<ellipse cx="32" cy="33" rx="17" ry="12" fill="${P.paper}" ${ol(1.5)}/>` + `<ellipse cx="32" cy="33" rx="11" ry="7" fill="${P.glass}" stroke="none"/>` + rect(29, 14, 6, 9, P.brass, 1, 1.5)],
    ["kitchen", "bathtub", "Clawfoot bathtub", 1, 2, () => withShadow(rect(6, 8, 52, 112, P.paper, 24)) + rect(13, 18, 38, 92, P.glass, 18, 1.5) + rect(28, 10, 8, 10, P.brass, 2, 1.5)],
    // bathroom: wall-mounted things have the wall along their top edge
    ["kitchen", "rain-shower-head", "Rain shower head", 1, 1, () => rect(29, 0, 6, 18, P.steel, 1, 1.5) + withShadow(circ(32, 32, 17, P.steel, 2)) + circ(32, 32, 13, "#c4c9cf", 1)
        + showerHoles(32, 32, 10), { crop: [13, 0, 40, 54] }],
    ["kitchen", "shower-head", "Shower head (wall)", 1, 1, () => rect(24, 0, 16, 5, P.steel, 1, 1.5) + rect(29, 4, 6, 12, P.steel, 1, 1.5) + withShadow(circ(32, 22, 9, P.steel, 1.5)) + showerHoles(32, 22, 5), { crop: [21, 0, 24, 36] }],
    ["kitchen", "hand-shower", "Hand shower and hose", 1, 1, () => rect(24, 0, 16, 6, P.steel, 1, 1.5) + line("M32 6C6 26 60 30 40 44", "#8d949b", 3) + withShadow(`<ellipse cx="40" cy="52" rx="7" ry="9" fill="${P.steel}" ${ol(1.5)}/>`) + showerHoles(40, 52, 4), { crop: [22, 0, 29, 66] }],
    ["kitchen", "shower-mixer", "Shower mixer", 1, 1, () => rect(18, 0, 28, 8, P.steel, 2, 1.5) + circ(24, 12, 5, P.steel, 1.5) + circ(40, 12, 5, P.steel, 1.5) + line("M24 12L24 7M40 12L44 8", K, 1.5), { crop: [16, 0, 32, 19] }],
    ["kitchen", "shower-base", "Shower base", 1, 1, () => showerTray(64, 64, 32, 32)],
    ["kitchen", "shower-tray-long", "Shower tray (long)", 2, 1, () => showerTray(128, 64, 108, 32)],
    ["kitchen", "shower-base-large", "Walk-in shower base", 2, 2, () => showerTray(128, 128, 64, 64)],
    ["kitchen", "shower-quadrant", "Corner shower (quadrant)", 2, 2, () => withShadow(path_("M4 4H124A120 120 0 0 1 4 124Z", P.paper)) + path_("M10 10H112A102 102 0 0 1 10 112Z", "#e9eef0", 1)
        + line("M10 10L40 40M112 10L48 36M10 112L36 48", "#b9c4c8", 1) + drainGrate(40, 40, 6) + `<path d="M124 4A120 120 0 0 1 4 124" fill="none" stroke="${P.glass}" stroke-width="5" opacity=".85"/>` + `<path d="M124 4A120 120 0 0 1 4 124" fill="none" stroke="#5b7d88" stroke-width="1.2"/>`],
    ["kitchen", "floor-drain", "Floor drain", 1, 1, () => drainGrate(32, 32, 11), { crop: [19, 19, 26, 26] }],
    ["kitchen", "linear-drain", "Linear drain", 2, 1, () => rect(6, 25, 116, 14, "#8d949b", 2, 1.5) + line("M12 32H116", K, 4, 'stroke-dasharray="2 6"'), { crop: [4, 23, 120, 18] }],
    ["kitchen", "towel-rail", "Towel rail", 1, 1, () => rect(6, 0, 6, 9, P.steel, 1, 1.5) + rect(52, 0, 6, 9, P.steel, 1, 1.5) + line("M9 7H55", "#8d949b", 3)
        + withShadow(rect(14, 4, 36, 12, "#7fa7b8", 2, 1.5)) + line("M14 13H50", "#5d8798", 1.2), { crop: [4, 0, 56, 21] }],
    ["kitchen", "heated-towel-rail", "Heated towel rail", 1, 1, () => rect(5, 0, 6, 12, "#d6d8db", 1, 1.5) + rect(53, 0, 6, 12, "#d6d8db", 1, 1.5) + rect(8, 6, 48, 6, "#e4e6e8", 2, 1.5)
        + line("M16 9H48", "#a7acb2", 1, 'stroke-dasharray="1 5"') + withShadow(rect(20, 4, 24, 14, "#c97b63", 2, 1.5)), { crop: [3, 0, 58, 23] }],
    ["kitchen", "towel-hooks", "Towel hooks", 1, 1, () => [16, 32, 48].map((x) => circ(x, 4, 3, P.brass, 1.2)).join("") + withShadow(rect(26, 6, 12, 20, "#7fa7b8", 4, 1.5)) + withShadow(rect(42, 6, 12, 16, "#e2d6b8", 4, 1.5)), { crop: [11, 0, 47, 31] }],
    ["kitchen", "vanity", "Vanity unit", 2, 1, () => withShadow(rect(4, 2, 120, 46, P.woodL, 3)) + rect(4, 2, 120, 40, P.stone, 3, 1.5) + vanityBasin(64), { crop: [1, 0, 127, 53] }],
    ["kitchen", "vanity-double", "Double vanity unit", 3, 1, () => withShadow(rect(4, 2, 184, 46, P.woodL, 3)) + rect(4, 2, 184, 40, P.stone, 3, 1.5) + vanityBasin(52) + vanityBasin(140), { crop: [1, 0, 191, 53] }],
    ["kitchen", "vessel-basin", "Vessel basin", 1, 1, () => withShadow(rect(2, 2, 60, 42, P.stone, 2)) + withShadow(circ(32, 26, 14, P.paper, 2)) + circ(32, 26, 9, "#e9eef0", 1) + circ(32, 26, 2, P.steel, 1) + rect(29, 2, 6, 9, P.brass, 1, 1.2), { crop: [-1, 0, 67, 49] }],
    ["kitchen", "wall-mirror", "Wall mirror", 1, 1, () => rect(4, 0, 56, 9, P.brass, 2, 1.5) + rect(7, 2, 50, 5, P.glass, 1, 1) + line("M12 4L18 4", "#ffffff", 1.2), { crop: [2, 0, 60, 11] }],
    ["kitchen", "mirror-cabinet", "Mirror cabinet", 1, 1, () => withShadow(rect(4, 0, 56, 14, P.woodL, 2)) + rect(7, 3, 24, 8, P.glass, 1, 1) + rect(33, 3, 24, 8, P.glass, 1, 1), { crop: [1, 0, 63, 19] }],
    ["kitchen", "toiletries", "Toiletries", 1, 1, () => `<ellipse cx="18" cy="16" rx="10" ry="7" fill="${P.paper}" ${ol(1.2)}/>` + `<ellipse cx="18" cy="16" rx="6" ry="4" fill="#e8d6a8" ${ol(1)}/>`
        + circ(40, 14, 6, "#6b8f71", 1.2) + circ(52, 18, 5, "#b47a9e", 1.2) + circ(40, 34, 7, P.glass, 1.2) + line("M38 30L36 22M42 30L45 23", P.red, 1.5), { crop: [4, 4, 56, 40] }],
    ["kitchen", "bath-mat", "Bath mat", 2, 1, () => rect(10, 12, 108, 40, "#7fa7b8", 6, 1.5) + line("M18 20H110M18 44H110", "#e8f0f2", 2) + line("M10 22v0M10 32v0M10 42v0M118 22v0M118 32v0M118 42v0", "#5d8798", 3), { crop: [7, 10, 114, 44] }],
    ["kitchen", "laundry-basket", "Laundry basket", 1, 1, () => withShadow(circ(32, 32, 20, P.woodL, 2)) + circ(32, 32, 15, "#a87a48", 1) + line("M17 32H47M32 17V47M21 21L43 43M43 21L21 43", "#8a6238", 1) + rect(22, 24, 14, 10, "#e2d6b8", 3, 1), { crop: [10, 10, 46, 47] }],
    ["kitchen", "toilet", "Toilet (modern)", 1, 1, () => withShadow(rect(14, 2, 36, 13, P.paper, 3)) + circ(32, 8, 2.5, P.steel, 1) + withShadow(`<ellipse cx="32" cy="37" rx="14" ry="18" fill="${P.paper}" ${ol(2)}/>`) + `<ellipse cx="32" cy="39" rx="8" ry="11" fill="#e9eef0" stroke="none"/>`, { crop: [11, 0, 43, 60] }],
    ["kitchen", "toilet-roll", "Toilet roll holder", 1, 1, () => rect(20, 0, 24, 4, P.steel, 1, 1.2) + withShadow(rect(22, 3, 20, 12, "#f4f1ea", 3, 1.2)) + line("M24 9H40", "#d8d2c4", 1), { crop: [18, 0, 28, 20] }],
    ["kitchen", "water-closet", "Water closet", 1, 1, () => withShadow(rect(14, 4, 36, 14, P.woodD, 2)) + `<ellipse cx="32" cy="38" rx="15" ry="18" fill="${P.paper}" ${ol(2)}/>` + `<ellipse cx="32" cy="40" rx="9" ry="11" fill="${P.glass}" stroke="none"/>` + line("M50 10L58 4", P.brass, 2)],
    ["kitchen", "counter", "Kitchen counter", 2, 1, () => withShadow(rect(4, 12, 120, 40, P.stone, 2)) + line("M44 12V52M84 12V52", P.stoneD, 1.5) + rect(56, 20, 20, 14, P.woodL, 2, 1.2) + circ(104, 30, 7, P.copper, 1.5)],
    // workshop & machinery
    ["machines", "boiler", "Boiler", 2, 2, () => withShadow(circ(64, 64, 52, P.copper)) + circ(64, 64, 42, P.copperD, 2) + circ(64, 64, 18, P.ironD, 2) + rivets(Array.from({ length: 16 }, (_, i) => [64 + 47 * Math.cos((i * Math.PI) / 8), 64 + 47 * Math.sin((i * Math.PI) / 8)])) + rect(90, 20, 26, 10, P.brass, 3, 2) + circ(64, 64, 6, P.glow, 1)],
    ["machines", "steam-engine", "Steam engine", 2, 2, () => withShadow(rect(8, 40, 112, 50, P.iron, 4)) + gear(36, 64, 26, 10, P.steel) + rect(66, 50, 46, 28, P.brass, 4) + line("M36 64L84 64", K, 5) + circ(100, 64, 7, P.ironD, 2) + rivets([[72, 54], [106, 54], [72, 74], [106, 74]])],
    ["machines", "gears", "Gear assembly", 2, 2, () => withShadow(rect(6, 6, 116, 116, P.ironD, 6)) + gear(44, 46, 26, 10, P.brass) + gear(90, 80, 20, 8, P.copper) + gear(88, 30, 12, 6, P.steel)],
    ["machines", "workbench", "Workbench", 2, 1, () => withShadow(rect(4, 8, 120, 48, P.woodL, 2)) + planks(4, 8, 120, 48, 4, true) + rect(12, 14, 22, 10, P.ironD, 2, 1.5) + line("M50 22L74 34", P.steel, 4) + line("M50 22L56 18", P.woodD, 4) + circ(100, 36, 9, P.brass, 1.5) + line("M88 44H116", P.iron, 3)],
    ["machines", "anvil", "Anvil", 1, 1, () => withShadow(path_("M10 22H44Q56 22 58 30H44V42H20V30H10Z", P.ironD)) + line("M20 26H40", P.steel, 2)],
    ["machines", "furnace", "Blast furnace", 2, 2, () => withShadow(rect(8, 8, 112, 112, P.brick, 6)) + line("M8 36H120M8 64H120M8 92H120M36 8V36M84 8V36M60 36V64M36 64V92M84 64V92M60 92V120", "#6e3324", 1.5) + circ(64, 64, 26, K, 2.5) + circ(64, 64, 18, "#e2561d", 0) + circ(64, 64, 9, P.glow, 0)],
    ["machines", "tesla-coil", "Tesla coil", 1, 1, () => withShadow(circ(32, 32, 24, P.ironD)) + circ(32, 32, 17, P.copper, 2) + circ(32, 32, 10, P.steel, 2) + line("M32 32L52 10M32 32L8 18M32 32L50 56", "#8fd0ff", 1.5, 'stroke-dasharray="4 2"')],
    ["machines", "dynamo", "Dynamo", 2, 1, () => withShadow(rect(6, 10, 70, 44, P.green, 6)) + rivets([[14, 16], [68, 16], [14, 48], [68, 48]]) + Array.from({ length: 6 }, (_, i) => line(`M${18 + i * 9} 14V50`, "#2d4d35", 2)).join("") + circ(98, 32, 20, P.steel) + circ(98, 32, 7, P.ironD, 1.5) + line("M76 32H92", K, 5)],
    ["machines", "pressure-tank", "Pressure tank", 1, 1, () => withShadow(circ(32, 32, 26, P.steel)) + circ(32, 32, 18, P.iron, 1.5) + circ(32, 32, 9, P.paper, 1.5) + line("M32 32L36 26", P.red, 1.5) + rivets([[32, 9], [55, 32], [32, 55], [9, 32]])],
    ["machines", "control-panel", "Control panel", 2, 1, () => withShadow(rect(4, 10, 120, 44, P.woodD, 4)) + [20, 46, 72].map((x) => circ(x, 28, 9, P.paper, 1.5) + line(`M${x} 28L${x + 5} 23`, P.red, 1.5)).join("") + [98, 106, 114].map((x, i) => line(`M${x} 44V${24 + i * 4}`, P.brass, 3) + circ(x, 24 + i * 4, 3, P.red, 1)).join("") + rect(14, 42, 66, 6, P.ironD, 1, 1)],
    ["machines", "lathe", "Lathe", 2, 1, () => withShadow(rect(4, 18, 120, 30, P.iron, 3)) + rect(8, 12, 26, 42, P.ironD, 3) + rect(96, 16, 22, 34, P.ironD, 3) + line("M34 33H96", P.steel, 6) + rect(56, 24, 14, 18, P.brass, 2, 1.5)],
    ["machines", "conveyor", "Conveyor belt", 3, 1, () => withShadow(rect(4, 12, 184, 40, P.ironD, 18)) + rect(16, 18, 160, 28, "#4d4a45", 4, 1.5) + Array.from({ length: 10 }, (_, i) => line(`M${24 + i * 16} 20V44`, "#2a2825", 2)).join("") + circ(22, 32, 6, P.steel, 1.5) + circ(170, 32, 6, P.steel, 1.5)],
    // pipes
    ["pipes", "pipe-straight", "Pipe, straight", 1, 1, () => rect(0, 22, 64, 20, P.copper, 0, 2) + line("M0 27H64", "#d99267", 2) + rect(28, 19, 8, 26, P.brass, 1, 1.5), { ports: [[0, 0.5], [1, 0.5]] }],
    ["pipes", "pipe-corner", "Pipe, corner", 1, 1, () => path_("M0 22H22Q42 22 42 42V64H22V44Q22 42 20 42H0Z", P.copper, 2) + rect(14, 19, 8, 26, P.brass, 1, 1.5), { ports: [[0, 0.5], [0.5, 1]] }],
    ["pipes", "pipe-tee", "Pipe, tee", 1, 1, () => rect(0, 22, 64, 20, P.copper, 0, 2) + rect(22, 42, 20, 22, P.copper, 0, 2) + circ(32, 32, 11, P.brass, 2), { ports: [[0, 0.5], [1, 0.5], [0.5, 1]] }],
    ["pipes", "pipe-cross", "Pipe, cross", 1, 1, () => rect(0, 22, 64, 20, P.copper, 0, 2) + rect(22, 0, 20, 64, P.copper, 0, 2) + circ(32, 32, 12, P.brass, 2), { ports: [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]] }],
    ["pipes", "valve-wheel", "Valve wheel", 1, 1, () => rect(0, 24, 64, 16, P.copper, 0, 2) + circ(32, 32, 18, "none", 4) + `<circle cx="32" cy="32" r="18" fill="none" stroke="${P.red}" stroke-width="3"/>` + line("M32 14V50M14 32H50", P.red, 3) + circ(32, 32, 4, P.brass, 1.5), { ports: [[0, 0.5], [1, 0.5]] }],
    ["pipes", "pressure-gauge", "Pressure gauge", 1, 1, () => rect(0, 26, 64, 12, P.copper, 0, 2) + circ(32, 32, 16, P.brass, 2.5) + circ(32, 32, 11, P.paper, 1.5) + line("M32 32L38 25", P.red, 1.5), { ports: [[0, 0.5], [1, 0.5]] }],
    ["pipes", "smokestack", "Smokestack", 1, 1, () => withShadow(circ(32, 32, 24, P.brick)) + circ(32, 32, 15, K, 2) + `<circle cx="38" cy="26" r="9" fill="#cfcfcf" opacity=".7"/><circle cx="46" cy="18" r="7" fill="#e6e6e6" opacity=".6"/>`],
    // containers
    ["containers", "crate", "Crate", 1, 1, () => withShadow(rect(10, 10, 44, 44, P.woodL, 2)) + rect(14, 14, 36, 36, "none", 0, 1.5) + line("M14 14L50 50", P.woodD, 3)],
    ["containers", "barrel", "Barrel", 1, 1, () => withShadow(circ(32, 32, 21, P.wood)) + circ(32, 32, 16, P.woodL, 1.5) + `<circle cx="32" cy="32" r="21" fill="none" stroke="${P.ironD}" stroke-width="3"/>` + circ(32, 32, 3, P.woodD, 1)],
    ["containers", "sack", "Sack", 1, 1, () => withShadow(path_("M18 18Q32 8 46 18Q56 34 46 50Q32 58 18 50Q8 34 18 18Z", P.cloth)) + line("M26 16Q32 22 38 16", "#a8946a", 2)],
    ["containers", "crate-stack", "Stacked crates", 2, 2, () => withShadow(rect(8, 8, 56, 56, P.woodL, 2) + rect(64, 30, 54, 54, P.wood, 2) + rect(18, 66, 50, 50, P.woodL, 2)) + rect(8, 8, 56, 56, P.woodL, 2) + line("M12 12L60 60", P.woodD, 3) + rect(64, 30, 54, 54, P.wood, 2) + line("M68 34L114 80", P.woodD, 3) + rect(18, 66, 50, 50, P.woodL, 2) + line("M22 70L64 112", P.woodD, 3)],
    ["containers", "coal-pile", "Coal pile", 1, 1, () => Array.from({ length: 14 }, (_, i) => circ(14 + ((i * 37) % 36), 14 + ((i * 23) % 36), 6 + (i % 3), i % 2 ? "#2a2a2e" : "#3e3e44", 1)).join("")],
    ["containers", "cask-rack", "Cask rack", 2, 1, () => withShadow(rect(4, 6, 120, 52, P.woodD, 2)) + [22, 64, 106].map((x) => circ(x, 32, 17, P.wood, 2) + circ(x, 32, 5, P.woodD, 1)).join("")],
    // street
    ["street", "gas-lamp", "Gas street lamp", 1, 1, () => `<circle cx="32" cy="32" r="26" fill="${P.glow}" opacity=".35"/>` + circ(32, 32, 9, P.ironD, 2) + rect(26, 26, 12, 12, P.glow, 2, 1.5)],
    ["street", "traffic-signal", "Traffic signal lamps", 1, 1, () => withShadow(rect(20, 6, 24, 52, P.ironD, 5)) + circ(32, 18, 6, "#d8402e", 1.5) + circ(32, 32, 6, "#e7b23a", 1.5) + circ(32, 46, 6, "#4caf6a", 1.5)],
    ["street", "semaphore", "Semaphore signal", 1, 1, () => circ(32, 32, 7, P.ironD, 2) + rect(32, 26, 26, 8, "#d8402e", 1, 1.5) + rect(4, 30, 26, 8, P.paper, 1, 1.5) + line("M8 34H26", K, 2, 'stroke-dasharray="3 3"')],
    ["street", "street-sign", "Street sign", 1, 1, () => circ(32, 32, 4, P.ironD, 1.5) + rect(10, 20, 44, 10, "#2f4a7a", 2, 1.5) + rect(16, 34, 36, 10, "#2f4a7a", 2, 1.5) + line("M14 25H50M20 39H48", P.paper, 1.5)],
    ["street", "bench", "Park bench", 2, 1, () => withShadow(rect(8, 18, 112, 28, P.wood, 2)) + planks(8, 18, 112, 28, 3) + rect(8, 14, 6, 36, P.ironD, 2, 1.5) + rect(114, 14, 6, 36, P.ironD, 2, 1.5)],
    ["street", "pillar-box", "Pillar box", 1, 1, () => withShadow(circ(32, 32, 16, "#b3261e")) + circ(32, 32, 10, "#c73a30", 1.5) + line("M24 32H40", K, 2)],
    ["street", "fountain", "Fountain", 2, 2, () => withShadow(circ(64, 64, 54, P.stone)) + circ(64, 64, 44, P.water, 2) + circ(64, 64, 16, P.stone, 2) + circ(64, 64, 6, P.glass, 1.5) + line("M64 40V30M88 64H98M64 88V98M40 64H30", "#d9eef4", 2)],
    ["street", "hydrant", "Fire hydrant", 1, 1, () => withShadow(circ(32, 32, 12, P.red)) + rect(18, 28, 28, 8, P.red, 2, 1.5) + circ(32, 32, 5, P.brass, 1.5)],
    ["street", "telegraph-pole", "Telegraph pole", 1, 1, () => circ(32, 32, 7, P.woodD, 2) + rect(4, 28, 56, 7, P.wood, 1, 1.5) + [10, 22, 42, 54].map((x) => circ(x, 31, 3, P.glass, 1)).join("")],
    ["street", "kiosk", "News kiosk", 2, 2, () => withShadow(path_("M40 10H88L118 40V88L88 118H40L10 88V40Z", P.green)) + path_("M44 22H84L106 44V84L84 106H44L22 84V44Z", "#355d40", 1.5) + circ(64, 64, 8, P.brass, 2)],
    ["street", "street-clock", "Street clock", 1, 1, () => circ(32, 32, 6, P.ironD, 2) + circ(32, 32, 18, "none", 0) + circ(32, 32, 14, P.paper, 2) + line("M32 32V22M32 32L39 35", K, 1.5)],
    ["street", "manhole", "Manhole cover", 1, 1, () => circ(32, 32, 20, P.iron, 2) + Array.from({ length: 4 }, (_, i) => line(`M${18 + i * 9} 18V46`, P.ironD, 1.5)).join("")],
    ["street", "horse-trough", "Horse trough", 2, 1, () => withShadow(rect(6, 16, 116, 32, P.stone, 4)) + rect(14, 22, 100, 20, P.water, 2, 1.5)],
    ["street", "lamp-post-double", "Double gas lamp", 1, 1, () => `<ellipse cx="32" cy="32" rx="30" ry="18" fill="${P.glow}" opacity=".3"/>` + line("M10 32H54", P.ironD, 3) + circ(32, 32, 6, P.ironD, 2) + rect(4, 26, 12, 12, P.glow, 2, 1.5) + rect(48, 26, 12, 12, P.glow, 2, 1.5)],
    // vehicles
    ["vehicles", "steam-car", "Steam car", 2, 3, () => wheel(16, 40, 8, 13) + wheel(112, 40, 8, 13) + wheel(16, 150, 8, 13) + wheel(112, 150, 8, 13) + withShadow(rect(20, 14, 88, 164, "#2f4a7a", 18)) + rect(30, 24, 68, 40, P.brass, 10, 2) + circ(64, 44, 12, P.copper, 2) + rect(28, 76, 72, 54, P.leather, 8, 2) + rect(34, 138, 60, 30, "#24395e", 6, 1.5) + `<circle cx="70" cy="26" r="9" fill="#e6e6e6" opacity=".7"/>`],
    ["vehicles", "carriage", "Horse-drawn carriage", 2, 4, () => [36, 92].map((x) => withShadow(path_(`M${x - 10} 30Q${x} 4 ${x + 10} 30V82H${x - 10}Z`, x < 64 ? "#6e4826" : "#3a2a1e"))).join("") + line("M48 82V108M80 82V108", P.woodD, 3) + wheel(14, 150, 7, 16) + wheel(114, 150, 7, 16) + wheel(14, 228, 7, 16) + wheel(114, 228, 7, 16) + withShadow(rect(20, 108, 88, 140, K, 10)) + rect(28, 120, 72, 112, "#2d2620", 8, 1.5) + rect(36, 132, 56, 40, P.velvet, 4, 1.5) + rect(36, 182, 56, 40, P.velvet, 4, 1.5)],
    ["vehicles", "steam-tram", "Steam tram", 2, 5, () => withShadow(rect(10, 6, 108, 308, "#7a2424", 14)) + rect(18, 16, 92, 288, "#a83a32", 10, 2) + Array.from({ length: 6 }, (_, i) => rect(24, 30 + i * 44, 80, 30, P.cloth, 3, 1.5)).join("") + rect(48, 0, 32, 14, P.brass, 4, 2) + `<circle cx="64" cy="10" r="10" fill="#e6e6e6" opacity=".6"/>`],
    ["vehicles", "locomotive", "Steam locomotive", 2, 5, () => withShadow(rect(14, 6, 100, 308, K, 10)) + rect(26, 14, 76, 190, "#333338", 36, 2) + rivets(Array.from({ length: 8 }, (_, i) => [64, 40 + i * 22])) + circ(64, 40, 16, K, 2) + `<circle cx="64" cy="40" r="22" fill="#d0d0d0" opacity=".6"/>` + circ(64, 112, 12, P.brass, 2) + rect(18, 212, 92, 96, "#5b2323", 6, 2) + rect(30, 222, 68, 36, P.ironD, 3, 1.5) + path_("M14 6L64 -4L114 6", P.red, 2)],
    ["vehicles", "rail-carriage", "Railway carriage", 2, 5, () => withShadow(rect(12, 6, 104, 308, "#2f4a2f", 10)) + rect(20, 14, 88, 292, "#3f6b4a", 8, 2) + line("M20 60H108M20 110H108M20 160H108M20 210H108M20 260H108", "#2d4d35", 2) + rect(54, 2, 20, 8, P.ironD, 2, 1.5) + rect(54, 310, 20, 8, P.ironD, 2, 1.5)],
    ["vehicles", "steam-lorry", "Steam lorry", 2, 4, () => wheel(14, 40, 8, 15) + wheel(114, 40, 8, 15) + wheel(14, 196, 8, 15) + wheel(114, 196, 8, 15) + withShadow(rect(18, 10, 92, 236, P.iron, 8)) + rect(24, 16, 80, 70, "#7a2424", 8, 2) + circ(64, 40, 16, P.copper, 2) + rect(22, 94, 84, 146, P.woodL, 3, 2) + planks(22, 94, 84, 146, 6)],
    ["vehicles", "velocipede", "Velocipede", 1, 1, () => wheel(32, 18, 4, 16) + wheel(32, 52, 3, 8) + line("M32 18V52", P.iron, 3) + line("M22 22H42", P.ironD, 3) + rect(28, 32, 8, 10, P.leather, 2, 1.5)],
    ["vehicles", "airship", "Airship", 4, 8, () => withShadow(`<ellipse cx="128" cy="230" rx="104" ry="220" fill="#c9b48a" ${ol(3)}/>`) + Array.from({ length: 7 }, (_, i) => line(`M${44 + i * 28} ${30 + Math.abs(3 - i) * 30}Q${44 + i * 28} 230 ${44 + i * 28} ${430 - Math.abs(3 - i) * 30}`, "#a6915f", 2)).join("") + rect(96, 210, 64, 120, P.woodD, 8, 2.5) + rect(104, 220, 48, 100, P.wood, 4, 1.5) + path_("M128 440L84 500H172Z", P.red, 2.5) + path_("M128 430V506", "none", 2)],
    ["vehicles", "steam-launch", "Steam launch", 2, 4, () => withShadow(path_("M64 4Q118 60 112 180Q108 240 64 252Q20 240 16 180Q10 60 64 4Z", P.wood)) + path_("M64 20Q104 70 98 180Q94 228 64 238Q34 228 30 180Q24 70 64 20Z", P.woodL, 1.5) + circ(64, 110, 14, P.brass, 2) + `<circle cx="70" cy="104" r="12" fill="#e6e6e6" opacity=".65"/>` + rect(40, 160, 48, 50, P.cloth, 4, 1.5)],
    ["vehicles", "handcart", "Handcart", 1, 2, () => wheel(6, 70, 5, 12) + wheel(58, 70, 5, 12) + withShadow(rect(10, 40, 44, 70, P.woodL, 2)) + planks(10, 40, 44, 70, 4) + line("M18 40L14 4M46 40L50 4", P.woodD, 3)],
    // bridges, doors, stairs
    ["bridges", "bridge-plank", "Plank bridge", 2, 4, () => withShadow(rect(14, 0, 100, 256, P.wood, 2)) + Array.from({ length: 15 }, (_, i) => line(`M16 ${16 + i * 16}H112`, P.woodD, 1.8)).join("") + rect(8, 0, 8, 256, P.woodD, 2, 2) + rect(112, 0, 8, 256, P.woodD, 2, 2)],
    ["bridges", "bridge-stone", "Stone arch bridge", 3, 5, () => withShadow(rect(20, 0, 152, 320, P.stone, 4)) + rect(36, 0, 120, 320, "#c2bcae", 0, 1.5) + Array.from({ length: 12 }, (_, i) => line(`M36 ${24 + i * 26}H156`, P.stoneD, 1.2)).join("") + rect(14, 0, 22, 320, P.stoneD, 3, 2) + rect(156, 0, 22, 320, P.stoneD, 3, 2)],
    ["bridges", "bridge-iron", "Iron truss bridge", 3, 6, () => withShadow(rect(20, 0, 152, 384, P.iron, 2)) + rect(34, 0, 124, 384, "#6f6a62", 0, 1.5) + rect(16, 0, 18, 384, P.ironD, 2, 2) + rect(158, 0, 18, 384, P.ironD, 2, 2) + Array.from({ length: 8 }, (_, i) => line(`M34 ${i * 48}L158 ${i * 48 + 48}M158 ${i * 48}L34 ${i * 48 + 48}`, P.ironD, 2.5)).join("") + rivets(Array.from({ length: 9 }, (_, i) => [25, i * 48]).concat(Array.from({ length: 9 }, (_, i) => [167, i * 48])))],
    ["bridges", "bridge-rope", "Rope bridge", 1, 5, () => Array.from({ length: 19 }, (_, i) => rect(10, 6 + i * 16, 44, 10, P.woodL, 1, 1.5)).join("") + line("M8 0V320M56 0V320", "#a8946a", 3)],
    ["doors", "door-swing", "Door", 1, 2, () => rect(0, 58, 6, 12, K, 0, 0) + rect(58, 58, 6, 12, K, 0, 0) + `<path d="M58 64A52 52 0 0 0 6 12" fill="none" stroke="${K}" stroke-width="1.2" stroke-dasharray="3 3"/>` + rect(6, 12, 7, 52, P.wood, 1, 1.5) + circ(9.5, 60, 2, P.brass, 0.8)],
    ["doors", "double-door-swing", "Double door", 2, 2, () => rect(0, 58, 6, 12, K, 0, 0) + rect(122, 58, 6, 12, K, 0, 0) + `<path d="M64 64A58 58 0 0 0 6 6M64 64A58 58 0 0 1 122 6" fill="none" stroke="${K}" stroke-width="1.2" stroke-dasharray="3 3"/>` + rect(6, 6, 7, 58, P.wood, 1, 1.5) + rect(115, 6, 7, 58, P.wood, 1, 1.5)],
    ["doors", "door", "Door (closed, old)", 1, 1, () => rect(0, 26, 6, 12, K, 0, 0) + rect(58, 26, 6, 12, K, 0, 0) + rect(6, 28, 52, 8, P.wood, 1, 1.5) + `<path d="M6 32A52 52 0 0 1 58 -20" fill="none" stroke="${K}" stroke-width="1" stroke-dasharray="3 3"/>`, { hidden: true }],
    ["doors", "double-door", "Double door (closed, old)", 2, 1, () => rect(0, 26, 8, 12, K, 0, 0) + rect(120, 26, 8, 12, K, 0, 0) + rect(8, 28, 56, 8, P.wood, 1, 1.5) + rect(64, 28, 56, 8, P.wood, 1, 1.5), { hidden: true }],
    ["doors", "window", "Window", 1, 1, () => rect(0, 26, 64, 12, K, 0, 0) + rect(6, 28, 52, 8, P.glass, 1, 1.5) + line("M32 28V36", K, 1.5)],
    ["doors", "stairs", "Stairs", 1, 2, () => withShadow(rect(4, 2, 56, 124, P.stone, 2)) + Array.from({ length: 9 }, (_, i) => line(`M6 ${14 + i * 12}H58`, P.stoneD, 2)).join("") + line("M32 116V24", K, 2) + path_("M24 32L32 20L40 32", "none", 2)],
    ["doors", "spiral-stairs", "Spiral stairs", 2, 2, () => withShadow(circ(64, 64, 56, P.stone)) + Array.from({ length: 12 }, (_, i) => line(`M64 64L${64 + 56 * Math.cos((i * Math.PI) / 6)} ${64 + 56 * Math.sin((i * Math.PI) / 6)}`, P.stoneD, 2)).join("") + circ(64, 64, 10, P.ironD, 2)],
    ["doors", "ladder", "Ladder", 1, 1, () => line("M20 2V62M44 2V62", P.woodD, 4) + Array.from({ length: 5 }, (_, i) => line(`M20 ${8 + i * 12}H44`, P.wood, 3)).join("")],
    ["doors", "trapdoor", "Trapdoor", 1, 1, () => withShadow(rect(8, 8, 48, 48, P.wood, 2)) + planks(8, 8, 48, 48, 4, true) + circ(48, 32, 4, P.ironD, 1.5)],
    // fire escapes and building services
    ["services", "fire-escape-landing", "Fire escape landing", 3, 2, () => withShadow(rect(4, 4, 184, 120, "#3a3a41", 2)) + Array.from({ length: 23 }, (_, i) => line(`M${10 + i * 8} 8V120`, "#55555e", 2)).join("") + Array.from({ length: 15 }, (_, i) => line(`M8 ${10 + i * 8}H184`, "#55555e", 1)).join("") + rect(4, 4, 184, 120, "none", 2, 3) + line("M8 8H184V120", "#1f1f24", 4) + rect(150, 30, 30, 60, "#2b2b30", 2, 2) + Array.from({ length: 6 }, (_, i) => line(`M152 ${36 + i * 9}H178`, "#6f727a", 2)).join("")],
    ["services", "fire-escape-stairs", "Fire escape stairs", 1, 3, () => withShadow(rect(8, 2, 48, 188, "#3a3a41", 2)) + Array.from({ length: 15 }, (_, i) => rect(12, 6 + i * 12, 40, 8, "#55555e", 1, 1)).join("") + line("M8 2V190M56 2V190", "#1f1f24", 4) + path_("M24 176L32 166L40 176", "none", 2)],
    ["services", "fire-escape-ladder", "Fire escape ladder", 1, 1, () => line("M20 2V62M44 2V62", "#2b2b30", 4) + Array.from({ length: 6 }, (_, i) => line(`M20 ${6 + i * 11}H44`, "#6f727a", 3)).join("") + rect(14, 0, 36, 6, "#3a3a41", 1, 1.5)],
    ["services", "drainpipe", "Drainpipe", 1, 1, () => circ(32, 32, 9, "#4d5157", 2) + circ(32, 32, 5, "#2b2b30", 1) + rect(26, 0, 12, 22, "#6f747b", 2, 1.5)],
    ["services", "ac-window-unit", "Window air conditioner", 1, 1, () => withShadow(rect(6, 14, 52, 38, "#d8d6cf", 3)) + Array.from({ length: 6 }, (_, i) => line(`M10 ${20 + i * 5}H54`, "#a9a69d", 1.5)).join("") + rect(10, 46, 44, 4, "#8f8c84", 1, 1)],
    ["services", "ac-rooftop", "Rooftop air handler", 2, 2, () => withShadow(rect(6, 6, 116, 116, "#c9ccd0", 4)) + rect(14, 14, 100, 46, "#b1b5ba", 2, 1.5) + Array.from({ length: 12 }, (_, i) => line(`M${18 + i * 8} 18V56`, "#8f949b", 1.5)).join("") + circ(40, 90, 22, P.ironD, 2) + circ(40, 90, 4, P.steel, 1) + circ(92, 90, 22, P.ironD, 2) + circ(92, 90, 4, P.steel, 1) + [40, 92].map((x) => Array.from({ length: 4 }, (_, i) => { const a = (i * Math.PI) / 2 + 0.4; return path_(`M${x} 90L${x + 18 * Math.cos(a)} ${90 + 18 * Math.sin(a)}L${x + 18 * Math.cos(a + 0.6)} ${90 + 18 * Math.sin(a + 0.6)}Z`, "#8f949b", 1); }).join("")).join("")],
    ["services", "condensing-unit", "Condensing unit", 1, 1, () => withShadow(rect(4, 4, 56, 56, "#d0d2d4", 4)) + circ(32, 32, 22, "#3a3a41", 2) + Array.from({ length: 5 }, (_, i) => `<circle cx="32" cy="32" r="${4 + i * 4}" fill="none" stroke="#8f949b" stroke-width="1"/>`).join("") + line("M10 32H54M32 10V54", "#8f949b", 1) + circ(32, 32, 4, P.steel, 1)],
    ["services", "condensing-unit-twin", "Condensing unit (twin fan)", 2, 1, () => withShadow(rect(4, 6, 120, 52, "#d0d2d4", 4)) + [36, 92].map((x) => circ(x, 32, 22, "#3a3a41", 2) + Array.from({ length: 5 }, (_, i) => `<circle cx="${x}" cy="32" r="${4 + i * 4}" fill="none" stroke="#8f949b" stroke-width="1"/>`).join("") + circ(x, 32, 4, P.steel, 1)).join("")],
    ["services", "ac-split-indoor", "Split air conditioner (wall)", 2, 1, () => withShadow(rect(4, 4, 120, 20, "#f2f1ec", 6)) + line("M14 18H114", "#c9c7bf", 2) + circ(112, 12, 2, "#4caf6a", 0.5)],
    ["services", "boiler-wall", "Wall boiler", 1, 1, () => withShadow(rect(10, 4, 44, 34, "#f2f1ec", 3)) + rect(18, 30, 28, 4, "#c9c7bf", 1, 1) + circ(32, 18, 5, "#3f6fa8", 1) + line("M22 38V50M32 38V50M42 38V50", P.copper, 3)],
    ["services", "electric-meter", "Meter box", 1, 1, () => withShadow(rect(14, 6, 36, 24, "#6b6f5e", 2)) + circ(32, 18, 7, P.paper, 1.2) + line("M32 18L36 15", K, 1)],
    // white goods
    ["appliances", "refrigerator", "Refrigerator", 1, 1, () => withShadow(rect(6, 6, 52, 52, "#f2f1ec", 4)) + line("M6 22H58", "#c9c7bf", 2) + rect(48, 10, 4, 8, "#9a978f", 1, 0.8) + rect(48, 28, 4, 14, "#9a978f", 1, 0.8)],
    ["appliances", "fridge-freezer-double", "American fridge-freezer", 2, 1, () => withShadow(rect(4, 6, 120, 52, "#c9ccd0", 4)) + line("M64 8V56", "#9aa0a8", 2) + rect(56, 22, 4, 20, "#6f747b", 1, 0.8) + rect(68, 22, 4, 20, "#6f747b", 1, 0.8) + rect(16, 14, 22, 14, "#3a3a41", 2, 1)],
    ["appliances", "chest-freezer", "Chest freezer", 2, 1, () => withShadow(rect(4, 8, 120, 48, "#f2f1ec", 4)) + rect(10, 14, 108, 36, "#e6e4dd", 3, 1) + rect(54, 48, 20, 5, "#9a978f", 1, 0.8)],
    ["appliances", "washing-machine", "Washing machine", 1, 1, () => withShadow(rect(6, 6, 52, 52, "#f2f1ec", 4)) + rect(10, 10, 44, 10, "#e1dfd8", 1, 1) + circ(18, 15, 3, "#9a978f", 0.8) + circ(32, 38, 15, "#bcdde4", 2) + circ(32, 38, 9, "#8fb8c4", 1)],
    ["appliances", "tumble-dryer", "Tumble dryer", 1, 1, () => withShadow(rect(6, 6, 52, 52, "#f2f1ec", 4)) + rect(10, 10, 44, 10, "#e1dfd8", 1, 1) + circ(46, 15, 3, "#d8402e", 0.8) + circ(32, 38, 15, "#d9d7d0", 2) + Array.from({ length: 4 }, (_, i) => line(`M${22 + i * 6} 32V44`, "#b1aea6", 1.5)).join("")],
    ["appliances", "dishwasher", "Dishwasher", 1, 1, () => withShadow(rect(6, 6, 52, 52, "#d0d2d4", 4)) + rect(10, 10, 44, 8, "#3a3a41", 1, 1) + circ(16, 14, 1.5, "#4caf6a", 0.5) + line("M14 26H50", "#9aa0a8", 2)],
    ["appliances", "cooker", "Cooker (four rings)", 1, 1, () => withShadow(rect(4, 4, 56, 56, "#f2f1ec", 4)) + rect(8, 8, 48, 44, "#2b2b30", 2, 1) + [[20, 20], [44, 20], [20, 40], [44, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8" fill="none" stroke="#6f727a" stroke-width="2"/>`).join("") + Array.from({ length: 4 }, (_, i) => circ(14 + i * 12, 56, 2, "#9a978f", 0.6)).join("")],
    ["appliances", "microwave", "Microwave", 1, 1, () => withShadow(rect(10, 16, 44, 30, "#3a3a41", 3)) + rect(14, 20, 28, 22, "#5d5d66", 2, 1) + rect(45, 22, 6, 16, "#2b2b30", 1, 0.8)],
    ["appliances", "water-heater-tank", "Hot water cylinder", 1, 1, () => withShadow(circ(32, 32, 22, "#c8743f")) + circ(32, 32, 16, "#b8673a", 1.5) + circ(32, 32, 5, P.brass, 1)],
    // bins and dumpsters
    ["waste", "wheelie-bin", "Wheelie bin", 1, 1, () => withShadow(rect(12, 8, 40, 44, "#3f6b4a", 4)) + rect(12, 8, 40, 10, "#2f5238", 3, 1.5) + wheel(16, 56, 4, 4) + wheel(48, 56, 4, 4)],
    ["waste", "wheelie-bin-recycling", "Recycling bin", 1, 1, () => withShadow(rect(12, 8, 40, 44, "#2f4a7a", 4)) + rect(12, 8, 40, 10, "#24395e", 3, 1.5) + path_("M26 34l6-8 6 8M38 38l-6 8-6-8", "none", 1.5)],
    ["waste", "dustbin", "Dustbin", 1, 1, () => withShadow(circ(32, 32, 20, "#8f949b")) + circ(32, 32, 16, "#a7adb5", 1.5) + rect(26, 30, 12, 4, "#5d5d66", 1, 1)],
    ["waste", "litter-bin", "Street litter bin", 1, 1, () => withShadow(circ(32, 32, 16, "#2b2b30")) + circ(32, 32, 11, "#1a1a1d", 1.2) + circ(32, 32, 16, "none", 0) + rect(28, 14, 8, 6, P.brass, 1, 1)],
    ["waste", "dumpster", "Dumpster", 2, 1, () => withShadow(rect(4, 6, 120, 52, "#3f6b4a", 3)) + rect(6, 8, 56, 48, "#355d40", 2, 1.5) + rect(66, 8, 56, 48, "#355d40", 2, 1.5) + line("M10 14H58M70 14H118", "#2d4d35", 2) + rect(0, 26, 6, 12, P.ironD, 1, 1) + rect(122, 26, 6, 12, P.ironD, 1, 1)],
    ["waste", "dumpster-open", "Dumpster (open, full)", 2, 1, () => withShadow(rect(4, 6, 120, 52, "#3f6b4a", 3)) + rect(10, 12, 108, 40, "#2b2a27", 2, 1.5) + Array.from({ length: 14 }, (_, i) => rect(14 + ((i * 29) % 96), 14 + ((i * 13) % 30), 10 + (i % 3) * 4, 8 + (i % 2) * 4, ["#3a3a41", "#c9c3b0", "#8e2f2f", "#5d5d66", "#d9d4c7"][i % 5], 2, 0.8)).join("")],
    ["waste", "skip", "Builder's skip", 3, 2, () => withShadow(path_("M10 10H182L170 118H22Z", "#d9b23a")) + path_("M26 22H166L158 106H34Z", "#a8862a", 1.5) + Array.from({ length: 10 }, (_, i) => rect(40 + ((i * 37) % 110), 30 + ((i * 23) % 64), 16, 10, ["#8a6238", "#9d988e", "#6e4826", "#b3ada2"][i % 4], 1, 0.8)).join("")],
    ["waste", "rubbish-bags", "Rubbish bags", 1, 1, () => [[22, 26, 14], [42, 30, 13], [30, 44, 12]].map(([x, y, r]) => withShadow(circ(x, y, r, "#2b2b30")) + path_(`M${x - 3} ${y - r + 2}l3 -4 3 4`, "none", 1.5)).join("")],
    ["waste", "recycling-bank", "Recycling bank", 3, 1, () => ["#3f6b4a", "#2f4a7a", "#9b3030"].map((c, i) => withShadow(rect(4 + i * 62, 8, 58, 48, c, 6)) + circ(33 + i * 62, 32, 8, "#1a1a1d", 1.2)).join("")],
    // nature (top-down)
    ["nature", "tree-oak", "Oak tree", 2, 2, () => withShadow(circ(64, 64, 52, P.leaf)) + [[44, 46, 26], [84, 50, 24], [60, 84, 26], [84, 84, 18], [40, 78, 18]].map(([x, y, r]) => circ(x, y, r, P.leafL, 1.5)).join("") + circ(52, 52, 8, "#86b25e", 0)],
    ["nature", "tree-pine", "Pine tree", 2, 2, () => withShadow(path_(Array.from({ length: 16 }, (_, i) => { const a = (i * Math.PI) / 8, r = i % 2 ? 30 : 54; return `${i ? "L" : "M"}${(64 + r * Math.cos(a)).toFixed(1)} ${(64 + r * Math.sin(a)).toFixed(1)}`; }).join("") + "Z", P.leafD)) + path_(Array.from({ length: 16 }, (_, i) => { const a = (i * Math.PI) / 8 + 0.2, r = i % 2 ? 16 : 32; return `${i ? "L" : "M"}${(64 + r * Math.cos(a)).toFixed(1)} ${(64 + r * Math.sin(a)).toFixed(1)}`; }).join("") + "Z", P.leaf, 1.5)],
    ["nature", "bush", "Bush", 1, 1, () => withShadow(circ(32, 32, 22, P.leaf)) + circ(24, 26, 10, P.leafL, 1.2) + circ(40, 36, 9, P.leafL, 1.2)],
    ["nature", "rock", "Rock", 1, 1, () => withShadow(path_("M14 40L18 18L38 10L54 24L50 46L30 54Z", P.stone)) + path_("M18 18L30 30L38 10M30 30L30 54", "none", 1.2)],
    ["nature", "boulder", "Boulder", 2, 2, () => withShadow(path_("M20 80L30 30L70 14L108 36L114 84L80 114L36 110Z", P.stone)) + path_("M30 30L60 60L70 14M60 60L36 110M60 60L108 36M60 60L114 84", "none", 1.5)],
    ["nature", "stump", "Tree stump", 1, 1, () => withShadow(circ(32, 32, 16, P.woodL)) + circ(32, 32, 10, "none", 1) + circ(32, 32, 4, "none", 1)],
    ["nature", "log", "Fallen log", 2, 1, () => withShadow(rect(8, 20, 112, 24, P.wood, 12)) + circ(108, 32, 11, P.woodL, 1.5) + circ(108, 32, 5, "none", 1) + line("M20 28H90M26 36H80", P.woodD, 1.2)],
    ["nature", "flowers", "Flower bed", 1, 1, () => circ(32, 32, 26, P.leaf, 1.5) + [[20, 22, "#d8402e"], [40, 18, "#e7b23a"], [44, 40, "#d8402e"], [24, 44, "#efe6cf"], [32, 30, "#8e5bd0"]].map(([x, y, c]) => circ(x, y, 5, c, 1)).join("")],
];

// ---- mechanical plant (top-down). Ports are connection points (0..1 of the stamp's box) that pipes snap to.
const PLANT = [
    ["centrifugal-pump", "Centrifugal pump", 2, 1, () => withShadow(rect(4, 14, 54, 36, P.green, 6)) + Array.from({ length: 5 }, (_, i) => line(`M${12 + i * 9} 16V48`, "#2d4d35", 2)).join("") + rect(58, 26, 10, 12, P.ironD, 1, 1.5) + circ(92, 32, 24, P.iron) + circ(92, 32, 14, P.steel, 2) + circ(92, 32, 4, P.ironD, 1) + rect(104, 26, 24, 12, P.ironD, 1, 1.5) + rivets([[8, 18], [54, 18], [8, 46], [54, 46]]), [[0, 0.5], [1, 0.5]]],
    ["compressor", "Compressor", 2, 2, () => withShadow(rect(6, 6, 116, 116, P.iron, 8)) + circ(40, 44, 24, P.steel) + circ(40, 44, 10, P.ironD, 2) + circ(88, 84, 24, P.steel) + circ(88, 84, 10, P.ironD, 2) + line("M40 44L88 84", P.ironD, 6) + rivets([[14, 14], [114, 14], [14, 114], [114, 114]]), [[0, 0.25], [1, 0.75]]],
    ["heat-exchanger", "Heat exchanger", 3, 1, () => withShadow(rect(10, 12, 172, 40, P.steel, 20)) + rect(10, 12, 26, 40, P.iron, 10, 2) + rect(156, 12, 26, 40, P.iron, 10, 2) + Array.from({ length: 7 }, (_, i) => line(`M${46 + i * 16} 14V50`, "#7d828a", 1.5)).join("") + rect(0, 26, 10, 12, P.ironD, 1, 1.5) + rect(182, 26, 10, 12, P.ironD, 1, 1.5), [[0, 0.5], [1, 0.5]]],
    ["cooling-tower", "Cooling tower", 3, 3, () => withShadow(circ(96, 96, 88, "#c2bcb0")) + circ(96, 96, 74, "#a39e93", 2) + circ(96, 96, 60, P.ironD, 2) + Array.from({ length: 6 }, (_, i) => { const a = (i * Math.PI) / 3; return path_(`M96 96L${96 + 56 * Math.cos(a)} ${96 + 56 * Math.sin(a)}L${96 + 56 * Math.cos(a + 0.45)} ${96 + 56 * Math.sin(a + 0.45)}Z`, P.steel, 1.5); }).join("") + circ(96, 96, 10, P.brass, 2) + `<circle cx="120" cy="70" r="26" fill="#e6e6e6" opacity=".45"/>`, [[0.5, 1]]],
    ["steam-turbine", "Steam turbine", 3, 2, () => withShadow(path_("M12 40L120 20H176V108H120L12 88Z", P.steel)) + path_("M12 40L120 20V108L12 88Z", "#a9afb7", 1.5) + Array.from({ length: 8 }, (_, i) => line(`M${24 + i * 12} ${40 - i * 2.4}V${88 + i * 2.4}`, "#7d828a", 1.5)).join("") + rect(120, 20, 56, 88, P.iron, 4, 2) + rect(0, 56, 12, 16, P.ironD, 1, 1.5) + rect(176, 56, 16, 16, P.ironD, 1, 1.5) + rivets([[128, 28], [168, 28], [128, 100], [168, 100]]), [[0, 0.5], [1, 0.5]]],
    ["generator", "Generator", 2, 2, () => withShadow(rect(10, 22, 108, 84, P.green, 10)) + Array.from({ length: 9 }, (_, i) => line(`M${20 + i * 11} 24V104`, "#2d4d35", 2.5)).join("") + rect(0, 54, 12, 20, P.steel, 2, 1.5) + rect(40, 10, 48, 14, P.brass, 3, 1.5) + circ(64, 64, 12, P.ironD, 2), [[0, 0.5]]],
    ["transformer", "Transformer", 2, 2, () => withShadow(rect(16, 16, 96, 96, "#6b6f5e", 6)) + Array.from({ length: 6 }, (_, i) => rect(4, 24 + i * 14, 12, 8, "#55594a", 1, 1) + rect(112, 24 + i * 14, 12, 8, "#55594a", 1, 1)).join("") + [40, 64, 88].map((x) => circ(x, 46, 7, "#c9c3a8", 1.5) + circ(x, 46, 3, P.copper, 1)).join("") + rect(36, 72, 56, 26, "#55594a", 3, 1.5) + path_("M58 78L64 86H60L66 94", "none", 1.5)],
    ["condenser", "Condenser", 3, 1, () => withShadow(rect(6, 10, 180, 44, "#8a9aa0", 22)) + Array.from({ length: 10 }, (_, i) => line(`M${24 + i * 15} 12V52`, "#6f7f86", 1.5)).join("") + rect(80, 0, 14, 12, P.ironD, 1, 1.5) + rect(0, 26, 8, 12, P.ironD, 1, 1.5) + rect(184, 26, 8, 12, P.ironD, 1, 1.5), [[0, 0.5], [1, 0.5]]],
    ["water-tank", "Water tank", 3, 3, () => withShadow(circ(96, 96, 84, P.steel)) + circ(96, 96, 72, "#a7adb5", 2) + Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return `<circle cx="${96 + 78 * Math.cos(a)}" cy="${96 + 78 * Math.sin(a)}" r="2.2" fill="${P.ironD}"/>`; }).join("") + circ(96, 96, 14, P.iron, 2) + rect(88, 178, 16, 14, P.ironD, 1, 1.5), [[0.5, 1]]],
    ["fuel-tank", "Fuel tank", 3, 2, () => withShadow(rect(8, 14, 176, 100, "#8e2f2f", 50)) + rect(24, 14, 6, 100, "#6e2424", 0, 0) + rect(162, 14, 6, 100, "#6e2424", 0, 0) + circ(96, 64, 12, P.ironD, 2) + rect(184, 56, 8, 16, P.ironD, 1, 1.5), [[1, 0.5]]],
    ["air-receiver", "Air receiver", 1, 1, () => withShadow(circ(32, 32, 24, P.steel)) + circ(32, 32, 16, "#a7adb5", 1.5) + circ(32, 32, 6, P.paper, 1.2) + line("M32 32L36 28", P.red, 1.2) + rect(0, 28, 9, 8, P.ironD, 1, 1.2), [[0, 0.5]]],
    ["control-cabinet", "Control cabinet", 2, 1, () => withShadow(rect(4, 10, 120, 44, "#5b6b5e", 3)) + line("M64 12V52", "#3f4a41", 2) + [16, 30, 44].map((x) => circ(x, 26, 5, P.paper, 1) + line(`M${x} 26L${x + 3} 23`, P.red, 1)).join("") + [80, 92, 104].map((x, i) => circ(x, 26, 4, ["#d8402e", "#e7b23a", "#4caf6a"][i], 1)).join("") + rect(16, 38, 96, 8, "#3f4a41", 1, 1)],
    ["electrical-panel", "Electrical panel", 1, 1, () => withShadow(rect(8, 14, 48, 36, "#8a8e95", 3)) + Array.from({ length: 4 }, (_, i) => rect(14 + i * 10, 22, 7, 14, K, 1, 0.8) + rect(15.5 + i * 10, 24, 4, 5, "#e7b23a", 0, 0)).join("") + path_("M30 40L34 44H31L35 48", "none", 1.2)],
    ["chiller", "Chiller", 3, 2, () => withShadow(rect(6, 6, 180, 116, "#9aa3a8", 6)) + [48, 96, 144].map((x) => circ(x, 64, 26, P.ironD, 2) + circ(x, 64, 20, "#5d5d66", 1) + path_(`M${x - 18} ${64}H${x + 18}M${x} ${46}V${82}`, "none", 3) + circ(x, 64, 5, P.steel, 1)).join(""), [[0, 0.25], [0, 0.75]]],
    ["ventilation-fan", "Ventilation fan", 2, 2, () => withShadow(rect(8, 8, 112, 112, P.iron, 8)) + circ(64, 64, 48, P.ironD, 2) + Array.from({ length: 5 }, (_, i) => { const a = (i * 2 * Math.PI) / 5; return path_(`M64 64Q${64 + 40 * Math.cos(a)} ${64 + 40 * Math.sin(a)} ${64 + 44 * Math.cos(a + 0.5)} ${64 + 44 * Math.sin(a + 0.5)}Q${64 + 20 * Math.cos(a + 0.6)} ${64 + 20 * Math.sin(a + 0.6)} 64 64Z`, P.steel, 1.5); }).join("") + circ(64, 64, 8, P.brass, 1.5), [[0.5, 0], [0.5, 1]]],
    ["gearbox", "Gearbox", 1, 1, () => withShadow(rect(10, 10, 44, 44, P.iron, 4)) + gear(32, 32, 12, 8, P.brass) + rect(0, 28, 10, 8, P.steel, 1, 1.2) + rect(54, 28, 10, 8, P.steel, 1, 1.2), [[0, 0.5], [1, 0.5]]],
    ["electric-motor", "Electric motor", 2, 1, () => withShadow(rect(6, 12, 90, 40, "#2f4a7a", 12)) + Array.from({ length: 7 }, (_, i) => line(`M${16 + i * 11} 14V50`, "#24395e", 2)).join("") + rect(96, 26, 32, 12, P.steel, 2, 1.5) + rect(30, 4, 30, 10, "#24395e", 2, 1.2)],
    ["flywheel", "Flywheel", 2, 2, () => withShadow(circ(64, 64, 56, P.ironD)) + circ(64, 64, 48, P.iron, 2) + Array.from({ length: 6 }, (_, i) => { const a = (i * Math.PI) / 3; return line(`M64 64L${64 + 46 * Math.cos(a)} ${64 + 46 * Math.sin(a)}`, P.ironD, 6); }).join("") + circ(64, 64, 12, P.steel, 2)],
    ["water-heater", "Water heater", 1, 1, () => withShadow(circ(32, 32, 26, P.paper)) + circ(32, 32, 18, "#d9cdb1", 1.5) + circ(32, 32, 6, P.red, 1.2) + rect(54, 28, 10, 8, P.copper, 1, 1.2) + rect(0, 28, 10, 8, P.copper, 1, 1.2), [[0, 0.5], [1, 0.5]]],
    ["filter-housing", "Filter housing", 1, 1, () => rect(0, 26, 64, 12, P.iron, 0, 1.5) + withShadow(circ(32, 32, 18, P.steel)) + circ(32, 32, 12, "#a7adb5", 1.5) + Array.from({ length: 6 }, (_, i) => { const a = (i * Math.PI) / 3; return `<circle cx="${32 + 15 * Math.cos(a)}" cy="${32 + 15 * Math.sin(a)}" r="1.8" fill="${P.ironD}"/>`; }).join(""), [[0, 0.5], [1, 0.5]]],
    ["valve-manifold", "Valve manifold", 3, 1, () => rect(0, 24, 192, 16, P.copper, 3, 2) + line("M0 28H192", "#d99267", 2) + [48, 96, 144].map((x) => rect(x - 4, 8, 8, 16, P.copper, 1, 1.5) + circ(x, 10, 9, "none", 3) + `<circle cx="${x}" cy="10" r="9" fill="none" stroke="${P.red}" stroke-width="2.5"/>`).join(""), [[0, 0.5], [1, 0.5], [0.25, 0], [0.5, 0], [0.75, 0]]],
    ["steam-accumulator", "Steam accumulator", 2, 2, () => withShadow(circ(64, 64, 54, P.copper)) + circ(64, 64, 44, P.copperD, 2) + rivets(Array.from({ length: 16 }, (_, i) => [64 + 49 * Math.cos((i * Math.PI) / 8), 64 + 49 * Math.sin((i * Math.PI) / 8)])) + circ(64, 64, 14, P.brass, 2) + `<circle cx="72" cy="56" r="14" fill="#e6e6e6" opacity=".5"/>`, [[0.5, 0], [1, 0.5]]],
    ["pressure-vessel", "Pressure vessel", 3, 1, () => withShadow(rect(6, 6, 180, 52, P.steel, 26)) + line("M40 8V56M152 8V56", "#7d828a", 2) + circ(96, 32, 9, P.paper, 1.5) + line("M96 32L101 27", P.red, 1.5) + rect(0, 26, 8, 12, P.ironD, 1, 1.5) + rect(184, 26, 8, 12, P.ironD, 1, 1.5), [[0, 0.5], [1, 0.5]]],
    ["duct-fan-coil", "Fan coil unit", 2, 1, () => withShadow(rect(4, 8, 120, 48, "#b8bec4", 4)) + Array.from({ length: 12 }, (_, i) => line(`M${12 + i * 9} 14V50`, "#8f949b", 1.5)).join("") + circ(100, 32, 14, P.ironD, 1.5), [[0, 0.5]]],
];

// ---- pipework: every style comes in the same pieces; pieces snap together at their ports
const PIPE_STYLES = [
    ["copper", "Copper", { c: P.copper, k: K, hl: "#d99267", w: 18, joint: P.brass }],
    ["iron", "Black iron", { c: "#3a3a41", k: "#17171a", hl: "#6d6d76", w: 18, joint: "#5d5d66" }],
    ["brass", "Brass", { c: P.brass, k: "#5e4b1c", hl: "#e8cf8a", w: 16, joint: P.brassD }],
    ["steel", "Galvanised steel", { c: "#9aa0a8", k: "#4d5157", hl: "#d0d4d8", w: 18, joint: "#6f747b" }],
    ["steam", "Lagged steam", { c: "#d9d4c7", k: "#6e6a60", hl: "#f2efe6", w: 26, joint: "#8a857b", bands: "#9b968a" }],
    ["water", "Water (blue)", { c: "#3f6fa8", k: "#1f3550", hl: "#7fa6d6", w: 18, joint: "#2a4a75" }],
    ["gas", "Gas (yellow)", { c: "#d9b23a", k: "#5e4b1c", hl: "#f0d97a", w: 14, joint: "#a8862a" }],
    ["oil", "Oil (brown)", { c: "#5b3a22", k: "#24170e", hl: "#8a6040", w: 18, joint: "#3e2817" }],
    ["main", "Large main", { c: "#5d5d66", k: "#24242a", hl: "#8f939b", w: 34, joint: "#3a3a41" }],
    ["duct", "Air duct", { c: "#b8bec4", k: "#5d6268", hl: "#e1e5e8", w: 44, joint: "#8f949b", square: true }],
];
const PIPE_PIECES = [
    ["straight", "straight", [[0, 0.5], [1, 0.5]]], ["elbow", "elbow", [[0, 0.5], [0.5, 1]]], ["tee", "tee", [[0, 0.5], [1, 0.5], [0.5, 1]]],
    ["cross", "cross", [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]]], ["cap", "end cap", [[0, 0.5]]], ["valve", "valve", [[0, 0.5], [1, 0.5]]], ["joint", "flanged joint", [[0, 0.5], [1, 0.5]]],
];
function pipePiece(st, piece) {
    const h = st.w / 2, a = 32 - h, b = 32 + h, r = st.square ? 1 : h;
    const run = (d) => `<path d="${d}" fill="none" stroke="${st.k}" stroke-width="${st.w + 3}" stroke-linecap="butt" stroke-linejoin="${st.square ? "miter" : "round"}"/><path d="${d}" fill="none" stroke="${st.c}" stroke-width="${st.w}" stroke-linecap="butt" stroke-linejoin="${st.square ? "miter" : "round"}"/>`;
    const shine = (d) => `<path d="${d}" fill="none" stroke="${st.hl}" stroke-width="${Math.max(1.5, st.w * 0.14)}" stroke-linecap="round" opacity=".8"/>`;
    const bands = (pts) => (st.bands ? pts.map(([x, y, v]) => (v ? `<rect x="${x - h}" y="${y - 1.5}" width="${st.w}" height="3" fill="${st.bands}"/>` : `<rect x="${x - 1.5}" y="${y - h}" width="3" height="${st.w}" fill="${st.bands}"/>`)).join("") : "");
    const flange = (x, y, v) => (v ? rect(x - h - 3, y - 3, st.w + 6, 6, st.joint, 1, 1.2) : rect(x - 3, y - h - 3, 6, st.w + 6, st.joint, 1, 1.2));
    const off = -h * 0.45;
    switch (piece) {
        case "straight": return run("M0 32H64") + shine(`M0 ${32 + off}H64`) + bands([[16, 32], [48, 32]]);
        case "elbow": return run(st.square ? "M0 32H32V64" : "M0 32H20Q32 32 32 44V64") + shine(st.square ? `M0 ${32 + off}H${32 + off}V64` : `M0 ${32 + off}H20Q${32 + off} ${32 + off} ${32 + off} 44V64`) + bands([[12, 32], [32, 52, 1]]);
        case "tee": return run("M0 32H64") + run("M32 32V64") + shine(`M0 ${32 + off}H64`) + (st.square ? "" : circ(32, 32, h + 2, st.joint, 1.5));
        case "cross": return run("M0 32H64") + run("M32 0V64") + shine(`M0 ${32 + off}H64`) + (st.square ? "" : circ(32, 32, h + 3, st.joint, 1.5));
        case "cap": return run("M0 32H30") + shine(`M0 ${32 + off}H28`) + (st.square ? rect(28, a - 2, 8, st.w + 4, st.joint, 1, 1.5) : `<path d="M28 ${a - 1.5}A${h + 1.5} ${h + 1.5} 0 0 1 28 ${b + 1.5}Z" fill="${st.joint}" stroke="${st.k}" stroke-width="1.5"/>`);
        case "valve": return run("M0 32H64") + shine(`M0 ${32 + off}H64`) + path_(`M20 ${a - 4}L44 ${b + 4}V${a - 4}L20 ${b + 4}Z`, st.joint, 1.5) + line(`M32 32V${Math.max(4, a - 10)}`, K, 2.5) + `<circle cx="32" cy="${Math.max(6, a - 12)}" r="7" fill="none" stroke="${P.red}" stroke-width="2.5"/>`;
        case "joint": return run("M0 32H64") + shine(`M0 ${32 + off}H64`) + flange(29, 32) + flange(35, 32) + rivets([[32, a - 1], [32, b + 1]]);
    }
    return "";
}

const SLIDING_DOORS = [
    ["sliding-door", "Sliding door", 64], ["double-sliding-door", "Double sliding door", 128], ["glass-sliding-door", "Glass sliding door", 128, { material: "steel" }],
    ["pocket-door", "Pocket door", 64], ["double-pocket-door", "Double pocket door", 128], ["barn-door", "Barn door", 64],
];
function buildSteampunk() {
    const out = [];
    const svgOf = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w * 64} ${h * 64}" width="${w * 64}" height="${h * 64}">${body}</svg>\n`;
    for (const [group, id, name, w, h, draw, { crop, ...extra } = {}] of STEAM) {
        // crop [x, y, w, h]: the stamp is only that part of its squares (things much smaller than a square, like a
        // mirror on the wall, get a box that fits them)
        if (crop) {
            const [cx, cy, cw, ch] = crop;
            write(`steampunk/${id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cx} ${cy} ${cw} ${ch}" width="${cw}" height="${ch}">${draw()}</svg>\n`);
            out.push({ group, id, name, w: cw / 64, h: ch / 64, ...extra });
            continue;
        }
        write(`steampunk/${id}.svg`, svgOf(w, h, draw()));
        out.push({ group, id, name, w, h, ...extra });
    }
    // sliding doors, drawn like the opening tool draws them (wood, for an opening of 1 or 2 squares)
    for (const [id, name, L, extra] of SLIDING_DOORS) {
        const d = doorStamp(id, L, 64, extra?.material ?? "wood");
        write(`steampunk/${id}.svg`, `${d.svg}\n`);
        out.push({ group: "doors", id, name, w: d.w / 64, h: d.h / 64 });
    }
    for (const [id, name, w, h, draw, ports] of PLANT) {
        write(`steampunk/${id}.svg`, svgOf(w, h, draw()));
        out.push({ group: "plant", id, name, w, h, ports });
    }
    for (const [sid, sname, st] of PIPE_STYLES) for (const [pid, pname, ports] of PIPE_PIECES) {
        const id = `pipe-${sid}-${pid}`;
        write(`pipes/${id}.svg`, svgOf(1, 1, pipePiece(st, pid)));
        out.push({ group: "pipework", id, name: `${sname} ${pname}`, w: 1, h: 1, ports, style: sname, dir: "pipes" });
    }
    return out;
}

// ------------------------------------------------------------------ game-icons: monster tokens and map markers

const MONSTERS = ["dragon-head", "spiked-dragon-head", "wyvern", "hydra", "goblin-head", "orc-head", "troll", "ogre", "minotaur", "cyclops", "centaur", "harpy", "lizardman",
    "kraken-tentacle", "sea-serpent", "mermaid", "wolf-head", "werewolf", "bear-face", "rat", "bat", "snake", "spider-face", "wasp-sting", "dinosaur-rex", "griffin-symbol", "unicorn",
    "floating-ghost", "shambling-zombie", "skeleton", "vampire-dracula", "mummy-head", "imp-laugh", "evil-minion", "slime", "rock-golem", "metal-golem-head", "robot-golem",
    "tracked-robot", "spider-bot", "mono-wheel-robot", "cultist", "bandit", "pirate-captain", "ninja-head", "alien-skull"];
const MARKERS = ["castle", "tower-flag", "village", "house", "church", "tavern-sign", "windmill", "well", "lighthouse", "camping-tent", "campfire", "cave-entrance", "gold-mine",
    "mining", "mine-wagon", "anchor", "ship-wheel", "portal", "magic-portal", "open-treasure-chest", "treasure-map", "crossed-swords", "skull-crossed-bones", "death-skull",
    "scroll-unfurled", "info", "hazard-sign", "poison-bottle", "wolf-trap", "caltrops", "trade", "anvil", "dragon-spiral"];
const STEAM_MARKERS = ["zeppelin", "steam-locomotive", "clock-tower", "factory", "big-gear", "cog", "clockwork", "steamroller", "paddle-steamer", "valve", "pipes", "furnace", "oil-pump", "coal-wagon"];
const MONSTER_BG = { robot: "#2f3b52", default: "#6b1f1f" };

function buildGameIcons(dir) {
    const credits = new Map();
    const find = (name) => { for (const a of fs.readdirSync(dir)) { const f = path.join(dir, a, `${name}.svg`); if (fs.existsSync(f)) return [a, f]; } return null; };
    const pathsOf = (file) => [...fs.readFileSync(file, "utf8").matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
    const out = [];
    const make = (name, kind) => {
        const hit = find(name);
        if (!hit) { console.warn(`game-icons: ${name} not found`); return; }
        const [author, file] = hit;
        credits.set(author, (credits.get(author) ?? 0) + 1);
        const d = pathsOf(file).map((x) => `<path d="${x}"/>`).join("");
        let svg;
        if (kind === "monster") {
            const bg = /robot|golem-head|bot/.test(name) ? MONSTER_BG.robot : MONSTER_BG.default;
            svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><circle cx="64" cy="66" r="58" fill="#000" opacity=".25"/><circle cx="64" cy="62" r="58" fill="${bg}" stroke="#e8d9b5" stroke-width="6"/><g transform="translate(24 22) scale(.15625)" fill="#f3e9d2">${d}</g></svg>\n`;
        } else {
            svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><circle cx="64" cy="64" r="58" fill="#efe6cf" stroke="#4a3522" stroke-width="5"/><g transform="translate(26 26) scale(.1484)" fill="#4a3522">${d}</g></svg>\n`;
        }
        const id = `${kind}-${name}`;
        write(`game-icons/${id}.svg`, svg);
        out.push({ kind, name, id, author });
    };
    for (const n of MONSTERS) make(n, "monster");
    for (const n of MARKERS) make(n, "marker");
    for (const n of STEAM_MARKERS) make(n, "steam");
    write("game-icons/authors.json", JSON.stringify(Object.fromEntries(credits), null, 1));
    return out;
}

// ------------------------------------------------------------------ manifest

const title = (s) => s.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ (\d)$/, " $1");
const list = (rel, ext) => fs.existsSync(path.join(ROOT, rel)) ? fs.readdirSync(path.join(ROOT, rel)).filter((f) => f.endsWith(ext)).sort() : [];

// Azgaar relief icon kinds -> group, default width on a freeform map (px)
const RELIEF = { mount: ["mountains", 70], mountSnow: ["mountains", 70], hill: ["hills", 50], conifer: ["trees", 30], coniferSnow: ["trees", 30], deciduous: ["trees", 30],
    acacia: ["trees", 32], palm: ["trees", 28], deadTree: ["trees", 26], cactus: ["desert", 22], dune: ["desert", 50], grass: ["wetland", 22], swamp: ["wetland", 30], vulcan: ["volcanoes", 70] };
const RELIEF_STYLES = { illustrated: "Illustrated", colored: "Painted", stickers: "Sticker", gray: "Grey" };
// Kenney cartography (ink outline) and medieval RTS (colour) file -> group
const CARTO = { castle: "buildings", castleTall: "buildings", castleWide: "buildings", castleWideLow: "buildings", church: "buildings", churchLarge: "buildings", house: "settlements",
    houseChimney: "settlements", houseSmall: "settlements", houseTall: "settlements", houseViking: "settlements", houses: "settlements", lighthouse: "buildings", mill: "buildings",
    mine: "buildings", ruins: "buildings", stable: "buildings", tent: "settlements", tipi: "settlements", tower: "buildings", towerLow: "buildings", towerTall: "buildings",
    towerWatch: "buildings", watchtower: "buildings", waterWheel: "buildings", well: "buildings", graveyard: "buildings", gate: "buildings", wall: "buildings", pyramid: "desert",
    dock: "water", ship: "water", lake: "water", lakeRound: "water", bridge: "water", bridgeRope: "water", treePine: "trees", treePineLarge: "trees", treePineTall: "trees",
    treePineTallLarge: "trees", treePineTallLow: "trees", treePines: "trees", treePinesSmall: "trees", treeTall: "trees", bush: "trees", palm: "trees", palmLarge: "trees",
    cactus: "desert", cactusLarge: "desert", rocks: "mountains", rocksA: "mountains", rocksB: "mountains", rocksMountain: "mountains", rocksTall: "mountains", vulcano: "volcanoes",
    campfire: "markers", chest: "markers", skull: "markers", flag: "markers", banner: "markers", compass: "markers", fence: "buildings", elementCircle: "markers",
    elementCross: "markers", elementDiamond: "markers", elementShield: "markers", elementSquare: "markers" };
const MEDIEVAL = { Environment_01: ["trees", "Poplar"], Environment_02: ["trees", "Small pine"], Environment_03: ["trees", "Pine"], Environment_04: ["trees", "Stump"],
    Environment_05: ["trees", "Log"], Environment_06: ["mountains", "Pebble"], Environment_07: ["mountains", "Rock"], Environment_08: ["mountains", "Rocks"],
    Environment_09: ["mountains", "Rock pile"], Environment_10: ["mountains", "Ore rocks"], Environment_11: ["mountains", "Gold ore"], Environment_12: ["trees", "Bush"],
    Environment_13: ["desert", "Sandstone pebble"], Environment_14: ["desert", "Sandstone"], Environment_15: ["desert", "Sandstone rocks"], Environment_16: ["desert", "Sandstone pile"],
    Environment_17: ["desert", "Copper ore"], Environment_18: ["desert", "Copper ore 2"], Environment_19: ["trees", "Berry bush"], Environment_20: ["markers", "Fire"],
    Environment_21: ["trees", "Cypress"], Structure_01: ["buildings", "Tower roof"], Structure_02: ["buildings", "Castle gate"], Structure_03: ["buildings", "Market hall"],
    Structure_04: ["buildings", "Chapel"], Structure_05: ["buildings", "Keep"], Structure_06: ["buildings", "Castle"], Structure_07: ["settlements", "Bakery stall"],
    Structure_08: ["buildings", "Watch post"], Structure_09: ["settlements", "Long hall"], Structure_10: ["settlements", "Tent"], Structure_11: ["settlements", "House"],
    Structure_12: ["buildings", "Statue"], Structure_16: ["settlements", "Barn"], Structure_17: ["settlements", "Cottage"], Structure_18: ["settlements", "Farmhouse"],
    Structure_19: ["buildings", "Temple"], Structure_20: ["settlements", "Smithy"], Structure_21: ["settlements", "Workshop"], Structure_22: ["settlements", "Market stall"],
    Structure_23: ["settlements", "Hut"] };

const GROUPS = [
    // freeform
    ["mountains", "Mountains & rocks", "freeform"], ["hills", "Hills", "freeform"], ["trees", "Trees & forests", "both"], ["desert", "Desert", "freeform"],
    ["wetland", "Wetland & grass", "freeform"], ["volcanoes", "Volcanoes", "freeform"], ["settlements", "Settlements", "freeform"], ["buildings", "Buildings & landmarks", "freeform"],
    ["water", "Water & coast", "freeform"], ["steam-landmarks", "Steampunk landmarks", "freeform"], ["markers", "Markers & symbols", "both"], ["monsters", "Monsters", "both"],
    // square grid
    ["furniture", "Furniture", "grid"], ["decor", "Plants & decor", "grid"], ["rugs", "Rugs", "grid"], ["kitchen", "Kitchen & bath", "grid"], ["machines", "Workshop & machinery", "grid"], ["pipes", "Pipes & valves", "grid"], ["pipework", "Pipework (snaps together)", "grid"], ["plant", "Mechanical plant", "grid"],
    ["services", "Fire escapes & building services", "grid"], ["appliances", "White goods", "grid"], ["waste", "Bins & dumpsters", "grid"],
    ["containers", "Crates & barrels", "grid"], ["street", "Street furniture", "grid"], ["vehicles", "Vehicles", "grid"], ["bridges", "Bridges", "grid"],
    ["doors", "Doors, windows & stairs", "grid"], ["nature", "Nature (top-down)", "grid"],
];

function manifest(steam, icons) {
    const stamps = [];
    const add = (s) => stamps.push(s);
    for (const [dir, style] of Object.entries(RELIEF_STYLES)) for (const f of list(`azgaar/relief/${dir}`, ".svg")) {
        const kind = f.replace(/-\d+\.svg$/, "");
        const [group, w] = RELIEF[kind] ?? ["markers", 40];
        add({ id: `azgaar/${dir}/${f.replace(".svg", "")}`, name: title(f.replace(".svg", "")), group, style, file: `azgaar/relief/${dir}/${f}`, w, source: "azgaar" });
    }
    for (const f of list("azgaar/burgs/illustrated", ".svg")) add({ id: `azgaar/burg/${f.replace(".svg", "")}`, name: title(f.replace(".svg", "")), group: "settlements", style: "Illustrated", file: `azgaar/burgs/illustrated/${f}`, w: 44, source: "azgaar" });
    for (const f of list("azgaar/burgs/atlas", ".svg")) add({ id: `azgaar/atlas/${f.replace(".svg", "")}`, name: title(f.replace(".svg", "")), group: "markers", style: "Atlas", file: `azgaar/burgs/atlas/${f}`, w: 16, source: "azgaar" });
    for (const f of list("kenney-cartography", ".png")) {
        const k = f.replace(".png", "");
        if (!CARTO[k]) continue;
        add({ id: `ink/${k}`, name: title(k), group: CARTO[k], style: "Ink", file: `kenney-cartography/${f}`, w: CARTO[k] === "markers" ? 30 : /castle|church|lake/.test(k) ? 56 : 40, source: "kenney" });
    }
    for (const f of list("kenney-medieval", ".png")) {
        const k = f.replace(/^medieval/, "").replace(".png", "");
        const m = MEDIEVAL[k];
        if (!m) continue;
        add({ id: `colour/${k}`, name: m[1], group: m[0], style: "Colour", file: `kenney-medieval/${f}`, w: /Structure/.test(k) ? 48 : 30, cells: /Structure/.test(k) ? 2 : 1, source: "kenney" });
    }
    for (const i of icons) {
        const group = i.kind === "monster" ? "monsters" : i.kind === "steam" ? "steam-landmarks" : "markers";
        add({ id: `icon/${i.id}`, name: title(i.name), group, style: i.kind === "monster" ? "Token" : "Marker", file: `game-icons/${i.id}.svg`, w: 36, cells: 1, source: "game-icons", author: i.author });
    }
    for (const s of steam) if (!s.hidden) add({ id: `${s.dir ?? "steampunk"}/${s.id}`, name: s.name, group: s.group, style: s.style ?? "Steampunk", file: `${s.dir ?? "steampunk"}/${s.id}.svg`, cells: [s.w, s.h], w: s.w * 64, source: "steampunk", ...(s.ports ? { ports: s.ports } : {}) });
    return {
        groups: GROUPS.map(([id, name, mode]) => ({ id, name, mode })),
        stamps,
    };
}

const steam = buildSteampunk();
const giDir = arg("game-icons");
const icons = giDir ? buildGameIcons(giDir)
    : list("game-icons", ".svg").map((f) => { const id = f.replace(".svg", ""); const [kind, ...rest] = id.split("-"); return { kind, name: rest.join("-"), id, author: null }; });
const authors = fs.existsSync(path.join(ROOT, "game-icons/authors.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "game-icons/authors.json"), "utf8")) : {};
const m = manifest(steam, icons);
m.credits = { gameIconsAuthors: Object.keys(authors).sort() };
// changes with every build, so the editor asks for fresh stamp images (it adds it to their addresses)
m.version = Date.now().toString(36);
write("manifest.json", `${JSON.stringify(m)}\n`);
console.log(`${m.stamps.length} stamps in ${m.groups.length} groups`);
