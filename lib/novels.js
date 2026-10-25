// Novels: discovery, per-novel config, characters, chapters, ledgers, callouts and sheet sync.
import { DS, LEDGER_TYPES_NOTE, linkLabel, noteName } from "./vault.js";
import { parseLedger, serializeLedger, foldStock, foldState, diffStock, headingOf, newId, normQty, qtyText, modsOf, linkTitle } from "./ledger.js";
import { renderTemplate, asCallout } from "./template.js";
import { atomicWrite, createNote, patchNote, sanitizeName } from "./write.js";

const MARKER = /%%\s*event:\s*\[\[([^\]#|]+)#(\d+)\.(\d+)[^\]]*\]\]\s*%%/g;

export class Novels {
    constructor(vault) { this.vault = vault; }

    list() {
        const folders = new Set();
        for (const n of this.vault.notes.values()) {
            const top = n.path.split("/")[0];
            const m = /^(\d+)\.\s+(.+)$/.exec(top);
            if (m && Number(m[1]) < 20 && n.path.includes("/")) folders.add(top);
        }
        return [...folders].sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b)).map((f) => this.get(f));
    }

    get(folder) {
        const m = /^(\d+)\.\s+(.+)$/.exec(folder);
        if (!m) return null;
        const configPath = `${folder}/config.md`;
        const config = this.vault.notes.get(configPath)?.fm ?? {};
        return {
            folder, number: Number(m[1]), name: m[2], configPath, config,
            noteName: m[2],
            charactersFolder: `${folder}/${config["characters-folder"] ?? "Characters"}`,
            chaptersFolder: `${folder}/${config["chapters-folder"] ?? "Chapters"}`,
            ledgersFolder: `${folder}/${config["ledgers-folder"] ?? "Ledgers"}`,
        };
    }

    /** Shared ledger types merged with the novel's config.md `ledger-types` */
    ledgerTypes(novel) {
        const shared = this.vault.notes.get(LEDGER_TYPES_NOTE)?.fm["ledger-types"] ?? {};
        const own = novel?.config["ledger-types"] ?? {};
        const out = {};
        for (const name of new Set([...Object.keys(shared), ...Object.keys(own)])) {
            const a = shared[name] ?? {}, b = own[name] ?? {};
            out[name] = { behaviour: "log", ...a, ...b, name, fields: { ...(a.fields ?? {}), ...(b.fields ?? {}) }, callouts: { ...(a.callouts ?? {}), ...(b.callouts ?? {}) }, sharedCallouts: a.callouts ?? {}, novelCallouts: b.callouts ?? {} };
        }
        return out;
    }

    chapters(novel) {
        return this.vault.inFolder(novel.chaptersFolder).map((n) => {
            const num = Number(n.fm.chapter ?? /^(\d+(?:\.\d+)?)/.exec(n.name)?.[1]);
            const number = Number.isFinite(num) ? num : null;
            return { path: n.path, name: n.name, number, title: n.fm["chapter title"] || n.name.replace(/^\d+(\.\d+)?\s*-?\s*/, ""), draft: number >= this.draftFrom(novel) };
        }).filter((c) => c.number != null).sort((a, b) => a.number - b.number);
    }

    /** Chapter numbers from this value up are drafts/placeholders (e.g. 999.md) and don't count as the latest chapter */
    draftFrom(novel) {
        return Number(novel.config["draft-chapter-from"] ?? 900);
    }

    latestChapter(novel) {
        const limit = this.draftFrom(novel);
        const nums = [...this.chapters(novel).map((c) => c.number), ...this.ledgers(novel).flatMap((l) => l.entries.map((e) => e.chapter))].filter((n) => n < limit);
        return nums.length ? Math.max(...nums) : 1;
    }

    characters(novel) {
        return this.vault.inFolder(novel.charactersFolder).filter((n) => n.fm.type !== "ledger");
    }

    /** All ledgers of a novel, parsed */
    ledgers(novel) {
        return this.vault.inFolder(novel.ledgersFolder).filter((n) => n.fm.type === "ledger").map((n) => this.readLedger(n));
    }

    readLedger(n) {
        const { preamble, entries } = parseLedger(n.body);
        const ownerPath = n.fm.owner ? this.vault.resolve(n.fm.owner) : null;
        return {
            path: n.path, name: n.name, mtime: n.mtime, type: String(n.fm["ledger-type"] ?? ""),
            owner: n.fm.owner ? linkLabel(n.fm.owner) : n.name.split(" - ")[0], ownerPath, preamble, entries,
        };
    }

    ledgerPath(novel, owner, type) {
        return `${novel.ledgersFolder}/${sanitizeName(`${owner} - ${type}`)}.md`;
    }

    ownerLedgers(novel, owner) {
        return this.ledgers(novel).filter((l) => l.owner.toLowerCase() === owner.toLowerCase());
    }

    // ------------------------------------------------------------ computed views

    compute(novel, ledger, { at, compare, mode } = {}) {
        const type = this.ledgerTypes(novel)[ledger.type] ?? { behaviour: "log" };
        const warnings = ledger.entries.flatMap((e) => e.warnings.map((w) => ({ entry: e.key, message: w })));
        if (type.behaviour === "stock") {
            const r = foldStock(this.vault, ledger.entries, { until: at ?? Infinity, mode });
            return { behaviour: "stock", ...r, warnings: [...warnings, ...foldStock(this.vault, ledger.entries).warnings], diff: compare != null && at != null ? diffStock(this.vault, ledger.entries, compare, at) : null };
        }
        if (type.behaviour === "state") return { behaviour: "state", ...foldState(ledger.entries, { until: at ?? Infinity }), warnings };
        return { behaviour: "log", warnings };
    }

    /** Chapter-text markers: which entries have been pasted into a chapter */
    placedEntries(novel) {
        const placed = new Map();
        for (const c of this.chapters(novel)) {
            const n = this.vault.notes.get(c.path);
            for (const m of n.body.matchAll(MARKER)) placed.set(`${m[1].trim().toLowerCase()}#${m[2]}.${m[3]}`, c);
        }
        return placed;
    }

    // ------------------------------------------------------------ callouts

    lineView(ledger, l) {
        const owner = ledger.owner;
        const action = String(l.action || "add").toLowerCase();
        const { q, unit } = normQty(l.qty, l.unit);
        const itemPath = l.item && /\[\[/.test(l.item) ? this.vault.resolve(l.item) : null;
        const place = (store) => (!store || store.toLowerCase() === "inventory" ? `${owner}'s inventory` : store);
        const isMaterial = (itemPath?.startsWith(`${DS}/Materials/`)) || unit === "g";
        const destination = action === "move" ? place(l["to-store"]) : action === "transfer-out" ? linkLabel(l.to) : place(l.store);
        return {
            ...l, action, item: l.item ?? "", itemName: linkLabel(l.item ?? ""), qty: l.qty ?? "1", unit: l.unit ?? "", qtyText: qtyText(q, unit),
            plural: q === 1 || unit === "g" ? "" : "s", haveHas: q === 1 ? "has" : "have", condition: linkTitle(this.vault, l.condition),
            rarity: linkTitle(this.vault, l.rarity),
            // condition, rarity and modifiers as bullets indented under the item's line (templates end the line with
            // {{details}}; empty when there are none)
            details: [
                l.condition && `\t- Condition: ${linkTitle(this.vault, l.condition)}`,
                l.rarity && `\t- Rarity: ${linkTitle(this.vault, l.rarity)}`,
                modsOf(l).length && `\t- Modifiers\n${modsOf(l).map((m) => `\t\t- ${m}`).join("\n")}`,
            ].filter(Boolean).map((x) => `\n${x}`).join(""), mods: modsOf(l).map((m) => ({ mod: m, modName: linkLabel(m) })), modsText: modsOf(l).map((m) => linkLabel(m)).join(", "),
            store: l.store ?? "inventory", destination, source: place(l.store), toName: l.to ? linkLabel(l.to) : "", fromName: l.from ? linkLabel(l.from) : "",
            note: l.note ?? "", setField: l.set ?? "", setValue: l.value ? linkLabel(l.value) : "", withName: l.with ? linkLabel(l.with) : "",
            isMaterial,
        };
    }

    entryView(novel, ledger, e) {
        const lines = e.lines.map((l) => this.lineView(ledger, l));
        const group = (pred) => lines.filter(pred);
        const wrap = (ls) => (ls.length ? [{ lines: ls }] : []);
        return {
            ...e.fields, novel: novel.name, owner: `[[${ledger.owner}]]`, ownerName: ledger.owner, character: ledger.owner, ledgerType: ledger.type,
            chapter: e.chapter, seq: e.seq, key: e.key, title: e.title, summary: e.title, body: e.body,
            eventLink: `%% event: [[${ledger.name}#${headingOf(e)}]] %%`,
            lines, added: group((l) => l.action === "add"), removed: group((l) => l.action === "remove"),
            gained: group((l) => ["add", "transfer-in"].includes(l.action)), lost: group((l) => ["remove", "transfer-out"].includes(l.action)),
            moved: group((l) => l.action === "move"), transferredIn: group((l) => l.action === "transfer-in"), transferredOut: group((l) => l.action === "transfer-out"),
            set: group((l) => l.setField), items: wrap(group((l) => l.item && !l.isMaterial)), materials: wrap(group((l) => l.item && l.isMaterial)),
        };
    }

    /** Pick the template: novel variant, novel default, shared variant, shared default */
    templateFor(novel, ledger, e) {
        const t = this.ledgerTypes(novel)[ledger.type];
        if (!t) return "[!note] {{title}}\n{{body}}\n{{eventLink}}";
        const variant = e.fields.callout || t["default-callout"] || "default";
        return t.novelCallouts[variant] ?? t.novelCallouts.default ?? t.sharedCallouts[variant] ?? t.sharedCallouts.default ?? "[!note] {{title}}\n{{body}}\n{{eventLink}}";
    }

    callout(novel, ledger, e) {
        return asCallout(renderTemplate(this.templateFor(novel, ledger, e), this.entryView(novel, ledger, e)));
    }

    /** Entries sharing a ref (or the entry itself), in chapter order, across all of the novel's ledgers */
    linkedSet(novel, ledger, e) {
        const ref = e.fields.ref;
        if (!ref) return [{ ledger, entry: e }];
        const out = [];
        for (const l of this.ledgers(novel)) for (const x of l.entries) if (x.fields.ref === ref || x.fields.id === ref) out.push({ ledger: l, entry: x });
        return out.sort((a, b) => a.entry.chapter - b.entry.chapter || a.entry.seq - b.entry.seq);
    }

    // ------------------------------------------------------------ writing

    nextSeq(novel, chapter) {
        let max = 0;
        for (const l of this.ledgers(novel)) for (const e of l.entries) if (e.chapter === chapter) max = Math.max(max, e.seq);
        return max + 1;
    }

    async ensureLedger(novel, owner, type) {
        const rel = this.ledgerPath(novel, owner, type);
        if (!this.vault.notes.has(rel)) {
            await createNote(this.vault, rel, { type: "ledger", "ledger-type": type, owner: `[[${owner}]]`, novel: `[[${novel.noteName}]]` }, "");
        }
        return this.readLedger(this.vault.notes.get(rel));
    }

    async writeLedger(ledger, entries, baseMtime) {
        const n = this.vault.notes.get(ledger.path);
        if (baseMtime != null && Math.abs(n.mtime - Number(baseMtime)) > 1) throw Object.assign(new Error(`${ledger.path} changed since it was loaded. Reload and try again.`), { status: 409 });
        const text = `---\n${n.fmText ?? ""}\n---\n${serializeLedger(ledger.preamble, entries)}`;
        await atomicWrite(this.vault, ledger.path, text);
    }

    /**
     * Save (create or replace) an entry. Transfers out of a stock ledger get a mirrored transfer-in
     * entry in the receiver's ledger; linked entries are saved to other ledgers of the same owner with a shared ref.
     */
    async saveEntry(novel, { owner, type, entry, replaceKey, baseMtime, linked = [] }) {
        const types = this.ledgerTypes(novel);
        if (!types[type]) throw Object.assign(new Error(`Unknown ledger type "${type}"`), { status: 400 });
        let ledger = await this.ensureLedger(novel, owner, type);
        const chapter = Number(entry.chapter);
        if (!Number.isFinite(chapter)) throw Object.assign(new Error("Chapter must be a number"), { status: 400 });

        const old = replaceKey ? ledger.entries.find((e) => e.key === replaceKey) : null;
        const fields = { ...(old?.fields ?? {}), ...(entry.fields ?? {}) };
        for (const k of Object.keys(fields)) if (fields[k] === "" || fields[k] == null) delete fields[k];
        fields.id ||= newId();
        if (linked.length) fields.ref ||= fields.id;
        const seq = old && old.chapter === chapter ? old.seq : this.nextSeq(novel, chapter);
        const lines = (entry.lines ?? []).map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== "" && v != null)));
        lines.forEach((l, i) => { if (l.action === "transfer-out" && !l.ref) l.ref = `${fields.id}-${i + 1}`; });
        const saved = { chapter, seq, title: sanitizeName(entry.title ?? "").replace(/^\d+\.\d+\s*/, ""), fields, lines, body: entry.body ?? "" };
        const others = ledger.entries.filter((e) => e !== old);
        await this.writeLedger(ledger, [...others, saved], baseMtime);

        // mirrored transfers
        if (types[type].behaviour === "stock") await this.syncMirrors(novel, type, owner, saved);

        // linked entries in other ledgers of the same owner
        for (const lk of linked) {
            await this.saveEntry(novel, { owner, type: lk.type, entry: { ...lk.entry, chapter: lk.entry.chapter ?? chapter, fields: { ...(lk.entry.fields ?? {}), ref: fields.ref } }, replaceKey: lk.replaceKey });
        }
        ledger = this.readLedger(this.vault.notes.get(ledger.path));
        return { ledger, entry: ledger.entries.find((e) => e.fields.id === fields.id) };
    }

    async syncMirrors(novel, type, owner, saved) {
        const id = saved.fields.id;
        // remove any previous mirrors of this entry
        for (const l of this.ledgers(novel).filter((x) => x.type === type)) {
            const keep = l.entries.filter((e) => e.fields["mirror-of"] !== id);
            if (keep.length !== l.entries.length) await this.writeLedger(l, keep);
        }
        const byReceiver = new Map();
        for (const l of saved.lines) {
            if (l.action !== "transfer-out" || !l.to) continue;
            const r = linkLabel(l.to);
            if (!byReceiver.has(r)) byReceiver.set(r, []);
            const { action, to, ...rest } = l;
            byReceiver.get(r).push({ action: "transfer-in", ...rest, from: `[[${owner}]]` });
        }
        for (const [receiver, lines] of byReceiver) {
            const l = await this.ensureLedger(novel, receiver, type);
            const mirror = { chapter: saved.chapter, seq: this.nextSeq(novel, saved.chapter), title: `${saved.title || "Transfer"} (from ${owner})`, fields: { "mirror-of": id, ...(saved.fields.callout ? { callout: saved.fields.callout } : {}) }, lines, body: "" };
            await this.writeLedger(l, [...l.entries, mirror]);
        }
    }

    async deleteEntry(novel, ledgerPath, key, baseMtime) {
        const ledger = this.readLedger(this.vault.notes.get(ledgerPath));
        const e = ledger.entries.find((x) => x.key === key);
        if (!e) throw Object.assign(new Error(`No entry ${key}`), { status: 404 });
        await this.writeLedger(ledger, ledger.entries.filter((x) => x !== e), baseMtime);
        if (e.fields.id) for (const l of this.ledgers(novel)) {
            const keep = l.entries.filter((x) => x.fields["mirror-of"] !== e.fields.id);
            if (keep.length !== l.entries.length) await this.writeLedger(l, keep);
        }
    }

    // ------------------------------------------------------------ character sheets

    /**
     * Write generated fields to a character's sheet: `inventory` from stock ledgers, and the latest
     * values from state ledgers (relations become relations/<value> lists).
     */
    async syncSheet(novel, owner) {
        const sheet = this.vault.resolve(owner);
        const n = sheet && this.vault.notes.get(sheet);
        if (!n || !n.path.startsWith(`${novel.charactersFolder}/`)) return null;
        const types = this.ledgerTypes(novel);
        let set = {};
        const inventory = [];
        const relations = {};
        let hasStock = false;
        for (const l of this.ownerLedgers(novel, owner)) {
            const t = types[l.type];
            if (t?.behaviour === "stock") {
                hasStock = true;
                for (const s of foldStock(this.vault, l.entries).stacks) {
                    if (s.qty <= 0) continue;
                    const item = s.itemPath ? `[[${noteName(s.itemPath)}]]` : s.itemName;
                    // (condition, rarity and modifiers in brackets: "1× [[Sword]] (worn, rare; Silver inlay, +2 sharpness)")
                    const kind = [s.condition, s.rarity].filter(Boolean).join(", "), mods = (s.mods ?? []).join(", ");
                    const extra = kind || mods ? ` (${[kind, mods].filter(Boolean).join("; ")})` : "";
                    inventory.push(`${s.unit === "ea" ? `${s.qty}×` : s.qtyText} ${item}${extra}${s.store.toLowerCase() !== "inventory" ? ` @ ${s.store}` : ""}`);
                }
            } else if (t?.behaviour === "state") {
                for (const v of foldState(l.entries).values) {
                    if (v.with) { (relations[`relations/${v.value.toLowerCase()}`] ??= []).push(`[[${v.withName}]]`); continue; }
                    set[v.field] = v.value;
                }
            }
        }
        if (hasStock) set.inventory = inventory;
        Object.assign(set, relations);
        if (this.sheetHook) set = this.sheetHook(novel, owner, set);
        const changed = Object.fromEntries(Object.entries(set).filter(([k, v]) => JSON.stringify(n.fm[k] ?? null) !== JSON.stringify(v)));
        if (!Object.keys(changed).length) return { path: n.path, changed: [] };
        await patchNote(this.vault, n.path, { set: changed });
        return { path: n.path, changed: Object.keys(changed) };
    }

    async createCharacter(novel, schema, name, fm = {}) {
        const clean = sanitizeName(name);
        if (!clean) throw Object.assign(new Error("Name required"), { status: 400 });
        if (this.vault.nameTaken(clean)) throw Object.assign(new Error(`A note named "${clean}" already exists`), { status: 409 });
        const out = {};
        for (const [k, def] of schema.characters?.fields ?? []) out[k] = Array.isArray(def) ? [...def] : def;
        Object.assign(out, { name: clean, novel: novel.name, "created-date": new Date().toISOString().slice(0, 10) }, fm);
        const rel = `${novel.charactersFolder}/${clean}.md`;
        await createNote(this.vault, rel, out, "## Bio\n\n### Appearance\n\n### Personality\n\n### Background\n\n## Relationships\n");
        return rel;
    }
}

