// One-off: restructure novel plans for the plan manager.
//   - volumes (Plan/Book Plan): type, title, number (was arc-name), file named after the title
//   - chapter plans (Plan/Chapter Plans): type, normalised `plan` outline, files named "Plan 014 (<Novel>)",
//     `volume` text written from the volume ranges
//   - plots (Plots): type, `plot` filled from the body where it was empty (bodies are left as they are)
//   - Plan.base views: arc-name -> number; Data Store Schema gets a `plans` section
// Usage: node scripts/migrate-plans.js [vault] [--write]   (dry run without --write)
import fsp from "node:fs/promises";
import path from "node:path";
import { Vault, SCHEMA_NOTE } from "../lib/vault.js";
import { Novels } from "../lib/novels.js";
import { Blueprints } from "../lib/blueprints.js";
import { DataStore } from "../lib/datastore.js";
import { Plans, PLAN_DEFAULTS, padChapter } from "../lib/plans.js";
import { patchNote, atomicWrite, uniqueName } from "../lib/write.js";
import { normalizeOutline } from "../public/outline.js";

const VAULT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? path.join(process.env.HOME, "Documents/Obsidian/books");
const write = process.argv.includes("--write");
const vault = new Vault(VAULT);
await vault.load();
const novels = new Novels(vault);
const store = new DataStore(vault, novels, new Blueprints(vault));
const plans = new Plans(vault, novels, store);
const log = (...a) => console.log(write ? "" : "[dry]", ...a);

async function patch(rel, set, unset = []) {
    const n = vault.notes.get(rel);
    const real = Object.fromEntries(Object.entries(set).filter(([k, v]) => JSON.stringify(n.fm[k] ?? "") !== JSON.stringify(v ?? "")));
    const gone = unset.filter((k) => k in n.fm);
    if (!Object.keys(real).length && !gone.length) return;
    log("patch", rel, JSON.stringify(real).slice(0, 160), gone.length ? `unset ${gone}` : "");
    if (write) await patchNote(vault, rel, { set: real, unset: gone });
}

async function rename(rel, name, label) {
    const folder = path.posix.dirname(rel);
    if (path.posix.basename(rel, ".md") === name) return rel;
    // free the old name first so a note can keep its own name
    const target = `${folder}/${uniqueName(vault, name, label)}.md`;
    if (target === rel) return rel;
    log("rename", rel, "->", target);
    if (!write) return rel;
    await fsp.rename(vault.abs(rel), vault.abs(target));
    vault.notes.delete(rel);
    await vault.loadFile(target);
    vault.rebuildNames();
    return target;
}

for (const novel of novels.list()) {
    const f = plans.folders(novel);
    const vols = vault.inFolder(f.volumes), chaps = vault.inFolder(f.chapters), plots = vault.inFolder(f.plots);
    if (!vols.length && !chaps.length && !plots.length) continue;
    console.log(`\n== ${novel.folder}`);

    // volumes: the chapter plans' "N - Title" text names the volume they sit in
    for (const v of vols) {
        const start = Number(v.fm["chapter-start"]), end = Number(v.fm["chapter-end"]);
        const named = chaps.filter((c) => Number(c.fm.chapter) >= start && Number(c.fm.chapter) <= end).map((c) => /^(\d+)\s*-\s*(.+)$/.exec(String(c.fm.volume ?? ""))).filter(Boolean);
        const counts = new Map();
        for (const m of named) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const m = top && /^(\d+)\s*-\s*(.+)$/.exec(top);
        const title = m?.[2] ?? String(v.fm.title || v.name);
        const number = Number(v.fm.number ?? v.fm["arc-name"] ?? m?.[1]) || "";
        await patch(v.path, { type: "volume", title, number, description: v.fm.description ?? "", plan: normalizeOutline(v.fm.plan ?? "") }, ["arc-name"]);
        await rename(v.path, title, PLAN_DEFAULTS.volumes.label);
    }

    // chapter plans
    for (const c of chaps) {
        const n = Number(c.fm.chapter);
        if (!Number.isFinite(n) || c.fm.chapter === "" || c.fm.chapter == null) { console.log("  skipped (no chapter number):", c.path); continue; }
        const unset = ["ordered"];
        if (String(c.fm.title ?? "") === String(n)) unset.push("title");
        await patch(c.path, { type: "chapter-plan", plan: normalizeOutline(c.fm.plan ?? "") }, unset);
        await rename(c.path, `Plan ${padChapter(n)} (${novel.name})`, PLAN_DEFAULTS.chapters.label);
    }
    if (write) for (const p of await plans.syncVolumes(novel)) log("volume text", p);

    // plots
    for (const p of plots) {
        const set = { type: "plot" };
        if (!String(p.fm.plot ?? "").trim() && p.body.trim()) set.plot = p.body.trim();
        await patch(p.path, set);
    }

    // Plan.base: volumes are ordered by `number`
    const base = `${novel.folder}/Plan.base`;
    const text = await fsp.readFile(vault.abs(base), "utf8").catch(() => null);
    if (text?.includes("arc-name")) {
        log("update", base);
        if (write) await atomicWrite(vault, base, text.replace("note.arc-name:\n    displayName: arc-order", "note.number:\n    displayName: volume").replace("      - arc-name\n", "      - number\n"));
    }
}

// Templater scaffold base and schema
const scaffold = "90. Templater/Templates/Novel Scaffold/Plan.base";
const st = await fsp.readFile(vault.abs(scaffold), "utf8").catch(() => null);
if (st?.includes("arc-name")) {
    log("update", scaffold);
    if (write) await atomicWrite(vault, scaffold, st.replace("note.arc-name:\n    displayName: arc-order", "note.number:\n    displayName: volume").replace("      - arc-name\n", "      - number\n"));
}
const schemaNote = vault.notes.get(SCHEMA_NOTE);
const json = schemaNote?.body.match(/```json\n([\s\S]*?)\n```/)?.[1];
if (json && !JSON.parse(json).plans) {
    const schema = { ...JSON.parse(json), plans: PLAN_DEFAULTS };
    log("schema: add plans section");
    const doc = "- **plans** — fields of each novel's plan notes (volumes in `Plan/Book Plan`, chapter plans in `Plan/Chapter Plans`, plots in `Plots`). Link targets starting with `@` are folders of the novel itself. Plan text lives in frontmatter (`plan`, `plot`) so bases can show it.\n";
    let body = schemaNote.body.replace(json, JSON.stringify(schema, null, 1));
    body = body.replace(/(- \*\*characters\*\*[^\n]*\n)/, `$1${doc}`);
    if (write) await patchNote(vault, SCHEMA_NOTE, { body });
}
console.log(write ? "\ndone" : "\ndry run: pass --write to apply");
