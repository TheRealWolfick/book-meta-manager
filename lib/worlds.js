// World builder: worlds, location hierarchies (Locations `parent` links), moves, and location maps
// (self-contained SVGs in the data store attachments, the editable document stored inside them).
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DS, linkTarget } from "./vault.js";
import { ATTACHMENTS } from "./datastore.js";
import { patchNote, atomicWrite, sanitizeName, createNote } from "./write.js";
import { renderMapSvg, parseMapSvg } from "../public/map-core.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
export const MAPS = `${ATTACHMENTS}/Maps`;
export const STAMPS = `${ATTACHMENTS}/Map Stamps`;
export const TEXTURES_NOTE = "90. Templater/Map Textures.md";
const LOC = `${DS}/Locations`;
const WORLDS = `${DS}/Worlds`;
const SCALES = `${DS}/Taxonomy/Location Scales`;
const STAMP_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
const fail = (status, message) => Object.assign(new Error(message), { status });

export class Worlds {
    constructor(vault, store) {
        this.vault = vault;
        this.store = store;
    }

    /** Location scales ranked by `class` (realm first) */
    scales() {
        return this.vault.inFolder(SCALES)
            .map((n) => ({ name: n.name, title: n.fm.title || n.name, rank: Number(n.fm.class) }))
            .filter((s) => Number.isFinite(s.rank)).sort((a, b) => a.rank - b.rank);
    }

    list() {
        const locs = this.vault.inFolder(LOC);
        const worlds = this.vault.inFolder(WORLDS).map((n) => ({
            path: n.path, name: n.name, title: n.fm.title || n.name, description: n.fm.description ?? "",
            count: locs.filter((l) => this.vault.resolve(l.fm.world) === n.path).length,
        }));
        const loose = locs.filter((l) => !this.vault.resolve(l.fm.world)).length;
        return { worlds, unassigned: loose };
    }

    /** All locations of a world (worldPath null: locations without a world) */
    locations(worldPath) {
        const ranks = new Map(this.scales().map((s) => [s.name.toLowerCase(), s.rank]));
        const all = this.vault.inFolder(LOC).filter((l) => (this.vault.resolve(l.fm.world) ?? null) === (worldPath ?? null));
        const inWorld = new Set(all.map((l) => l.path));
        return all.map((l) => {
            const parent = this.vault.resolve(l.fm.parent);
            const scale = l.fm.scale ? linkTarget(l.fm.scale) : "";
            const map = this.mapPath(l);
            return {
                path: l.path, name: l.name, title: l.fm.title || l.name, mtime: l.mtime,
                parent: parent && inWorld.has(parent) ? parent : null,
                parentOutside: parent && !inWorld.has(parent) ? parent : null,
                scale, rank: ranks.get(scale.toLowerCase()) ?? 99,
                controlledBy: [].concat(l.fm["controlled-by"] ?? []).filter(Boolean).map((v) => linkTarget(v)),
                population: l.fm.population ?? "", description: l.fm.description ?? "", status: l.fm.status ?? "",
                map: map && this.vault.files.has(map) ? map : null,
            };
        });
    }

    world(worldPath) {
        const w = worldPath ? this.vault.notes.get(worldPath) : null;
        if (worldPath && !w) throw fail(404, "World not found");
        return {
            path: w?.path ?? null, name: w?.name ?? "No world", title: w?.fm.title || w?.name || "Locations without a world",
            description: w?.fm.description ?? "", locations: this.locations(worldPath), scales: this.scales(),
        };
    }

    location(p) {
        const n = this.vault.notes.get(p);
        if (!n || n.folder !== LOC) throw fail(404, "Location not found");
        return n;
    }

    descendants(p) {
        const out = [];
        const walk = (q) => { for (const l of this.vault.inFolder(LOC)) if (this.vault.resolve(l.fm.parent) === q && !out.includes(l.path)) { out.push(l.path); walk(l.path); } };
        walk(p);
        return out;
    }

    async createLocation({ world, parent, name, scale }) {
        const fm = { scale: scale ? `[[${scale}]]` : "" };
        if (world) fm.world = `[[${this.vault.notes.get(world)?.name ?? world}]]`;
        if (parent) fm.parent = `[[${this.location(parent).name}]]`;
        return this.store.create("Locations", name, fm);
    }

