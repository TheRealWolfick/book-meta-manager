// Map builder: an SVG editor for a location's map. Freeform maps (fantasy style) and square-grid maps (floor plans,
// streets, battle maps). Layers, stamps (built-in library + your own pasted images), lines in many styles, area fills,
// floor painting with a default terrain, rooms, text notes, pins for sub-locations, measuring. Saved as a self-contained
// SVG in the vault (POST /api/map); rendering is shared with the server in map-core.js.
import { h } from "preact";
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import htm from "htm";
import { api, toast, store, go, noteHref, openInDrawer, markDirty, Loading, ConfirmButton } from "./app.js";
import { canPaint, paintFloorChunk, roomTiles, paintRoomTile, ribbonPieceBoxes, paintRibbonPiece, toUrl, releaseUrl } from "./map-raster.js";
import {
    CELL, TERRAINS, BACKDROPS, PATH_STYLES, TEXT_STYLES, newMap, uid, viewLayers, layerSvg, backgroundSvg, gridSvg,
    textureCatalog, texturesDefs, texturePreview, resolveTexture, usedFloors, DETAILS, DETAIL_COLORS, detailRows, bounds, textureTileSvg, TILE_PX,
    floorSvg, moveObject, pathD, unitsPerPx, layerParts, objectSvg, sampleCurve, RIBBONS, RIBBON_PARTS,
    toRoom, fromRoom, inRoom, anchorOf, rehome, touchesBox, roomLookKey, roomInside, roomExtent, nearestWall, shapeSvg,
} from "./map-core.js";

const html = htm.bind(h);
// texture catalogue for menus (built-ins + derived textures); the editor refreshes it when the library loads
let TEX = textureCatalog();
const TEX_GROUPS = ["Outdoor", "Street", "Water", "Indoor", "Roof", "Map", "My textures"];
const texOptions = () => TEX_GROUPS.map((g) => html`<optgroup label=${g}>${Object.entries(TEX).filter(([, f]) => f.group === g).map(([k, f]) => html`<option value=${k}>${f.name}</option>`)}</optgroup>`);
const mapHref = (p) => `#/map/${encodeURIComponent(p)}`;
const linkName = (v) => String(v ?? "").replace(/^\[\[|\]\]$/g, "").split("|")[0];

// ------------------------------------------------------------------ stamp library (built-in manifest + vault stamps)

let manifestPromise = null;
const loadManifest = () => (manifestPromise ??= fetch("/stamps/manifest.json").then((r) => r.json()));
const stampSrc = (s) => s.src ?? `/stamps/${s.file}`;
const aspects = new Map(); // src -> h / w
function aspectOf(src) {
    if (aspects.has(src)) return Promise.resolve(aspects.get(src));
    return new Promise((res) => {
        const img = new Image();
        img.onload = () => { const a = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1; aspects.set(src, a); res(a); };
        img.onerror = () => res(1);
        img.src = src;
    });
}
const moveShape = (sh, dx, dy) => (sh.shape === "poly" ? { ...sh, pts: sh.pts.map(([x, y]) => [x + dx, y + dy]) }
    : sh.shape === "circle" || sh.op === "open" ? { ...sh, cx: sh.cx + dx, cy: sh.cy + dy } : { ...sh, x: sh.x + dx, y: sh.y + dy });
// painted room squares follow when the room's edge moves by whole boxes
const shiftCells = (cells, dx, dy, B) => {
    const cx = Math.round(dx / B), cy = Math.round(dy / B);
    if (!cells || (!cx && !cy)) return cells;
    return Object.fromEntries(Object.entries(cells).map(([k, f]) => { const [c, r] = k.split(",").map(Number); return [`${c + cx},${r + cy}`, f]; }));
};

/** Size of a new stamp on this map */
async function stampSize(s, doc) {
    const src = stampSrc(s);
    if (doc.kind === "grid") {
        if (Array.isArray(s.cells)) return { w: s.cells[0] * CELL, h: s.cells[1] * CELL };
        const w = (s.cells ?? Math.max(1, Math.round((s.w ?? 48) / 40))) * CELL;
        return { w, h: w * (await aspectOf(src)) };
    }
    const w = Array.isArray(s.cells) ? s.cells[0] * 22 : s.w ?? 48;
    return { w, h: Array.isArray(s.cells) ? s.cells[1] * 22 : w * (await aspectOf(src)) };
}

// ------------------------------------------------------------------ textures as bitmaps
// Drawing a texture tile from its thousands of vector shapes on every pan is slow, so each texture's tile is drawn
// once into a canvas and the map paints with that single image. (Saved maps keep the vector textures.)
const RASTER_SCALE = 2; // sharp when zoomed in to 200%
const rasters = new Map(); // key -> object URL, or a Promise while drawing
const canRaster = () => typeof Image !== "undefined" && typeof document !== "undefined" && typeof URL?.createObjectURL === "function";
function rasterTexture(key, id, custom) {
    if (rasters.has(key)) return rasters.get(key);
    const job = new Promise((resolve) => {
        const svg = new Blob([textureTileSvg(id, custom, RASTER_SCALE)], { type: "image/svg+xml" });
        const src = URL.createObjectURL(svg);
        const img = new Image();
        img.onload = () => {
            try {
                const cv = document.createElement("canvas");
                cv.width = cv.height = TILE_PX * RASTER_SCALE;
                cv.getContext("2d").drawImage(img, 0, 0);
                cv.toBlob((b) => { URL.revokeObjectURL(src); const url = b ? URL.createObjectURL(b) : null; rasters.set(key, url); resolve(url); }, "image/png");
            } catch { URL.revokeObjectURL(src); rasters.set(key, null); resolve(null); }
        };
        img.onerror = () => { URL.revokeObjectURL(src); rasters.set(key, null); resolve(null); };
        img.src = src;
    });
    rasters.set(key, job);
    return job;
}

// Finished ribbons (rail track, roads…) are drawn from bitmaps too: each piece of 6 boxes becomes one image.
const ribbonKey = (o, custom) => { const f = o.floor === undefined ? RIBBONS[o.style]?.floor : o.floor; return JSON.stringify([o.style, o.pts, o.cols, o.box, o.grid, f, o.off, o.extra, o.smooth, custom[f] ?? null]); };
// Bitmaps are made at the resolution the zoom needs (lod = bitmap px per map px, in powers of two), so they stay
// sharp however far you zoom in; a few drawing jobs run at a time, the oldest bitmaps are dropped when there are many.
const lodFor = (z) => Math.min(8, Math.max(1 / 32, 2 ** Math.ceil(Math.log2(Math.max(1e-6, z * (globalThis.devicePixelRatio || 1)) - 1e-9))));
const jobs = [];
let running = 0, currentLod = 1;
/** queue a drawing job; jobs for a resolution the view has left are dropped (and can be asked for again) */
const enqueue = (fn, lod, drop) => new Promise((resolve) => { jobs.push([fn, resolve, lod, drop]); pump(); });
function pump() {
    while (running < 2 && jobs.length) {
        const [fn, resolve, lod, drop] = jobs.shift();
        if (lod != null && lod !== currentLod) { drop?.(); resolve(null); continue; }
        running++;
        fn().catch((e) => { console.warn("map bitmap:", e); return null; }).then((r) => { running--; resolve(r); pump(); });
    }
}
const urlsOf = (v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.map((x) => x?.url).filter(Boolean) : v?.url ? [v.url] : []);
function remember(cache, key, value, max) {
    cache.set(key, value);
    if (cache.size > max) {
        // URLs still used as a stand-in at another resolution stay alive
        const shown = new Set([...latest.values()].flatMap(urlsOf));
        for (const [k, v] of cache) { if (cache.size <= max * 0.8) break; if (!(v instanceof Promise)) { for (const u of urlsOf(v)) if (!shown.has(u)) releaseUrl(u); cache.delete(k); } }
    }
}
/** cache lookup with a fallback: the newest bitmap of the same thing at any resolution, shown while the right one is drawn */
const latest = new Map(); // look key -> value at some lod (bounded like the caches; entries are shared with them)
const setLatest = latest.set.bind(latest);
latest.set = (k, v) => { setLatest(k, v); if (latest.size > 600) for (const key of latest.keys()) { latest.delete(key); if (latest.size <= 480) break; } return latest; };

// Rooms (floor, painted squares, grid and walls; the things inside stay separate) and finished ribbons (rail track,
// roads…) are drawn from bitmaps of pieces: room tiles of at most 1024 px, ribbon pieces of 6 boxes. The whole thing
// is kept at a modest resolution (the stand-in, never dropped); closer in, only the pieces near the view are painted
// sharp and drawn over it, so a large room or long track never paints what is off screen.
const pieceRasters = new Map(); // look|scale|x,y -> {x, y, w, h, url} | Promise | null
function rasterPiece(key, box, paint, lodTag) {
    if (pieceRasters.has(key)) return pieceRasters.get(key);
    const job = enqueue(() => paint().then((url) => {
        const piece = url ? { ...box, url } : null;
        remember(pieceRasters, key, piece, 300);
        return piece;
    }), lodTag, () => pieceRasters.delete(key));
    pieceRasters.set(key, job);
    return job;
}
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const pow2Below = (v) => 2 ** Math.floor(Math.log2(Math.max(v, 1e-6)));
/**
 * the bitmap pieces to show now, asking for missing ones (done() runs when one arrives). boxes(scale) lists the
 * pieces, paint(scale, box, i) draws one; near {x, y, w, h} (in the pieces' coordinates) picks the sharp ones.
 */
function pieceBitmaps({ look, standin, sharp, near, boxes, paint, done }) {
    const want = (scale, list, lodTag) => list.map(([b, i]) => {
        const key = `${look}|${scale}|${b.x},${b.y}`;
        let r = pieceRasters.get(key);
        if (r === undefined) { r = rasterPiece(key, b, () => paint(scale, b, i), lodTag); r.then(done); }
        return r && !(r instanceof Promise) ? r : null;
    });
    const base = want(standin, boxes(standin).map((b, i) => [b, i]), null);
    let out;
    if (base.every(Boolean)) { out = base; latest.set(look, base); } else out = latest.get(look) ?? [];
    if (sharp > standin && near) out = out.concat(want(sharp, boxes(sharp).map((b, i) => [b, i]).filter(([b]) => overlaps(b, near)), currentLod).filter(Boolean));
    return out;
}
const STANDIN_PX = 2048;
const TILE_BMP = 1024;
function roomBitmaps(o, look, lod, region, custom, texKey, done) {
    const e = roomExtent(o);
    let near = null;
    if (region) {
        // the region in room coordinates (the room may be turned)
        const ps = [[region.x, region.y], [region.x + region.w, region.y], [region.x, region.y + region.h], [region.x + region.w, region.y + region.h]].map((p) => toRoom(o, p));
        const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
        near = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    return pieceBitmaps({
        look, standin: Math.min(lod, pow2Below(STANDIN_PX / Math.max(e.w, e.h, 1))), sharp: Math.min(lod, 8), near,
        boxes: (scale) => roomTiles(o, scale), paint: (scale, b) => paintRoomTile(o, custom, scale, texKey, b), done,
    });
}
function ribbonBitmaps(o, look, lod, region, custom, texKey, done) {
    const one = ribbonPieceBoxes(o, custom, 1);
    const big = Math.max(1, ...one.map((b) => Math.max(b.w, b.h)));
    return pieceBitmaps({
        look, standin: Math.max(0.25, Math.min(lod, pow2Below(1024 / big))), sharp: Math.max(0.25, Math.min(lod, 4)), near: region,
        boxes: (scale) => ribbonPieceBoxes(o, custom, scale), paint: (scale, b, i) => paintRibbonPiece(o, custom, scale, texKey, i).then((cv) => toUrl(cv)), done,
    });
}

// Floors (terrain and painted squares) are drawn in chunks: one 1024 px image per chunk, at the zoom's resolution.
// Zoomed out a chunk covers many squares, zoomed in only a few, so only a handful of images are ever on screen.
const CHUNK_BMP = 1024;
const chunkRasters = new Map(); // key -> url | Promise | null
const quickHash = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
function rasterChunk(key, look, spec) {
    if (chunkRasters.has(key)) return chunkRasters.get(key);
    const job = enqueue(() => paintFloorChunk({ ...spec, px: CHUNK_BMP }).then((url) => { remember(chunkRasters, key, url, 220); if (url) latest.set(look, url); return url; }), spec.lod, () => chunkRasters.delete(key));
    chunkRasters.set(key, job);
    return job;
}
/** painted squares of a floor map by chunk (with a one-square margin, since details spill over edges) */
const chunkIndex = new WeakMap();
function floorByChunk(floor, S) {
    let byS = chunkIndex.get(floor);
    if (!byS) { byS = new Map(); chunkIndex.set(floor, byS); }
    if (byS.has(S)) return byS.get(S);
    const m = new Map();
    for (const e of Object.entries(floor)) {
        const [c, r] = e[0].split(",").map(Number);
        for (let cy = Math.floor(((r - 1) * CELL) / S); cy <= Math.floor(((r + 2) * CELL - 1) / S); cy++) for (let cx = Math.floor(((c - 1) * CELL) / S); cx <= Math.floor(((c + 2) * CELL - 1) / S); cx++) {
            const k = `${cx},${cy}`;
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(e);
        }
    }
    const out = new Map([...m].map(([k, list]) => [k, { entries: list, hash: quickHash(JSON.stringify(list)) }]));
    byS.set(S, out);
    return out;
}

// ------------------------------------------------------------------ geometry helpers

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts.at(-1)];
    let max = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i];
        const d = Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]) / (dist(a, b) || 1);
        if (d > max) { max = d; idx = i; }
    }
    if (max <= tol) return [a, b];
    return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}
const rotPt = ([x, y], [cx, cy], deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]; };

// ------------------------------------------------------------------ page: load or create

export function MapEditor({ location }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => { api.get(`/api/map?location=${encodeURIComponent(location)}`).then(setData).catch((e) => setError(e.message)); }, [location]);
    if (!data) return html`<${Loading} error=${error} />`;
    if (!data.doc) return html`<${NewMap} data=${data} onCreate=${(doc) => setData({ ...data, doc, isNew: true })} />`;
    return html`<${Editor} data=${data} />`;
}

