// Data store: schema, collections, entry pages, creation, image attachments, QA.
import fsp from "node:fs/promises";
import path from "node:path";
import { DS, SCHEMA_NOTE, isLink, linkLabel, linkTarget } from "./vault.js";
import { createNote, patchNote, sanitizeName, uniqueName } from "./write.js";
import { renderMarkdown, fileUrl } from "./render.js";

export const ATTACHMENTS = `${DS}/_Attachments`;
const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const MAX_IMAGE = 15 * 1024 * 1024;

export class DataStore {
    constructor(vault, novels, blueprints) { this.vault = vault; this.novels = novels; this.blueprints = blueprints; this._sv = -1; }

    schema() {
        if (this._sv === this.vault.version) return this._schema;
        const n = this.vault.notes.get(SCHEMA_NOTE);
        const json = n?.body.match(/```json\n([\s\S]*?)\n```/)?.[1];
        this._schema = json ? JSON.parse(json) : { collections: {} };
        this._sv = this.vault.version;
        return this._schema;
    }

    collectionOf(p) {
        if (!p.startsWith(`${DS}/`)) return null;
        const folder = path.posix.dirname(p.slice(DS.length + 1));
        return this.schema().collections[folder] ? folder : null;
    }

    /** Everything the browser needs to list and filter the data store, without bodies */
    index() {
        const schema = this.schema();
        const notes = [];
        for (const n of this.vault.notes.values()) {
            const collection = this.collectionOf(n.path);
            if (!collection) continue;
            notes.push({ path: n.path, name: n.name, collection, fm: n.fm, cover: this.cover(n), mtime: n.mtime });
        }
        const counts = {};
        for (const n of notes) counts[n.collection] = (counts[n.collection] ?? 0) + 1;
        return { schema, notes, counts, novels: this.novels.list().map(({ folder, name, number, config }) => ({ folder, name, number, accent: config.accent ?? null })) };
    }

    cover(n) {
        const first = [].concat(n.fm.images ?? [])[0];
        const p = first ? this.vault.resolve(first) : null;
        return p ? fileUrl(p) : null;
    }

    /** Resolve every link-looking value in frontmatter so the browser can draw chips */
    resolveFm(fm) {
        const out = {};
        const visit = (v) => {
            if (Array.isArray(v)) v.forEach(visit);
            else if (isLink(v)) { const p = this.vault.resolve(v); out[v] = p ? { path: p, label: linkLabel(v), image: !p.endsWith(".md") } : null; }
        };
        Object.values(fm).forEach(visit);
        return out;
    }

    page(p) {
        const n = this.vault.notes.get(p);
        if (!n) return null;
        const groups = {};
        for (const b of this.vault.backlinks(p)) {
            const c = this.collectionOf(b) ?? b.split("/")[0];
            (groups[c] ??= []).push({ path: b, name: this.vault.notes.get(b)?.name ?? path.posix.basename(b) });
        }
        // notes this one links to (frontmatter and body), grouped like backlinks; images and attachments are left out
        const outlinks = {};
        const seen = new Set([p]);
        for (const l of n.links) {
            if (!linkTarget(l)) continue;
            const r = this.vault.resolve(l);
            if (r ? seen.has(r) || !r.endsWith(".md") : seen.has(`?${l}`)) continue;
            seen.add(r ?? `?${l}`);
            const c = r ? this.collectionOf(r) ?? r.split("/")[0] : "Unresolved";
            (outlinks[c] ??= []).push(r ? { path: r, name: this.vault.notes.get(r)?.name ?? path.posix.basename(r) } : { path: null, name: linkLabel(`[[${l}]]`) });
        }
        const collection = this.collectionOf(p);
        const out = {
            path: p, name: n.name, collection, fm: n.fm, fmError: n.fmError, body: n.body, mtime: n.mtime,
            html: renderMarkdown(n.body, this.vault), links: this.resolveFm(n.fm), backlinks: groups, outlinks,
            images: [].concat(n.fm.images ?? []).map((i) => this.vault.resolve(i)).filter(Boolean).map(fileUrl),
        };
        if (collection === "Items") {
            if (this.blueprints.recipeFor(p)) out.blueprint = this.blueprints.tree(p);
            out.whereUsed = this.blueprints.whereUsed(p);
            out.heldBy = this.heldBy(p);
        }
        if (collection === "Materials") out.whereUsed = [];
        // materials and recipes are held in inventories like items
        if (collection === "Materials" || collection === "Recipes") out.heldBy = this.heldBy(p);
        if (collection === "Recipes" && n.fm.item) {
            const item = this.vault.resolve(n.fm.item);
            if (item) out.blueprint = this.blueprints.tree(item);
        }
        return out;
    }