    /** Move a location under a new parent (null: top level). A new world is set on it and everything below it. */
    async move({ path: p, parent, world, baseMtime }) {
        const n = this.location(p);
        if (parent) {
            this.location(parent);
            if (parent === p || this.descendants(p).includes(parent)) throw fail(400, "A location can't go inside itself or anything below it");
        }
        const set = { parent: parent ? `[[${this.vault.notes.get(parent).name}]]` : "" };
        const targetWorld = parent ? this.vault.notes.get(parent).fm.world : world !== undefined ? (world ? `[[${this.vault.notes.get(world)?.name}]]` : "") : n.fm.world;
        const worldChanged = (this.vault.resolve(targetWorld) ?? null) !== (this.vault.resolve(n.fm.world) ?? null);
        if (worldChanged) set.world = targetWorld ?? "";
        await patchNote(this.vault, p, { set, baseMtime });
        if (worldChanged) for (const d of this.descendants(p)) await patchNote(this.vault, d, { set: { world: targetWorld ?? "" } });
        return { path: p, moved: 1 + this.descendants(p).length, worldChanged };
    }

    // ------------------------------------------------------------------ maps

    /** Vault path of a location's map: its `map` link, else the default file name */
    mapPath(n) {
        const linked = n.fm.map ? this.vault.resolve(n.fm.map) : null;
        return linked ?? `${MAPS}/${n.name} (Map).svg`;
    }

    async readMap(p) {
        const n = this.location(p);
        const file = this.mapPath(n);
        let doc = null, mtime = null;
        try {
            const st = await fsp.stat(this.vault.abs(file));
            mtime = st.mtimeMs;
            doc = parseMapSvg(await fsp.readFile(this.vault.abs(file), "utf8"));
        } catch { /* no map yet */ }
        const children = this.vault.inFolder(LOC).filter((l) => this.vault.resolve(l.fm.parent) === p).map((l) => {
            const mp = this.mapPath(l);
            return { path: l.path, name: l.name, title: l.fm.title || l.name, scale: l.fm.scale ? linkTarget(l.fm.scale) : "", hasMap: this.vault.files.has(mp) };
        });
        const parent = this.vault.resolve(n.fm.parent);
        return {
            location: { path: n.path, name: n.name, title: n.fm.title || n.name, scale: n.fm.scale ? linkTarget(n.fm.scale) : "", world: this.vault.resolve(n.fm.world) },
            parent: parent ? { path: parent, name: this.vault.notes.get(parent)?.name, hasMap: this.vault.files.has(this.mapPath(this.vault.notes.get(parent))) } : null,
            file, doc, mtime, children, scales: this.scales(),
        };
    }

    /** Stamp image as a data URI for the exported SVG (built-in /stamps/… or vault /files/…) */
    async stampData(src) {
        let abs;
        if (src.startsWith("/stamps/")) {
            abs = path.resolve(PUBLIC, `.${decodeURIComponent(src)}`);
            if (!abs.startsWith(path.join(PUBLIC, "stamps") + path.sep)) throw fail(400, `Bad stamp ${src}`);
        } else if (src.startsWith("/files/")) abs = this.vault.abs(decodeURIComponent(src.slice(7)));
        else throw fail(400, `Bad stamp ${src}`);
        const ext = path.extname(abs).slice(1).toLowerCase();
        if (!STAMP_TYPES[ext]) throw fail(400, `Bad stamp type ${src}`);
        const buf = await fsp.readFile(abs).catch(() => null);
        if (!buf) return null;
        return `data:${STAMP_TYPES[ext]};base64,${buf.toString("base64")}`;
    }

