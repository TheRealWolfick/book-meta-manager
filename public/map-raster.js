// Fast bitmaps for the map editor, painted on a canvas from pre-drawn pieces instead of rendering big SVGs:
// each texture's 32 variations are drawn once per resolution into a sprite sheet, then floor chunks, room tiles and
// ribbon pieces copy the right variation into every square.
//
// Floor chunks and room tiles are painted in a worker (map-paint-worker.js, which imports this module's drawing
// functions), so painting and encoding never hold up the page. The page only draws the sprite sheets (SVG needs
// an <img>) and hands them over as bitmaps. Without workers or OffscreenCanvas everything is painted here instead.
import {
    CELL, TILE_PX, SHEET, spriteSheetSvg, textureLayerSvg, continuousPeriod, squarePicker, macroBlobs, MACRO_ALPHA, patchStrength,
    roomExtent, roomOutline, PATH_STYLES, ribbonPieces,
} from "./map-core.js";

const IN_PAGE = typeof document !== "undefined";
export const canPaint = () => IN_PAGE && typeof Image !== "undefined" && typeof URL?.createObjectURL === "function";

// ------------------------------------------------------------------ drawing (page and worker)
/** a canvas to paint on: OffscreenCanvas where there is one. In the page they are kept in memory, not on the GPU, so
 * turning one into an image doesn't copy it back from the GPU (which held up the page for up to 200 ms) */
function newCanvas(w, h) {
    const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    return [cv, cv.getContext("2d", IN_PAGE ? { willReadFrequently: true } : undefined)];
}
/** canvas -> Blob: JPEG for opaque bitmaps (about ten times quicker than WebP), WebP where it needs transparency */
export function blobOf(cv, opaque = false) {
    const type = opaque ? "image/jpeg" : "image/webp", quality = opaque ? 0.9 : 0.85;
    if (cv.convertToBlob) return cv.convertToBlob({ type, quality });
    return new Promise((resolve) => cv.toBlob(resolve, type, quality));
}

const pow2 = (v, lo, hi) => Math.min(hi, Math.max(lo, 2 ** Math.round(Math.log2(Math.max(1e-6, v)))));
/** sprite size (px per square) for squares of about `px` screen px */
export const spriteSize = (px) => pow2(px, 8, 256);

/** a canvas pattern of `img` laid in map units (img px per map px = sc), anchored at the map origin, turned and scaled */
function mapPattern(ctx, img, sc, { angle = 0, k = 1 } = {}) {
    const p = ctx.createPattern(img, "repeat");
    if (p?.setTransform) p.setTransform(new DOMMatrix().rotateSelf(angle).scaleSelf(k / sc));
    return p;
}
/** soft light and dark patches; k: patchStrength of the floor underneath */
function drawPatches(ctx, x, y, w, h, k) {
    for (const b of macroBlobs(x, y, w, h)) {
        if ((b.dark ? k.dark : k.light) <= 0) continue;
        ctx.save();
        ctx.translate(b.cx, b.cy); ctx.rotate((b.rot * Math.PI) / 180); ctx.scale(b.rx, b.ry);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        const c = b.dark ? `0,0,0` : `255,255,255`, a = b.dark ? MACRO_ALPHA.dark * k.dark : MACRO_ALPHA.light * k.light;
        g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
    }
}
/** squares' bases, then their details (which spill half a square over each edge). squares: [[c, r, floorId, pick]] */
function drawSquares(ctx, sp, squares, B) {
    const kk = B / CELL, layers = new Map(); // continuous floors: one pattern per texture, filled square by square
    for (const [c, r, f, q] of squares) {
        const s = sp[f], x = c * B, y = r * B;
        if (q.cont && s.fl) {
            if (!layers.has(f)) layers.set(f, mapPattern(ctx, s.fl, s.sc, { k: kk }));
            ctx.fillStyle = layers.get(f);
            ctx.fillRect(x, y, B, B);
            continue;
        }
        const ss = CELL * s.sc;
        ctx.drawImage(s.sheet, (q.k % SHEET.cols) * ss, Math.floor(q.k / SHEET.cols) * ss, ss, ss, x, y, B, B);
    }
    for (const [c, r, f, q] of squares) {
        const s = sp[f], ss = CELL * s.sc, o = SHEET.rows * ss;
        ctx.drawImage(s.sheet, (q.k % SHEET.cols) * 2 * ss, o + Math.floor(q.k / SHEET.cols) * 2 * ss, 2 * ss, 2 * ss, c * B - B / 2, r * B - B / 2, 2 * B, 2 * B);
    }
}

