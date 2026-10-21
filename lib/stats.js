// Character and creature stats: per-novel stat templates (config.md `stat-templates`), values over chapters from
// state ledgers, typed checks, sheet sync and stats panels. Field rules live in public/stats-core.js.
import { linkLabel } from "./vault.js";
import { foldState } from "./ledger.js";
import { createNote, patchNote, sanitizeName, uniqueName } from "./write.js";
import { asCallout, renderTemplate } from "./template.js";
import {
    normalizeTemplates, serializeTemplate, checkTemplate, checkValue, fromText, computeValues, displayValue, panelData, defaultPanel, fieldNamed, namesField,
} from "../public/stats-core.js";

const fail = (status, message) => Object.assign(new Error(message), { status });

export class Stats {
    constructor(vault, novels, store) { this.vault = vault; this.novels = novels; this.store = store; }

    templates(novel) {
        return normalizeTemplates(novel.config["stat-templates"]);
    }

    defaultTemplate(novel) {
        return Object.values(this.templates(novel)).find((t) => t.default) ?? null;
    }

    creaturesFolder(novel) {
        return `${novel.folder}/${novel.config["creatures-folder"] ?? "Creatures"}`;
    }

    /** Characters (sheets) and creature stat notes of a novel, with their template name */
    holders(novel) {
        const def = this.defaultTemplate(novel)?.name ?? null;
        const chars = this.novels.characters(novel).map((n) => ({ kind: "character", path: n.path, name: n.name, template: n.fm["stat-template"] || def, assigned: !!n.fm["stat-template"] }));
        const creatures = this.vault.inFolder(this.creaturesFolder(novel)).filter((n) => n.fm.type === "creature-stats").map((n) => ({
            kind: "creature", path: n.path, name: n.name, template: n.fm["stat-template"] || null, assigned: !!n.fm["stat-template"],
            creature: n.fm.creature ?? null, creaturePath: n.fm.creature ? this.vault.resolve(n.fm.creature) : null,
        }));
        return [...chars, ...creatures];
    }

    holder(novel, owner) {
        const p = this.vault.resolve(owner);
        return this.holders(novel).find((h) => h.path === p || h.name.toLowerCase() === String(owner).toLowerCase()) ?? null;
    }

    /** {key: {value, chapter, entry}} set by the owner's state ledgers (lines without a "with" target), up to `at` */
    ledgerValues(novel, owner, template, at = Infinity) {
        const types = this.novels.ledgerTypes(novel);
        const out = {}, managed = new Set();
        for (const l of this.novels.ownerLedgers(novel, owner)) {
            if (types[l.type]?.behaviour !== "state") continue;
            for (const e of l.entries) for (const line of e.lines) if (line.set && !line.with && fieldNamed(template, line.set)) managed.add(fieldNamed(template, line.set).key);
            for (const v of foldState(l.entries, { until: at }).values) {
                const f = !v.with && fieldNamed(template, v.field);
                if (f && (!out[f.key] || v.chapter >= out[f.key].chapter)) out[f.key] = { value: fromText(f, v.value), chapter: v.chapter, entry: v.entry };
            }
        }
        return { values: out, managed };
    }

    /**
     * Stat values of a holder at a chapter. A field a ledger ever sets takes its value from the ledger (empty before
     * its first entry, unless it has a prefill source); other fields read the sheet, then the prefill source field.
     */
    valuesAt(novel, holder, template, at = Infinity) {
        const note = this.vault.notes.get(holder.path);
        const fm = note?.fm ?? {};
        const { values: led, managed } = holder.kind === "creature" ? { values: {}, managed: new Set() } : this.ledgerValues(novel, holder.name, template, at);
        const values = {}, origin = {};
        for (const f of template.fields) {
            if (f.type === "computed") continue;
            if (led[f.key]) { values[f.key] = led[f.key].value; origin[f.key] = { from: "ledger", chapter: led[f.key].chapter, entry: led[f.key].entry }; continue; }
            if (!managed.has(f.key) && fm[f.key] != null && fm[f.key] !== "") { values[f.key] = fromText(f, fm[f.key]); origin[f.key] = { from: "sheet" }; continue; }
            if (f.source && fm[f.source] != null && fm[f.source] !== "") { values[f.key] = fromText(f, fm[f.source]); origin[f.key] = { from: "source", field: f.source }; continue; }
            values[f.key] = fromText(f, null);
        }
        return { values: computeValues(template, values), origin, managed: [...managed] };
    }