    async saveMap(p, doc, baseMtime) {
        const n = this.location(p);
        if (!doc || !Array.isArray(doc.layers) || !(doc.width > 0) || !(doc.height > 0)) throw fail(400, "Not a map document");
        const file = this.mapPath(n);
        if (baseMtime != null) {
            const st = await fsp.stat(this.vault.abs(file)).catch(() => null);
            if (st && Math.abs(st.mtimeMs - Number(baseMtime)) > 1) throw fail(409, "The map changed since it was opened. Reload and try again.");
        }
        // every stamp image once, as a symbol
        const all = doc.layers.flatMap((l) => l.objects.flatMap((o) => (o.type === "room" ? [o, ...(o.children ?? [])] : [o])));
        const srcs = [...new Set(all.filter((o) => o.type === "stamp").map((o) => o.src))];
        const ids = new Map();
        let defs = "";
        for (const [i, src] of srcs.entries()) {
            const data = await this.stampData(src);
            if (!data) continue;
            ids.set(src, `s${i}`);
            defs += `<symbol id="s${i}" viewBox="0 0 100 100" preserveAspectRatio="none"><image href="${data}" width="100" height="100" preserveAspectRatio="none"/></symbol>`;
        }
        const names = new Map(this.vault.inFolder(LOC).map((l) => [l.path, l.fm.title || l.name]));
        const svg = renderMapSvg(doc, {
            use: true, defs,
            stampHref: (o) => `#${ids.get(o.src) ?? "missing"}`,
            pinLabel: (o) => names.get(this.vault.resolve(o.location)) ?? linkTarget(o.location),
        });
        await fsp.mkdir(path.dirname(this.vault.abs(file)), { recursive: true });
        await atomicWrite(this.vault, file, svg);
        const link = `[[${path.posix.basename(file)}]]`;
        if (this.vault.resolve(n.fm.map) !== file) await patchNote(this.vault, p, { set: { map: link } });
        const st = await fsp.stat(this.vault.abs(file));
        return { file, mtime: st.mtimeMs };
    }

    // ------------------------------------------------------------------ derived floor textures (shared by all maps)

    /** {textures: {id: {name, from, age, vary, tint, tintAmount, hue, light, density, add}}, mtime} from Map Textures.md */
    textures() {
        const n = this.vault.notes.get(TEXTURES_NOTE);
        const t = n?.fm.textures;
        return { textures: t && typeof t === "object" && !Array.isArray(t) ? t : {}, mtime: n?.mtime ?? null };
    }

    async saveTextures(textures, baseMtime) {
        if (!textures || typeof textures !== "object" || Array.isArray(textures)) throw fail(400, "textures must be an object");
        for (const [id, t] of Object.entries(textures)) {
            if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(id)) throw fail(400, `Bad texture id ${id}`);
            if (!t?.from) throw fail(400, `${id} needs a base texture (from)`);
        }
        if (this.vault.notes.has(TEXTURES_NOTE)) await patchNote(this.vault, TEXTURES_NOTE, { set: { textures }, baseMtime });
        else await createNote(this.vault, TEXTURES_NOTE, { type: "map-textures", textures },
            "Floor textures for the map builder, made from the built-in ones (age, colour variation, tint, extra detail). Edited in Books Meta Viewer.\n");
        return this.textures();
    }

    // ------------------------------------------------------------------ stamps you add (pasted or dropped images)

    vaultStamps() {
        return [...this.vault.files].filter((f) => f.startsWith(`${STAMPS}/`) && STAMP_TYPES[path.extname(f).slice(1).toLowerCase()])
            .sort().map((f) => ({ id: `vault/${f}`, name: path.posix.basename(f).replace(/\.[^.]+$/, ""), file: f, src: `/files/${f.split("/").map(encodeURIComponent).join("/")}`,
                set: path.posix.dirname(f).slice(STAMPS.length + 1) || "My stamps" }));
    }

    async addStamp(filename, buffer, set = "Pasted") {
        const ext = path.extname(filename).slice(1).toLowerCase();
        if (!STAMP_TYPES[ext]) throw fail(400, `Unsupported image type .${ext}`);
        if (buffer.length > 8 * 1024 * 1024) throw fail(413, "Stamp images are limited to 8 MB");
        const folder = `${STAMPS}/${sanitizeName(set) || "Pasted"}`;
        const base = sanitizeName(path.basename(filename, path.extname(filename))) || "stamp";
        let name = `${base}.${ext}`;
        for (let i = 2; this.vault.files.has(`${folder}/${name}`); i++) name = `${base} ${i}.${ext}`;
        const rel = `${folder}/${name}`;
        await fsp.mkdir(this.vault.abs(folder), { recursive: true });
        await fsp.writeFile(this.vault.abs(rel), buffer);
        this.vault.files.add(rel);
        this.vault.rebuildNames();
        return this.vaultStamps().find((s) => s.file === rel);
    }
}