/** the cells of a floor chunk, and the textures they use */
function chunkCells({ x, y, S, terrain, entries }) {
    const cells = terrain ? [] : entries.map(([key, f]) => { const [c, r] = key.split(",").map(Number); return [c, r, f]; });
    if (terrain) for (let r = Math.floor(y / CELL) - 1; r <= Math.floor((y + S) / CELL); r++) for (let c = Math.floor(x / CELL) - 1; c <= Math.floor((x + S) / CELL); c++) cells.push([c, r, terrain]);
    return cells;
}
const chunkIds = (spec) => (spec.terrain ? [spec.terrain] : [...new Set(spec.entries.map((e) => e[1]))]);
/**
 * A floor chunk (map area x, y, S × S) as a px × px canvas: the terrain everywhere, or a layer's painted squares
 * (entries [["c,r", floorId]]). sp: sprites by texture id.
 */
export function drawFloorChunk({ x, y, S, px, terrain, entries, custom }, sp) {
    const lod = px / S, cellPx = CELL * lod;
    const cells = chunkCells({ x, y, S, terrain, entries });
    const ids = [...new Set(cells.map((q) => q[2]))];
    const [cv, ctx] = newCanvas(px, px);
    ctx.setTransform(lod, 0, 0, lod, -x * lod, -y * lod);
    ctx.imageSmoothingQuality = "high";
    const clip = () => { const p = new Path2D(); for (const [c, r] of cells) p.rect(c * CELL, r * CELL, CELL, CELL); ctx.clip(p); };
    // patches as strong as each floor allows (light ones fade on dark floors), each kept to its own squares
    const patches = () => {
        if (terrain) return drawPatches(ctx, x, y, S, S, patchStrength(terrain, custom));
        for (const id of ids) {
            ctx.save();
            const p = new Path2D(); for (const [c, r, f] of cells) if (f === id) p.rect(c * CELL, r * CELL, CELL, CELL);
            ctx.clip(p);
            drawPatches(ctx, x, y, S, S, patchStrength(id, custom));
            ctx.restore();
        }
    };
    if (cellPx >= 12) {
        // every square on its own, its variation picked from its position
        const pick = squarePicker(custom);
        if (!terrain) { ctx.save(); clip(); }
        drawSquares(ctx, sp, cells.filter((q) => sp[q[2]]).map(([c, r, f]) => [c, r, f, pick(c, r, f)]), CELL);
        if (!terrain) ctx.restore();
        if (lod >= 1 / 8) patches();
    } else {
        // far out: the texture's tile, plus the patches
        for (const id of ids) {
            if (!sp[id]?.f) continue;
            ctx.fillStyle = mapPattern(ctx, sp[id].f, sp[id].fsc);
            if (terrain) ctx.fillRect(x, y, S, S);
            else { const p = new Path2D(); for (const [c, r, f] of cells) if (f === id) p.rect(c * CELL, r * CELL, CELL, CELL); ctx.fill(p); }
        }
        if (lod >= 1 / 8) patches();
    }
    return cv;
}