    describeLink(link) {
        const p = this.vault.resolve(link);
        const n = p && this.vault.notes.get(p);
        return n ? { title: String(n.fm.title || n.name), description: String(n.fm.description ?? "") } : null;
    }

    resolveForCheck = (v) => { const p = this.vault.resolve(v); return p ? { path: p, collection: this.store.collectionOf(p) } : null; };

    problems(template, values) {
        const out = [];
        for (const f of template.fields) {
            if (f.type === "computed") continue;
            const msg = checkValue(f, values[f.key], { resolve: this.resolveForCheck });
            if (msg) out.push(msg);
        }
        return out;
    }

    panel(novel, holder, template, values, chapter) {
        const data = panelData(template, values, { ownerName: holder.name, chapter, describe: (l) => this.describeLink(l) });
        const text = template.panel?.trim() ? renderTemplate(template.panel, data) : defaultPanel(data, template.callout);
        return asCallout(text);
    }

    /** Everything a stats view needs; `template` may be an unsaved template object (editor preview) */
    view(novel, owner, { at, template: draft } = {}) {
        const holder = this.holder(novel, owner);
        if (!holder) throw fail(404, `${owner} has no stats in ${novel.name}`);
        const template = draft ? normalizeTemplates({ [draft.name || "Draft"]: draft })[draft.name || "Draft"] : this.templates(novel)[holder.template];
        if (!template) return { holder, template: null, templates: Object.keys(this.templates(novel)) };
        const chapter = at ?? (holder.kind === "creature" ? null : this.novels.latestChapter(novel));
        const { values, origin, managed } = this.valuesAt(novel, holder, template, chapter ?? Infinity);
        return {
            holder, template, chapter, values, origin, managed,
            display: Object.fromEntries(template.fields.map((f) => [f.key, displayValue(template, f, values)])),
            problems: this.problems(template, values),
            panel: this.panel(novel, holder, template, values, chapter),
            templates: Object.keys(this.templates(novel)),
        };
    }

    // ------------------------------------------------------------ checks before writes

    /** Problems in state-ledger lines for an owner with a template (empty if none, or no template) */
    checkLines(novel, owner, typeName, lines) {
        const type = this.novels.ledgerTypes(novel)[typeName];
        if (type?.behaviour !== "state") return [];
        const holder = this.holder(novel, owner);
        const template = holder && this.templates(novel)[holder.template];
        if (!template) return [];
        const out = [];
        for (const l of lines ?? []) {
            if (!l.set || l.with) continue;
            const f = fieldNamed(template, l.set);
            if (!f) continue;
            const msg = checkValue(f, fromText(f, l.value), { resolve: this.resolveForCheck });
            if (msg) out.push(msg);
        }
        return out;
    }

    /** Problems in a frontmatter edit of a character sheet or creature note */
    checkPatch(path, set) {
        const novel = this.novels.get(path.split("/")[0]);
        if (!novel) return [];
        const holder = this.holders(novel).find((h) => h.path === path);
        if (!holder) return [];
        const name = set["stat-template"] ?? holder.template;
        if (set["stat-template"] && !this.templates(novel)[name]) return [`No stat template "${name}" in ${novel.name}`];
        const template = this.templates(novel)[name];
        if (!template) return [];
        const out = [];
        for (const f of template.fields) {
            if (!(f.key in set)) continue;
            const msg = f.type === "computed" ? null : checkValue(f, fromText(f, set[f.key]), { resolve: this.resolveForCheck });
            if (msg) out.push(msg);
        }
        return out;
    }

    /** Sheet sync hook: template fields get their latest typed value (whatever name the ledger used), plus computed fields */
    sheetValues(novel, owner, set) {
        const holder = this.holder(novel, owner);
        const template = holder && this.templates(novel)[holder.template];
        if (!template) return set;
        const out = { ...set };
        // ledgers may name a field by a short name ("level" for character/level): never write those as extra keys
        for (const k of Object.keys(out)) { const f = fieldNamed(template, k); if (f && f.key !== k) delete out[k]; }
        const { values, managed } = this.valuesAt(novel, holder, template);
        for (const f of template.fields) {
            if (f.type === "computed") { if (values[f.key] !== "") out[f.key] = values[f.key]; }
            else if (managed.includes(f.key)) out[f.key] = values[f.key];
        }
        return out;
    }

