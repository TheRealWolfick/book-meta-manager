// Novel planning: volumes (the grand plan), chapter plans and graded plots. All text lives in frontmatter
// (`plan`, `plot`) so Obsidian Bases can show it; bodies are never touched.
import { DS } from "./vault.js";
import { createNote, patchNote, sanitizeName, uniqueName } from "./write.js";
import { normalizeOutline } from "../public/outline.js";

export const RATINGS = `${DS}/Taxonomy/Rating`;

// Used when `90. Templater/Data Store Schema.md` has no `plans` section. Link targets starting with "@" are
// folders of the novel itself (its plots or characters), others are data store collections.
export const PLAN_DEFAULTS = {
    volumes: {
        label: "Volume",
        fields: [["title", ""], ["type", "volume"], ["number", ""], ["plot", ""], ["subplots", []], ["chapter-start", ""], ["chapter-end", ""], ["description", ""], ["plan", ""]],
        links: { plot: "@plots", subplots: "@plots" },
    },
    chapters: {
        label: "Chapter Plan",
        fields: [["title", ""], ["type", "chapter-plan"], ["chapter", ""], ["volume", ""], ["plan", ""]],
        links: {},
        generated: ["volume"],
    },
    plots: {
        label: "Plot",
        fields: [["title", ""], ["type", "plot"], ["rating", ""], ["characters", []], ["mood", ""], ["soundtrack", []], ["images", []], ["plot", ""]],
        links: { rating: "Taxonomy/Rating", characters: "@characters" },
    },
};

const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const pad = (n) => String(n).padStart(3, "0");
const fail = (status, message) => Object.assign(new Error(message), { status });

export class Plans {
    constructor(vault, novels, store) { this.vault = vault; this.novels = novels; this.store = store; }

    spec(kind) {
        return { ...PLAN_DEFAULTS[kind], ...(this.store.schema().plans?.[kind] ?? {}) };
    }

    folders(novel) {
        const c = novel.config;
        return {
            volumes: `${novel.folder}/${c["volumes-folder"] ?? "Plan/Book Plan"}`,
            chapters: `${novel.folder}/${c["chapter-plans-folder"] ?? "Plan/Chapter Plans"}`,
            plots: `${novel.folder}/${c["plots-folder"] ?? "Plots"}`,
        };
    }

    /** Which plan kind a note is ("volumes" | "chapters" | "plots"), with its novel */
    kindOf(p) {
        const novel = this.novels.get(p.split("/")[0]);
        if (!novel) return null;
        const folder = p.slice(0, p.lastIndexOf("/"));
        const kind = Object.entries(this.folders(novel)).find(([, f]) => f === folder)?.[0];
        return kind ? { kind, novel } : null;
    }