// rooms
const dashOf = (d) => (d ? String(d).split(/[ ,]+/).map(Number).filter((n) => !Number.isNaN(n)) : []);
function roomBox(o) {
    const e = roomExtent(o);
    const wall = PATH_STYLES[o.wall];
    const ww = wall ? Math.max(...wall.layers.map((l) => l.w)) : 0;
    const pad = ww / 2 + 2;
    return { e, wall, ww, box: { x: Math.floor(e.x - pad), y: Math.floor(e.y - pad), w: Math.ceil(e.w + pad * 2) + 1, h: Math.ceil(e.h + pad * 2) + 1 } };
}
const roomIds = (o) => [...new Set([o.floor, ...Object.values(o.cells ?? {})].filter(Boolean))];
/** The tiles (room coordinates, at most 1024 px each at `scale`) a room's base is drawn in */
export function roomTiles(o, scale) {
    const { box } = roomBox(o);
    const T = 1024 / scale, out = [];
    for (let ty = box.y; ty < box.y + box.h; ty += T) for (let tx = box.x; tx < box.x + box.w; tx += T) out.push({ x: tx, y: ty, w: Math.min(T, box.x + box.w - tx), h: Math.min(T, box.y + box.h - ty) });
    return out;
}
/** One tile {x, y, w, h} of a room's base (floor, painted squares, grid, walls with openings) at `scale` */
export function drawRoomTile(o, custom, scale, { x: tx, y: ty, w, h }, sp) {
    const { e, wall, ww, box } = roomBox(o);
    const shaped = (o.shapes ?? []).some((sh) => sh.op !== "open");
    const outline = new Path2D(shaped ? roomOutline(o).d : `M0 0H${o.w}V${o.h}H0Z`);
    const opens = (o.shapes ?? []).filter((sh) => sh.op === "open");
    const B = o.box ?? CELL;
    const pick = squarePicker(custom);
    const [cv, ctx] = newCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    ctx.setTransform(scale, 0, 0, scale, -tx * scale, -ty * scale);
    ctx.imageSmoothingQuality = "high";
    // floor inside the room's area: base everywhere, painted squares over it, then details, then the grid
    ctx.save();
    ctx.clip(outline);
    const c0 = Math.floor(Math.max(e.x, tx - B) / B), c1 = Math.floor(Math.min(e.x + e.w, tx + w + B) / B);
    const r0 = Math.floor(Math.max(e.y, ty - B) / B), r1 = Math.floor(Math.min(e.y + e.h, ty + h + B) / B);
    const squares = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const f = o.cells?.[`${c},${r}`] ?? o.floor; if (f && sp[f]) squares.push([c, r, f, pick(c, r, f)]); }
    drawSquares(ctx, sp, squares, B);
    if (o.grid ?? true) {
        ctx.beginPath();
        for (let x = Math.floor(e.x / B) * B + B; x < e.x + e.w - 0.5; x += B) { ctx.moveTo(x, e.y); ctx.lineTo(x, e.y + e.h); }
        for (let y = Math.floor(e.y / B) * B + B; y < e.y + e.h - 0.5; y += B) { ctx.moveTo(e.x, y); ctx.lineTo(e.x + e.w, y); }
        ctx.strokeStyle = "rgba(0,0,0,.28)"; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
    // walls along the outline, with gaps where openings are
    if (wall) {
        ctx.save();
        if (opens.length) {
            const p = new Path2D();
            p.rect(box.x - ww, box.y - ww, box.w + ww * 2, box.h + ww * 2);
            for (const sh of opens) {
                const a = ((sh.rot ?? 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
                const pts = [[-sh.len / 2, -sh.thick / 2], [sh.len / 2, -sh.thick / 2], [sh.len / 2, sh.thick / 2], [-sh.len / 2, sh.thick / 2]].map(([u, v]) => [sh.cx + u * cos - v * sin, sh.cy + u * sin + v * cos]);
                p.moveTo(...pts[0]); for (const q of pts.slice(1)) p.lineTo(...q); p.closePath();
            }
            ctx.clip(p, "evenodd");
        }
        ctx.lineJoin = "miter"; ctx.lineCap = "butt";
        for (const l of wall.layers) { ctx.lineWidth = l.w; ctx.strokeStyle = l.c; ctx.setLineDash(dashOf(l.dash)); ctx.stroke(outline); }
        ctx.restore();
    }
    return cv;
}

// ------------------------------------------------------------------ page only
/** an SVG string drawn into a canvas of w × h px, in horizontal bands with a pause between them, so drawing a big
 * texture never holds up the page for long */
const nextFrame = () => new Promise((r) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));
function loadSvg(svg) {
    return new Promise((resolve) => {
        const src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(src); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(src); resolve(null); };
        img.src = src;
    });
}
async function svgToCanvas(svg, w, h, bands = 1) {
    const [cv, ctx] = newCanvas(w, h);
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    if (bands <= 1 || !vb) {
        const img = await loadSvg(svg);
        try { if (img) ctx.drawImage(img, 0, 0, w, h); } catch { /* broken image */ }
        return cv;
    }
    const VW = Number(vb[1]), VH = Number(vb[2]), bh = VH / bands;
    for (let i = 0; i < bands; i++) {
        const y0 = i * bh, py0 = Math.floor((y0 / VH) * h), py1 = Math.ceil(((y0 + bh) / VH) * h);
        const part = svg.replace(/viewBox="[^"]*" width="[^"]*" height="[^"]*"/, `viewBox="0 ${(py0 / h) * VH} ${VW} ${((py1 - py0) / h) * VH}" width="${w}" height="${py1 - py0}"`);
        const img = await loadSvg(part);
        try { if (img) ctx.drawImage(img, 0, py0, w, py1 - py0); } catch { /* broken image */ }
        if (i < bands - 1) await nextFrame();
    }
    return cv;
}
/** a canvas scaled down by f (in halving steps, which keeps fine detail from aliasing) */
function shrink(src, f) {
    let cur = src, cw = src.width, ch = src.height;
    const tw = Math.max(1, Math.round(src.width * f)), th = Math.max(1, Math.round(src.height * f));
    do {
        cw = Math.max(tw, Math.floor(cw / 2)); ch = Math.max(th, Math.floor(ch / 2));
        const [cv, ctx] = newCanvas(cw, ch);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(cur, 0, 0, cw, ch);
        cur = cv;
    } while (cw > tw || ch > th);
    return cur;
}

