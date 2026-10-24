// Builds public/stamps/manifest.json (the map builder's stamp library) and the generated stamp files:
// steampunk top-down stamps (drawn here) and game-icons tokens/markers (from a game-icons.net SVG download).
// Usage: node scripts/build-stamps.js [--game-icons <dir with author folders of .svg>]
// Sources and licences: public/stamps/CREDITS.md
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    ["furniture", "potted-plant", "Potted fern", 1, 1, () => withShadow(circ(32, 34, 14, P.copper)) + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i * Math.PI) / 4; return path_(`M32 34Q${32 + 18 * Math.cos(a + 0.4)} ${34 + 18 * Math.sin(a + 0.4)} ${32 + 26 * Math.cos(a)} ${34 + 26 * Math.sin(a)}Q${32 + 12 * Math.cos(a - 0.3)} ${34 + 12 * Math.sin(a - 0.3)} 32 34Z`, i % 2 ? P.leaf : P.leafL, 1.2); }).join("")],
    ["furniture", "side-table-lamp", "Side table with oil lamp", 1, 1, () => withShadow(circ(32, 32, 22, P.wood)) + circ(32, 32, 11, P.brass, 2) + circ(32, 32, 6, P.glow, 1)],
    // kitchen & bath
    ["kitchen", "stove", "Cast-iron stove", 1, 1, () => withShadow(rect(6, 8, 52, 48, P.ironD, 4)) + circ(20, 22, 7, P.iron, 1.5) + circ(44, 22, 7, P.iron, 1.5) + circ(20, 42, 7, P.iron, 1.5) + circ(44, 42, 7, "#a33a1d", 1.5) + rect(26, 0, 12, 10, P.ironD, 1, 2)],
    ["kitchen", "washstand", "Washstand", 1, 1, () => withShadow(rect(6, 14, 52, 38, P.woodL, 3)) + `<ellipse cx="32" cy="33" rx="17" ry="12" fill="${P.paper}" ${ol(1.5)}/>` + `<ellipse cx="32" cy="33" rx="11" ry="7" fill="${P.glass}" stroke="none"/>` + rect(29, 14, 6, 9, P.brass, 1, 1.5)],
    ["kitchen", "bathtub", "Clawfoot bathtub", 1, 2, () => withShadow(rect(6, 8, 52, 112, P.paper, 24)) + rect(13, 18, 38, 92, P.glass, 18, 1.5) + rect(28, 10, 8, 10, P.brass, 2, 1.5)],
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

function buildSteampunk() {
    const out = [];
    const svgOf = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w * 64} ${h * 64}" width="${w * 64}" height="${h * 64}">${body}</svg>\n`;
    for (const [group, id, name, w, h, draw, extra = {}] of STEAM) {
        write(`steampunk/${id}.svg`, svgOf(w, h, draw()));
        out.push({ group, id, name, w, h, ...extra });
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
    ["furniture", "Furniture", "grid"], ["kitchen", "Kitchen & bath", "grid"], ["machines", "Workshop & machinery", "grid"], ["pipes", "Pipes & valves", "grid"], ["pipework", "Pipework (snaps together)", "grid"], ["plant", "Mechanical plant", "grid"],
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
write("manifest.json", `${JSON.stringify(m)}\n`);
console.log(`${m.stamps.length} stamps in ${m.groups.length} groups`);