    volumes(novel) {
        return this.vault.inFolder(this.folders(novel).volumes).map((n) => ({
            path: n.path, name: n.name, mtime: n.mtime, fm: n.fm,
            title: String(n.fm.title || n.name), number: num(n.fm.number), start: num(n.fm["chapter-start"]), end: num(n.fm["chapter-end"]),
        })).sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || (a.start ?? Infinity) - (b.start ?? Infinity) || a.title.localeCompare(b.title));
    }

    /** Text written to a chapter plan's `volume` (kept as text so Bases can group and sort by it) */
    volumeLabel(v) {
        return v.number != null ? `${v.number} - ${v.title}` : v.title;
    }

    volumeOf(volumes, n) {
        return volumes.find((v) => v.start != null && n >= v.start && (v.end == null || n <= v.end)) ?? null;
    }

    chapterPlans(novel) {
        const out = new Map();
        for (const n of this.vault.inFolder(this.folders(novel).chapters)) {
            const c = num(n.fm.chapter);
            if (c != null && !out.has(c)) out.set(c, n);
        }
        return out;
    }

    ratings() {
        return this.vault.inFolder(RATINGS).map((n) => ({ path: n.path, name: n.name, title: String(n.fm.title || n.name), class: num(n.fm.class) ?? 0 }))
            .sort((a, b) => b.class - a.class);
    }

    plots(novel) {
        return this.vault.inFolder(this.folders(novel).plots).map((n) => {
            const r = n.fm.rating ? this.vault.resolve(n.fm.rating) : null;
            const rating = r ? this.vault.notes.get(r) : null;
            return {
                path: n.path, name: n.name, mtime: n.mtime, fm: n.fm, title: String(n.fm.title || n.name),
                rating: rating ? { path: r, title: String(rating.fm.title || rating.name), class: num(rating.fm.class) ?? 0 } : null,
            };
        });
    }

    /** Chapter notes and chapter plans merged by number */
    chapters(novel) {
        const notes = new Map(this.novels.chapters(novel).map((c) => [c.number, c]));
        const plans = this.chapterPlans(novel);
        const volumes = this.volumes(novel);
        const draftFrom = this.novels.draftFrom(novel);
        return [...new Set([...notes.keys(), ...plans.keys()])].sort((a, b) => a - b).map((n) => {
            const note = notes.get(n), plan = plans.get(n);
            return {
                number: n, title: note?.title || String(plan?.fm.title ?? ""), notePath: note?.path ?? null, planPath: plan?.path ?? null,
                plan: String(plan?.fm.plan ?? ""), draft: n >= draftFrom, volume: this.volumeOf(volumes, n)?.path ?? null,
            };
        });
    }

    overview(novel) {
        const ledgers = this.novels.ledgers(novel);
        const entries = (n) => ledgers.reduce((s, l) => s + l.entries.filter((e) => e.chapter === n).length, 0);
        return {
            folders: this.folders(novel),
            specs: { volumes: this.spec("volumes"), chapters: this.spec("chapters"), plots: this.spec("plots") },
            volumes: this.volumes(novel).map((v) => ({ ...v, label: this.volumeLabel(v) })),
            plots: this.plots(novel),
            chapters: this.chapters(novel).map((c) => ({ ...c, entries: entries(c.number) })),
            ratings: this.ratings(),
            characters: this.novels.characters(novel).map((n) => ({ path: n.path, name: n.name })),
            draftFrom: this.novels.draftFrom(novel),
        };
    }

    // ------------------------------------------------------------ writing

    defaults(kind) {
        const out = {};
        for (const [k, def] of this.spec(kind).fields) out[k] = Array.isArray(def) ? [...def] : def;
        return out;
    }

    async create(novel, kind, name, fm) {
        const spec = this.spec(kind);
        const base = sanitizeName(name);
        if (!base) throw fail(400, "Name required");
        const file = uniqueName(this.vault, base, spec.label);
        const rel = `${this.folders(novel)[kind]}/${file}.md`;
        await createNote(this.vault, rel, { ...this.defaults(kind), "created-date": new Date().toISOString().slice(0, 10), ...fm });
        return rel;
    }

    createVolume(novel, title, fm = {}) {
        return this.create(novel, "volumes", title, { title, ...fm });
    }

    createPlot(novel, title, fm = {}) {
        return this.create(novel, "plots", title, { title, ...fm });
    }

    /** Create or update the plan of chapter n. Returns {path, mtime} */
    async saveChapterPlan(novel, n, { set = {}, baseMtime } = {}) {
        set = Object.fromEntries(Object.entries(set).filter(([k]) => !["chapter", "volume", "type"].includes(k)));
        if ("plan" in set) set.plan = normalizeOutline(set.plan);
        const existing = this.chapterPlans(novel).get(n);
        const volume = this.volumeOf(this.volumes(novel), n);
        const label = volume ? this.volumeLabel(volume) : "";
        let rel = existing?.path;
        if (rel) await patchNote(this.vault, rel, { set: { ...set, ...(String(existing.fm.volume ?? "") !== label ? { volume: label } : {}) }, baseMtime });
        else rel = await this.create(novel, "chapters", `Plan ${pad(n)} (${novel.name})`, { ...set, chapter: n, volume: label });
        return { path: rel, mtime: this.vault.notes.get(rel)?.mtime };
    }

    /** Write each chapter plan's `volume` text from the volume chapter ranges; only changed notes are patched */
    async syncVolumes(novel) {
        const volumes = this.volumes(novel);
        const changed = [];
        for (const [n, note] of this.chapterPlans(novel)) {
            const v = this.volumeOf(volumes, n);
            const label = v ? this.volumeLabel(v) : "";
            if (String(note.fm.volume ?? "") === label) continue;
            await patchNote(this.vault, note.path, { set: { volume: label } });
            changed.push(note.path);
        }
        return changed;
    }

    /** After any note edit: keep chapter plans' volume text in step with volumes */
    async afterPatch(p) {
        const k = this.kindOf(p);
        if (k && (k.kind === "volumes" || k.kind === "chapters")) await this.syncVolumes(k.novel);
    }

    /** For note pages: the plan kind, field spec and novel of a plan note */
    describe(p) {
        const k = this.kindOf(p);
        if (!k) return null;
        return { kind: k.kind, novel: k.novel.folder, spec: this.spec(k.kind) };
    }
}