const decoded = new Map(); // url -> decoded Image, kept so the map's <image> elements show it without decoding again
/** Blob -> object URL, decoded off the main thread before it is shown (else the first paint decodes it and stalls) */
async function urlOf(blob) {
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try { await img.decode(); decoded.set(url, img); } catch { /* shown undecoded */ }
    return url;
}
/** canvas -> object URL */
export const toUrl = async (cv, opaque = false) => (cv ? urlOf(await blobOf(cv, opaque)) : null);
/** drop an object URL made here */
export const releaseUrl = (url) => { decoded.delete(url); URL.revokeObjectURL(url); };

// ---- texture sprites: {sheet, sc (sheet px per map px), fl (continuous layer) + flP, f (repeating tile)}
// The SVGs are drawn once per texture at 128 px a square (and at 256 when zoomed far in); smaller sizes are scaled
// down from that, which is cheap.
const sprites = new Map();
const MASTER = 128;
/** sprites of texture `id` for squares of `s` px; `key` identifies the texture's definition */
export function textureSprites(id, custom, s, key) {
    const k = `${key}|${s}`;
    if (sprites.has(k)) return sprites.get(k);
    const sc = s / CELL;
    const P = continuousPeriod(id, custom);
    const job = s < MASTER
        ? textureSprites(id, custom, MASTER, key).then((m) => ({
            sheet: m.sheet && shrink(m.sheet, s / MASTER), sc, fl: m.fl && shrink(m.fl, s / MASTER), flP: P, f: m.f, fsc: m.fsc,
        }))
        : (async () => {
            const W = SHEET.cols * 128, H = SHEET.rows * 192;
            const sheet = await svgToCanvas(spriteSheetSvg(id, custom, sc), Math.ceil(W * sc), Math.ceil(H * sc), Math.ceil((W * H * sc * sc) / 6e5));
            const fl = P ? await svgToCanvas(textureLayerSvg(id, custom, "fl", sc), Math.ceil(P * sc), Math.ceil(P * sc), Math.ceil((P * P * sc * sc) / 6e5)) : null;
            // the repeating tile is only needed far out (and for ribbon floors); one size is enough
            const f = s === MASTER ? await svgToCanvas(textureLayerSvg(id, custom, "f", 1), TILE_PX, TILE_PX, 4) : (await textureSprites(id, custom, MASTER, key)).f;
            return { sheet, sc, fl, flP: P, f, fsc: 1 };
        })();
    sprites.set(k, job);
    if (sprites.size > 60) for (const key0 of sprites.keys()) { if (sprites.size <= 48) break; if (!key0.endsWith(`|${MASTER}`)) sprites.delete(key0); }
    return job;
}
const spritesFor = async (ids, custom, s, texKey) => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await textureSprites(id, custom, s, texKey(id))])));