function NewMap({ data, onCreate }) {
    const rank = data.scales.find((s) => s.name === data.location.scale)?.rank ?? 1;
    const [kind, setKind] = useState(rank >= 7 ? "grid" : "freeform");
    const [terrain, setTerrain] = useState(rank >= 11 ? "interior" : "urban");
    const [backdrop, setBackdrop] = useState("parchment");
    const [cols, setCols] = useState(rank >= 11 ? 24 : 40);
    const [rows, setRows] = useState(rank >= 11 ? 18 : 28);
    return html`<div class="panel new-map">
        <div class="muted"><a href=${`#/world/${encodeURIComponent(data.location.world ?? "-")}`}>World builder</a> / ${data.location.title}</div>
        <h1>New map of ${data.location.title}</h1>
        <div class="kind-pick">
            <button class=${kind === "freeform" ? "on" : ""} onClick=${() => setKind("freeform")}><b>Freeform</b><span class="muted">Fantasy-style map: landmasses, mountains, forests, rivers, settlements. For realms down to cities.</span></button>
            <button class=${kind === "grid" ? "on" : ""} onClick=${() => setKind("grid")}><b>Square grid</b><span class="muted">Battle-map style: painted floors, walls, rooms, furniture, vehicles. For streets, buildings and rooms.</span></button>
        </div>
        <div class="formgrid" style="max-width:520px">
            ${kind === "grid" ? html`
                <label>Default terrain</label><select value=${terrain} onChange=${(e) => setTerrain(e.target.value)}>${Object.entries(TERRAINS).map(([k, t]) => html`<option value=${k}>${t.name}</option>`)}</select>
                <label>Size (squares)</label><span class="row"><input type="number" min="4" max="200" value=${cols} onInput=${(e) => setCols(+e.target.value)} style="width:80px" /> × <input type="number" min="4" max="200" value=${rows} onInput=${(e) => setRows(+e.target.value)} style="width:80px" /></span>`
            : html`<label>Background</label><select value=${backdrop} onChange=${(e) => setBackdrop(e.target.value)}>${Object.entries(BACKDROPS).map(([k, n]) => html`<option value=${k}>${n}</option>`)}</select>`}
        </div>
        <button class="primary" onClick=${() => onCreate(newMap(kind, { terrain, backdrop, cols, rows }))}>Create map</button>
        <p class="muted small-note">The map is saved as <code>${data.file}</code> and linked from the location note.</p>
    </div>`;
}

// ------------------------------------------------------------------ editor

const TOOLS = [
    ["select", "Select", "V", "M5 3l14 8-6 2-2 6z"],
    ["pan", "Pan (or hold Space)", "H", "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"],
    ["stamp", "Stamp", "I", "M12 3l5 9H7zM12 12v8"],
    ["scatter", "Scatter brush", "G", "M9 10l2-4 2 4zM13 16l2-4 2 4zM6 16l2-4 2 4z"],
    ["line", "Line: roads, rivers, walls, cliffs…", "L", "M4 19C9 17 9 7 20 5"],
    ["ribbon", "Track or strip: curved roads, rails, monorail… with its own grid", "C", "M3 19c5-9 11-9 16-15M7 21c4-7 9-8 14-13M5 16l3 3M9 12l3 3M14 8l3 3"],
    ["area", "Area fill: land, water, forest…", "O", "M4 15c1-6 5-10 9-9s7 4 6 8-6 6-9 5-7 0-6-4z"],
    ["floor", "Paint floor", "F", "M4 4h7v7H4zM13 13h7v7h-7z", "grid"],
    ["unfloor", "Erase floor", "X", "M4 4h7v7H4zM14 14l6 6M20 14l-6 6", "grid"],
    ["room", "Room: floor + walls", "R", "M4 5h16v14H4z", "grid"],
    ["text", "Text and notes", "T", "M5 6h14M12 6v13"],
    ["pin", "Pin a sub-location", "P", "M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12zM12 9h.01"],
    ["measure", "Measure", "M", "M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"],
    ["roomshape", "Add to or cut from a room (box, circle, polygon)", "U", "M4 4h10v6h6v10H4zM14 4l6 6", "grid"],
    ["opening", "Opening, door or window in a room wall", "N", "M3 20h5V8h8v12h5M8 20a8 8 0 0 1 8-8", "grid"],
    ["erase", "Erase", "E", "M16 4l5 5-10 10H6l-3-3zM11 9l5 5"],
];

function Editor({ data }) {
    const loc = data.location;
    const [doc, setDocRaw] = useState(data.doc);
    const docRef = useRef(doc); docRef.current = doc;
    const hist = useRef({ past: [], future: [] });
    const [saved, setSaved] = useState({ doc: data.isNew ? null : data.doc, mtime: data.mtime });
    const [busy, setBusy] = useState(false);
    const [tool, setTool] = useState("select");
    const [opt, setOpt] = useState(() => ({ vary: false, radius: 60, density: 3, jitter: 0.25, spacing: 0.7, pathStyle: data.doc.kind === "grid" ? "wall-stone" : "road",
        areaFill: data.doc.kind === "grid" ? "water" : "grass", areaEdge: data.doc.kind === "grid" ? "none" : "coast", floor: "wood-planks", brush: 1, wallStyle: "wall-stone",
        textStyle: data.doc.kind === "grid" ? "note" : "label", roomOp: "add", roomShape: "rect", openKind: "door", openLen: 1, ribbonStyle: "railway", ribbonCols: 2, ribbonBox: data.doc.kind === "grid" ? CELL : 24, ribbonGrid: data.doc.kind === "grid", stamp: null, pinLoc: null, ...store.get("mapToolOpts", {}) }));
    const setO = (patch) => setOpt((o) => { const n = { ...o, ...patch }; const { stamp, pinLoc, ...keep } = n; store.set("mapToolOpts", keep); return n; });
    const [sel, setSel] = useState([]);
    const [panel, setPanel] = useState("stamps");
    const [hover, setHover] = useState(null);
    const [draft, setDraft] = useState(null); // {pts, freehand} for line/area/ribbon
    const draftRef = useRef(null); draftRef.current = draft;
    const [ghost, setGhost] = useState(null); // drag previews: box, rect, measure
    const [autosave, setAutosave] = useState(() => store.get("mapAutosave", true));
    const [space, setSpace] = useState(false);
    const [library, setLibrary] = useState(null);
    const svgRef = useRef(), wrapRef = useRef(), dragRef = useRef(null), clip = useRef([]);
    const [size, setSize] = useState({ w: 800, h: 600 });
    const [view, setView] = useState(null);

    const dirty = doc !== saved.doc;
    useEffect(() => { markDirty("page", `map:${loc.path}`, dirty); }, [dirty]);
    useEffect(() => () => markDirty("page", `map:${loc.path}`, false), []);

    // stamp library
    const loadLibrary = () => Promise.all([loadManifest(), api.get("/api/stamps")]).then(([m, v]) => setLibrary({ ...m, vault: v.vault }));
    useEffect(() => { loadLibrary().catch((e) => toast(e.message)); }, []);
    // derived textures: the shared library (Map Textures.md) over the copies saved in this map
    const [texLib, setTexLib] = useState({ textures: {}, mtime: null });
    useEffect(() => { api.get("/api/textures").then(setTexLib).catch(() => {}); }, []);
    const customTex = useMemo(() => ({ ...(doc.textures ?? {}), ...texLib.textures }), [doc.textures, texLib]);
    TEX = useMemo(() => textureCatalog(customTex), [customTex]);
    /** the map document with copies of the derived textures it uses (so the saved map never depends on the library) */
    const withTextures = (d) => {
        const need = new Set();
        const add = (id) => { if (customTex[id] && !need.has(id)) { need.add(id); add(customTex[id].from); } };
        usedFloors(d, customTex).forEach(add);
        const textures = Object.fromEntries([...need].map((id) => [id, customTex[id]]));
        return Object.keys(textures).length || d.textures ? { ...d, textures } : d;
    };

    // ---------------------------------------------------------------- history
    const commit = (next, prev = docRef.current) => {
        if (next === prev) return;
        hist.current.past.push(prev);
        if (hist.current.past.length > 150) hist.current.past.shift();
        hist.current.future = [];
        docRef.current = next;
        setDocRaw(next);
    };
    const live = (next) => { docRef.current = next; setDocRaw(next); };
    const undo = () => { const p = hist.current.past.pop(); if (!p) return; hist.current.future.push(docRef.current); live(p); setSel([]); };
    const redo = () => { const f = hist.current.future.pop(); if (!f) return; hist.current.past.push(docRef.current); live(f); setSel([]); };

    const active = doc.layers.find((l) => l.id === doc.active) ?? doc.layers[0];
    const withLayer = (d, fn) => ({ ...d, layers: d.layers.map((l) => (l.id === d.active ? fn(l) : l)) });
    const withObjects = (d, fn) => withLayer(d, (l) => ({ ...l, objects: fn(l.objects) }));
    const locked = () => { if (active.locked) { toast(`${active.name} is locked`); return true; } return false; };
    // Rooms hold child objects in their own coordinates. entries: every object on the active layer with the room holding it.
    const layerOf = (d) => d.layers.find((l) => l.id === d.active) ?? d.layers[0];
    const entriesOf = (objs) => objs.flatMap((o) => (o.type === "room" ? [{ o, room: null }, ...(o.children ?? []).map((c) => ({ o: c, room: o }))] : [{ o, room: null }]));
    const entries = entriesOf(active.objects);
    const roomAt = (p, d = docRef.current, except) => [...layerOf(d).objects].reverse().find((r) => r.type === "room" && r.id !== except && inRoom(r, p)) ?? null;
    /** fn(o, room) -> new object, or null to drop it; applied to rooms and their children */
    const mapDeep = (d, fn) => withObjects(d, (os) => os.map((o) => {
        const n = fn(o, null);
        if (!n) return null;
        return n.type === "room" ? { ...n, children: (n.children ?? []).map((c) => fn(c, n)).filter(Boolean) } : n;
    }).filter(Boolean));
    const addTo = (d, roomId, objs) => (roomId
        ? withObjects(d, (os) => os.map((r) => (r.id === roomId ? { ...r, children: [...(r.children ?? []), ...objs] } : r)))
        : withObjects(d, (os) => [...os, ...objs]));
    /** Add objects given in map coordinates; each lands in the room under it (if any) */
    const addObjects = (objs, d = docRef.current) => objs.reduce((acc, o) => {
        const room = o.type === "room" ? null : roomAt(anchorOf(o), acc);
        return addTo(acc, room?.id, [room ? rehome(o, null, room) : o]);
    }, d);
    const selEntries = entries.filter((e) => sel.includes(e.o.id));
    const selected = selEntries.map((e) => e.o);
    const roomOf = (id) => entries.find((e) => e.o.id === id)?.room ?? null;

    // ---------------------------------------------------------------- view (pan / zoom)
    useLayoutEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 });
        measure();
        const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        return () => ro?.disconnect();
    }, []);
    const fit = () => { const z = Math.min(size.w / doc.width, size.h / doc.height) * 0.94; setView({ z, x: doc.width / 2 - size.w / z / 2, y: doc.height / 2 - size.h / z / 2 }); };
    useEffect(() => { if (!view) fit(); }, [size]);
    const v = view ?? { x: 0, y: 0, z: 1 };
    const zoomAt = (f, cx = size.w / 2, cy = size.h / 2) => setView((o) => {
        o ??= v;
        const z = Math.max(0.03, Math.min(8, o.z * f));
        return { z, x: o.x + cx / o.z - cx / z, y: o.y + cy / o.z - cy / z };
    });
    const toMap = (e) => {
        const r = svgRef.current.getBoundingClientRect();
        return [v.x + (e.clientX - r.left) / v.z, v.y + (e.clientY - r.top) / v.z];
    };
    const grid = doc.kind === "grid";
    const snapOn = (e) => doc.snap && grid && !e?.altKey;
    const cellOf = (p) => [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL)];
    /** Snap a map point to the grid it is on: a room's own grid inside a room, else the map's */
    const snapIn = (p, kind, e) => {
        if (!snapOn(e)) return p;
        const room = roomAt(p);
        const B = room ? room.box ?? CELL : CELL;
        const q = room ? toRoom(room, p) : p;
        const r = kind === "corner" ? q.map((v) => Math.round(v / B) * B) : q.map((v) => Math.floor(v / B) * B + B / 2);
        return room ? fromRoom(room, r) : r;
    };
    const snapLine = (p, e, style = opt.pathStyle) => snapIn(p, PATH_STYLES[style]?.snap ? "corner" : "center", e);
    // a ribbon with an even number of boxes across centres on grid lines, an odd one on square centres
    const snapRibbon = (p, e, cols = opt.ribbonCols) => snapIn(p, cols % 2 ? "center" : "corner", e);
    /** Where a new thing at p goes: the room under it (local coordinates, its box size) or the map */
    const spaceAt = (p, d = docRef.current) => { const room = roomAt(p, d); return { room, lp: room ? toRoom(room, p) : p, B: room ? room.box ?? CELL : CELL }; };

    // ---------------------------------------------------------------- connection points: pipes and plant snap port to port
    const portsWorld = (o, room) => (o.ports ?? []).map(([u, w]) => {
        let q = [o.x + u * o.w, o.y + w * o.h];
        if (o.rot) q = rotPt(q, [o.x + o.w / 2, o.y + o.h / 2], o.rot);
        return room ? fromRoom(room, q) : q;
    });
    const otherPorts = (exclude, d = docRef.current) => entriesOf(layerOf(d).objects)
        .filter((x) => x.o.type === "stamp" && x.o.ports?.length && !exclude.includes(x.o.id)).flatMap((x) => portsWorld(x.o, x.room));
    /** map shift that puts one of o's ports on the nearest other port, if one is within a few screen pixels */
    const portSnap = (o, room, exclude = []) => {
        const mine = portsWorld(o, room);
        if (!mine.length) return null;
        const T = 12 / v.z, theirs = otherPorts(exclude);
        let best = null;
        for (const a of mine) for (const b of theirs) { const d = dist(a, b); if (d <= T && (!best || d < best.d)) best = { d, v: [b[0] - a[0], b[1] - a[1]] }; }
        return best?.v ?? null;
    };
    const shiftLocal = (o, room, [wx, wy]) => { const [lx, ly] = room?.rot ? rotPt([wx, wy], [0, 0], -room.rot) : [wx, wy]; return moveObject(o, lx, ly); };
    /** a square (room coordinates) counts as part of the room if any of it is, e.g. against a curved wall */
    const cellTouches = (r, c, q, B) => [0.03, 0.5, 0.97].some((u) => [0.03, 0.5, 0.97].some((w) => roomInside(r, [(c + u) * B, (q + w) * B])));

    // ---------------------------------------------------------------- saving
    const save = async () => {
        if (busy) return;
        setBusy(true);
        const d = docRef.current;
        try {
            const r = await api.send("POST", "/api/map", { location: loc.path, doc: withTextures(d), baseMtime: saved.mtime });
            setSaved({ doc: d, mtime: r.mtime });
            toast("Map saved");
        } catch (e) { toast(e.message); }
        setBusy(false);
    };
    useEffect(() => {
        if (!autosave || !dirty || busy || dragRef.current) return;
        const t = setTimeout(save, 4000);
        return () => clearTimeout(t);
    }, [doc, autosave, dirty, busy]);

    // ---------------------------------------------------------------- placing things
    const stampsFor = (s) => {
        if (!opt.vary || !library) return [s];
        const all = [...library.stamps, ...library.vault.map((x) => ({ ...x, group: "vault", style: "Mine" }))];
        const same = all.filter((x) => x.group === s.group && x.style === s.style);
        return same.length ? same : [s];
    };
    const placeStamp = async (s, p, e) => {
        if (locked()) return;
        const pick = stampsFor(s)[Math.floor(Math.random() * stampsFor(s).length)];
        const size0 = await stampSize(pick, docRef.current);
        const k = opt.handScale ?? 1, w = size0.w * k, hh = size0.h * k;
        const { room, lp, B } = spaceAt(p);
        let x = lp[0] - w / 2, y = lp[1] - hh / 2;
        if (snapOn(e)) { x = Math.floor(lp[0] / B) * B; y = Math.floor(lp[1] / B) * B; }
        let o = { id: uid(), type: "stamp", src: stampSrc(pick), name: pick.name, x, y, w, h: hh, ...(opt.handRot ? { rot: opt.handRot } : {}), ...(pick.ports ? { ports: pick.ports } : {}) };
        const sn = !e?.altKey && portSnap(o, room);
        if (sn) o = shiftLocal(o, room, sn);
        commit(addTo(docRef.current, room?.id, [o]));
        return o;
    };
    const uploadStamp = async (file, at) => {
        try {
            const ext = (file.type.split("/")[1] || "png").replace("svg+xml", "svg").replace("jpeg", "jpg");
            const name = file.name && file.name !== "image.png" ? file.name : `pasted ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${ext}`;
            const s = await api.send("POST", `/api/stamps?filename=${encodeURIComponent(name)}`, null, file);
            await loadLibrary();
            const entry = { ...s, group: "vault", style: "Mine", w: grid ? CELL : 64, cells: grid ? 1 : undefined };
            setO({ stamp: entry });
            const o = await placeStamp(entry, at ?? [v.x + size.w / v.z / 2, v.y + size.h / v.z / 2]);
            if (o) setSel([o.id]);
            setTool("select");
            toast(`Added ${s.name} to your stamps`);
        } catch (e) { toast(e.message); }
    };

    // ---------------------------------------------------------------- pointer handling
    const hitId = (e) => e.target.closest?.("[data-id]")?.getAttribute("data-id");
    const scatterAt = (p, d, placed) => {
        const s = opt.stamp;
        if (!s) return d;
        const pool = stampsFor(s);
        const add = [];
        for (let i = 0; i < opt.density; i++) {
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * opt.radius;
            const q = [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r];
            const pick = pool[Math.floor(Math.random() * pool.length)];
            const src = stampSrc(pick);
            const base = grid ? (Array.isArray(pick.cells) ? pick.cells[0] : pick.cells ?? 1) * CELL : Array.isArray(pick.cells) ? pick.cells[0] * 22 : pick.w ?? 40;
            const w = base * (1 + (Math.random() * 2 - 1) * opt.jitter);
            const hh = w * (aspects.get(src) ?? (Array.isArray(pick.cells) ? pick.cells[1] / pick.cells[0] : 1));
            if (placed.some((o) => dist([o.x + o.w / 2, o.y + o.h / 2], q) < opt.spacing * (o.w + w) / 2)) continue;
            const o = { id: uid(), type: "stamp", src, name: pick.name, x: q[0] - w / 2, y: q[1] - hh / 2, w, h: hh };
            placed.push(o);
            const { room, lp } = spaceAt(q, d);
            add.push([room?.id, { ...o, x: lp[0] - w / 2, y: lp[1] - hh / 2 }]);
        }
        return add.reduce((acc, [rid, o]) => addTo(acc, rid, [o]), d);
    };
    const paintFloor = (d, p, erase) => {
        const n = opt.brush, off = Math.floor((n - 1) / 2);
        const room = roomAt(p, d);
        if (room) {
            const B = room.box ?? CELL, lp = toRoom(room, p);
            const c0 = Math.floor(lp[0] / B), r0 = Math.floor(lp[1] / B);
            return withObjects(d, (os) => os.map((r) => {
                if (r.id !== room.id) return r;
                const cells = { ...r.cells };
                for (let c = c0 - off; c < c0 - off + n; c++) for (let q = r0 - off; q < r0 - off + n; q++) {
                    if (!cellTouches(r, c, q, B)) continue;
                    if (erase) delete cells[`${c},${q}`]; else cells[`${c},${q}`] = opt.floor;
                }
                return { ...r, cells };
            }));
        }
        const [c0, r0] = cellOf(p);
        return withLayer(d, (l) => {
            const floor = { ...l.floor };
            for (let c = c0 - off; c < c0 - off + n; c++) for (let r = r0 - off; r < r0 - off + n; r++) {
                if (erase) delete floor[`${c},${r}`]; else floor[`${c},${r}`] = opt.floor;
            }
            return { ...l, floor };
        });
    };
    const fillRect = (d, a, b, floorId) => {
        const room = roomAt(a, d);
        if (room) {
            const B = room.box ?? CELL, la = toRoom(room, a), lb = toRoom(room, b);
            const [c0, r0, c1, r1] = [la[0], la[1], lb[0], lb[1]].map((v) => Math.floor(v / B));
            return withObjects(d, (os) => os.map((r) => {
                if (r.id !== room.id) return r;
                const cells = { ...r.cells };
                for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) for (let q = Math.min(r0, r1); q <= Math.max(r0, r1); q++) {
                    if (!cellTouches(r, c, q, B)) continue;
                    if (floorId) cells[`${c},${q}`] = floorId; else delete cells[`${c},${q}`];
                }
                return { ...r, cells };
            }));
        }
        const [c0, r0] = cellOf(a), [c1, r1] = cellOf(b);
        return withLayer(d, (l) => {
            const floor = { ...l.floor };
            for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
                if (floorId) floor[`${c},${r}`] = floorId; else delete floor[`${c},${r}`];
            }
            return { ...l, floor };
        });
    };
    const finishDraft = (dr = draftRef.current) => {
        if (!dr) return;
        const pts = dr.pts.filter((p, i) => !i || dist(p, dr.pts[i - 1]) > 0.5);
        setDraft(null);
        if (tool === "area" ? pts.length < 3 : pts.length < 2) return;
        if (locked()) return;
        const o = tool === "ribbon"
            ? { id: uid(), type: "ribbon", style: opt.ribbonStyle, pts: dr.freehand ? simplify(pts, 6) : pts, smooth: true, cols: opt.ribbonCols, box: opt.ribbonBox, grid: opt.ribbonGrid }
            : tool === "area"
            ? { id: uid(), type: "area", fill: opt.areaFill, style: opt.areaEdge === "none" ? null : opt.areaEdge, pts, smooth: dr.freehand || !grid }
            : { id: uid(), type: "path", style: opt.pathStyle, pts, smooth: PATH_STYLES[opt.pathStyle]?.smooth && (dr.freehand || !PATH_STYLES[opt.pathStyle]?.snap) };
        const room = roomAt(pts[0]);
        commit(addTo(docRef.current, room?.id, [room ? rehome(o, null, room) : o]));
    };

    /** After moving: things whose anchor left their room (or entered one) change container */
    const regroup = (d, ids) => {
        let out = d;
        for (const e of entriesOf(layerOf(d).objects)) {
            if (!ids.includes(e.o.id) || e.o.type === "room") continue;
            const world = e.room ? fromRoom(e.room, anchorOf(e.o)) : anchorOf(e.o);
            const target = roomAt(world, out);
            if ((target?.id ?? null) === (e.room?.id ?? null)) continue;
            const moved = rehome(e.o, e.room, target);
            out = mapDeep(out, (o) => (o.id === e.o.id ? null : o));
            out = addTo(out, target?.id, [moved]);
        }
        return out;
    };
    /** Map delta -> per-object delta (rotated into a room's frame, snapped to its grid) */
    const deltaFor = (room, dx, dy, e) => {
        let [x, y] = room?.rot ? rotPt([dx, dy], [0, 0], -room.rot) : [dx, dy];
        if (snapOn(e)) { const B = room ? room.box ?? CELL : CELL; x = Math.round(x / B) * B; y = Math.round(y / B) * B; }
        return [x, y];
    };
    const canRotateRoom = () => !(grid && doc.snap);

    // ---------------------------------------------------------------- joined rooms (same `group` move and turn together)
    /** ids plus every room joined to one of them */
    const withGroups = (ids, objs = layerOf(docRef.current).objects) => {
        const groups = new Set(objs.filter((o) => o.type === "room" && o.group && ids.includes(o.id)).map((o) => o.group));
        return [...new Set([...ids, ...objs.filter((o) => o.type === "room" && groups.has(o.group)).map((o) => o.id)])];
    };
    /** room b's base rectangle seen in room a's frame (only when they face the same way, in 90° steps) */
    const rectIn = (a, b) => {
        const rel = ((((b.rot ?? 0) - (a.rot ?? 0)) % 90) + 90) % 90;
        if (Math.min(rel, 90 - rel) > 0.5) return null;
        const cs = [[0, 0], [b.w, 0], [b.w, b.h], [0, b.h]].map((q) => toRoom(a, fromRoom(b, q)));
        const xs = cs.map((q) => q[0]), ys = cs.map((q) => q[1]);
        return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    };
    /** Pull moving rooms onto nearby rooms' edges: {dx, dy} added to the move, or null */
    const edgeSnap = (d0, ids, dx, dy) => {
        const objs = layerOf(d0).objects;
        const moving = objs.filter((o) => o.type === "room" && ids.includes(o.id));
        const others = objs.filter((o) => o.type === "room" && !ids.includes(o.id));
        if (!moving.length || !others.length) return null;
        const T = 14 / v.z;
        let bx = null, by = null;
        for (const m of moving) for (const o of others) {
            const r = rectIn(o, { ...m, x: m.x + dx, y: m.y + dy });
            if (!r || r.x0 - T > o.w || r.x1 + T < 0 || r.y0 - T > o.h || r.y1 + T < 0) continue;
            const a = ((o.rot ?? 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
            // edge to edge, and lined up with the parallel edges
            for (const cx of [o.w - r.x0, -r.x1, -r.x0, o.w - r.x1]) if (Math.abs(cx) <= T && (!bx || Math.abs(cx) < bx.d)) bx = { d: Math.abs(cx), v: [cx * c, cx * sn] };
            for (const cy of [o.h - r.y0, -r.y1, -r.y0, o.h - r.y1]) if (Math.abs(cy) <= T && (!by || Math.abs(cy) < by.d)) by = { d: Math.abs(cy), v: [-cy * sn, cy * c] };
        }
        if (!bx && !by) return null;
        return { dx: (bx?.v[0] ?? 0) + (by?.v[0] ?? 0), dy: (bx?.v[1] ?? 0) + (by?.v[1] ?? 0) };
    };
    /** Rooms that touch (edge to edge, same direction) */
    const touching = (a, b) => {
        const r = rectIn(a, b);
        if (!r) return false;
        const ovX = Math.min(r.x1, a.w) - Math.max(r.x0, 0), ovY = Math.min(r.y1, a.h) - Math.max(r.y0, 0);
        return ((Math.abs(r.x0 - a.w) < 1.5 || Math.abs(r.x1) < 1.5) && ovY > 2) || ((Math.abs(r.y0 - a.h) < 1.5 || Math.abs(r.y1) < 1.5) && ovX > 2);
    };
    /** Join the moved rooms to every room they now touch; returns {doc, joined} */
    const joinTouching = (d, ids) => {
        const rooms = layerOf(d).objects.filter((o) => o.type === "room");
        const pairs = [];
        for (const m of rooms.filter((r) => ids.includes(r.id))) for (const o of rooms) if (o.id !== m.id && !ids.includes(o.id) && touching(o, m) && (!o.group || o.group !== m.group)) pairs.push([m, o]);
        if (!pairs.length) return { doc: d, joined: 0 };
        let out = d;
        for (const [m, o] of pairs) out = joinRooms(out, [m.id, o.id]);
        return { doc: out, joined: pairs.length };
    };
    /** Put rooms (and everything already joined to them) in one group */
    const joinRooms = (d, ids) => {
        const objs = layerOf(d).objects;
        const groups = new Set(objs.filter((o) => ids.includes(o.id) && o.group).map((o) => o.group));
        const g = [...groups][0] ?? `g${uid()}`;
        return withObjects(d, (os) => os.map((o) => (o.type === "room" && (ids.includes(o.id) || groups.has(o.group)) ? { ...o, group: g } : o)));
    };
    /** Take rooms out of their groups (a group left with one room dissolves) */
    const separateRooms = (d, ids) => {
        let out = withObjects(d, (os) => os.map((o) => (ids.includes(o.id) && o.group ? { ...o, group: undefined } : o)));
        const objs = layerOf(out).objects;
        const count = new Map();
        for (const o of objs) if (o.group) count.set(o.group, (count.get(o.group) ?? 0) + 1);
        return withObjects(out, (os) => os.map((o) => (o.group && count.get(o.group) < 2 ? { ...o, group: undefined } : o)));
    };
    const joinSelected = () => {
        const ids = selected.filter((o) => o.type === "room").map((o) => o.id);
        if (ids.length < 2) return toast("Select two or more rooms to join");
        commit(joinRooms(docRef.current, ids)); toast(`Joined ${ids.length} rooms`);
    };
    const separateSelected = () => {
        const ids = selected.filter((o) => o.type === "room" && o.group).map((o) => o.id);
        if (!ids.length) return toast("Select a joined room to separate");
        commit(separateRooms(docRef.current, ids)); toast(ids.length > 1 ? `Separated ${ids.length} rooms` : "Room separated");
    };

    // ---------------------------------------------------------------- room shapes and openings
    const [roomPoly, setRoomPoly] = useState(null); // polygon being drawn: {room, pts (room coordinates)}
    const roomPolyRef = useRef(null); roomPolyRef.current = roomPoly;
    /** the selected room, else the room under p */
    const targetRoom = (p) => { const s = selEntries.find((x) => x.o.type === "room")?.o; return s ?? roomAt(p); };
    const snapLocal = (room, lp, e) => { if (!snapOn(e)) return lp; const B = room.box ?? CELL; return lp.map((v) => Math.round(v / B) * B); };
    const addShape = (roomId, shape) => {
        commit(mapDeep(docRef.current, (o) => (o.id === roomId ? { ...o, shapes: [...(o.shapes ?? []), shape] } : o)));
        setSel([roomId]);
    };
    const finishRoomPoly = () => {
        const rp = roomPolyRef.current;
        setRoomPoly(null);
        if (!rp || rp.pts.length < 3) return;
        addShape(rp.room, { op: opt.roomOp, shape: "poly", pts: rp.pts });
    };
    /** nearest room wall to p (within reach): {room, q (room coordinates), angle} */
    const wallHit = (p, e) => {
        let best = null;
        for (const r of active.objects) {
            if (r.type !== "room") continue;
            let lp = toRoom(r, p);
            const B = r.box ?? CELL;
            if (snapOn(e)) lp = lp.map((v) => Math.round(v / (B / 2)) * (B / 2));
            const w = nearestWall(r, lp);
            if (w && w.dist < Math.max(24, 40 / v.z) && (!best || w.dist < best.dist)) best = { room: r, q: w.p, angle: w.angle, dist: w.dist };
        }
        return best;
    };

    const onPointerDown = (e) => {
        if (e.button === 1 || space || tool === "pan") {
            e.preventDefault();
            dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, v0: v };
            svgRef.current.setPointerCapture?.(e.pointerId);
            return;
        }
        if (e.button === 2 && (tool === "stamp" || tool === "scatter")) { setTool("select"); return; }
        if (e.button === 2 && tool !== "floor") return;
        const p = toMap(e);
        const d0 = docRef.current;
        const handle = e.target.closest?.("[data-handle]")?.getAttribute("data-handle");
        const capture = () => svgRef.current.setPointerCapture?.(e.pointerId);
        if (handle && tool === "select") {
            const o = selected[0];
            const [kind, i] = handle.split(":");
            if (kind === "rotate" && o.type === "room" && !canRotateRoom()) return toast("Turn snapping off to rotate rooms");
            dragRef.current = { kind, i: Number(i), o, room: roomOf(o.id), d0 };
            capture();
            return;
        }
        switch (tool) {
            case "select": {
                const id = hitId(e);
                if (id) {
                    if (active.locked) return toast(`${active.name} is locked`);
                    const next = e.shiftKey ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : sel.includes(id) ? sel : [id];
                    setSel(next);
                    dragRef.current = { kind: "move", p0: p, ids: withGroups(next), d0 };
                } else {
                    if (!e.shiftKey) setSel([]);
                    dragRef.current = { kind: "box", p0: p, keep: e.shiftKey ? sel : [] };
                }
                capture();
                break;
            }
            case "stamp": if (opt.stamp) placeStamp(opt.stamp, p, e); else toast("Pick a stamp in the library first"); break;
            case "scatter": {
                if (!opt.stamp) return toast("Pick a stamp in the library first");
                if (locked()) return;
                stampsFor(opt.stamp).forEach((s) => aspectOf(stampSrc(s)));
                const placed = [];
                live(scatterAt(p, d0, placed));
                dragRef.current = { kind: "scatter", d0, last: p, placed };
                capture();
                break;
            }
            case "line": case "area": case "ribbon": {
                const q = tool === "line" ? snapLine(p, e) : tool === "ribbon" ? snapRibbon(p, e) : p;
                dragRef.current = { kind: "draw", sx: e.clientX, sy: e.clientY, freehand: false };
                setDraft((dr) => (dr ? { ...dr, pts: [...dr.pts, q] } : { pts: [q], freehand: false }));
                capture();
                break;
            }
            case "floor": case "unfloor": {
                if (!grid) return;
                if (locked()) return;
                const erase = tool === "unfloor" || e.altKey || e.button === 2;
                if (e.shiftKey) { const room = roomAt(p); dragRef.current = { kind: "rect", p0: p, erase, d0, room }; setGhost({ rect: [p, p], room }); }
                else { live(paintFloor(d0, p, erase)); dragRef.current = { kind: "paint", erase, d0 }; }
                capture();
                break;
            }
            case "room": if (grid && !locked()) { dragRef.current = { kind: "room", p0: p, d0, free: !snapOn(e) }; setGhost({ rect: [p, p], free: !snapOn(e) }); capture(); } break;
            case "text": {
                if (locked()) return;
                const { room, lp, B } = spaceAt(p);
                const q = snapOn(e) ? lp.map((v) => Math.floor(v / B) * B + B / 2) : lp;
                const o = { id: uid(), type: "text", style: opt.textStyle, text: TEXT_STYLES[opt.textStyle]?.box ? "Note" : "Label", x: q[0], y: q[1] };
                commit(addTo(docRef.current, room?.id, [o]));
                setSel([o.id]); setTool("select"); setPanel("inspect");
                break;
            }
            case "pin": placePin(opt.pinLoc, p); break;
            case "measure": dragRef.current = { kind: "measure", p0: p }; setGhost({ measure: [p, p] }); capture(); break;
            case "roomshape": {
                if (locked()) return;
                const room = targetRoom(p);
                if (!room) return toast("Select a room first, or start inside one");
                const lp = snapLocal(room, toRoom(room, p), e);
                if (opt.roomShape === "poly") {
                    if (roomPoly && roomPoly.room !== room.id) setRoomPoly(null);
                    setRoomPoly((rp) => (rp && rp.room === room.id ? { ...rp, pts: [...rp.pts, lp] } : { room: room.id, pts: [lp] }));
                    break;
                }
                dragRef.current = { kind: "roomshape", room, a: lp };
                setGhost({ roomShape: { room, a: lp, b: lp } });
                capture();
                break;
            }
            case "opening": {
                if (locked()) return;
                const hit = wallHit(p, e);
                if (!hit) return toast("Click on a room wall");
                const { room, q, angle } = hit;
                const B = room.box ?? CELL, len = opt.openLen * B;
                const wall = PATH_STYLES[room.wall];
                const thick = (wall ? Math.max(...wall.layers.map((l) => l.w)) : 12) + 8;
                const open = { op: "open", cx: q[0], cy: q[1], len, thick, rot: angle };
                const kind = opt.openKind;
                // doors are drawn with their swing inside the stamp; the wall line runs through its middle
                const file = { door: "door-swing", "double-door": "double-door-swing", window: "window" }[kind];
                const sh = kind === "door" ? len * 2 : len;
                const kids = kind === "opening" ? [] : [{ id: uid(), type: "stamp", src: `/stamps/steampunk/${file}.svg`, name: kind, w: len, h: sh, x: q[0] - len / 2, y: q[1] - sh / 2, rot: ((angle % 360) + 360) % 360 }];
                commit(mapDeep(docRef.current, (o) => (o.id === room.id ? { ...o, shapes: [...(o.shapes ?? []), open], children: [...(o.children ?? []), ...kids] } : o)));
                break;
            }
            case "erase": {
                if (locked()) return;
                const id = hitId(e);
                if (id) commit(mapDeep(d0, (o) => (o.id === id ? null : o)));
                dragRef.current = { kind: "erase", d0 };
                break;
            }
        }
    };
    const onPointerMove = (e) => {
        let p = toMap(e);
        setHover(p);
        const dr = dragRef.current;
        if (!dr) return;
        const d = docRef.current;
        switch (dr.kind) {
            case "pan": setView({ ...dr.v0, x: dr.v0.x - (e.clientX - dr.sx) / dr.v0.z, y: dr.v0.y - (e.clientY - dr.sy) / dr.v0.z }); break;
            case "move": {
                const dx = p[0] - dr.p0[0], dy = p[1] - dr.p0[1];
                let [tx, ty] = deltaFor(null, dx, dy, e);
                // rooms snap to the edges of rooms they come close to (Alt: no snapping)
                const snap = !e.altKey && edgeSnap(dr.d0, dr.ids, tx, ty);
                if (snap) { tx += snap.dx; ty += snap.dy; }
                dr.snapped = !!snap;
                let next = mapDeep(dr.d0, (o, room) => {
                    if (!dr.ids.includes(o.id) || (room && dr.ids.includes(room.id))) return o;
                    return room ? moveObject(o, ...deltaFor(room, dx, dy, e)) : moveObject(o, tx, ty);
                });
                // a single pipe or plant stamp snaps onto the nearest connection point
                if (dr.ids.length === 1 && !e.altKey) {
                    const hit = entriesOf(layerOf(next).objects).find((x) => x.o.id === dr.ids[0]);
                    if (hit?.o.type === "stamp" && hit.o.ports?.length) {
                        docRef.current = next;
                        const sn = portSnap(hit.o, hit.room, dr.ids);
                        if (sn) next = mapDeep(next, (o) => (o.id === hit.o.id ? shiftLocal(o, hit.room, sn) : o));
                    }
                }
                live(next);
                break;
            }
            case "box": setGhost({ box: [dr.p0, p] }); break;
            case "resize": {
                const o = dr.o, cx = o.x + (o.w ?? 0) / 2, cy = o.y + (o.h ?? 0) / 2;
                p = dr.room ? toRoom(dr.room, p) : p;
                const upd = (fn) => live(mapDeep(dr.d0, (x) => (x.id === o.id ? fn(x) : x)));
                if (o.type === "room") {
                    const lp = rotPt(p, [cx, cy], -(o.rot ?? 0)), B = o.box ?? CELL;
                    let w = Math.max(B, Math.abs(lp[0] - cx) * 2), hh = Math.max(B, Math.abs(lp[1] - cy) * 2);
                    if (snapOn(e)) { w = Math.max(B, Math.round(w / B) * B); hh = Math.max(B, Math.round(hh / B) * B); }
                    // keep the contents where they are on the map
                    const sx = (w - o.w) / 2, sy = (hh - o.h) / 2;
                    upd((x) => ({ ...x, w, h: hh, x: cx - w / 2, y: cy - hh / 2, children: (x.children ?? []).map((c) => moveObject(c, sx, sy)), shapes: (x.shapes ?? []).map((sh) => moveShape(sh, sx, sy)), cells: shiftCells(x.cells, sx, sy, B) }));
                    break;
                }
                if (o.type === "text") {
                    const b = bounds(o);
                    const k = Math.max(0.2, Math.max(Math.abs(p[0] - o.x) / (b.w / 2), Math.abs(p[1] - o.y) / (b.h / 2 || 1)));
                    upd((x) => ({ ...x, size: Math.round((o.size ?? TEXT_STYLES[o.style]?.size ?? 20) * k) }));
                    break;
                }
                const lp = rotPt(p, [cx, cy], -(o.rot ?? 0));
                let w = Math.max(8, Math.abs(lp[0] - cx) * 2), hh = Math.max(8, Math.abs(lp[1] - cy) * 2);
                if (!e.shiftKey) { const k = Math.max(w / o.w, hh / o.h); w = o.w * k; hh = o.h * k; }
                if (snapOn(e) && !o.rot) { w = Math.max(CELL, Math.round(w / CELL) * CELL); hh = Math.max(CELL / 2, Math.round(hh / (CELL / 2)) * (CELL / 2)); }
                upd((x) => ({ ...x, w, h: hh, x: cx - w / 2, y: cy - hh / 2 }));
                break;
            }
            case "rotate": {
                const o = dr.o, b = o.type === "room" ? { x: o.x, y: o.y, w: o.w, h: o.h } : bounds(o), cx = b.x + b.w / 2, cy = o.type === "text" ? o.y : b.y + b.h / 2;
                const q = dr.room ? toRoom(dr.room, p) : p;
                let a = (Math.atan2(q[1] - cy, q[0] - cx) * 180) / Math.PI + 90;
                a = e.shiftKey ? Math.round(a) : Math.round(a / 10) * 10; // 10° steps, Shift: free
                const members = o.type === "room" && o.group ? layerOf(dr.d0).objects.filter((x) => x.type === "room" && x.group === o.group) : [];
                if (members.length > 1) {
                    const delta = a - (o.rot ?? 0), pivot = [cx, cy];
                    live(withObjects(dr.d0, (os) => os.map((x) => {
                        if (!members.includes(x)) return x;
                        const c = rotPt([x.x + x.w / 2, x.y + x.h / 2], pivot, delta);
                        return { ...x, x: c[0] - x.w / 2, y: c[1] - x.h / 2, rot: ((((x.rot ?? 0) + delta) % 360) + 360) % 360 };
                    })));
                } else live(mapDeep(dr.d0, (x) => (x.id === o.id ? { ...x, rot: ((a % 360) + 360) % 360 } : x)));
                break;
            }
            case "vertex": {
                const o = dr.o;
                const w = o.type === "path" ? snapLine(p, e, o.style) : o.type === "ribbon" ? snapRibbon(p, e, o.cols ?? 2) : p;
                const q = dr.room ? toRoom(dr.room, w) : w;
                live(mapDeep(dr.d0, (x) => (x.id === o.id ? { ...x, pts: x.pts.map((pt, i) => (i === dr.i ? q : pt)) } : x)));
                break;
            }
            case "scatter": if (dist(p, dr.last) > opt.radius * 0.6) { dr.last = p; live(scatterAt(p, d, dr.placed)); } break;
            case "draw":
                if (!dr.freehand && Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) > 6) { dr.freehand = true; setDraft((x) => ({ ...x, freehand: true })); }
                if (dr.freehand) setDraft((x) => (x && dist(x.pts.at(-1), p) > 6 / v.z ? { ...x, pts: [...x.pts, p] } : x));
                break;
            case "paint": live(paintFloor(d, p, dr.erase)); break;
            case "rect": case "room": setGhost({ rect: [dr.p0, p], free: dr.free, room: dr.room }); break;
            case "measure": setGhost({ measure: [dr.p0, p] }); break;
            case "roomshape": setGhost({ roomShape: { room: dr.room, a: dr.a, b: snapLocal(dr.room, toRoom(dr.room, p), e) } }); break;
            case "erase": { if (e.buttons !== 1) break; const id = hitId(e); if (id) live(mapDeep(d, (o) => (o.id === id ? null : o))); break; }
        }
    };
    const onPointerUp = (e) => {
        const dr = dragRef.current;
        dragRef.current = null;
        if (!dr) return;
        const p = toMap(e);
        switch (dr.kind) {
            case "move":
                if (docRef.current !== dr.d0) {
                    const j = e.altKey || doc.autoJoin === false ? { doc: docRef.current, joined: 0 } : joinTouching(docRef.current, dr.ids);
                    commit(regroup(j.doc, dr.ids), dr.d0);
                    if (j.joined) toast("Rooms joined", { label: "Undo join", run: () => commit(separateRooms(docRef.current, dr.ids)) });
                }
                break;
            case "resize": case "rotate": case "vertex": case "scatter": case "paint": case "erase":
                if (docRef.current !== dr.d0) commit(docRef.current, dr.d0);
                break;
            case "box": {
                const [a, b] = [dr.p0, p];
                const r = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
                if (r.w > 2 || r.h > 2) setSel([...new Set([...dr.keep, ...active.objects.filter((o) => touchesBox(o, r)).map((o) => o.id)])]);
                setGhost(null);
                break;
            }
            case "draw":
                if (dr.freehand) { setDraft((x) => { const fin = { ...x, pts: simplify(x.pts, 2.5 / v.z) }; setTimeout(() => finishDraft(fin)); return null; }); }
                break;
            case "rect": commit(fillRect(dr.d0, dr.p0, p, dr.erase ? null : opt.floor), dr.d0); setGhost(null); break;
            case "room": {
                setGhost(null);
                let x0, y0, x1, y1;
                if (dr.free) [x0, y0, x1, y1] = [Math.min(dr.p0[0], p[0]), Math.min(dr.p0[1], p[1]), Math.max(dr.p0[0], p[0]), Math.max(dr.p0[1], p[1])];
                else {
                    const [c0, r0] = cellOf(dr.p0), [c1, r1] = cellOf(p);
                    [x0, y0, x1, y1] = [Math.min(c0, c1) * CELL, Math.min(r0, r1) * CELL, (Math.max(c0, c1) + 1) * CELL, (Math.max(r0, r1) + 1) * CELL];
                }
                if (x1 - x0 < 8 || y1 - y0 < 8) break;
                const room = { id: uid(), type: "room", x: x0, y: y0, w: x1 - x0, h: y1 - y0, box: opt.roomBox ?? CELL, floor: opt.floor, wall: opt.wallStyle, grid: true, cells: {}, children: [] };
                // things already standing inside become part of the room
                let d = addTo(dr.d0, null, [room]);
                const inside = layerOf(d).objects.filter((o) => o.type !== "room" && inRoom(room, anchorOf(o))).map((o) => o.id);
                d = regroup(d, inside);
                commit(d, dr.d0);
                setSel([room.id]); setPanel("inspect");
                break;
            }
            case "measure": break; // the measurement stays until the next one
            case "roomshape": {
                setGhost(null);
                const b = snapLocal(dr.room, toRoom(dr.room, p), e), a = dr.a;
                const shape = opt.roomShape === "circle"
                    ? { op: opt.roomOp, shape: "circle", cx: a[0], cy: a[1], r: Math.hypot(b[0] - a[0], b[1] - a[1]) }
                    : { op: opt.roomOp, shape: "rect", x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
                if ((shape.r ?? Math.min(shape.w, shape.h)) < 4) break;
                addShape(dr.room.id, shape);
                break;
            }
        }
    };
    const onWheel = (e) => {
        e.preventDefault();
        const r = svgRef.current.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    useEffect(() => {
        const el = svgRef.current;
        el?.addEventListener("wheel", onWheel, { passive: false });
        return () => el?.removeEventListener("wheel", onWheel);
    });

    // WASD pans while held (Shift: faster)
    const held = useRef(new Set()), fast = useRef(false), panning = useRef(false);
    const startPan = () => {
        if (panning.current) return;
        panning.current = true;
        let last = performance.now();
        const step = (t) => {
            if (!held.current.size) { panning.current = false; return; }
            const dt = Math.min(0.05, (t - last) / 1000); last = t;
            const sp = (fast.current ? 3000 : 1300) * dt;
            const k = held.current;
            const dx = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0), dy = (k.has("s") ? 1 : 0) - (k.has("w") ? 1 : 0);
            setView((o) => (o ? { ...o, x: o.x + (dx * sp) / o.z, y: o.y + (dy * sp) / o.z } : o));
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };
    useEffect(() => { const clear = () => held.current.clear(); addEventListener("blur", clear); return () => removeEventListener("blur", clear); }, []);

    // ---------------------------------------------------------------- pins
    const placedPins = new Map(doc.layers.flatMap((l) => entriesOf(l.objects).filter((e) => e.o.type === "pin").map((e) => [linkName(e.o.location).toLowerCase(), { o: e.o, layer: l }])));
    const placePin = (child, p) => {
        if (!child) return toast("Pick a sub-location in the Pins panel first");
        if (locked()) return;
        const key = child.name.toLowerCase();
        const have = placedPins.get(key);
        let d = docRef.current;
        if (have) d = { ...d, layers: d.layers.map((l) => (l === have.layer ? { ...l, objects: l.objects.filter((o) => o.id !== have.o.id).map((o) => (o.type === "room" ? { ...o, children: (o.children ?? []).filter((c) => c.id !== have.o.id) } : o)) } : l)) };
        commit(addObjects([{ ...(have?.o ?? { id: uid(), type: "pin", location: `[[${child.name}]]` }), x: p[0], y: p[1] }], d));
        const next = data.children.find((c) => c.name !== child.name && !placedPins.has(c.name.toLowerCase()));
        setO({ pinLoc: next ?? null });
        if (!next) setTool("select");
    };
    const openPin = (o) => {
        const c = data.children.find((x) => x.name.toLowerCase() === linkName(o.location).toLowerCase());
        if (!c) return toast(`${linkName(o.location)} is not a sub-location of ${loc.title}`);
        if (c.hasMap) go(mapHref(c.path)); else openInDrawer(noteHref(c.path));
    };

    // ---------------------------------------------------------------- keyboard, paste, drop
    useEffect(() => {
        const typing = (e) => e.target.closest?.("input, textarea, select, [contenteditable]");
        const down = (e) => {
            if (typing(e)) { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); } return; }
            const mod = e.ctrlKey || e.metaKey;
            const k = e.key.toLowerCase();
            if (mod && k === "s") { e.preventDefault(); save(); return; }
            if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
            if (mod && k === "y") { e.preventDefault(); redo(); return; }
            if (mod && k === "d") { e.preventDefault(); duplicate(); return; }
            if (mod && k === "g") { e.preventDefault(); e.shiftKey ? separateSelected() : joinSelected(); return; }
            if (mod && k === "c" && selected.length) { clip.current = selEntries.map((x) => (x.room ? rehome(x.o, x.room, null) : x.o)); toast(`Copied ${selected.length}`); return; }
            if (mod && k === "a") { e.preventDefault(); setSel(active.objects.map((o) => o.id)); return; }
            if (mod) return;
            if (e.key === " ") { e.preventDefault(); setSpace(true); return; }
            if ("wasd".includes(k) && k.length === 1) { e.preventDefault(); held.current.add(k); fast.current = e.shiftKey; startPan(); return; }
            if (e.key === "Escape") { setDraft(null); setGhost(null); setRoomPoly(null); setSel([]); return; }
            if (e.key === "Enter" && draftRef.current) { finishDraft(); return; }
            if (e.key === "Enter" && roomPolyRef.current) { finishRoomPoly(); return; }
            if (e.key === "Backspace" && roomPolyRef.current) { setRoomPoly((rp) => (rp.pts.length > 1 ? { ...rp, pts: rp.pts.slice(0, -1) } : null)); return; }
            if (e.key === "Backspace" && draft) { setDraft((x) => (x.pts.length > 1 ? { ...x, pts: x.pts.slice(0, -1) } : null)); return; }
            if ((e.key === "Delete" || e.key === "Backspace") && sel.length) { removeSel(); return; }
            if (e.key.startsWith("Arrow") && sel.length) {
                e.preventDefault();
                const step = grid && doc.snap ? CELL : e.shiftKey ? 10 : 1;
                const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
                const ids = withGroups(sel);
                commit(regroup(mapDeep(docRef.current, (o, room) => (ids.includes(o.id) && !(room && ids.includes(room.id)) ? moveObject(o, ...deltaFor(room, dx, dy, e)) : o)), ids));
                return;
            }
            if (e.key === "[" || e.key === "]") { order(e.key === "]" ? "up" : "down"); return; }
            // holding a stamp: Q / E turn it in the hand (10°, Shift 90°) instead of switching tools
            if (tool === "stamp" && (k === "q" || k === "e")) { setO({ handRot: ((((opt.handRot ?? 0) + (k === "e" ? 1 : -1) * (e.shiftKey ? 90 : 10)) % 360) + 360) % 360 }); return; }
            // and Z / X make it smaller or larger (10% a press, Shift: 50%)
            if (tool === "stamp" && (k === "z" || k === "x")) { const f = e.shiftKey ? 1.5 : 1.1; setO({ handScale: Math.round(Math.max(0.1, Math.min(10, (opt.handScale ?? 1) * (k === "x" ? f : 1 / f))) * 1000) / 1000 }); return; }
            if (e.key === "+" || e.key === "=") { zoomAt(1.25); return; }
            if (e.key === "-") { zoomAt(0.8); return; }
            if (e.key === "0") { fit(); return; }
            const t = TOOLS.find((x) => x[2].toLowerCase() === k && (!x[4] || grid));
            if (t) { setTool(t[0]); setDraft(null); }
        };
        const up = (e) => { if (e.key === " ") setSpace(false); held.current.delete(e.key.toLowerCase()); };
        const paste = (e) => {
            if (typing(e)) return;
            const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
            if (file) { e.preventDefault(); uploadStamp(file); return; }
            if (clip.current.length) {
                e.preventDefault();
                const off = grid ? CELL : 20;
                const copies = clip.current.map((o) => ({ ...moveObject(o, off, off), id: uid() }));
                commit(addObjects(copies));
                clip.current = copies;
                setSel(copies.map((o) => o.id));
            }
        };
        addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("paste", paste);
        return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("paste", paste); };
    });
    const onDrop = (e) => {
        e.preventDefault();
        const p = toMap(e);
        const pin = e.dataTransfer.getData("application/x-map-pin");
        if (pin) return placePin(data.children.find((c) => c.path === pin), p);
        const stampId = e.dataTransfer.getData("application/x-map-stamp");
        if (stampId && library) { const s = [...library.stamps, ...library.vault].find((x) => x.id === stampId); if (s) return placeStamp(s, p, e); }
        const file = [...(e.dataTransfer.files ?? [])].find((f) => f.type.startsWith("image/"));
        if (file) uploadStamp(file, p);
    };

    // ---------------------------------------------------------------- points of lines, areas and ribbons
    // double-click on a line adds a point where you clicked; double-click on a point removes it
    const addPoint = (o, wp) => {
        if (locked()) return;
        const room = roomOf(o.id);
        const p = room ? toRoom(room, wp) : wp;
        const closed = o.type === "area" || o.closed;
        const samples = sampleCurve(o.pts, o.smooth ?? PATH_STYLES[o.style]?.smooth ?? true, closed, 3);
        let best = null;
        for (const sm of samples) { const d = dist(sm.p, p); if (!best || d < best.d) best = { d, span: sm.span }; }
        if (!best) return;
        const w = o.type === "ribbon" ? snapRibbon(wp, undefined, o.cols ?? 2) : o.type === "path" ? snapLine(wp, undefined, o.style) : wp;
        const q = room ? toRoom(room, w) : w;
        const pts = [...o.pts.slice(0, best.span + 1), q, ...o.pts.slice(best.span + 1)];
        commit(mapDeep(docRef.current, (x) => (x.id === o.id ? { ...x, pts } : x)));
        setSel([o.id]);
    };
    const removePoint = (o, i) => {
        if (locked() || o.pts.length <= (o.type === "area" ? 3 : 2)) return;
        commit(mapDeep(docRef.current, (x) => (x.id === o.id ? { ...x, pts: x.pts.filter((_, j) => j !== i) } : x)));
    };

    // ---------------------------------------------------------------- selection actions
    const removeSel = () => { if (locked()) return; commit(mapDeep(docRef.current, (o) => (sel.includes(o.id) ? null : o))); setSel([]); };
    const withIds = (o) => (o.type === "room" ? { ...o, id: uid(), children: (o.children ?? []).map((c) => ({ ...c, id: uid() })) } : { ...o, id: uid() });
    const duplicate = () => {
        if (!selected.length || locked()) return;
        let d = docRef.current;
        const ids = [];
        for (const { o, room } of selEntries) {
            if (room && sel.includes(room.id)) continue;
            const off = room ? room.box ?? CELL : grid ? CELL : 20;
            const c = withIds(moveObject(o, off, off));
            d = addTo(d, room?.id, [c]);
            ids.push(c.id);
        }
        commit(d);
        setSel(ids);
    };
    const reorder = (os, dir) => {
        const pick = os.filter((o) => sel.includes(o.id)), rest = os.filter((o) => !sel.includes(o.id));
        return dir === "top" || dir === "up" ? [...rest, ...pick] : [...pick, ...rest];
    };
    const order = (dir) => commit(withObjects(docRef.current, (os) => reorder(os, dir).map((o) => (o.type === "room" ? { ...o, children: reorder(o.children ?? [], dir) } : o))));
    const patchSel = (patch) => commit(mapDeep(docRef.current, (o) => (sel.includes(o.id) ? { ...o, ...(typeof patch === "function" ? patch(o) : patch) } : o)));
    /** A room's things become ordinary map objects again */
    const releaseRoom = (room) => {
        let d = mapDeep(docRef.current, (o) => (o.id === room.id ? { ...o, children: [] } : o));
        commit(addTo(d, null, (room.children ?? []).map((c) => rehome(c, room, null))));
    };
    const toLayer = (id) => {
        const d = docRef.current;
        const moving = selEntries.filter((x) => !(x.room && sel.includes(x.room.id))).map((x) => (x.room ? rehome(x.o, x.room, null) : x.o));
        const out = mapDeep(d, (o, room) => (sel.includes(o.id) && !(room && sel.includes(room.id) && o.type !== "room") ? null : o));
        commit({ ...out, layers: out.layers.map((l) => (l.id === id ? { ...l, objects: [...l.objects, ...moving] } : l)) });
        setSel([]);
        toast(`Moved to ${d.layers.find((l) => l.id === id)?.name}`);
    };

    // ---------------------------------------------------------------- rendering
    const names = useMemo(() => new Map(data.children.map((c) => [c.name.toLowerCase(), c.title])), [data.children]);
    const [rasterTick, setRasterTickNow] = useState(0);
    const tickPending = useRef(false);
    const setRasterTick = () => { if (tickPending.current) return; tickPending.current = true; requestAnimationFrame(() => { tickPending.current = false; setRasterTickNow((t) => t + 1); }); };
    const selKey = sel.join(",");
    // bitmaps follow the zoom once it settles (while zooming, the current ones are just scaled)
    const zoomLod = lodFor(v.z);
    const [lod, setLod] = useState(zoomLod);
    useEffect(() => { if (zoomLod === lod) return; const t = setTimeout(() => setLod(zoomLod), 220); return () => clearTimeout(t); }, [zoomLod, lod]);
    currentLod = lod;
    const texKeyOf = (id) => `${id}|${JSON.stringify(customTex[id] ?? null)}|${JSON.stringify(customTex[customTex[id]?.from] ?? null)}`;
    const regionRef = useRef(null);
    const ctx = useMemo(() => ({
        edit: true, stampHref: (o) => o.src, pinLabel: (o) => names.get(linkName(o.location).toLowerCase()) ?? linkName(o.location),
        // selected ribbons stay vector (they are being edited); the rest use bitmaps of their pieces once drawn
        ribbonImage: (o) => {
            if (!canPaint() || sel.includes(o.id)) return null;
            const r = ribbonBitmaps(o, `rb|${ribbonKey(o, customTex)}`, lod, regionRef.current, customTex, texKeyOf, () => setRasterTick((t) => t + 1));
            if (!r.length) return null;
            return r.map((pc) => `<image href="${pc.url}" x="${pc.x}" y="${pc.y}" width="${pc.w}" height="${pc.h}" preserveAspectRatio="none"/>`).join("");
        },
        // rooms keep their bitmap while moved or turned; changing the room itself draws a new one (vector meanwhile)
        roomImage: (o) => {
            if (!canPaint()) return null;
            // mid-stroke (painting, reshaping, resizing) the room stays live; the bitmap is made when you let go
            if (["paint", "rect", "resize", "roomshape"].includes(dragRef.current?.kind)) return null;
            const look = `rm|${roomLookKey(o)}|${JSON.stringify([o.floor, ...Object.values(o.cells ?? {})].map((f) => customTex[f] ?? null))}`;
            const r = roomBitmaps(o, look, lod, regionRef.current, customTex, texKeyOf, () => setRasterTick((t) => t + 1));
            if (!r.length) return null;
            return r.map((t) => `<image href="${t.url}" x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" preserveAspectRatio="none"/>`).join("");
        },
    }), [names, selKey, customTex, rasterTick, lod]);
    const cache = useRef(new WeakMap());
    // only what is on screen (plus a margin) is drawn; the region moves in 512 px steps so panning rarely rebuilds it
    const STEP = 512;
    const vw = size.w / v.z, vh = size.h / v.z;
    const rx0 = Math.floor((v.x - vw / 2) / STEP) * STEP, ry0 = Math.floor((v.y - vh / 2) / STEP) * STEP;
    const region = { x: rx0, y: ry0, w: Math.ceil((v.x + vw * 1.5 - rx0) / STEP) * STEP, h: Math.ceil((v.y + vh * 1.5 - ry0) / STEP) * STEP };
    const regionKey = `${region.x},${region.y},${region.w},${region.h}`;
    // sharp room tiles and ribbon pieces are painted only for the view plus one tile, snapped to the tile size
    const TT = TILE_BMP / lod;
    const nearX = Math.floor(v.x / TT) - 1, nearY = Math.floor(v.y / TT) - 1;
    regionRef.current = { x: nearX * TT, y: nearY * TT, w: (Math.ceil(vw / TT) + 3) * TT, h: (Math.ceil(vh / TT) + 3) * TT };
    const nearKey = `${nearX},${nearY}`;
    const markup = (l) => {
        let s = cache.current.get(l);
        const key = `${regionKey}|${nearKey}|${selKey}|${rasterTick}|${lod}`;
        if (!s || s.key !== key) { s = { key, ...layerParts(l, ctx, region) }; cache.current.set(l, s); }
        return s;
    };
    // only the textures this map shows or the tools are about to paint
    const needTex = [...new Set([...usedFloors(doc, customTex), opt.floor, opt.areaFill, RIBBONS[opt.ribbonStyle]?.floor, TERRAINS[doc.terrain]?.floor, doc.backdrop].filter(Boolean))].sort();
    const texKey = `${needTex.join(",")}|${JSON.stringify(needTex.map((id) => customTex[id] ?? null))}`;
    useEffect(() => {
        if (!canRaster()) return;
        let live = true;
        for (const id of needTex) { const k = texKeyOf(id); const r = rasters.get(k); if (r === undefined) rasterTexture(k, id, customTex).then(() => live && setRasterTick((t) => t + 1)); }
        return () => { live = false; };
    }, [texKey]);
    // texture patterns are bitmaps; zoomed in past RASTER_SCALE, area fills (the only thing still filled with a
    // pattern once floors, rooms and ribbons are bitmaps) switch to the vector texture so they stay sharp
    const vectorTex = lod > RASTER_SCALE;
    const areaTex = vectorTex ? [...new Set([
        ...doc.layers.flatMap((l) => l.objects.flatMap((x) => (x.type === "room" ? x.children ?? [] : [x]))).filter((o) => o.type === "area").map((o) => o.fill ?? "parchment"),
        ...(tool === "area" ? [opt.areaFill] : []),
    ])].filter((id) => needTex.includes(id)).sort() : [];
    const patterns = useMemo(() => (canRaster()
        ? needTex.filter((id) => !areaTex.includes(id)).map((id) => {
            const url = rasters.get(texKeyOf(id));
            const t = resolveTexture(id, customTex);
            return typeof url === "string"
                ? `<pattern id="f-${id}" width="${TILE_PX}" height="${TILE_PX}" patternUnits="userSpaceOnUse"><image href="${url}" width="${TILE_PX}" height="${TILE_PX}" preserveAspectRatio="none"/></pattern>`
                : `<pattern id="f-${id}" width="${CELL}" height="${CELL}" patternUnits="userSpaceOnUse"><rect width="${CELL}" height="${CELL}" fill="${t?.color ?? "#777"}"/></pattern>`;
        }).join("") + texturesDefs(areaTex, customTex)
        : texturesDefs(needTex, customTex))
        + `<pattern id="grid-lines-ed" width="${CELL}" height="${CELL}" patternUnits="userSpaceOnUse"><path d="M${CELL} 0H0V${CELL}" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1"/></pattern>`, [texKey, rasterTick, areaTex.join()]);
    const vb = `${v.x} ${v.y} ${size.w / v.z} ${size.h / v.z}`;
    const cursor = space || tool === "pan" ? (dragRef.current?.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : tool === "erase" ? "not-allowed" : "crosshair";
    const hs = 7 / v.z; // handle size in map units
    // floors in chunks: which chunks the view needs (a quarter screen margin), each an image once drawn
    const useChunks = canPaint();
    const S = CHUNK_BMP / lod;
    const painting = ["paint", "rect"].includes(dragRef.current?.kind);
    const chunkCells = useMemo(() => {
        const out = [];
        const m = 0.25;
        for (let cy = Math.floor((v.y - vh * m) / S); cy <= Math.floor((v.y + vh * (1 + m)) / S); cy++) for (let cx = Math.floor((v.x - vw * m) / S); cx <= Math.floor((v.x + vw * (1 + m)) / S); cx++) out.push([cx, cy]);
        return out;
    }, [Math.floor(v.x / (S / 4)), Math.floor(v.y / (S / 4)), S, vw, vh]);
    const bump = () => setRasterTick((t) => t + 1);
    const chunkImage = (look, key, spec, fallback) => {
        const r = chunkRasters.get(key);
        if (r === undefined && !(painting && spec.entries) && chunkCells.length <= 64) rasterChunk(key, look, { ...spec, texKey: texKeyOf }).then(bump);
        const url = typeof r === "string" ? r : latest.get(look);
        return typeof url === "string" ? `<image href="${url}" x="${spec.x}" y="${spec.y}" width="${spec.S}" height="${spec.S}" preserveAspectRatio="none"/>` : fallback();
    };
    const terrainFloor = grid ? TERRAINS[doc.terrain]?.floor ?? "void" : doc.backdrop ?? "parchment";
    // right after zooming out the chunks are still the size for the old zoom and there can be thousands; until the
    // resolution settles (a fraction of a second) the terrain is one rectangle in the texture's colour (a pattern
    // shrunk that far is slow to paint) and painted squares are their paths
    const tooMany = chunkCells.length > 64;
    const terrainChunks = () => tooMany ? `<rect x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}" fill="${resolveTexture(terrainFloor, customTex)?.color ?? "#888"}"/>` : chunkCells.map(([cx, cy]) => {
        const x = cx * S, y = cy * S;
        const look = `t|${terrainFloor}|${quickHash(JSON.stringify(customTex[terrainFloor] ?? null))}|${cx * S},${cy * S},${S}`;
        return chunkImage(look, `${look}|${lod}`, { x, y, S, lod, terrain: terrainFloor, custom: customTex }, () => `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="url(#f-${terrainFloor})"/>`);
    }).join("");
    const floorChunks = (l) => {
        if (!Object.keys(l.floor ?? {}).length) return "";
        if (tooMany) return floorSvg(l.floor);
        const idx = floorByChunk(l.floor, S);
        return chunkCells.map(([cx, cy]) => {
            const c = idx.get(`${cx},${cy}`);
            if (!c) return "";
            const x = cx * S, y = cy * S;
            const look = `f|${c.hash}|${quickHash(JSON.stringify([...new Set(c.entries.map((e) => e[1]))].map((f) => customTex[f] ?? null)))}|${x},${y},${S}`;
            return chunkImage(look, `${look}|${lod}`, { x, y, S, lod, entries: c.entries, custom: customTex }, () => {
                // not drawn yet: the squares of this chunk as pattern-filled paths
                const inside = Object.fromEntries(c.entries.filter(([k]) => { const [cc, rr] = k.split(",").map(Number); return cc * CELL >= x && cc * CELL < x + S && rr * CELL >= y && rr * CELL < y + S; }));
                return floorSvg(inside);
            });
        }).join("");
    };
    // grid maps: terrain and squares fill the whole visible canvas (the border marks the saved area)
    const ext = { x: Math.floor(v.x / CELL) * CELL - CELL, y: Math.floor(v.y / CELL) * CELL - CELL, w: Math.ceil(size.w / v.z / CELL + 3) * CELL, h: Math.ceil(size.h / v.z / CELL + 3) * CELL };

    const roomFrame = (room) => `translate(${room.x} ${room.y})${room.rot ? ` rotate(${room.rot} ${room.w / 2} ${room.h / 2})` : ""}`;
    const overlay = () => {
        const out = [];
        for (const { o, room } of selEntries) {
            const b = o.type === "room" ? { x: o.x, y: o.y, w: o.w, h: o.h } : bounds(o);
            const frame = room ? `translate(${room.x} ${room.y})${room.rot ? ` rotate(${room.rot} ${room.w / 2} ${room.h / 2})` : ""}` : "";
            const box = [];
            const push = (x) => box.push(x);
            if (o.type === "stamp" || o.type === "text" || o.type === "room") {
                const cx = b.x + b.w / 2, cy = o.type === "text" ? o.y : b.y + b.h / 2;
                const rot = o.rot ? `rotate(${o.rot} ${cx} ${cy})` : "";
                const canRot = o.type !== "room" || canRotateRoom();
                push(html`<g transform=${rot}>
                    <rect x=${b.x} y=${b.y} width=${b.w} height=${b.h} class="sel-box" stroke-width=${1.5 / v.z} />
                    ${selected.length === 1 && html`<rect data-handle="resize" x=${b.x + b.w - hs} y=${b.y + b.h - hs} width=${hs * 2} height=${hs * 2} class="handle" stroke-width=${1.5 / v.z} />
                        ${canRot && html`<line x1=${cx} y1=${b.y} x2=${cx} y2=${b.y - 24 / v.z} class="sel-line" stroke-width=${1.5 / v.z} />
                        <circle data-handle="rotate" cx=${cx} cy=${b.y - 24 / v.z} r=${hs} class="handle" stroke-width=${1.5 / v.z} />`}`}
                </g>`);
            } else if (o.pts) {
                push(html`<rect x=${b.x - 4 / v.z} y=${b.y - 4 / v.z} width=${b.w + 8 / v.z} height=${b.h + 8 / v.z} class="sel-box" stroke-width=${1.5 / v.z} />`);
                if (selected.length === 1) o.pts.forEach((pt, i) => push(html`<circle data-handle=${`vertex:${i}`} cx=${pt[0]} cy=${pt[1]} r=${hs} class="handle" stroke-width=${1.5 / v.z} />`));
            } else push(html`<rect x=${b.x} y=${b.y} width=${b.w} height=${b.h} class="sel-box" stroke-width=${1.5 / v.z} />`);
            out.push(frame ? html`<g transform=${frame}>${box}</g>` : box);
        }
        const groups = new Set(selected.filter((o) => o.type === "room" && o.group).map((o) => o.group));
        for (const r of active.objects) if (r.type === "room" && groups.has(r.group) && !sel.includes(r.id)) out.push(html`<g transform=${roomFrame(r)}><rect width=${r.w} height=${r.h} class="group-box" stroke-width=${1.5 / v.z} /></g>`);
        if (ghost?.box) { const [a, b] = ghost.box; out.push(html`<rect x=${Math.min(a[0], b[0])} y=${Math.min(a[1], b[1])} width=${Math.abs(a[0] - b[0])} height=${Math.abs(a[1] - b[1])} class="box-sel" stroke-width=${1 / v.z} />`); }
        if (ghost?.rect && ghost.free) {
            const [a, b] = ghost.rect;
            out.push(html`<rect x=${Math.min(a[0], b[0])} y=${Math.min(a[1], b[1])} width=${Math.abs(a[0] - b[0])} height=${Math.abs(a[1] - b[1])} class="box-sel" stroke-width=${2 / v.z} />`);
        } else if (ghost?.rect && ghost.room) {
            const room = ghost.room, B = room.box ?? CELL, la = toRoom(room, ghost.rect[0]), lb = toRoom(room, ghost.rect[1]);
            const [c0, r0, c1, r1] = [la[0], la[1], lb[0], lb[1]].map((x) => Math.floor(x / B));
            out.push(html`<g transform=${roomFrame(room)}><rect x=${Math.min(c0, c1) * B} y=${Math.min(r0, r1) * B} width=${(Math.abs(c1 - c0) + 1) * B} height=${(Math.abs(r1 - r0) + 1) * B} class="box-sel" stroke-width=${2 / v.z} /></g>`);
        } else if (ghost?.rect) {
            const [a, b] = ghost.rect, [c0, r0] = cellOf(a), [c1, r1] = cellOf(b);
            out.push(html`<rect x=${Math.min(c0, c1) * CELL} y=${Math.min(r0, r1) * CELL} width=${(Math.abs(c1 - c0) + 1) * CELL} height=${(Math.abs(r1 - r0) + 1) * CELL} class="box-sel" stroke-width=${2 / v.z} />`);
            out.push(html`<text x=${Math.max(c0, c1) * CELL + CELL} y=${Math.min(r0, r1) * CELL - 6 / v.z} class="measure-text" font-size=${13 / v.z}>${Math.abs(c1 - c0) + 1} × ${Math.abs(r1 - r0) + 1}</text>`);
        }
        if (ghost?.measure) {
            const [a, b] = ghost.measure, len = dist(a, b) * unitsPerPx(doc);
            out.push(html`<line x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]} class="measure-line" stroke-width=${2 / v.z} stroke-dasharray=${`${6 / v.z} ${4 / v.z}`} />
                <text x=${b[0] + 8 / v.z} y=${b[1] - 8 / v.z} class="measure-text" font-size=${14 / v.z}>${len >= 10 ? Math.round(len) : len.toFixed(1)} ${doc.units?.unit ?? ""}</text>`);
        }
        if (draft) {
            const pts = hover && !draft.freehand ? [...draft.pts, tool === "line" ? snapLine(hover) : tool === "ribbon" ? snapRibbon(hover) : hover] : draft.pts;
            if (tool === "ribbon") out.push(html`<g opacity="0.8" dangerouslySetInnerHTML=${{ __html: objectSvg({ id: "draft", type: "ribbon", style: opt.ribbonStyle, pts, cols: opt.ribbonCols, box: opt.ribbonBox, grid: opt.ribbonGrid }, {}) }} />`,
                ...draft.pts.map((q) => html`<circle cx=${q[0]} cy=${q[1]} r=${hs} class="handle" stroke-width=${1.5 / v.z} />`));
            else if (tool === "area") out.push(html`<path d=${pathD(pts, draft.freehand, true)} class="draft-area" stroke-width=${2 / v.z} />`);
            else out.push(html`<g dangerouslySetInnerHTML=${{ __html: layerSvg({ objects: [{ id: "draft", type: "path", style: opt.pathStyle, pts, smooth: PATH_STYLES[opt.pathStyle]?.smooth && draft.freehand }] }, { stampHref: () => "" }) }} opacity="0.75" />`);
        }
        if (hover && (tool === "floor" || tool === "unfloor") && grid && !ghost) {
            // the brush follows the floor under it: a room's angle and box size, or the map's squares
            const { room, lp, B } = spaceAt(hover);
            const off = Math.floor((opt.brush - 1) / 2), c = Math.floor(lp[0] / B), r = Math.floor(lp[1] / B);
            const f = tool === "unfloor" ? (room ? room.floor : TERRAINS[doc.terrain]?.floor) ?? "void" : opt.floor;
            const k = B / CELL;
            const brush = html`<defs><pattern id="brush-pat" href=${`#f-${f}`} patternTransform=${`scale(${k})`} /></defs>
                <rect x=${(c - off) * B} y=${(r - off) * B} width=${opt.brush * B} height=${opt.brush * B} class=${tool === "unfloor" ? "brush erase" : "brush"} fill="url(#brush-pat)" stroke-width=${2 / v.z} />`;
            out.push(room ? html`<g transform=${roomFrame(room)}>${brush}</g>` : brush);
        }
        if (hover && tool === "scatter") out.push(html`<circle cx=${hover[0]} cy=${hover[1]} r=${opt.radius} class="brush-ring" stroke-width=${1.5 / v.z} />`);
        if (hover && tool === "stamp" && opt.stamp && !dragRef.current) {
            const a = aspects.get(stampSrc(opt.stamp));
            const s = opt.stamp;
            const w0 = grid ? (Array.isArray(s.cells) ? s.cells[0] : s.cells ?? Math.max(1, Math.round((s.w ?? 48) / 40))) * CELL : Array.isArray(s.cells) ? s.cells[0] * 22 : s.w ?? 48;
            const hh0 = Array.isArray(s.cells) ? (grid ? s.cells[1] * CELL : s.cells[1] * 22) : w0 * (a ?? 1);
            const hk = opt.handScale ?? 1, w = w0 * hk, hh = hh0 * hk;
            // the preview sits the way it will land: in a room it takes the room's angle and grid
            const { room, lp, B } = spaceAt(hover);
            let x = snapOn() ? Math.floor(lp[0] / B) * B : lp[0] - w / 2, y = snapOn() ? Math.floor(lp[1] / B) * B : lp[1] - hh / 2;
            if (s.ports) { const sn = portSnap({ x, y, w, h: hh, rot: opt.handRot, ports: s.ports }, room); if (sn) { const t = shiftLocal({ x, y }, room, sn); x = t.x; y = t.y; } }
            const img = html`<image href=${stampSrc(s)} x=${x} y=${y} width=${w} height=${hh} opacity="0.55" preserveAspectRatio="none" pointer-events="none"
                transform=${opt.handRot ? `rotate(${opt.handRot} ${x + w / 2} ${y + hh / 2})` : undefined} />`;
            out.push(room ? html`<g transform=${roomFrame(room)}>${img}</g>` : img);
        }
        if (ghost?.roomShape) {
            const { room, a, b } = ghost.roomShape;
            const sh = opt.roomShape === "circle" ? { shape: "circle", cx: a[0], cy: a[1], r: Math.hypot(b[0] - a[0], b[1] - a[1]) } : { shape: "rect", x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
            out.push(html`<g transform=${roomFrame(room)} class=${`room-shape ${opt.roomOp}`} stroke-width=${2 / v.z} dangerouslySetInnerHTML=${{ __html: shapeSvg(sh, "currentColor") }} />`);
        }
        if (roomPoly) {
            const room = active.objects.find((o) => o.id === roomPoly.room);
            if (room) {
                const pts = hover ? [...roomPoly.pts, snapLocal(room, toRoom(room, hover))] : roomPoly.pts;
                out.push(html`<g transform=${roomFrame(room)} class=${`room-shape ${opt.roomOp}`}><path d=${`M${pts.map((q) => q.join(" ")).join("L")}Z`} fill="currentColor" stroke-width=${2 / v.z} />
                    ${roomPoly.pts.map((q) => html`<circle cx=${q[0]} cy=${q[1]} r=${hs} class="handle" stroke-width=${1.5 / v.z} />`)}</g>`);
            }
        }
        if (hover && tool === "roomshape" && !ghost?.roomShape && !roomPoly) {
            const room = targetRoom(hover);
            if (room) { const e = roomExtent(room); out.push(html`<g transform=${roomFrame(room)}><rect x=${e.x} y=${e.y} width=${e.w} height=${e.h} class="sel-box" stroke-width=${1.5 / v.z} /></g>`); }
        }
        if (hover && tool === "opening") {
            const hit = wallHit(hover);
            if (hit) {
                const len = opt.openLen * (hit.room.box ?? CELL);
                out.push(html`<g transform=${roomFrame(hit.room)}><rect x=${hit.q[0] - len / 2} y=${hit.q[1] - 9} width=${len} height=${18} class="opening-preview" stroke-width=${2 / v.z} transform=${`rotate(${hit.angle} ${hit.q[0]} ${hit.q[1]})`} /></g>`);
            }
        }
        return out;
    };

    const layerViews = viewLayers(doc);
    return html`<div class="map-editor">
        <header class="map-bar">
            <a href=${`#/world/${encodeURIComponent(loc.world ?? "-")}?tab=maps`} class="muted">← World builder</a>
            ${data.parent && html`<a class="muted" href=${data.parent.hasMap ? mapHref(data.parent.path) : noteHref(data.parent.path)}>↑ ${data.parent.name}</a>`}
            <b class="map-title">${loc.title}</b>${loc.scale && html`<span class="badge">${loc.scale}</span>`}
            <span class="badge">${grid ? `square grid · 1 square = ${doc.units.amount} ${doc.units.unit}` : "freeform"}</span>
            <div class="seg" role="group" aria-label="Layer view">
                ${[["current", "This layer"], ["faded", "Below faded"], ["solid", "Below solid"], ["all", "All solid"]].map(([k, l]) => html`<button class=${doc.view === k ? "on" : ""} aria-pressed=${doc.view === k} onClick=${() => commit({ ...doc, view: k })} title="Which layers below the current one show">${l}</button>`)}
            </div>
            ${grid && html`<button class=${`snap-toggle ${doc.snap ? "on" : ""}`} aria-pressed=${doc.snap} title="Snap to the grid (hold Alt to place freely once)" onClick=${() => commit({ ...doc, snap: !doc.snap })}>Snap ${doc.snap ? "on" : "off"}</button>`}
            <span class="grow" />
            <button title="Undo (Ctrl+Z)" onClick=${undo} disabled=${!hist.current.past.length}>↶</button>
            <button title="Redo (Ctrl+Shift+Z)" onClick=${redo} disabled=${!hist.current.future.length}>↷</button>
            <span class="row zoom"><button onClick=${() => zoomAt(0.8)} aria-label="Zoom out">−</button><span>${Math.round(v.z * 100)}%</span><button onClick=${() => zoomAt(1.25)} aria-label="Zoom in">+</button><button onClick=${fit}>Fit</button></span>
            <label class="row muted" title="Save 4 seconds after the last change"><input type="checkbox" checked=${autosave} onChange=${(e) => { setAutosave(e.target.checked); store.set("mapAutosave", e.target.checked); }} /> Autosave</label>
            <button class="primary" disabled=${busy || !dirty} onClick=${save}>${busy ? "Saving…" : dirty ? "Save" : "Saved"}</button>
        </header>
        <div class="map-body">
            <nav class="tool-rail" aria-label="Tools">${TOOLS.filter((t) => !t[4] || grid).map(([id, label, key, d]) => html`<button class=${tool === id ? "on" : ""} aria-pressed=${tool === id} title=${`${label} (${key})`} aria-label=${label}
                onClick=${() => { setTool(id); setDraft(null); if (id === "pin") setPanel("pins"); if (id === "stamp" || id === "scatter") setPanel("stamps"); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${d} /></svg></button>`)}
            </nav>
            <section class="map-canvas" ref=${wrapRef}>
                <${ToolOptions} tool=${tool} opt=${opt} setO=${setO} grid=${grid} draft=${draft} finishDraft=${finishDraft} data=${data} />
                <svg ref=${svgRef} class="map-svg" viewBox=${vb} style=${`cursor:${cursor}`} xmlns="http://www.w3.org/2000/svg"
                    onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${onPointerUp} onPointerLeave=${() => setHover(null)}
                    onDblClick=${(e) => {
                        if (draft && !draft.freehand) return finishDraft();
                        if (roomPoly) return finishRoomPoly();
                        if (tool !== "select") return;
                        const handle = e.target.closest?.("[data-handle]")?.getAttribute("data-handle");
                        if (handle?.startsWith("vertex:") && selected.length === 1) return removePoint(selected[0], Number(handle.split(":")[1]));
                        const o = active.objects.find((x) => x.id === hitId(e));
                        if (o?.type === "pin") return openPin(o);
                        if (o?.pts) addPoint(o, toMap(e));
                    }} onContextMenu=${(e) => e.preventDefault()}
                    onDragOver=${(e) => e.preventDefault()} onDrop=${onDrop}>
                    <defs dangerouslySetInnerHTML=${{ __html: patterns }} />
                    <rect x=${-1e5} y=${-1e5} width=${2e5} height=${2e5} class="map-outside" />
                    ${useChunks ? html`<g pointer-events="none" dangerouslySetInnerHTML=${{ __html: grid ? terrainChunks() : `<clipPath id="map-area"><rect width="${doc.width}" height="${doc.height}"/></clipPath><g clip-path="url(#map-area)">${terrainChunks()}</g>` }} />`
                        : grid ? html`<rect x=${ext.x} y=${ext.y} width=${ext.w} height=${ext.h} fill=${`url(#f-${TERRAINS[doc.terrain]?.floor ?? "void"})`} pointer-events="none" />`
                        : html`<g pointer-events="none" dangerouslySetInnerHTML=${{ __html: backgroundSvg(doc) }} />`}
                    ${layerViews.filter((x) => x.shown).map((x, i, all) => html`<g key=${x.layer.id} class=${x.active ? "layer-active" : "layer-below"} opacity=${x.faded ? 0.35 : 1}
                        pointer-events=${x.active && !x.layer.locked ? "auto" : "none"}>
                        <g pointer-events="none" dangerouslySetInnerHTML=${{ __html: useChunks ? floorChunks(x.layer) : markup(x.layer).floor }} />
                        ${i === all.length - 1 && (grid ? doc.showGrid && html`<rect x=${ext.x} y=${ext.y} width=${ext.w} height=${ext.h} fill="url(#grid-lines-ed)" pointer-events="none" />`
                            : html`<g pointer-events="none" dangerouslySetInnerHTML=${{ __html: gridSvg(doc) }} />`)}
                        <g dangerouslySetInnerHTML=${{ __html: markup(x.layer).objects }} />
                    </g>`)}
                    <g pointer-events="none" class="map-border">
                        <rect width=${doc.width} height=${doc.height} class="edge-dark" stroke-width=${4 / v.z} />
                        <rect width=${doc.width} height=${doc.height} class="edge-light" stroke-width=${1.5 / v.z} stroke-dasharray=${`${8 / v.z} ${6 / v.z}`} />
                        <text x=${0} y=${-8 / v.z} font-size=${12 / v.z} class="edge-label">${grid ? `${doc.width / CELL} × ${doc.height / CELL} squares` : `${doc.width} × ${doc.height} px`} · saved area</text>
                    </g>
                    <g class="overlay">${overlay()}</g>
                </svg>
                <div class="map-status muted">${hover ? (grid ? `square ${cellOf(hover).join(", ")}` : `${Math.round(hover[0])}, ${Math.round(hover[1])}`) : ""} · layer: ${active.name}${active.locked ? " (locked)" : ""}${sel.length ? ` · ${sel.length} selected` : ""}</div>
            </section>
            <aside class="map-side">
                <div class="tabs side-tabs">${[["stamps", "Stamps"], ["textures", "Textures"], ["inspect", sel.length ? `Selected (${sel.length})` : "Selected"], ["layers", "Layers"], ["pins", "Pins"], ["map", "Map"]].map(([k, l]) => html`<button class=${panel === k ? "on" : ""} onClick=${() => setPanel(k)}>${l}</button>`)}</div>
                <div class="side-body">
                    ${panel === "stamps" && html`<${StampLibrary} library=${library} grid=${grid} opt=${opt} onPick=${(s) => { setO({ stamp: s }); if (tool !== "scatter") setTool("stamp"); aspectOf(stampSrc(s)); }} onUpload=${(f) => uploadStamp(f)} />`}
                    ${panel === "textures" && html`<${TexturePanel} lib=${texLib} setLib=${setTexLib} custom=${customTex} opt=${opt} setO=${setO} grid=${grid} useFloor=${(id) => { setO({ floor: id }); setTool(grid ? "floor" : "area"); if (!grid) setO({ areaFill: id }); }} />`}
                    ${panel === "inspect" && html`<${Inspector} selected=${selected} joinSelected=${joinSelected} separateSelected=${separateSelected} groupSize=${(g) => active.objects.filter((o) => o.type === "room" && o.group === g).length} canRotateRoom=${canRotateRoom()} releaseRoom=${releaseRoom} patchSel=${patchSel} removeSel=${removeSel} duplicate=${duplicate} order=${order} doc=${doc} toLayer=${toLayer} grid=${grid} names=${names} />`}
                    ${panel === "layers" && html`<${LayersPanel} doc=${doc} commit=${commit} setSel=${setSel} />`}
                    ${panel === "pins" && html`<${PinsPanel} data=${data} placed=${placedPins} opt=${opt} setO=${setO} setTool=${setTool} onOpen=${(c) => (c.hasMap ? go(mapHref(c.path)) : openInDrawer(noteHref(c.path)))} />`}
                    ${panel === "map" && html`<${MapSettings} doc=${doc} commit=${commit} file=${data.file} />`}
                </div>
            </aside>
        </div>
    </div>`;
}

// ------------------------------------------------------------------ tool options (floating bar on the canvas)

function ToolOptions({ tool, opt, setO, grid, draft, finishDraft, data }) {
    const styles = Object.entries(PATH_STYLES).filter(([, s]) => s.modes === "both" || s.modes === (grid ? "grid" : "freeform"));
    const floorSelect = (value, on) => html`<select value=${value} onChange=${(e) => on(e.target.value)}>${texOptions()}</select>`;
    const swatch = (id) => html`<svg width="22" height="22" class="swatch" aria-hidden="true"><rect width="22" height="22" fill=${`url(#f-${id})`} /></svg>`;
    const body = {
        select: html`<span class="muted">Click to select, Shift-click to add, drag on empty space to box-select. Double-click a line to add a point, a point to remove it. Del deletes, Ctrl+D duplicates, [ ] reorder. WASD pans.</span>`,
        pan: html`<span class="muted">Drag to pan, or hold W A S D (Shift: faster). Wheel zooms; 0 fits the map.</span>`,
        stamp: html`<span>${opt.stamp ? html`<b>${opt.stamp.name}</b>` : html`<span class="muted">Pick a stamp in the library</span>`}</span>
            <label class="row"><input type="checkbox" checked=${opt.vary} onChange=${(e) => setO({ vary: e.target.checked })} /> Vary (random from the same set)</label>
            <span class="row">Angle <b>${opt.handRot ?? 0}°</b> <button class="small" onClick=${() => setO({ handRot: 0 })} disabled=${!opt.handRot}>Reset</button></span>
            <span class="row">Size <b>${Math.round((opt.handScale ?? 1) * 100)}%</b> <button class="small" onClick=${() => setO({ handScale: 1 })} disabled=${(opt.handScale ?? 1) === 1}>Reset</button></span>
            <span class="muted">Q / E rotate (Shift: 90°), Z / X smaller / larger (Shift: more). Click to place${grid ? ", snapped to the grid (Alt: free)" : ""}; right-click to put it down.</span>`,
        scatter: html`<span>${opt.stamp ? html`<b>${opt.stamp.name}</b>` : html`<span class="muted">Pick a stamp</span>`}</span>
            <label class="row"><input type="checkbox" checked=${opt.vary} onChange=${(e) => setO({ vary: e.target.checked })} /> Vary</label>
            <label class="row">Radius <input type="range" min="10" max="300" value=${opt.radius} onInput=${(e) => setO({ radius: +e.target.value })} /></label>
            <label class="row">Density <input type="range" min="1" max="10" value=${opt.density} onInput=${(e) => setO({ density: +e.target.value })} /></label>
            <label class="row">Size ± <input type="range" min="0" max="0.6" step="0.05" value=${opt.jitter} onInput=${(e) => setO({ jitter: +e.target.value })} /></label>
            <label class="row">Spacing <input type="range" min="0.2" max="1.5" step="0.05" value=${opt.spacing} onInput=${(e) => setO({ spacing: +e.target.value })} /></label>`,
        line: html`<label class="row">Style <select value=${opt.pathStyle} onChange=${(e) => setO({ pathStyle: e.target.value })}>${styles.map(([k, s]) => html`<option value=${k}>${s.name}</option>`)}</select></label>
            <${StylePreview} style=${opt.pathStyle} />
            <span class="muted">Click points (Enter or double-click ends, Backspace removes the last) or drag to draw freehand.</span>
            ${draft && html`<button class="small" onClick=${() => finishDraft()}>Finish</button>`}`,
        ribbon: html`<label class="row">Kind <select value=${opt.ribbonStyle} onChange=${(e) => setO({ ribbonStyle: e.target.value, ribbonCols: RIBBONS[e.target.value].cols })}>${Object.entries(RIBBONS).map(([k, r]) => html`<option value=${k}>${r.name}</option>`)}</select></label>
            <label class="row">Boxes across <input type="number" min="1" max="12" value=${opt.ribbonCols} style="width:56px" onChange=${(e) => setO({ ribbonCols: Math.max(1, +e.target.value) })} /></label>
            <label class="row">Box size <input type="number" min="8" max="256" value=${opt.ribbonBox} style="width:64px" onChange=${(e) => setO({ ribbonBox: Math.max(8, +e.target.value) })} /> px</label>
            <label class="row"><input type="checkbox" checked=${opt.ribbonGrid} onChange=${(e) => setO({ ribbonGrid: e.target.checked })} /> Own grid</label>
            <span class="muted">Click points along the centre (Enter ends) or drag freehand. Then double-click the strip to add points and drag them to bend it.</span>
            ${draft && html`<button class="small" onClick=${() => finishDraft()}>Finish</button>`}`,
        roomshape: html`<div class="seg" role="group" aria-label="Add or cut">${[["add", "Add"], ["sub", "Cut away"]].map(([k, l]) => html`<button class=${opt.roomOp === k ? "on" : ""} aria-pressed=${opt.roomOp === k} onClick=${() => setO({ roomOp: k })}>${l}</button>`)}</div>
            <div class="seg" role="group" aria-label="Shape">${[["rect", "Box"], ["circle", "Circle"], ["poly", "Polygon"]].map(([k, l]) => html`<button class=${opt.roomShape === k ? "on" : ""} aria-pressed=${opt.roomShape === k} onClick=${() => setO({ roomShape: k })}>${l}</button>`)}</div>
            <span class="muted">${opt.roomShape === "poly" ? "Click corners, Enter or double-click to finish." : opt.roomShape === "circle" ? "Drag from the centre." : "Drag a box."} Works in the selected room's own grid and angle; walls follow.</span>`,
        opening: html`<label class="row">Put in <select value=${opt.openKind} onChange=${(e) => setO({ openKind: e.target.value })}><option value="opening">Opening only</option><option value="door">Door</option><option value="double-door">Double door</option><option value="window">Window</option></select></label>
            <label class="row">Width <select value=${opt.openLen} onChange=${(e) => setO({ openLen: +e.target.value })}>${[1, 2, 3, 4].map((n) => html`<option value=${n}>${n} box${n > 1 ? "es" : ""}</option>`)}</select></label>
            <span class="muted">Click on a room wall. It turns with the wall.</span>`,
        unfloor: html`<label class="row">Brush <select value=${opt.brush} onChange=${(e) => setO({ brush: +e.target.value })}>${[1, 2, 3, 5].map((n) => html`<option value=${n}>${n}×${n}</option>`)}</select></label>
            <span class="muted">Drag to erase painted floor back to the default terrain; Shift-drag erases a rectangle.</span>`,
        area: html`<label class="row">Fill ${swatch(opt.areaFill)} ${floorSelect(opt.areaFill, (v) => setO({ areaFill: v }))}</label>
            <label class="row">Edge <select value=${opt.areaEdge} onChange=${(e) => setO({ areaEdge: e.target.value })}><option value="none">None</option>${styles.map(([k, s]) => html`<option value=${k}>${s.name}</option>`)}</select></label>
            <span class="muted">Drag around the area, or click its corners and press Enter.</span>`,
        floor: html`<label class="row">Floor ${swatch(opt.floor)} ${floorSelect(opt.floor, (v) => setO({ floor: v }))}</label>
            <label class="row">Brush <select value=${opt.brush} onChange=${(e) => setO({ brush: +e.target.value })}>${[1, 2, 3, 5].map((n) => html`<option value=${n}>${n}×${n}</option>`)}</select></label>
            <span class="muted">Drag to paint, Shift-drag fills a rectangle, Alt or right button erases (back to the default terrain).</span>`,
        room: html`<label class="row">Floor ${swatch(opt.floor)} ${floorSelect(opt.floor, (v) => setO({ floor: v }))}</label>
            <label class="row">Walls <select value=${opt.wallStyle} onChange=${(e) => setO({ wallStyle: e.target.value })}>${styles.filter(([k]) => k.startsWith("wall") || k === "fence" || k === "hedge" || k === "iron-railing").map(([k, s]) => html`<option value=${k}>${s.name}</option>`)}</select></label>
            <label class="row">Box size <input type="number" min="8" max="256" value=${opt.roomBox ?? CELL} style="width:64px" onChange=${(e) => setO({ roomBox: Math.max(8, +e.target.value) })} /> px</label>
            <span class="muted">Drag a rectangle. The room is an object: move it, resize it, rotate it (snapping off). Things placed in it move with it.</span>`,
        text: html`<label class="row">Style <select value=${opt.textStyle} onChange=${(e) => setO({ textStyle: e.target.value })}>${Object.entries(TEXT_STYLES).map(([k, s]) => html`<option value=${k}>${s.name}</option>`)}</select></label>
            <span class="muted">Click to place, then type in the Selected panel.</span>`,
        pin: html`<span>${opt.pinLoc ? html`Placing <b>${opt.pinLoc.title}</b>` : data.children.length ? html`<span class="muted">Pick a sub-location in the Pins panel</span>` : html`<span class="muted">${data.location.title} has no sub-locations yet</span>`}</span>`,
        measure: html`<span class="muted">Drag to measure, in the map's units (set them in the Map panel).</span>`,
        erase: html`<span class="muted">Click or drag over things to delete them (floors: use the floor tool with Alt).</span>`,
    }[tool];
    return html`<div class="tool-opts row">${body}</div>`;
}

function StylePreview({ style }) {
    const markup = layerSvg({ objects: [{ id: "p", type: "path", style, pts: [[8, 18], [60, 8], [112, 18]], smooth: true }] }, { stampHref: () => "" });
    return html`<svg width="120" height="26" viewBox="0 0 120 26" class="style-preview" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: markup }} />`;
}

// ------------------------------------------------------------------ stamp library

function StampLibrary({ library, grid, opt, onPick, onUpload }) {
    const [q, setQ] = useState("");
    const [style, setStyle] = useState(() => store.get(`stampStyle:${grid ? "grid" : "free"}`, ""));
    const [all, setAll] = useState(false);
    const [closed, setClosed] = useState(() => new Set(store.get("stampGroupsClosed", [])));
    const fileRef = useRef();
    if (!library) return html`<p class="muted">Loading stamps…</p>`;
    const groups = library.groups.filter((g) => all || g.mode === "both" || g.mode === (grid ? "grid" : "freeform"));
    const ids = new Set(groups.map((g) => g.id));
    const mine = library.vault.map((s) => ({ ...s, group: "vault", style: "Mine" }));
    const pool = library.stamps.filter((s) => ids.has(s.group));
    const styles = [...new Set(pool.map((s) => s.style))];
    const t = q.trim().toLowerCase();
    const match = (s) => (!style || s.style === style) && (!t || s.name.toLowerCase().includes(t) || s.group.includes(t));
    const toggle = (id) => { const c = new Set(closed); c.has(id) ? c.delete(id) : c.add(id); setClosed(c); store.set("stampGroupsClosed", [...c]); };
    const tile = (s) => html`<button key=${s.id} class=${`stamp-tile ${opt.stamp?.id === s.id ? "on" : ""}`} title=${`${s.name} · ${s.style}`} onClick=${() => onPick(s)}
        draggable="true" onDragStart=${(e) => e.dataTransfer.setData("application/x-map-stamp", s.id)}><img src=${stampSrc(s)} alt=${s.name} loading="lazy" /></button>`;
    const section = (id, name, list) => list.length > 0 && html`<section class="stamp-group">
        <button class="group-head" aria-expanded=${!closed.has(id) || !!t} onClick=${() => toggle(id)}><span>${name}</span><span class="muted">${list.length} ${closed.has(id) && !t ? "▸" : "▾"}</span></button>
        ${(!closed.has(id) || t) && html`<div class="stamp-grid">${list.map(tile)}</div>`}
    </section>`;
    return html`<div class="stamp-library">
        <input placeholder="Search stamps…" value=${q} onInput=${(e) => setQ(e.target.value)} style="width:100%" aria-label="Search stamps" />
        <div class="style-chips">${["", ...styles].map((s) => html`<button class=${`chip ${style === s ? "on" : ""}`} onClick=${() => { setStyle(s); store.set(`stampStyle:${grid ? "grid" : "free"}`, s); }}>${s || "All styles"}</button>`)}</div>
        <div class="row" style="margin:6px 0">
            <button class="small" onClick=${() => fileRef.current.click()}>+ Add image</button>
            <input ref=${fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden onChange=${(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
            <label class="row muted"><input type="checkbox" checked=${all} onChange=${(e) => setAll(e.target.checked)} /> All groups</label>
        </div>
        <p class="muted small-note">Paste an image (Ctrl+V) or drop one on the map to add it to your stamps.</p>
        ${section("vault", "My stamps", mine.filter((s) => !t || s.name.toLowerCase().includes(t)))}
        ${groups.map((g) => section(g.id, g.name, pool.filter((s) => s.group === g.id && match(s))))}
        <p class="muted small-note">Stamp credits: <a href="/stamps/CREDITS.md" target="_blank" rel="noopener">CREDITS.md</a> (game-icons.net stamps are CC BY 3.0).</p>
    </div>`;
}

// ------------------------------------------------------------------ selection inspector

function Inspector({ selected, joinSelected, separateSelected, groupSize, canRotateRoom, releaseRoom, patchSel, removeSel, duplicate, order, doc, toLayer, grid, names }) {
    if (!selected.length) return html`<p class="muted">Nothing selected. Use the select tool (V) and click something on the map.</p>`;
    const o = selected[0];
    const one = selected.length === 1;
    const styles = Object.entries(PATH_STYLES).filter(([, s]) => s.modes === "both" || s.modes === (grid ? "grid" : "freeform"));
    const num = (label, key, step = 1) => html`<label class="field"><span>${label}</span><input type="number" step=${step} value=${Math.round((o[key] ?? 0) * 10) / 10}
        onChange=${(e) => patchSel({ [key]: Number(e.target.value) })} /></label>`;
    return html`<div class="inspector">
        <div class="spread"><b>${one ? ({ stamp: o.name ?? "Stamp", path: PATH_STYLES[o.style]?.name ?? "Line", area: "Area", ribbon: RIBBONS[o.style]?.name ?? "Strip", room: "Room", text: "Text", pin: names.get(linkName(o.location).toLowerCase()) ?? linkName(o.location) }[o.type]) : `${selected.length} things`}</b>
            <span class="muted">${one ? o.type : ""}</span></div>
        ${one && o.type === "text" && html`
            <textarea key=${o.id} autoFocus value=${o.text} onInput=${(e) => patchSel({ text: e.target.value })} style="font-family:inherit;min-height:70px" aria-label="Text" />
            <div class="field-grid">
                <label class="field"><span>Style</span><select value=${o.style} onChange=${(e) => patchSel({ style: e.target.value, size: undefined })}>${Object.entries(TEXT_STYLES).map(([k, s]) => html`<option value=${k}>${s.name}</option>`)}</select></label>
                <label class="field"><span>Size</span><input type="number" min="6" max="400" value=${o.size ?? TEXT_STYLES[o.style]?.size} onChange=${(e) => patchSel({ size: Number(e.target.value) })} /></label>
                <label class="field"><span>Colour</span><input type="color" value=${o.color ?? TEXT_STYLES[o.style]?.color} onInput=${(e) => patchSel({ color: e.target.value })} /></label>
                ${num("Rotation", "rot")}
            </div>`}
        ${one && o.type === "stamp" && html`<div class="field-grid">${num("Width", "w")}${num("Height", "h")}${num("Rotation", "rot")}
            <label class="field"><span>Opacity</span><input type="range" min="0.1" max="1" step="0.05" value=${o.opacity ?? 1} onInput=${(e) => patchSel({ opacity: Number(e.target.value) })} /></label></div>`}
        ${one && o.type === "ribbon" && html`<${RibbonFields} o=${o} patchSel=${patchSel} />`}
        ${selected.filter((x) => x.type === "room").length > 1 && html`<div class="row"><button onClick=${joinSelected}>Join rooms</button><span class="muted small-note">Ctrl+G · joined rooms move and turn together</span></div>`}
        ${selected.some((x) => x.type === "room" && x.group) && html`<div class="row"><span class="muted">${one ? `Joined with ${groupSize(o.group) - 1} other room${groupSize(o.group) > 2 ? "s" : ""}` : "Joined rooms"}</span>
            <button class="small" onClick=${separateSelected}>Separate</button><span class="muted small-note">Ctrl+Shift+G</span></div>`}
        ${one && o.type === "room" && html`<${RoomFields} o=${o} patchSel=${patchSel} canRotate=${canRotateRoom} release=${() => releaseRoom(o)} />`}
        ${(o.type === "path" || o.type === "area") && one && html`<div class="field-grid">
            ${o.type === "area" && html`<label class="field"><span>Fill</span><select value=${o.fill} onChange=${(e) => patchSel({ fill: e.target.value })}>${texOptions()}</select></label>`}
            <label class="field"><span>${o.type === "area" ? "Edge" : "Style"}</span><select value=${o.style ?? "none"} onChange=${(e) => patchSel({ style: e.target.value === "none" ? null : e.target.value })}>${o.type === "area" && html`<option value="none">None</option>`}${styles.map(([k, s]) => html`<option value=${k}>${s.name}</option>`)}</select></label>
            <label class="field"><span>Width ×</span><input type="number" min="0.2" max="6" step="0.1" value=${o.scale ?? 1} onChange=${(e) => patchSel({ scale: Number(e.target.value) })} /></label>
            <label class="row"><input type="checkbox" checked=${o.smooth ?? PATH_STYLES[o.style]?.smooth} onChange=${(e) => patchSel({ smooth: e.target.checked })} /> Smooth</label>
            ${o.type === "path" && html`<label class="row"><input type="checkbox" checked=${!!o.closed} onChange=${(e) => patchSel({ closed: e.target.checked })} /> Closed loop</label>`}
        </div><p class="muted small-note">Drag the round handles to reshape it.</p>`}
        ${one && o.type === "pin" && html`<label class="row"><input type="checkbox" checked=${!o.hideLabel} onChange=${(e) => patchSel({ hideLabel: !e.target.checked })} /> Show name</label>
            <label class="field"><span>Colour</span><input type="color" value=${o.color ?? "#6a4fc4"} onInput=${(e) => patchSel({ color: e.target.value })} /></label>
            <p class="muted small-note">Double-click the pin to open its map (or note).</p>`}
        <div class="row" style="margin-top:8px">
            ${selected.some((x) => x.type === "stamp" || x.type === "text") && [-90, -10, 10, 90].map((a) => html`<button class="small" title=${`Rotate ${a > 0 ? "right" : "left"} ${Math.abs(a)}°`}
                onClick=${() => patchSel((x) => (x.type === "stamp" || x.type === "text" ? { rot: (((x.rot ?? 0) + a) % 360 + 360) % 360 } : {}))}>${a < 0 ? "⟲" : "⟳"} ${Math.abs(a)}°</button>`)}
            ${selected.some((x) => x.type === "stamp") && html`
                <button class="small" onClick=${() => patchSel((x) => ({ flip: !x.flip }))}>Flip</button>`}
            <button class="small" onClick=${duplicate}>Duplicate</button>
            <button class="small" onClick=${() => order("top")}>To front</button>
            <button class="small" onClick=${() => order("bottom")}>To back</button>
            <${ConfirmButton} onConfirm=${removeSel}>Delete<//>
        </div>
        ${doc.layers.length > 1 && html`<label class="field" style="margin-top:8px"><span>Move to layer</span><select value="" onChange=${(e) => e.target.value && toLayer(e.target.value)}>
            <option value="">Choose…</option>${doc.layers.filter((l) => l.id !== doc.active).map((l) => html`<option value=${l.id}>${l.name}</option>`)}</select></label>`}
    </div>`;
}

function RibbonFields({ o, patchSel }) {
    const preset = RIBBONS[o.style] ?? RIBBONS.strip;
    const off = new Set(o.off ?? []), extra = new Set(o.extra ?? []);
    const floor = o.floor === undefined ? preset.floor : o.floor;
    const toggle = (part, on) => preset.parts.includes(part)
        ? patchSel({ off: on ? [...off].filter((x) => x !== part) : [...off, part] })
        : patchSel({ extra: on ? [...extra, part] : [...extra].filter((x) => x !== part) });
    return html`<div class="field-grid">
        <label class="field"><span>Kind</span><select value=${o.style} onChange=${(e) => patchSel({ style: e.target.value, off: [], extra: [], floor: undefined })}>${Object.entries(RIBBONS).map(([k, r]) => html`<option value=${k}>${r.name}</option>`)}</select></label>
        <label class="field"><span>Base texture</span><select value=${floor ?? ""} onChange=${(e) => patchSel({ floor: e.target.value || null })}><option value="">None</option>${texOptions()}</select></label>
        <label class="field"><span>Boxes across</span><input type="number" min="1" max="12" value=${o.cols ?? preset.cols} onChange=${(e) => patchSel({ cols: Math.max(1, +e.target.value) })} /></label>
        <label class="field"><span>Box size (px)</span><input type="number" min="8" max="256" value=${o.box ?? CELL} onChange=${(e) => patchSel({ box: Math.max(8, +e.target.value) })} /></label>
        <label class="row"><input type="checkbox" checked=${o.grid ?? true} onChange=${(e) => patchSel({ grid: e.target.checked })} /> Own grid</label>
    </div>
    <div class="field"><span>Parts</span><div class="part-list">${Object.entries(RIBBON_PARTS).map(([k, p]) => html`<label class="row"><input type="checkbox"
        checked=${preset.parts.includes(k) ? !off.has(k) : extra.has(k)} onChange=${(e) => toggle(k, e.target.checked)} /> ${p.name}</label>`)}</div></div>
    <p class="muted small-note">Double-click the strip to add a point, drag the round handles to bend it, double-click a handle to remove it.</p>`;
}

function RoomFields({ o, patchSel, canRotate, release }) {
    const B = o.box ?? CELL;
    const resize = (w, h) => patchSel((x) => {
        // keep the room's top-left corner (and its contents) in place when unrotated
        const cx = x.x + x.w / 2, cy = x.y + x.h / 2;
        return x.rot ? { w, h, x: cx - w / 2, y: cy - h / 2 } : { w, h };
    });
    const walls = Object.entries(PATH_STYLES).filter(([k]) => k.startsWith("wall") || ["fence", "hedge", "iron-railing"].includes(k));
    return html`<div class="field-grid">
        <label class="field"><span>Width (boxes)</span><input type="number" min="1" max="200" value=${Math.round(o.w / B)} onChange=${(e) => resize(Math.max(1, +e.target.value) * B, o.h)} /></label>
        <label class="field"><span>Height (boxes)</span><input type="number" min="1" max="200" value=${Math.round(o.h / B)} onChange=${(e) => resize(o.w, Math.max(1, +e.target.value) * B)} /></label>
        <label class="field"><span>Box size (px)</span><input type="number" min="8" max="256" value=${B} onChange=${(e) => patchSel({ box: Math.max(8, +e.target.value), cells: {} })} /></label>
        <label class="field"><span>Rotation</span><input type="number" step="10" value=${o.rot ?? 0} disabled=${!canRotate} title=${canRotate ? "" : "Turn snapping off to rotate rooms"} onChange=${(e) => patchSel({ rot: (((+e.target.value) % 360) + 360) % 360 })} /></label>
        <label class="field"><span>Floor</span><select value=${o.floor ?? ""} onChange=${(e) => patchSel({ floor: e.target.value || null })}><option value="">None (see through)</option>${texOptions()}</select></label>
        <label class="field"><span>Walls</span><select value=${o.wall ?? ""} onChange=${(e) => patchSel({ wall: e.target.value || null })}><option value="">None</option>${walls.map(([k, w]) => html`<option value=${k}>${w.name}</option>`)}</select></label>
        <label class="row"><input type="checkbox" checked=${o.grid ?? true} onChange=${(e) => patchSel({ grid: e.target.checked })} /> Own grid</label>
    </div>
    ${(o.shapes ?? []).length > 0 && html`<div class="row"><span class="muted">${(o.shapes ?? []).filter((x) => x.op === "add").length} added, ${(o.shapes ?? []).filter((x) => x.op === "sub").length} cut, ${(o.shapes ?? []).filter((x) => x.op === "open").length} openings</span>
        <button class="small" onClick=${() => patchSel((x) => ({ shapes: (x.shapes ?? []).slice(0, -1) }))}>Undo last shape</button>
        <${ConfirmButton} onConfirm=${() => patchSel({ shapes: [] })}>Clear shapes<//></div>`}
    <p class="muted small-note">${(o.children ?? []).length} things inside. They move and turn with the room. Paint its floor with the floor tools; changing the box size clears painted squares.${canRotate ? "" : " Turn snapping off to rotate it."}</p>
    <button class="small" onClick=${release} disabled=${!(o.children ?? []).length}>Release the things inside</button>`;
}

// ------------------------------------------------------------------ textures (built-in + derived)

const previewCache = new Map();
function texPreviewUrl(id, custom, n = 2) {
    const key = `${id}|${n}|${JSON.stringify(custom[id] ?? null)}|${JSON.stringify(custom[custom[id]?.from] ?? null)}`;
    if (!previewCache.has(key)) previewCache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(texturePreview(id, custom, n))}`);
    return previewCache.get(key);
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "texture";

function TexturePanel({ lib, setLib, custom, opt, useFloor }) {
    const [edit, setEdit] = useState(null); // {id|null, def}
    const [busy, setBusy] = useState(false);
    const [q, setQ] = useState("");
    const save = async (textures) => {
        setBusy(true);
        try { setLib(await api.send("POST", "/api/textures", { textures, baseMtime: lib.mtime })); return true; } catch (e) { toast(e.message); return false; } finally { setBusy(false); }
    };
    const startNew = (from) => setEdit({ id: null, def: { name: `${TEX[from]?.name ?? from} (aged)`, from, age: 0.5, density: 1, details: detailRows(from, custom) } });
    // older textures (extra detail as a list of names) open with every detail as its own row
    const startEdit = (id) => { const def = lib.textures[id]; setEdit({ id, def: Array.isArray(def.details) ? { ...def } : { ...def, details: detailRows(id, custom), density: 1, add: undefined } }); };
    const commitEdit = async () => {
        const { add, ...d } = edit.def;
        let id = edit.id;
        if (!id) { id = slug(d.name); for (let i = 2; custom[id] || TEX[id]; i++) id = `${slug(d.name)}-${i}`; }
        if (await save({ ...lib.textures, [id]: d })) { setEdit(null); useFloor(id); toast(`Saved ${d.name}`); }
    };
    const remove = (id) => { const { [id]: _, ...rest } = lib.textures; save(rest); };
    const modal = edit && html`<${TextureModal} edit=${edit} setEdit=${setEdit} custom=${custom} busy=${busy} onSave=${commitEdit} />`;
    const t = q.trim().toLowerCase();
    return html`<div class="texture-panel">
        ${modal}
        <input placeholder="Search textures…" value=${q} onInput=${(e) => setQ(e.target.value)} style="width:100%" aria-label="Search textures" />
        <p class="muted small-note">Each texture is a plain base plus ${24} generated variations; every painted square gets one. Make your own from any texture: aged, recoloured, with extra moss, cracks, rust…</p>
        ${TEX_GROUPS.map((g) => {
            const items = Object.entries(TEX).filter(([, f]) => f.group === g && (!t || f.name.toLowerCase().includes(t)));
            return items.length > 0 && html`<section class="stamp-group"><div class="group-head"><span>${g}</span></div>
                <div class="tex-grid">${items.map(([id, f]) => html`<div class=${`tex-item ${opt.floor === id ? "on" : ""}`}>
                    <button class="tex-swatch" title=${`Paint with ${f.name}`} onClick=${() => useFloor(id)}><img src=${texPreviewUrl(id, custom)} alt="" loading="lazy" /></button>
                    <span class="tex-name">${f.name}</span>
                    <span class="row">${g === "My textures"
                        ? html`<button class="small" onClick=${() => startEdit(id)} disabled=${!lib.textures[id]} title=${lib.textures[id] ? "" : "Only saved in this map"}>Edit</button><${ConfirmButton} confirmLabel="Sure?" onConfirm=${() => remove(id)}>×<//>`
                        : html`<button class="small" onClick=${() => startNew(id)}>New from this</button>`}</span>
                </div>`)}</div></section>`;
        })}
    </div>`;
}

/** The texture editor: a dialog in the middle of the screen, with a big live preview and every detail's own settings */
function TextureModal({ edit, setEdit, custom, busy, onSave }) {
    const d = edit.def;
    const [squares, setSquares] = useState(5);
    const set = (patch) => setEdit({ ...edit, def: { ...d, ...patch } });
    const rows = d.details ?? [];
    const setRow = (i, patch) => set({ details: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
    const base = resolveTexture(d.from, custom);
    const preview = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(texturePreview("__preview", { ...custom, __preview: d }, squares))}`, [JSON.stringify(d), squares]);
    const [addKind, setAddKind] = useState("moss");
    useEffect(() => { const k = (e) => { if (e.key === "Escape") setEdit(null); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
    const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;
    const slider = (label, value, show, min, max, step, on) => html`<label class="tex-slider"><span>${label}</span><input type="range" min=${min} max=${max} step=${step} value=${value} onInput=${(e) => on(+e.target.value)} /><output>${show}</output></label>`;
    return html`<div class="modal-back tex-modal-back" onClick=${(e) => e.target === e.currentTarget && setEdit(null)}>
        <div class="modal tex-modal" role="dialog" aria-label=${edit.id ? `Edit ${d.name}` : "New texture"} onKeyDown=${(e) => e.stopPropagation()}>
            <div class="spread"><h2 style="margin:0">${edit.id ? `Edit ${d.name}` : "New texture"}</h2><button onClick=${() => setEdit(null)} aria-label="Close">×</button></div>
            <div class="tex-modal-body">
                <div class="tex-modal-preview">
                    <img src=${preview} alt="Preview of the texture" />
                    <div class="seg" role="group" aria-label="Preview size">${[[3, "Close"], [5, "Medium"], [8, "Wide"]].map(([n, l]) => html`<button class=${squares === n ? "on" : ""} onClick=${() => setSquares(n)}>${l}</button>`)}</div>
                    <p class="muted small-note">${squares} × ${squares} squares, each with one of the texture's 24 variations.</p>
                </div>
                <div class="tex-modal-settings">
                    <section>
                        <h3>Texture</h3>
                        <div class="field-grid">
                            <label class="field"><span>Name</span><input value=${d.name} onInput=${(e) => set({ name: e.target.value })} /></label>
                            <label class="field"><span>Based on</span><select value=${d.from} onChange=${(e) => set({ from: e.target.value })}>${texOptions()}</select></label>
                        </div>
                        <button class="small" onClick=${() => set({ details: detailRows(d.from, custom) })}>Use the details of ${TEX[d.from]?.name ?? d.from}</button>
                    </section>
                    <section>
                        <h3>Look</h3>
                        ${slider("Age / wear", d.age ?? 0, pct(d.age), 0, 1, 0.05, (v) => set({ age: v }))}
                        ${slider("Colour variation", d.vary ?? base?.vary ?? 0.3, pct(d.vary ?? base?.vary ?? 0.3), 0, 1, 0.05, (v) => set({ vary: v }))}
                        ${slider("Lightness", d.light ?? 0, `${Math.round((d.light ?? 0) * 100)}`, -0.25, 0.25, 0.01, (v) => set({ light: v }))}
                        ${slider("Hue shift", d.hue ?? 0, `${d.hue ?? 0}°`, -60, 60, 1, (v) => set({ hue: v }))}
                        <label class="tex-slider"><span>Tint</span><span class="row" style="flex:1"><input type="color" value=${d.tint ?? "#8a6238"} onInput=${(e) => set({ tint: e.target.value, tintAmount: d.tintAmount || 0.3 })} />
                            <input type="range" min="0" max="1" step="0.05" value=${d.tintAmount ?? 0} style="flex:1" onInput=${(e) => set({ tintAmount: +e.target.value, tint: d.tint ?? "#8a6238" })} /></span><output>${pct(d.tintAmount)}</output></label>
                        ${slider("All detail ×", d.density ?? 1, `×${(d.density ?? 1).toFixed(1)}`, 0, 3, 0.1, (v) => set({ density: v }))}
                    </section>
                    <section>
                        <h3>Details</h3>
                        <div class="detail-table" role="table">
                            <div class="detail-row head" role="row"><span></span><span>Detail</span><span>Amount per square</span><span>Size</span><span>Variation</span><span>Colour</span><span></span></div>
                            ${rows.map((r, i) => { const k = DETAILS[r.kind]; const max = k?.max ?? 10; return html`<div class=${`detail-row ${r.on === false ? "off" : ""}`} role="row">
                                <input type="checkbox" checked=${r.on !== false} onChange=${(e) => setRow(i, { on: e.target.checked })} aria-label=${`Show ${k?.name}`} />
                                <span>${k?.name ?? r.kind}</span>
                                <span class="row"><input type="range" min="0" max=${max} step=${max > 10 ? 1 : 0.05} value=${r.n} onInput=${(e) => setRow(i, { n: +e.target.value })} aria-label="Amount" /><output>${r.n < 1 ? `${Math.round(r.n * 100)}%` : r.n}</output></span>
                                <span class="row"><input type="range" min="0.3" max="3" step="0.05" value=${r.size ?? 1} onInput=${(e) => setRow(i, { size: +e.target.value })} aria-label="Size" /><output>×${(r.size ?? 1).toFixed(1)}</output></span>
                                <span class="row"><input type="range" min="0" max="1" step="0.05" value=${r.vary ?? 0.5} onInput=${(e) => setRow(i, { vary: +e.target.value })} aria-label="Colour variation" /><output>${pct(r.vary ?? 0.5)}</output></span>
                                ${k?.fixedColour ? html`<span class="muted small-note">mixed</span>` : html`<input type="color" value=${r.color} onInput=${(e) => setRow(i, { color: e.target.value })} aria-label="Colour" />`}
                                <button class="small" title="Remove" aria-label=${`Remove ${k?.name}`} onClick=${() => set({ details: rows.filter((_, j) => j !== i) })}>×</button>
                            </div>`; })}
                        </div>
                        <p class="muted small-note">Amounts under 1 are a chance per square (30% = roughly every third square).</p>
                        <div class="row"><select value=${addKind} onChange=${(e) => setAddKind(e.target.value)} aria-label="Detail to add">${Object.entries(DETAILS).map(([k, x]) => html`<option value=${k}>${x.name}</option>`)}</select>
                            <button onClick=${() => set({ details: [...rows, { kind: addKind, n: (DETAILS[addKind]?.max ?? 10) > 10 ? 10 : 1, color: DETAIL_COLORS[addKind] ?? "#4b463f", size: 1, vary: 0.5, on: true }] })}>+ Add detail</button></div>
                    </section>
                </div>
            </div>
            <div class="spread tex-modal-foot">
                <span class="muted small-note">Saved in <code>90. Templater/Map Textures.md</code> for every map; each map keeps a copy of the textures it uses.</span>
                <span class="row"><button onClick=${() => setEdit(null)}>Cancel</button><button class="primary" disabled=${busy || !d.name.trim()} onClick=${onSave}>${busy ? "Saving…" : "Save texture"}</button></span>
            </div>
        </div>
    </div>`;
}

// ------------------------------------------------------------------ layers

function LayersPanel({ doc, commit, setSel }) {
    const set = (id, patch) => commit({ ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
    const move = (i, dir) => { const ls = [...doc.layers]; const j = i + dir; if (j < 0 || j >= ls.length) return; [ls[i], ls[j]] = [ls[j], ls[i]]; commit({ ...doc, layers: ls }); };
    const add = () => { const id = uid(); const i = doc.layers.findIndex((l) => l.id === doc.active); const ls = [...doc.layers]; ls.splice(i + 1, 0, { id, name: `Layer ${doc.layers.length + 1}`, objects: [], floor: {} }); commit({ ...doc, layers: ls, active: id }); setSel([]); };
    const remove = (id) => { const ls = doc.layers.filter((l) => l.id !== id); commit({ ...doc, layers: ls, active: doc.active === id ? ls.at(-1).id : doc.active }); setSel([]); };
    return html`<div class="layers-panel">
        <div class="seg" role="group" aria-label="Layer view">${[["current", "Only this layer"], ["faded", "Below faded"], ["solid", "Below solid"], ["all", "All solid"]].map(([k, l]) => html`<button class=${doc.view === k ? "on" : ""} aria-pressed=${doc.view === k} onClick=${() => commit({ ...doc, view: k })}>${l}</button>`)}</div>
        <p class="muted small-note">${doc.view === "all" ? "Every layer shows; you only edit the one you're on." : "Layers above the one you're on are hidden."} Saving keeps this view, so the map shows the same way in Obsidian.</p>
        ${[...doc.layers].map((l, i) => ({ l, i })).reverse().map(({ l, i }) => html`<div class=${`layer-row ${l.id === doc.active ? "on" : ""}`} key=${l.id}>
            <button class="layer-name" onClick=${() => { commit({ ...doc, active: l.id }); setSel([]); }} onDblClick=${() => { const n = prompt("Layer name", l.name); if (n?.trim()) set(l.id, { name: n.trim() }); }} title="Click to work on this layer, double-click to rename">
                ${l.name} <span class="muted">${l.objects.length + Object.keys(l.floor ?? {}).length ? `${l.objects.length} items${Object.keys(l.floor ?? {}).length ? `, ${Object.keys(l.floor).length} squares` : ""}` : "empty"}</span></button>
            <button class="small" title=${l.hidden ? "Show" : "Hide"} aria-label=${l.hidden ? `Show ${l.name}` : `Hide ${l.name}`} onClick=${() => set(l.id, { hidden: !l.hidden })}>${l.hidden ? "◌" : "●"}</button>
            <button class="small" title=${l.locked ? "Unlock" : "Lock"} aria-label=${l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`} onClick=${() => set(l.id, { locked: !l.locked })}>${l.locked ? "🔒︎" : "🔓︎"}</button>
            <button class="small" title="Move up" aria-label=${`Move ${l.name} up`} onClick=${() => move(i, 1)} disabled=${i === doc.layers.length - 1}>↑</button>
            <button class="small" title="Move down" aria-label=${`Move ${l.name} down`} onClick=${() => move(i, -1)} disabled=${i === 0}>↓</button>
            ${doc.layers.length > 1 && html`<${ConfirmButton} confirmLabel="Confirm" onConfirm=${() => remove(l.id)} title="Delete layer">×<//>`}
        </div>`)}
        <button onClick=${add} style="margin-top:8px">+ Layer above the current one</button>
    </div>`;
}

// ------------------------------------------------------------------ pins

function PinsPanel({ data, placed, opt, setO, setTool, onOpen }) {
    if (!data.children.length) return html`<p class="muted">${data.location.title} has no sub-locations yet. Add them in the world builder outline, then pin them here.</p>`;
    return html`<div class="pins-panel">
        <p class="muted small-note">Pins are saved in this map. Click Place (or drag a name onto the map), then click where it goes.</p>
        ${data.children.map((c) => { const p = placed.get(c.name.toLowerCase()); return html`<div class=${`pin-row ${opt.pinLoc?.path === c.path ? "on" : ""}`} draggable="true" onDragStart=${(e) => e.dataTransfer.setData("application/x-map-pin", c.path)}>
            <span><b>${c.title}</b> <span class="muted">${c.scale}</span> ${p ? html`<span class="badge ok">${p.layer.name}</span>` : html`<span class="badge warn">not placed</span>`}</span>
            <span class="row"><button class="small" onClick=${() => { setO({ pinLoc: c }); setTool("pin"); }}>${p ? "Move" : "Place"}</button>
                <button class="small" onClick=${() => onOpen(c)}>${c.hasMap ? "Its map" : "Note"}</button></span>
        </div>`; })}
    </div>`;
}

// ------------------------------------------------------------------ map settings

function MapSettings({ doc, commit, file }) {
    const grid = doc.kind === "grid";
    const set = (patch) => commit({ ...doc, ...patch });
    const [cols, rows] = [doc.width / CELL, doc.height / CELL];
    return html`<div class="map-settings field-grid">
        ${grid ? html`
            <label class="field"><span>Default terrain</span><select value=${doc.terrain} onChange=${(e) => set({ terrain: e.target.value })}>${Object.entries(TERRAINS).map(([k, t]) => html`<option value=${k}>${t.name}</option>`)}</select></label>
            <p class="muted small-note">Every square no layer paints shows the default terrain.</p>
            <label class="field"><span>Columns</span><input type="number" min="2" max="300" value=${cols} onChange=${(e) => set({ width: Math.max(2, +e.target.value) * CELL })} /></label>
            <label class="field"><span>Rows</span><input type="number" min="2" max="300" value=${rows} onChange=${(e) => set({ height: Math.max(2, +e.target.value) * CELL })} /></label>
            <label class="field"><span>1 square =</span><span class="row"><input type="number" min="0.1" step="0.5" value=${doc.units.amount} style="width:70px" onChange=${(e) => set({ units: { ...doc.units, amount: +e.target.value } })} />
                <input value=${doc.units.unit} style="width:60px" onChange=${(e) => set({ units: { ...doc.units, unit: e.target.value } })} /></span></label>
            <label class="row"><input type="checkbox" checked=${doc.showGrid} onChange=${(e) => set({ showGrid: e.target.checked })} /> Show grid lines</label>
            <label class="row"><input type="checkbox" checked=${doc.snap} onChange=${(e) => set({ snap: e.target.checked })} /> Snap to grid (Alt overrides)</label>
            <label class="row"><input type="checkbox" checked=${doc.autoJoin !== false} onChange=${(e) => set({ autoJoin: e.target.checked })} /> Rooms join when dragged together</label>
            <p class="muted small-note">Rooms still snap edge to edge when this is off; join them with Ctrl+G.</p>`
        : html`
            <label class="field"><span>Background</span><select value=${doc.backdrop} onChange=${(e) => set({ backdrop: e.target.value })}>${Object.entries(BACKDROPS).map(([k, n]) => html`<option value=${k}>${n}</option>`)}</select></label>
            <label class="field"><span>Width (px)</span><input type="number" min="200" max="20000" step="100" value=${doc.width} onChange=${(e) => set({ width: +e.target.value })} /></label>
            <label class="field"><span>Height (px)</span><input type="number" min="200" max="20000" step="100" value=${doc.height} onChange=${(e) => set({ height: +e.target.value })} /></label>
            <label class="field"><span>${doc.units.per} px =</span><span class="row"><input type="number" min="0.01" step="any" value=${doc.units.amount} style="width:80px" onChange=${(e) => set({ units: { ...doc.units, amount: +e.target.value } })} />
                <input value=${doc.units.unit} style="width:60px" onChange=${(e) => set({ units: { ...doc.units, unit: e.target.value } })} /></span></label>
            <label class="row"><input type="checkbox" checked=${doc.showGrid} onChange=${(e) => set({ showGrid: e.target.checked })} /> Show a grid</label>`}
        <p class="muted small-note">Saved as <code>${file}</code>. Embed it in any note with <code>![[${file.split("/").pop()}]]</code>.</p>
    </div>`;
}
