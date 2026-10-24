// Paints map editor bitmaps (floor chunks, room tiles) off the page's main thread. The page sends the texture sprite
// sheets as ImageBitmaps once ({t: "sprite", k, sp}), then jobs ({t: "paint", id, kind, args, sp: {floorId: key}});
// each job answers {id, blob}, or {id, need: [keys]} when a sprite was dropped meanwhile.
import { drawFloorChunk, drawRoomTile, blobOf } from "./map-raster.js";

const sprites = new Map();

self.onmessage = async ({ data }) => {
    if (data.t === "sprite") { sprites.set(data.k, data.sp); return; }
    if (data.t === "drop") { const s = sprites.get(data.k); sprites.delete(data.k); for (const b of [s?.sheet, s?.fl, s?.f]) b?.close?.(); return; }
    if (data.t !== "paint") return;
    const need = Object.values(data.sp).filter((k) => !sprites.has(k));
    if (need.length) { self.postMessage({ id: data.id, need }); return; }
    const sp = Object.fromEntries(Object.entries(data.sp).map(([id, k]) => [id, sprites.get(k)]));
    try {
        const a = data.args;
        const cv = data.kind === "chunk" ? drawFloorChunk(a, sp) : drawRoomTile(a.o, a.custom, a.scale, a.tile, sp);
        self.postMessage({ id: data.id, blob: await blobOf(cv, data.kind === "chunk" && !!a.terrain) });
    } catch (e) {
        self.postMessage({ id: data.id, error: String(e?.stack ?? e) });
    }
};
