// Seed a vault with the structure World Builder needs: the data store schema and ledger types, every collection
// folder, and a basic taxonomy (rarity, item condition, ratings, location scales, units, genres, elements…).
// Optionally scaffolds a novel and a world. Never overwrites: anything that already exists is left alone.
//
//   node scripts/seed.js <vault folder> [--novel "Name"] [--number 3] [--world "Name"] [--no-taxonomy] [--dry-run]
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault, DS, SCHEMA_NOTE, LEDGER_TYPES_NOTE } from "../lib/vault.js";
import { Novels } from "../lib/novels.js";
import { Blueprints } from "../lib/blueprints.js";
import { DataStore } from "../lib/datastore.js";
import { createNote } from "../lib/write.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.join(HERE, "..", "seed");
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const flag = (n) => args.includes(`--${n}`);
const target = args.find((a, i) => !a.startsWith("--") && !["--novel", "--number", "--world"].includes(args[i - 1]));
if (!target || flag("help")) {
    console.log(`Usage: node scripts/seed.js <vault folder> [--novel "Name"] [--number N] [--world "Name"] [--no-taxonomy] [--dry-run]`);
    process.exit(target ? 0 : 2);
}
const ROOT = path.resolve(target.replace(/^~(?=\/)/, process.env.HOME));
const DRY = flag("dry-run");
const done = [];
const say = (what) => { done.push(what); console.log(`${DRY ? "would " : ""}${what}`); };

async function ensureDir(rel) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) return;
    say(`create folder ${rel}/`);
    if (!DRY) await fsp.mkdir(abs, { recursive: true });
}
async function copySeed(rel) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) return console.log(`keep ${rel} (already there)`);
    say(`add ${rel}`);
    if (!DRY) { await fsp.mkdir(path.dirname(abs), { recursive: true }); await fsp.copyFile(path.join(SEED, rel), abs); }
}

if (!fs.existsSync(ROOT)) { say(`create the vault folder ${ROOT}`); if (!DRY) await fsp.mkdir(ROOT, { recursive: true }); }

// 1. shared definitions (fields of every collection, ledger types and their callouts)
await copySeed(SCHEMA_NOTE);
await copySeed(LEDGER_TYPES_NOTE);

// 2. one flat folder per collection, as the schema lists them
const schemaText = fs.readFileSync(fs.existsSync(path.join(ROOT, SCHEMA_NOTE)) ? path.join(ROOT, SCHEMA_NOTE) : path.join(SEED, SCHEMA_NOTE), "utf8");
const schema = JSON.parse(schemaText.match(/```json\n([\s\S]*?)```/)[1]);
for (const c of Object.keys(schema.collections)) await ensureDir(`${DS}/${c}`);
await ensureDir(`${DS}/_Attachments`);

// the app's own index of the vault, so names stay unique the way Obsidian resolves links
const vault = new Vault(ROOT);
if (fs.existsSync(ROOT)) await vault.load();
const novels = new Novels(vault);
const store = new DataStore(vault, novels, new Blueprints(vault));
const existing = (collection, title) => vault.inFolder(`${DS}/${collection}`).some((n) => [n.name, n.fm.title].some((t) => String(t ?? "").toLowerCase() === title.toLowerCase()));
async function addNote(collection, title, fm) {
    if (existing(collection, title)) return null;
    say(`add ${collection}: ${title}`);
    if (DRY) return `${DS}/${collection}/${title}.md`;
    return store.create(collection, title, fm);
}

// 3. basic taxonomy
if (!flag("no-taxonomy")) {
    const tax = JSON.parse(fs.readFileSync(path.join(SEED, "taxonomy.json"), "utf8"));
    for (const [facet, def] of Object.entries(tax)) {
        for (const v of def.values) {
            await addNote(`Taxonomy/${facet}`, v.title, {
                type: def.type, facet,
                ...(def.ordered ? { ordered: true, class: v.class } : {}),
                ...(v.description ? { description: v.description } : {}),
            });
        }
    }
}

// 4. a novel: "<N>. <Name>" with its folders and config, plus its Taxonomy/Novels note
const novelName = opt("novel");
if (novelName) {
    const used = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).map((d) => /^(\d+)\.\s/.exec(d)?.[1]).filter(Boolean).map(Number) : [];
    const existingFolder = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).find((d) => d.replace(/^\d+\.\s+/, "").toLowerCase() === novelName.toLowerCase()) : null;
    let number = Number(opt("number")) || 1;
    if (!opt("number")) while (used.includes(number)) number++;
    if (number >= 20) { console.error("Novel numbers must be below 20 (folders 80. and 90. are the data store and templates)"); process.exit(2); }
    const folder = existingFolder ?? `${number}. ${novelName}`;
    for (const d of ["Chapters", "Characters", "Ledgers", "Creatures", "Plots", "Plan/Book Plan", "Plan/Chapter Plans"]) await ensureDir(`${folder}/${d}`);
    if (!fs.existsSync(path.join(ROOT, folder, "config.md"))) {
        say(`add ${folder}/config.md`);
        if (!DRY) await createNote(vault, `${folder}/config.md`, { type: "config", blueprints: false, "contains-system": false },
            "Settings for this novel (World Builder and Templater read the frontmatter).\n");
    }
    await addNote("Taxonomy/Novels", novelName, { type: "novel", facet: "Novels", folder });
}

// 5. a world
const worldName = opt("world");
if (worldName) await addNote("Worlds", worldName, novelName ? { novels: [`[[${novelName}]]`] } : {});

console.log(done.length ? `\n${DRY ? "Dry run: " : ""}${done.length} change${done.length === 1 ? "" : "s"} in ${ROOT}` : `\nNothing to do: ${ROOT} already has everything.`);