    // ------------------------------------------------------------ writing

    /** Save all templates of a novel; `renames` {old: new} updates sheets and creature notes that use them */
    async saveTemplates(novel, templates, { baseMtime, renames = {} } = {}) {
        const normalized = normalizeTemplates(Object.fromEntries(templates.map((t) => [t.name, t])));
        if (Object.keys(normalized).length !== templates.length) throw fail(400, "Template names must be unique");
        const errors = Object.values(normalized).flatMap((t) => checkTemplate(t).map((e) => `${t.name}: ${e}`));
        if (Object.values(normalized).filter((t) => t.default).length > 1) errors.push("Only one template can be the default");
        if (templates.some((t) => !String(t.name ?? "").trim())) errors.push("Every template needs a name");
        if (errors.length) throw fail(400, errors.join("\n"));
        const value = Object.fromEntries(Object.values(normalized).map((t) => [t.name, serializeTemplate(t)]));
        await patchNote(this.vault, novel.configPath, { set: { "stat-templates": value }, baseMtime });
        const fresh = this.novels.get(novel.folder);
        for (const h of this.holders(fresh)) {
            const n = this.vault.notes.get(h.path);
            const cur = n?.fm["stat-template"];
            if (cur && renames[cur] && renames[cur] !== cur) await patchNote(this.vault, h.path, { set: { "stat-template": renames[cur] } });
        }
        return { templates: Object.keys(value) };
    }

    /** Give a data store creature base stats in a novel: <novel>/Creatures/<Creature> (<Novel>).md */
    async createCreature(novel, creature, templateName) {
        const p = this.vault.resolve(creature);
        if (!p) throw fail(404, `No creature ${creature}`);
        if (!this.templates(novel)[templateName]) throw fail(400, `No stat template "${templateName}" in ${novel.name}`);
        const existing = this.holders(novel).find((h) => h.kind === "creature" && h.creaturePath === p);
        if (existing) throw fail(409, `${linkLabel(creature)} already has stats in ${novel.name}`);
        const base = sanitizeName(`${this.vault.notes.get(p)?.name ?? linkLabel(creature)} (${novel.name})`);
        const rel = `${this.creaturesFolder(novel)}/${uniqueName(this.vault, base, "Stats")}.md`;
        await createNote(this.vault, rel, {
            type: "creature-stats", creature: `[[${this.vault.notes.get(p)?.name ?? linkLabel(creature)}]]`, novel: novel.name,
            "stat-template": templateName, "created-date": new Date().toISOString().slice(0, 10),
        });
        return rel;
    }

    /** For note pages: stats info of a character sheet or creature stat note */
    describeNote(p) {
        const novel = this.novels.get(p.split("/")[0]);
        if (!novel) return null;
        const holder = this.holders(novel).find((h) => h.path === p);
        if (!holder) return null;
        const templates = this.templates(novel);
        const template = templates[holder.template] ?? null;
        const out = { novel: novel.folder, holder, templates: Object.keys(templates), template };
        if (template) {
            const v = this.valuesAt(novel, holder, template);
            Object.assign(out, { values: v.values, origin: v.origin, managed: v.managed, problems: this.problems(template, v.values) });
        }
        return out;
    }

    /** Novels' creature stats for a data store creature note */
    creatureUses(p) {
        const out = [];
        for (const novel of this.novels.list()) for (const h of this.holders(novel)) if (h.kind === "creature" && h.creaturePath === p) out.push({ novel: novel.folder, novelName: novel.name, path: h.path, template: h.template });
        return out;
    }

    /** Quality check: holders whose current values break their template */
    qa() {
        const out = [];
        for (const novel of this.novels.list()) {
            const templates = this.templates(novel);
            for (const h of this.holders(novel)) {
                if (h.assigned && !templates[h.template]) { out.push({ novel: novel.folder, path: h.path, name: h.name, message: `Unknown stat template "${h.template}"` }); continue; }
                const t = templates[h.template];
                if (!t) continue;
                for (const m of this.problems(t, this.valuesAt(novel, h, t).values)) out.push({ novel: novel.folder, path: h.path, name: h.name, message: m });
            }
        }
        return out;
    }
}