// ---- the worker
let worker = null, workerFailed = false, nextId = 1;
const pending = new Map(); // job id -> {resolve, msg}
const sent = new Map(); // sprite key -> Promise (sent to the worker)
function getWorker() {
    if (worker || workerFailed) return worker;
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") { workerFailed = true; return null; }
    try {
        worker = new Worker(new URL("./map-paint-worker.js", import.meta.url), { type: "module" });
    } catch { workerFailed = true; return null; }
    worker.onmessage = async ({ data }) => {
        const p = pending.get(data.id);
        if (!p) return;
        if (data.need) { // the worker dropped some sprites: send them again and retry
            for (const k of data.need) sent.delete(k);
            await sendSprites(p.sprites);
            worker.postMessage(p.msg);
            return;
        }
        pending.delete(data.id);
        if (data.error) console.warn("map bitmap:", data.error);
        p.resolve(data.blob ? await urlOf(data.blob) : null);
    };
    worker.onerror = (e) => { console.warn("map painter worker failed, painting in the page:", e.message); workerFailed = true; worker = null; for (const p of pending.values()) p.resolve(p.fallback()); pending.clear(); };
    return worker;
}
const SENT_MAX = 48;
/** make sure the worker has these sprites: [[key, Promise<sprite>]] */
async function sendSprites(list) {
    await Promise.all(list.map(([k, job]) => {
        if (!sent.has(k)) {
            sent.set(k, job.then(async (s) => {
                const [sheet, fl, f] = await Promise.all([s.sheet, s.fl, s.f].map((c) => (c ? createImageBitmap(c) : null)));
                worker?.postMessage({ t: "sprite", k, sp: { sheet, fl, f, sc: s.sc, flP: s.flP, fsc: s.fsc } }, [sheet, fl, f].filter(Boolean));
            }));
            if (sent.size > SENT_MAX) for (const k0 of sent.keys()) { if (sent.size <= SENT_MAX * 0.75) break; sent.delete(k0); worker?.postMessage({ t: "drop", k: k0 }); }
        }
        return sent.get(k);
    }));
}
/** paint in the worker: kind "chunk" | "room", args for it, the textures it needs; resolves to an object URL */
async function paintInWorker(kind, args, ids, custom, s, texKey, fallback) {
    const w = getWorker();
    if (!w) return fallback();
    const list = ids.map((id) => [`${texKey(id)}|${s}`, textureSprites(id, custom, s, texKey(id))]);
    const sp = Object.fromEntries(ids.map((id, i) => [id, list[i][0]]));
    await sendSprites(list);
    if (!worker) return fallback();
    const id = nextId++;
    const msg = { t: "paint", id, kind, args, sp };
    return new Promise((resolve) => { pending.set(id, { resolve, msg, sprites: list, fallback }); worker.postMessage(msg); });
}

/** a floor chunk {x, y, S, px, terrain | entries, custom} as an object URL */
export function paintFloorChunk({ texKey, ...spec }) {
    const s = spriteSize(CELL * (spec.px / spec.S));
    const ids = chunkIds(spec);
    const here = async () => toUrl(drawFloorChunk(spec, await spritesFor(ids, spec.custom, s, texKey)), !!spec.terrain);
    return paintInWorker("chunk", spec, ids, spec.custom, s, texKey, here);
}
/** one tile of a room's base as an object URL */
export function paintRoomTile(o, custom, scale, texKey, tile) {
    const s = spriteSize((o.box ?? CELL) * scale);
    const ids = roomIds(o);
    const here = async () => toUrl(drawRoomTile(o, custom, scale, tile, await spritesFor(ids, custom, s, texKey)));
    return paintInWorker("room", { o, custom, scale, tile }, ids, custom, s, texKey, here);
}

// ---- ribbons (in the page: their rails, curbs and grid are SVG): floor painted from the texture tile, then the
// light SVG of the parts on top
const ribbonCache = new WeakMap(); // ribbon object -> Map(scale -> pieces)
function piecesOf(o, custom, scale) {
    let m = ribbonCache.get(o);
    if (!m) ribbonCache.set(o, (m = new Map()));
    if (!m.has(scale)) m.set(scale, ribbonPieces(o, custom, scale, { noFloor: true }));
    return m.get(scale);
}
/** the boxes {x, y, w, h} (map coordinates) of a ribbon's pieces at `scale` */
export const ribbonPieceBoxes = (o, custom, scale) => piecesOf(o, custom, scale).map(({ x, y, w, h }) => ({ x, y, w, h }));
/** piece i of a ribbon as a canvas */
export async function paintRibbonPiece(o, custom, scale, texKey, i) {
    const pieces = piecesOf(o, custom, scale), pc = pieces[i];
    if (!pc) return null;
    const floor = pieces[0].floor, kk = pieces[0].k;
    const sp = floor ? await textureSprites(floor, custom, spriteSize(CELL * kk * scale), texKey(floor)) : null;
    const W = Math.ceil(pc.w * scale), H = Math.ceil(pc.h * scale);
    const [cv, ctx] = newCanvas(W, H);
    if (sp?.f) {
        ctx.setTransform(scale, 0, 0, scale, -pc.x * scale, -pc.y * scale);
        for (const sl of pc.slices) {
            const p = new Path2D();
            p.moveTo(...sl.pts[0]); for (const q of sl.pts.slice(1)) p.lineTo(...q); p.closePath();
            ctx.fillStyle = mapPattern(ctx, sp.f, sp.fsc, { angle: sl.angle, k: kk });
            ctx.fill(p);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    const parts = await svgToCanvas(pc.svg, W, H);
    if (parts) ctx.drawImage(parts, 0, 0);
    return cv;
}