    /** Who holds this item, per novel, at each novel's latest chapter */
    heldBy(p) {
        const out = [];
        for (const novel of this.novels.list()) {
            for (const l of this.novels.ledgers(novel)) {
                const c = this.novels.compute(novel, l);
                if (c.behaviour !== "stock") continue;
                for (const s of c.stacks) if (s.itemPath === p && s.qty > 0) out.push({ novel: novel.folder, owner: l.owner, ledger: l.type, store: s.store, qtyText: s.qtyText });
            }
        }
        return out;
    }

    // ------------------------------------------------------------ writing

    /** Create a data store note from the schema; returns its path. Name is made unique vault-wide. */
    async create(collection, name, fm = {}, body = "") {
        const col = this.schema().collections[collection];
        if (!col) throw Object.assign(new Error(`Unknown collection ${collection}`), { status: 400 });
        const clean = sanitizeName(name);
        if (!clean) throw Object.assign(new Error("Name required"), { status: 400 });
        const final = uniqueName(this.vault, clean, col.label);
        const out = {};
        for (const [k, def] of col.fields) out[k] = Array.isArray(def) ? [...def] : def;
        Object.assign(out, fm);
        if (!out.title) out.title = clean;
        if (!out["created-date"]) out["created-date"] = new Date().toISOString().slice(0, 10);
        const rel = `${DS}/${collection}/${final}.md`;
        await createNote(this.vault, rel, out, body);
        return rel;
    }

    // ------------------------------------------------------------ recipes (blueprints)

    /**
     * Create the recipe (blueprint) for an item, in the same shape as Templater's createBlueprint: a Recipes note
     * "<item> (Blueprint)" whose frontmatter lists the item, components, materials and disciplines, and whose body holds
     * the component::/count:: and material::/quantity::/unit:: fields the build tree and the crafting scripts read.
     * The item gets `recipe: "[[<recipe>]]"`. Returns {path, name}.
     * fm: {description, cat, tier, disciplines, "power-system"}; components [{item, count}]; materials [{material, qty, unit}]
     */
    async createRecipe({ item, fm = {}, components = [], materials = [], assembly = "" }) {
        const itemNote = this.vault.notes.get(item);
        if (!itemNote || this.collectionOf(item) !== "Items") throw Object.assign(new Error("Not an item"), { status: 400 });
        const existing = this.blueprints.recipeFor(item);
        if (existing) throw Object.assign(new Error(`${itemNote.name} already has a recipe: ${existing.note.name}`), { status: 409 });
        const link = (v) => (v ? `[[${linkLabel(v)}]]` : "");
        const comps = components.filter((c) => c?.item).map((c) => ({ item: link(c.item), count: Math.max(1, Math.round(Number(c.count) || 1)) }));
        const mats = materials.filter((m) => m?.material).map((m) => ({ material: link(m.material), qty: Number(m.qty) || 0, unit: m.unit || "g" }));
        const list = (v) => [...new Set([].concat(v ?? []).filter(Boolean).map(link))];
        const front = {
            title: `${itemNote.name} blueprint`,
            cat: list(fm.cat ?? (this.vault.resolve("[[tech blueprint]]") ? "[[tech blueprint]]" : [])),
            item: `[[${itemNote.name}]]`,
            tier: fm.tier === "" || fm.tier == null ? "" : Number(fm.tier),
            components: [...new Set(comps.map((c) => c.item))],
            materials: [...new Set(mats.map((m) => m.material))],
            disciplines: list(fm.disciplines),
            "power-system": list(fm["power-system"] ?? itemNote.fm["power-system"]),
            // like the Templater script: the recipe belongs where its item does
            genre: list(itemNote.fm.genre),
            novels: list(itemNote.fm.novels),
            description: String(fm.description ?? "").trim(),
        };
        let body = "";
        if (comps.length) body += `## Components\n${comps.map((c) => `component:: ${c.item}\ncount:: ${c.count}\n`).join("\n")}\n`;
        if (mats.length) body += `## Materials Required\n${mats.map((m) => `material:: ${m.material}\nquantity:: ${m.qty}\nunit:: ${m.unit}\n`).join("\n")}\n`;
        if (String(assembly).trim()) body += `## Assembly\n${String(assembly).trim()}\n`;
        const p = await this.create("Recipes", `${itemNote.name} (Blueprint)`, front, body);
        const name = path.posix.basename(p, ".md");
        await patchNote(this.vault, item, { set: { recipe: `[[${name}]]` } });
        return { path: p, name };
    }

