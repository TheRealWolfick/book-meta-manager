// World builder: worlds, location hierarchies (Locations `parent` links), moves, and location maps
// (self-contained SVGs in the data store attachments, the editable document stored inside them).
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DS, linkTarget } from "./vault.js";
import { ATTACHMENTS } from "./datastore.js";
import { patchNote, atomicWrite, sanitizeName, createNote, trashNote } from "./write.js";
import { renderMapSvg, renderBlueprintSvg, parseMapSvg, allObjects } from "../public/map-core.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
export const MAPS = `${ATTACHMENTS}/Maps`;
export const STAMPS = `${ATTACHMENTS}/Map Stamps`;
export const BLUEPRINTS = `${ATTACHMENTS}/Map Blueprints`;
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
        if (parent) {
            const p = this.location(parent);
            // a sub-location is always a smaller scale than what holds it (the hierarchy runs realm → … → room)
            const ranks = new Map(this.scales().map((s) => [s.name.toLowerCase(), s]));
            const above = ranks.get((p.fm.scale ? linkTarget(p.fm.scale) : "").toLowerCase()), own = ranks.get(String(scale ?? "").toLowerCase());
            if (above && own && own.rank <= above.rank) throw fail(400, `A ${own.title} can't go inside ${p.fm.title || p.name}, which is a ${above.title}: a sub-location has to be a smaller scale`);
            if (above && !own && scale) throw fail(400, `Unknown scale ${scale}`);
            fm.parent = `[[${p.name}]]`;
        }
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
        // everything below the location, in outline order (siblings by scale, then title): depth 1 = its sub-locations,
        // 2 = theirs (rooms of a building's floors)… `via` names the locations in between; the editor shows as many
        // levels as the map's pin depth asks for
        const ranks = new Map(this.scales().map((s) => [s.name.toLowerCase(), s.rank]));
        const locs = this.vault.inFolder(LOC);
        const seen = new Set([p]);
        const below = (q, depth, via) => locs.filter((l) => this.vault.resolve(l.fm.parent) === q && !seen.has(l.path))
            .map((l) => ({ l, scale: l.fm.scale ? linkTarget(l.fm.scale) : "", title: l.fm.title || l.name }))
            .sort((a, b) => (ranks.get(a.scale.toLowerCase()) ?? 99) - (ranks.get(b.scale.toLowerCase()) ?? 99) || a.title.localeCompare(b.title))
            .flatMap(({ l, scale, title }) => {
                seen.add(l.path);
                const entry = { path: l.path, name: l.name, title, scale, hasMap: this.vault.files.has(this.mapPath(l)), depth, parent: q, via };
                return [entry, ...below(l.path, depth + 1, [...via, title])];
            });
        const children = below(p, 1, []);
        const parent = this.vault.resolve(n.fm.parent);
        return {
            location: { path: n.path, name: n.name, title: n.fm.title || n.name, scale: n.fm.scale ? linkTarget(n.fm.scale) : "", world: this.vault.resolve(n.fm.world) },
            parent: parent ? { path: parent, name: this.vault.notes.get(parent)?.name, hasMap: this.vault.files.has(this.mapPath(this.vault.notes.get(parent))) } : null,
            file, doc, mtime, children, scales: this.scales(),
        };
    }

    /** Stamp image as a data URI for the exported SVG (built-in /stamps/… or vault /files/…) */
    async stampData(src) {
        // stamps drawn for their size (windows) carry their SVG with them
        if (src.startsWith("data:image/svg+xml")) return src;
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

    /** What the SVG of a map or blueprint needs: every stamp image once, as a symbol, and pin labels */
    async svgContext(objects) {
        const srcs = [...new Set(objects.filter((o) => o.type === "stamp").map((o) => o.src))];
        const ids = new Map();
        let defs = "";
        for (const [i, src] of srcs.entries()) {
            const data = await this.stampData(src);
            if (!data) continue;
            ids.set(src, `s${i}`);
            defs += `<symbol id="s${i}" viewBox="0 0 100 100" preserveAspectRatio="none"><image href="${data}" width="100" height="100" preserveAspectRatio="none"/></symbol>`;
        }
        const names = new Map(this.vault.inFolder(LOC).map((l) => [l.path, l.fm.title || l.name]));
        return {
            use: true, defs,
            stampHref: (o) => `#${ids.get(o.src) ?? "missing"}`,
            pinLabel: (o) => names.get(this.vault.resolve(o.location)) ?? linkTarget(o.location),
        };
    }

    async saveMap(p, doc, baseMtime) {
        const n = this.location(p);
        if (!doc || !Array.isArray(doc.layers) || !(doc.width > 0) || !(doc.height > 0)) throw fail(400, "Not a map document");
        const file = this.mapPath(n);
        if (baseMtime != null) {
            const st = await fsp.stat(this.vault.abs(file)).catch(() => null);
            if (st && Math.abs(st.mtimeMs - Number(baseMtime)) > 1) throw fail(409, "The map changed since it was opened. Reload and try again.");
        }
        const svg = renderMapSvg(doc, await this.svgContext(doc.layers.flatMap((l) => allObjects(l.objects))));
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
            "Floor textures for the map builder, made from the built-in ones (age, colour variation, tint, extra detail). Edited in World Builder.\n");
        return this.textures();
    }

    // ------------------------------------------------------------------ blueprints (saved groups of map objects)
    // One SVG per blueprint, `Map Blueprints/<Category>/<Name>.svg`: a preview, with the objects in its <metadata>.

    async mapBlueprints() {
        const files = [...this.vault.files].filter((f) => f.startsWith(`${BLUEPRINTS}/`) && f.toLowerCase().endsWith(".svg")).sort();
        return Promise.all(files.map(async (f) => {
            const st = await fsp.stat(this.vault.abs(f)).catch(() => null);
            return { file: f, name: path.posix.basename(f).replace(/\.svg$/i, ""), category: path.posix.dirname(f).slice(BLUEPRINTS.length + 1) || "General",
                src: `/files/${f.split("/").map(encodeURIComponent).join("/")}?v=${Math.round(st?.mtimeMs ?? 0)}` };
        }));
    }

    /** {blueprints, categories}: categories are the folders, empty ones included */
    async blueprintLibrary() {
        const dirs = await fsp.readdir(this.vault.abs(BLUEPRINTS), { withFileTypes: true }).catch(() => []);
        const blueprints = await this.mapBlueprints();
        const categories = [...new Set([...dirs.filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name), ...blueprints.map((b) => b.category)])]
            .sort((a, b) => a.localeCompare(b));
        return { blueprints, categories };
    }

    /** a blueprint's file from the client, checked */
    blueprintFile(file) {
        if (typeof file !== "string" || !file.startsWith(`${BLUEPRINTS}/`) || file.includes("..") || !this.vault.files.has(file)) throw fail(404, `No blueprint ${file}`);
        return file;
    }

    /** Rename a blueprint and/or move it to another category; the same name already there (ignoring case) is replaced */
    async renameBlueprint(file, name, category) {
        this.blueprintFile(file);
        const base = sanitizeName(name), cat = sanitizeName(category) || "General";
        if (!base) throw fail(400, "The blueprint needs a name");
        const want = `${BLUEPRINTS}/${cat}/${base}.svg`;
        const clash = [...this.vault.files].find((f) => f.toLowerCase() === want.toLowerCase() && f !== file);
        if (clash) await trashNote(this.vault, clash);
        if (want !== file) {
            await fsp.mkdir(this.vault.abs(`${BLUEPRINTS}/${cat}`), { recursive: true });
            // (a change of case only still goes through a spare name, for file systems that ignore case)
            const tmp = `${want}.moving`;
            await fsp.rename(this.vault.abs(file), this.vault.abs(tmp));
            await fsp.rename(this.vault.abs(tmp), this.vault.abs(want));
            await this.vault.loadFile(file);
            await this.vault.loadFile(want);
            this.vault.rebuildNames();
        }
        return { file: want, replaced: !!clash, ...(await this.blueprintLibrary()) };
    }

    /** Move a blueprint to the vault's .trash */
    async deleteBlueprint(file) {
        await trashNote(this.vault, this.blueprintFile(file));
        return this.blueprintLibrary();
    }

    /** A new (empty) category, or `from` renamed to `to`: its blueprints move, replacing the same names already there */
    async saveBlueprintCategory(from, to) {
        const target = sanitizeName(to);
        if (!target) throw fail(400, "The category needs a name");
        if (!from) {
            await fsp.mkdir(this.vault.abs(`${BLUEPRINTS}/${target}`), { recursive: true });
            return this.blueprintLibrary();
        }
        const source = sanitizeName(from);
        const files = [...this.vault.files].filter((f) => path.posix.dirname(f) === `${BLUEPRINTS}/${source}` && f.toLowerCase().endsWith(".svg"));
        for (const f of files) await this.renameBlueprint(f, path.posix.basename(f).replace(/\.svg$/i, ""), target);
        // the old folder goes once it is empty (and when only the case of the name changed, it is the same folder)
        if (source.toLowerCase() !== target.toLowerCase()) await fsp.rmdir(this.vault.abs(`${BLUEPRINTS}/${source}`)).catch(() => {});
        else if (source !== target) {
            const tmp = `${BLUEPRINTS}/.${target}.moving`;
            await fsp.rename(this.vault.abs(`${BLUEPRINTS}/${source}`), this.vault.abs(tmp)).catch(() => {});
            await fsp.rename(this.vault.abs(tmp), this.vault.abs(`${BLUEPRINTS}/${target}`)).catch(() => {});
            for (const f of [...this.vault.files].filter((x) => path.posix.dirname(x) === `${BLUEPRINTS}/${source}`)) {
                await this.vault.loadFile(f);
                await this.vault.loadFile(`${BLUEPRINTS}/${target}/${path.posix.basename(f)}`);
            }
            this.vault.rebuildNames();
        }
        return this.blueprintLibrary();
    }

    /** Remove an empty category */
    async deleteBlueprintCategory(name) {
        const cat = sanitizeName(name);
        if ([...this.vault.files].some((f) => path.posix.dirname(f) === `${BLUEPRINTS}/${cat}`)) throw fail(400, `${cat} still has blueprints in it`);
        await fsp.rmdir(this.vault.abs(`${BLUEPRINTS}/${cat}`)).catch(() => {});
        return this.blueprintLibrary();
    }

    async readBlueprint(file) {
        if (!file.startsWith(`${BLUEPRINTS}/`) || !this.vault.files.has(file)) throw fail(404, `No blueprint ${file}`);
        const bp = parseMapSvg(await fsp.readFile(this.vault.abs(file), "utf8"), "books-meta-blueprint");
        if (!bp) throw fail(400, `${file} is not a blueprint`);
        return { file, blueprint: bp };
    }

    /** Save a blueprint; the same name in the same category (ignoring case) is replaced */
    async saveBlueprint(name, category, bp) {
        if (!bp || !Array.isArray(bp.objects) || !bp.objects.length || !(bp.w >= 0) || !(bp.h >= 0)) throw fail(400, "Not a blueprint");
        const base = sanitizeName(name), cat = sanitizeName(category) || "General";
        if (!base) throw fail(400, "The blueprint needs a name");
        const folder = `${BLUEPRINTS}/${cat}`;
        const want = `${folder}/${base}.svg`;
        const existing = [...this.vault.files].find((f) => f.toLowerCase() === want.toLowerCase());
        const file = existing ?? want;
        const clean = { objects: bp.objects, w: bp.w, h: bp.h, grid: !!bp.grid, textures: bp.textures ?? {} };
        await fsp.mkdir(this.vault.abs(folder), { recursive: true });
        await atomicWrite(this.vault, file, renderBlueprintSvg(clean, await this.svgContext(allObjects(clean.objects))));
        if (!existing) { this.vault.files.add(file); this.vault.rebuildNames(); }
        return { file, replaced: !!existing, list: await this.mapBlueprints(), categories: (await this.blueprintLibrary()).categories };
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
