// Renaming a note's file (its title is a separate field): the file gets its new name in the same folder, and
// everything in the vault that points at it
// follows. [[links]] and embeds in notes (frontmatter and body) are rewritten in place, only the link text changing;
// pins in map and blueprint SVGs are rewritten and their pictures redrawn; canvases that show the file are updated.
// A location's map file (`<Location> (Map).svg`) is renamed along with the location.
import fsp from "node:fs/promises";
import path from "node:path";
import { DS } from "./vault.js";
import { atomicWrite, patchNote, sanitizeName } from "./write.js";
import { MAPS, BLUEPRINTS } from "./worlds.js";
import { parseMapSvg, renderMapSvg, renderBlueprintSvg, allObjects } from "../public/map-core.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
// [[target#heading|alias]] and ![[…]]; a "\|" (a link inside a table) keeps its backslash
const LINK = /(!?\[\[)([^\]\n|#]+?)(\\?)((?:#[^\]\n|]*)?(?:\|[^\]\n]*)?)\]\]/g;

export class Renamer {
    constructor(vault, store, worlds) {
        this.vault = vault;
        this.store = store;
        this.worlds = worlds;
    }

    /** Notes that are never renamed here (their names are part of how the app finds them) */
    protectedReason(n) {
        if (n.path.startsWith("90. Templater/")) return "Templater notes are renamed in Obsidian";
        if (n.fm.type === "config") return "A novel's config.md keeps its name";
        if (n.fm.type === "ledger") return "Ledgers are named after their owner and type";
        return null;
    }

    /** What renaming a note would touch: {name, protected (reason or null), links (notes linking to it), pins (maps and
     * blueprints pinning it), map (its map file, renamed with it)} */
    async preview(p) {
        const n = this.vault.notes.get(p);
        if (!n) throw fail(404, "Note not found");
        const map = n.folder === `${DS}/Locations` ? this.worlds.mapPath(n) : null;
        return {
            name: n.name, protected: this.protectedReason(n), links: this.vault.backlinks(p).length, pins: (await this.svgPins(p, n.name)).length,
            map: map && this.vault.files.has(map) && map === `${MAPS}/${n.name} (Map).svg` ? map : null,
        };
    }

    /**
     * Rename a note's file to `name` (unique across the vault, ignoring case). `title` (optional) is set first, for
     * dialogs that edit both. Returns {path, name, renamed, updated: [paths of other files that changed]}.
     */
    async rename({ path: p, title, name, baseMtime }) {
        const n = this.vault.notes.get(p);
        if (!n) throw fail(404, "Note not found");
        const reason = this.protectedReason(n);
        if (reason) throw fail(400, reason);
        if (title != null && String(title).trim() !== String(n.fm.title ?? "")) {
            await patchNote(this.vault, p, { set: { title: String(title).trim() }, baseMtime });
            baseMtime = undefined;
        }
        const base = sanitizeName(name ?? n.name);
        if (!base) throw fail(400, "The new name is empty (characters like / : # | [ ] are left out of file names)");
        if (base === n.name) return { path: p, name: n.name, renamed: false, updated: [] };
        // a change of case is the same name; anything else must be free across the vault (Obsidian links by name)
        if (base.toLowerCase() !== n.name.toLowerCase() && this.vault.nameTaken(base)) throw fail(409, `${base} is already the name of another note`);
        const updated = new Set();
        // a location's map file follows its name (only when it has the default name)
        if (n.folder === `${DS}/Locations`) {
            const map = this.worlds.mapPath(n);
            const mapTo = `${MAPS}/${base} (Map).svg`;
            // (never over another file of that name: then the map keeps its name, and its link still finds it)
            const free = mapTo.toLowerCase() === map.toLowerCase() || !(await fsp.access(this.vault.abs(mapTo)).then(() => true, () => false));
            if (this.vault.files.has(map) && map === `${MAPS}/${n.name} (Map).svg` && free) {
                for (const f of await this.move(map, mapTo)) updated.add(f);
            }
        }
        const to = `${n.folder === "." ? "" : `${n.folder}/`}${base}.md`;
        for (const f of await this.move(p, to)) updated.add(f);
        // (the note itself may have changed on the way: its map link, under its old name)
        updated.delete(to);
        updated.delete(p);
        return { path: to, name: base, renamed: true, updated: [...updated].sort() };
    }

    /**
     * Move a file (note or attachment) to a new name and point every link at it there. Returns the paths of the
     * files whose links changed.
     */
    async move(from, to) {
        const isNote = from.endsWith(".md");
        const oldBase = path.posix.basename(from, isNote ? ".md" : undefined).toLowerCase();
        const newBase = path.posix.basename(to, isNote ? ".md" : undefined);
        // 1. links, worked out while the old name still resolves
        const rewrites = new Map(); // path -> new text
        const sources = new Set([...this.backlinksOf(from), ...(isNote ? [from] : [])]);
        for (const src of sources) {
            const text = await fsp.readFile(this.vault.abs(src), "utf8").catch(() => null);
            if (text == null) continue;
            const next = text.replace(LINK, (all, open, target, esc, rest) => {
                const t = target.trim();
                if (this.vault.resolve(t) !== from) return all;
                // only links that name the file (not an alias of it) change: keep any folder prefix and extension
                const dir = t.includes("/") ? t.slice(0, t.lastIndexOf("/") + 1) : "";
                const file = t.slice(dir.length);
                const ext = isNote ? (file.toLowerCase().endsWith(".md") ? file.slice(-3) : "") : "";
                const stem = ext ? file.slice(0, -3) : file;
                if (stem.toLowerCase() !== oldBase) return all;
                const target2 = `${dir}${isNote ? `${newBase}${ext}` : newBase}`;
                return `${open}${target2}${esc}${rest}]]`;
            });
            if (next !== text) rewrites.set(src, next);
        }
        const svgs = await this.svgPins(from, newBase);
        const canvases = await this.canvases(from, to);
        // 2. the move itself (a change of case only goes through a spare name, for file systems that ignore case)
        const tmp = `${to}.renaming`;
        await fsp.rename(this.vault.abs(from), this.vault.abs(tmp));
        await fsp.rename(this.vault.abs(tmp), this.vault.abs(to));
        await this.vault.loadFile(from);
        await this.vault.loadFile(to);
        this.vault.rebuildNames();
        // 3. write the rewritten files (the note's own links to itself land in its new file)
        const changed = [];
        for (const [src, text] of rewrites) {
            const at = src === from ? to : src;
            await atomicWrite(this.vault, at, text);
            await this.vault.loadFile(at);
            changed.push(at);
        }
        for (const [file, text] of canvases) { await atomicWrite(this.vault, file, text); changed.push(file); }
        // pins are redrawn now, so their labels show the note's new title
        for (const { file, doc, blueprint } of svgs) {
            const ctx = await this.worlds.svgContext(blueprint ? allObjects(doc.objects) : doc.layers.flatMap((l) => allObjects(l.objects)));
            await atomicWrite(this.vault, file, blueprint ? renderBlueprintSvg(doc, ctx) : renderMapSvg(doc, ctx));
            changed.push(file);
        }
        this.vault.rebuildNames();
        return changed;
    }

    /** Notes linking to a file (notes from the vault's index; attachments by scanning links, since they have none) */
    backlinksOf(file) {
        if (file.endsWith(".md")) return this.vault.backlinks(file);
        return [...this.vault.notes.values()].filter((n) => n.links.some((l) => this.vault.resolve(l) === file)).map((n) => n.path);
    }

    /** Map and blueprint SVGs with pins on a location that is being renamed: [{file, doc (pins rewritten), blueprint}] */
    async svgPins(from, newBase) {
        if (!from.endsWith(".md")) return [];
        const name = path.posix.basename(from, ".md").toLowerCase();
        const out = [];
        for (const file of this.vault.files) {
            const blueprint = file.startsWith(`${BLUEPRINTS}/`);
            if (!file.toLowerCase().endsWith(".svg") || !(blueprint || file.startsWith(`${MAPS}/`))) continue;
            const text = await fsp.readFile(this.vault.abs(file), "utf8").catch(() => "");
            if (!text.toLowerCase().includes(name)) continue;
            const doc = parseMapSvg(text, blueprint ? "books-meta-blueprint" : "books-meta-map");
            if (!doc) continue;
            let hit = false;
            const fix = (objs) => (objs ?? []).map((o) => {
                if (o.type === "pin" && this.vault.resolve(o.location) === from) { hit = true; return { ...o, location: `[[${newBase}]]` }; }
                return o.type === "room" && o.children?.length ? { ...o, children: fix(o.children) } : o;
            });
            const next = blueprint ? { ...doc, objects: fix(doc.objects) } : { ...doc, layers: doc.layers.map((l) => ({ ...l, objects: fix(l.objects) })) };
            if (hit) out.push({ file, doc: next, blueprint });
        }
        return out;
    }

    /** Canvases showing the file: [[path, new text]] */
    async canvases(from, to) {
        const out = [];
        for (const file of this.vault.files) {
            if (!file.endsWith(".canvas")) continue;
            const text = await fsp.readFile(this.vault.abs(file), "utf8").catch(() => "");
            if (!text.includes(JSON.stringify(from).slice(1, -1))) continue;
            try {
                const c = JSON.parse(text);
                let hit = false;
                for (const node of c.nodes ?? []) if (node.file === from) { node.file = to; hit = true; }
                if (hit) out.push([file, JSON.stringify(c, null, "\t")]);
            } catch { /* not a canvas we can read */ }
        }
        return out;
    }
}