    /**
     * Recipes like the one being made for `item`, for keeping costs in balance: scored by shared item categories,
     * power system and closeness of tier. [{path, name, item, itemName, tier, score, why, disciplines, bill, parts,
     * grams (total weight of materials), components (count)}], best first
     */
    compareRecipes(item, limit = 12) {
        const it = this.vault.notes.get(item);
        if (!it) throw Object.assign(new Error("Item not found"), { status: 404 });
        const labels = (v) => new Set([].concat(v ?? []).filter(Boolean).map((x) => linkLabel(x).toLowerCase()));
        const cats = labels([].concat(it.fm.cat ?? [], it.fm.subcat ?? [])), ps = labels(it.fm["power-system"]), tier = Number(it.fm.tier) || null;
        const out = [];
        for (const [ip, r] of this.blueprints.index().recipes) {
            if (ip === item) continue;
            const other = this.vault.notes.get(ip);
            if (!other) continue;
            const why = [];
            let score = 0;
            const shared = [...labels([].concat(other.fm.cat ?? [], other.fm.subcat ?? []))].filter((c) => cats.has(c));
            if (shared.length) { score += 3 * shared.length; why.push(shared.join(", ")); }
            const sharedPs = [...labels(other.fm["power-system"])].filter((c) => ps.has(c));
            if (sharedPs.length) { score += 2; why.push(sharedPs.join(", ")); }
            const t = Number(other.fm.tier ?? r.note.fm.tier) || null;
            if (tier && t) { const d = Math.abs(t - tier); if (d === 0) { score += 2; why.push(`tier ${t}`); } else if (d === 1) { score += 1; why.push(`tier ${t}`); } }
            if (score <= 0) continue;
            const tree = this.blueprints.tree(ip);
            out.push({
                path: r.note.path, name: r.note.name, item: ip, itemName: other.fm.title || other.name, tier: t, score, why,
                disciplines: tree.disciplines, bill: tree.bill, parts: tree.parts, components: r.components.reduce((n, c) => n + c.count, 0),
                grams: tree.bill.filter((b) => b.unit === "g").reduce((n, b) => n + b.qty, 0),
            });
        }
        return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
    }

    /** Save an uploaded image next to the data store and link it from the note */
    async attachImage(notePath, filename, buffer) {
        const n = this.vault.notes.get(notePath);
        if (!n) throw Object.assign(new Error("Note not found"), { status: 404 });
        const ext = path.extname(filename).slice(1).toLowerCase();
        if (!IMAGE_TYPES[ext]) throw Object.assign(new Error(`Unsupported image type .${ext}`), { status: 400 });
        if (buffer.length > MAX_IMAGE) throw Object.assign(new Error("Image larger than 15 MB"), { status: 413 });
        const collection = this.collectionOf(notePath);
        const novel = this.novels.list().find((x) => notePath.startsWith(`${x.folder}/`));
        const folder = collection ? `${ATTACHMENTS}/${collection}` : novel ? `${novel.folder}/_Attachments/${path.posix.basename(path.posix.dirname(notePath))}` : `${ATTACHMENTS}/Other`;
        let i = 1, file;
        do { file = `${n.name} ${i++}.${ext}`; } while (this.vault.fileByName.has(file.toLowerCase()));
        const rel = `${folder}/${file}`;
        await fsp.mkdir(this.vault.abs(folder), { recursive: true });
        await fsp.writeFile(this.vault.abs(rel), buffer);
        this.vault.files.add(rel);
        this.vault.rebuildNames();

        // body: embed under "## Images"
        const lines = n.body.split("\n");
        const h = lines.findIndex((l) => /^##\s+Images\s*$/.test(l));
        if (h === -1) {
            const body = `${n.body.replace(/\s*$/, "")}${n.body.trim() ? "\n\n" : ""}## Images\n![[${file}]]\n`;
            await patchNote(this.vault, notePath, { body, set: { images: [...[].concat(n.fm.images ?? []), `[[${file}]]`] } });
        } else {
            let end = h + 1;
            while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
            while (end > h + 1 && !lines[end - 1].trim()) end--;
            lines.splice(end, 0, `![[${file}]]`);
            await patchNote(this.vault, notePath, { body: lines.join("\n"), set: { images: [...[].concat(n.fm.images ?? []), `[[${file}]]`] } });
        }
        return { path: rel, url: fileUrl(rel) };
    }

    // ------------------------------------------------------------ QA

    qa() {
        const schema = this.schema();
        const unresolved = [], fmErrors = [], untitled = [];
        for (const n of this.vault.notes.values()) {
            if (n.fmError) fmErrors.push({ path: n.path, error: n.fmError });
            const col = this.collectionOf(n.path);
            if (!col) continue;
            if (/^Untitled( \d+)?$/.test(n.name)) untitled.push({ path: n.path });
            for (const key of Object.keys(schema.collections[col].links ?? {})) {
                for (const v of [].concat(n.fm[key] ?? [])) if (isLink(v) && !this.vault.resolve(v)) unresolved.push({ path: n.path, field: key, value: v });
            }
        }
        const collisions = [];
        for (const [name, paths] of this.vault.byName) if (paths.length > 1 && paths.some((p) => p.startsWith(`${DS}/`))) collisions.push({ name, paths });
        const ledgers = [], misc = [];
        for (const novel of this.novels.list()) {
            const all = this.novels.ledgers(novel);
            const ins = new Set(all.flatMap((l) => l.entries.flatMap((e) => e.lines.filter((x) => x.action === "transfer-in").map((x) => x.ref))));
            for (const l of all) {
                const c = this.novels.compute(novel, l);
                for (const w of c.warnings) ledgers.push({ novel: novel.folder, ledger: l.path, ...w });
                for (const e of l.entries) for (const x of e.lines) {
                    if (x.action === "transfer-out" && x.ref && !ins.has(x.ref)) ledgers.push({ novel: novel.folder, ledger: l.path, entry: e.key, message: `Transfer to ${linkLabel(x.to)} has no matching transfer-in` });
                    if (x.item && !/\[\[/.test(x.item)) misc.push({ novel: novel.folder, ledger: l.path, entry: e.key, item: x.item });
                    else if (x.item && !this.vault.resolve(x.item)) ledgers.push({ novel: novel.folder, ledger: l.path, entry: e.key, message: `Unresolved item ${x.item}` });
                }
            }
        }
        return { unresolved, fmErrors, untitled, collisions, ledgers, misc };
    }

    /** Create a data note for a misc item and relink every ledger line that mentions it */
    async promoteMisc(novelFolder, itemText, collection, fm) {
        const rel = await this.create(collection, itemText, fm);
        const name = path.posix.basename(rel, ".md");
        const novel = this.novels.get(novelFolder);
        let changed = 0;
        for (const l of this.novels.ledgers(novel)) {
            let touched = false;
            for (const e of l.entries) for (const x of e.lines) {
                if (x.item && !/\[\[/.test(x.item) && x.item.trim().toLowerCase() === itemText.trim().toLowerCase()) { x.item = `[[${name}]]`; e.raw = undefined; touched = true; changed++; }
            }
            if (touched) await this.novels.writeLedger(l, l.entries);
        }
        return { path: rel, changed };
    }
}

