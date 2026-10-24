// Books meta viewer: browse and edit the Obsidian data store and novel ledgers in a web browser.
// Usage: node server.js [--vault <path>] [--port 4321] [--host 127.0.0.1]
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Vault, SCHEMA_NOTE } from "./lib/vault.js";
import { Novels } from "./lib/novels.js";
import { Blueprints } from "./lib/blueprints.js";
import { DataStore } from "./lib/datastore.js";
import { Plans } from "./lib/plans.js";
import { Stats } from "./lib/stats.js";
import { Worlds } from "./lib/worlds.js";
import { fromText, fieldNamed } from "./public/stats-core.js";
import { patchNote, trashNote } from "./lib/write.js";
import { renderMarkdown } from "./lib/render.js";
import { asCallout, renderTemplate } from "./lib/template.js";
import { foldStock } from "./lib/ledger.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const PORT = Number(arg("port", process.env.PORT ?? 4321));
const HOST = arg("host", process.env.BOOKS_HOST || "127.0.0.1");
const expand = (p) => path.resolve(String(p).replace(/^~(?=\/|$)/, os.homedir()));

// The vault folder: --vault, else the one chosen on the Settings page (settings.json), else BOOKS_VAULT from the
// service settings. Without one the app starts on its Settings page.
const SETTINGS_FILE = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "books-meta-viewer", "settings.json");
const readSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { return {}; } };
async function writeSettings(patch) {
    const next = { ...readSettings(), ...patch };
    await fsp.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2) + "\n");
}
const VAULT_SOURCES = [["--vault", arg("vault")], ["settings", readSettings().vault], ["BOOKS_VAULT", process.env.BOOKS_VAULT]];
const startSource = VAULT_SOURCES.find(([, v]) => v);
const isFolder = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

let vault = null, novels, blueprints, store, plans, stats, worlds;
let vaultSource = null, vaultProblem = null, epoch = 0;
const clients = new Set();
const version = () => epoch * 1e9 + (vault?.version ?? 0);
const broadcast = (paths) => { const msg = `data: ${JSON.stringify({ version: version(), paths })}\n\n`; for (const res of clients) res.write(msg); };
/** open a vault folder (closing the previous one) */
async function openVault(dir, source) {
    const next = new Vault(dir);
    await next.load();
    vault?.close();
    vault = next;
    novels = new Novels(vault);
    blueprints = new Blueprints(vault);
    store = new DataStore(vault, novels, blueprints);
    plans = new Plans(vault, novels, store);
    stats = new Stats(vault, novels, store);
    worlds = new Worlds(vault, store);
    novels.sheetHook = (novel, owner, set) => stats.sheetValues(novel, owner, set);
    vault.on("change", broadcast);
    vault.watch();
    vaultSource = source; vaultProblem = null; epoch++;
    broadcast([]);
}

const STATIC = {
    "/": ["public/index.html", "text/html"],
    "/app.js": ["public/app.js", "text/javascript"],
    "/style.css": ["public/style.css", "text/css"],
    "/outline.js": ["public/outline.js", "text/javascript"],
    "/stats-core.js": ["public/stats-core.js", "text/javascript"],
    "/map-core.js": ["public/map-core.js", "text/javascript"],
    "/world.js": ["public/world.js", "text/javascript"],
    "/map-editor.js": ["public/map-editor.js", "text/javascript"],
    "/map-raster.js": ["public/map-raster.js", "text/javascript"],
    "/map-paint-worker.js": ["public/map-paint-worker.js", "text/javascript"],
    "/fonts/newsreader-latin.woff2": ["public/fonts/newsreader-latin.woff2", "font/woff2"],
    "/vendor/preact.mjs": ["node_modules/preact/dist/preact.mjs", "text/javascript"],
    "/vendor/hooks.mjs": ["node_modules/preact/hooks/dist/hooks.mjs", "text/javascript"],
    "/vendor/htm.mjs": ["node_modules/htm/dist/htm.module.js", "text/javascript"],
};
const FILE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", pdf: "application/pdf" };


const send = (res, status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const need = (v, what) => { if (v == null || v === "") throw fail(400, `Missing ${what}`); return v; };
const found = (v, what) => { if (v == null) throw fail(404, `${what} not found`); return v; };

async function readBody(req, limit = 20 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > limit) throw fail(413, "Request too large"); chunks.push(c); }
    return Buffer.concat(chunks);
}
const json = async (req) => { const b = await readBody(req, 2 * 1024 * 1024); return b.length ? JSON.parse(b.toString("utf8")) : {}; };

function getNovel(folder) {
    const n = novels.get(need(folder, "novel"));
    if (!n || !novels.list().some((x) => x.folder === folder)) throw fail(404, `No novel ${folder}`);
    return n;
}
const ledgerAt = (p) => { const n = vault.notes.get(need(p, "ledger")); if (!n || n.fm.type !== "ledger") throw fail(404, `No ledger ${p}`); return novels.readLedger(n); };
const novelOfPath = (p) => getNovel(p.split("/")[0]);

/** Ledger entry + its computed callout, for API responses */
function entryOut(novel, ledger, e, placed) {
    return { ...e, ledger: ledger.path, ledgerName: ledger.name, owner: ledger.owner, type: ledger.type, callout: novels.callout(novel, ledger, e), placed: placed?.get(`${ledger.name.toLowerCase()}#${e.key}`)?.name ?? null };
}

// routes that work without a vault
const SETUP_ROUTES = new Set(["GET /api/settings", "POST /api/settings", "GET /api/settings/folders"]);
const routes = {
    "GET /api/settings": () => ({
        vault: vault?.root ?? null, source: vaultSource, notes: vault?.notes.size ?? 0, problem: vaultProblem,
        settingsFile: SETTINGS_FILE, overridden: vaultSource === "--vault",
        looksLikeVault: vault ? isFolder(path.join(vault.root, ".obsidian")) : false,
        hasSchema: vault ? vault.notes.has(SCHEMA_NOTE) : false,
    }),
    "POST /api/settings": async ({ req }) => {
        const b = await json(req);
        const dir = expand(need(b.vault, "vault"));
        if (!isFolder(dir)) throw fail(400, `Not a folder: ${dir}`);
        if (path.resolve(dir) === path.resolve(HERE) || HERE.startsWith(path.resolve(dir) + path.sep)) throw fail(400, "That folder holds this app; choose your Obsidian vault");
        await openVault(dir, "settings");
        await writeSettings({ vault: dir });
        console.log(`Vault switched to ${dir} (${vault.notes.size} notes)`);
        return { vault: dir, notes: vault.notes.size };
    },
    // sub folders of a folder, for the folder picker on the Settings page
    "GET /api/settings/folders": async ({ q }) => {
        const dir = expand(q.get("path") || vault?.root || os.homedir());
        if (!isFolder(dir)) throw fail(404, `Not a folder: ${dir}`);
        const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
        const folders = ents.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => ({ name: e.name, path: path.join(dir, e.name), vault: isFolder(path.join(dir, e.name, ".obsidian")) }))
            .sort((x, y) => x.name.localeCompare(y.name));
        return { path: dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), home: os.homedir(), vault: isFolder(path.join(dir, ".obsidian")), folders };
    },
    "GET /api/index": () => store.index(),
    "GET /api/note": ({ q }) => {
        const p = need(q.get("path"), "path");
        const page = found(store.page(p), "Note");
        return { ...page, plan: plans.describe(p), stats: stats.describeNote(p), creatureStats: page.collection === "Creatures" ? stats.creatureUses(p) : undefined };
    },
    "GET /api/blueprint": ({ q }) => blueprints.tree(need(q.get("item"), "item"), Number(q.get("count") ?? 1)),
    "GET /api/qa": () => ({ ...store.qa(), stats: stats.qa() }),
    "POST /api/render": async ({ req }) => ({ html: renderMarkdown((await json(req)).markdown ?? "", vault) }),

    "POST /api/note": async ({ req }) => {
        const b = await json(req);
        return { path: await store.create(need(b.collection, "collection"), need(b.name, "name"), b.fm ?? {}, b.body ?? "") };
    },
    "PATCH /api/note": async ({ req }) => {
        const b = await json(req);
        const p = need(b.path, "path");
        if (!vault.notes.has(p)) throw fail(404, "Note not found");
        const problems = stats.checkPatch(p, b.set ?? {});
        if (problems.length) throw fail(400, problems.join("\n"));
        const n = await patchNote(vault, p, { set: b.set ?? {}, unset: b.unset ?? [], body: b.body, baseMtime: b.baseMtime });
        await plans.afterPatch(p);
        return { path: p, mtime: vault.notes.get(p)?.mtime ?? n.mtime };
    },
    "DELETE /api/note": async ({ q }) => {
        const p = need(q.get("path"), "path");
        const n = found(vault.notes.get(p), "Note");
        if (p.startsWith("90. Templater/") || ["config", "ledger"].includes(n.fm.type)) throw fail(400, "This note can't be deleted here");
        const trashed = await trashNote(vault, p, q.get("baseMtime"));
        await plans.afterPatch(p);
        return { ok: true, trashed };
    },
    "POST /api/images": async ({ req, q }) => store.attachImage(need(q.get("path"), "path"), need(q.get("filename"), "filename"), await readBody(req)),

    // ---- novels
    "GET /api/novels": () => novels.list(),
    "GET /api/novel": ({ q }) => {
        const novel = getNovel(q.get("folder"));
        const ledgers = novels.ledgers(novel);
        const placed = novels.placedEntries(novel);
        return {
            ...novel, configMtime: vault.notes.get(novel.configPath)?.mtime ?? null, ledgerTypes: novels.ledgerTypes(novel), chapters: novels.chapters(novel).map((c) => ({ ...c, entries: ledgers.reduce((n, l) => n + l.entries.filter((e) => e.chapter === c.number).length, 0) })),
            latestChapter: novels.latestChapter(novel),
            characters: novels.characters(novel).map((n) => ({ path: n.path, name: n.name, fm: n.fm, cover: store.cover(n), mtime: n.mtime })),
            ledgers: ledgers.map((l) => ({ path: l.path, owner: l.owner, ownerPath: l.ownerPath, type: l.type, entries: l.entries.length, unplaced: l.entries.filter((e) => !placed.has(`${l.name.toLowerCase()}#${e.key}`)).length })),
            stores: [...new Set(ledgers.flatMap((l) => l.entries.flatMap((e) => e.lines.flatMap((x) => [x.store, x["to-store"]]))).filter(Boolean))].sort(),
            setFields: [...new Set(ledgers.flatMap((l) => l.entries.flatMap((e) => e.lines.map((x) => x.set))).filter(Boolean))].sort(),
        };
    },
    "GET /api/owner": ({ q }) => {
        const novel = getNovel(q.get("novel"));
        const owner = need(q.get("owner"), "owner");
        const at = q.get("at") ? Number(q.get("at")) : novels.latestChapter(novel);
        const compare = q.get("compare") ? Number(q.get("compare")) : null;
        const placed = novels.placedEntries(novel);
        const ownerPath = vault.resolve(owner);
        return {
            owner, ownerPath, sheet: ownerPath ? store.page(ownerPath) : null, at, compare, latestChapter: novels.latestChapter(novel),
            ledgers: novels.ownerLedgers(novel, owner).map((l) => ({
                path: l.path, type: l.type, mtime: l.mtime,
                entries: l.entries.map((e) => entryOut(novel, l, e, placed)),
                computed: novels.compute(novel, l, { at, compare, mode: q.get("mode") ?? "end" }),
            })),
        };
    },
    "GET /api/chapter": ({ q }) => {
        const novel = getNovel(q.get("novel"));
        const n = Number(need(q.get("n"), "chapter"));
        const placed = novels.placedEntries(novel);
        const entries = [];
        for (const l of novels.ledgers(novel)) for (const e of l.entries) if (e.chapter === n) entries.push(entryOut(novel, l, e, placed));
        entries.sort((a, b) => a.seq - b.seq);
        const chapter = novels.chapters(novel).find((c) => c.number === n) ?? null;
        const planNote = plans.chapterPlans(novel).get(n);
        const volumes = plans.volumes(novel);
        const volume = plans.volumeOf(volumes, n);
        const nums = plans.chapters(novel).map((c) => c.number);
        return {
            chapter, n, entries, copyAll: entries.map((e) => e.callout).join("\n\n"),
            plan: planNote ? { path: planNote.path, fm: planNote.fm, mtime: planNote.mtime } : null,
            volume: volume ? { path: volume.path, title: volume.title, label: plans.volumeLabel(volume) } : null,
            prev: nums.filter((x) => x < n).at(-1) ?? null, next: nums.find((x) => x > n) ?? null,
        };
    },
    "GET /api/callout": ({ q }) => {
        const ledger = ledgerAt(q.get("ledger"));
        const novel = novelOfPath(ledger.path);
        const e = found(ledger.entries.find((x) => x.key === q.get("key")), "Entry");
        const set = q.get("linked") ? novels.linkedSet(novel, ledger, e) : [{ ledger, entry: e }];
        return { text: set.map((x) => novels.callout(novel, x.ledger, x.entry)).join("\n\n"), count: set.length };
    },
    "POST /api/ledger/entry": async ({ req }) => {
        const b = await json(req);
        const novel = getNovel(b.novel);
        for (const c of b.createNotes ?? []) {
            const rel = await store.create(c.collection, c.name, c.fm ?? {});
            const final = path.posix.basename(rel, ".md");
            for (const l of b.entry.lines ?? []) if (l.item === `[[${c.name}]]` || l.item === c.name) l.item = `[[${final}]]`;
        }
        const problems = stats.checkLines(novel, b.owner, b.type, b.entry?.lines);
        if (problems.length) throw fail(400, problems.join("\n"));
        const r = await novels.saveEntry(novel, { owner: need(b.owner, "owner"), type: need(b.type, "type"), entry: b.entry, replaceKey: b.replaceKey, baseMtime: b.baseMtime, linked: b.linked ?? [] });
        const receivers = (b.entry.lines ?? []).filter((l) => l.action === "transfer-out" && l.to).map((l) => l.to.replace(/^\[\[|\]\]$/g, ""));
        const synced = [];
        for (const o of [b.owner, ...receivers]) { const s = await novels.syncSheet(novel, o); if (s) synced.push(s); }
        const set = novels.linkedSet(novel, r.ledger, r.entry);
        return { ledger: r.ledger.path, key: r.entry.key, callout: novels.callout(novel, r.ledger, r.entry), linkedCallout: set.map((x) => novels.callout(novel, x.ledger, x.entry)).join("\n\n"), synced };
    },
    "POST /api/ledger/preview": async ({ req }) => {
        const b = await json(req);
        const novel = getNovel(b.novel);
        const type = novels.ledgerTypes(novel)[b.type];
        if (!type) throw fail(400, `Unknown ledger type ${b.type}`);
        const existing = novels.ownerLedgers(novel, b.owner).find((l) => l.type === b.type);
        const ledger = existing ?? { path: "", name: `${b.owner} - ${b.type}`, owner: b.owner, type: b.type, entries: [] };
        const chapter = Number(b.entry.chapter);
        const seq = b.replaceKey ? Number(String(b.replaceKey).split(".")[1]) : novels.nextSeq(novel, chapter);
        const draft = { chapter, seq, key: `${chapter}.${seq}`, title: b.entry.title ?? "", fields: b.entry.fields ?? {}, lines: (b.entry.lines ?? []).filter((l) => l.item || l.set), body: b.entry.body ?? "", warnings: [] };
        const others = ledger.entries.filter((e) => e.key !== b.replaceKey);
        const out = { callout: asCallout(renderTemplate(novels.templateFor(novel, ledger, draft), novels.entryView(novel, ledger, draft))) };
        if (type.behaviour === "stock") {
            out.before = foldStock(vault, others, { until: chapter }).stacks;
            const after = foldStock(vault, [...others, draft], { until: chapter });
            out.after = after.stacks;
            out.warnings = foldStock(vault, [...others, draft]).warnings.filter((w) => !foldStock(vault, others).warnings.some((x) => x.message === w.message));
        }
        if (type.behaviour === "state") {
            out.warnings = stats.checkLines(novel, b.owner, b.type, draft.lines).map((message) => ({ message }));
            // previous values at this chapter (for prefilling) and the stats panel with this entry applied
            const holder = stats.holder(novel, b.owner);
            const template = holder && stats.templates(novel)[holder.template];
            if (template) {
                const before = stats.valuesAt(novel, holder, template, chapter - 1e-9);
                const after = { ...before.values };
                for (const l of draft.lines) { const f = !l.with && fieldNamed(template, l.set); if (f) after[f.key] = fromText(f, l.value); }
                out.stats = { template, before: before.values, panel: stats.panel(novel, holder, template, after, chapter) };
            }
        }
        return out;
    },
    "DELETE /api/ledger/entry": async ({ q }) => {
        const ledger = ledgerAt(q.get("ledger"));
        const novel = novelOfPath(ledger.path);
        await novels.deleteEntry(novel, ledger.path, need(q.get("key"), "key"), q.get("baseMtime"));
        await novels.syncSheet(novel, ledger.owner);
        return { ok: true };
    },
    // ---- world builder
    "GET /api/worlds": () => worlds.list(),
    "GET /api/world": ({ q }) => worlds.world(q.get("world") || null),
    "POST /api/world/location": async ({ req }) => {
        const b = await json(req);
        return { path: await worlds.createLocation({ world: b.world ?? null, parent: b.parent ?? null, name: need(b.name, "name"), scale: b.scale ?? "" }) };
    },
    "POST /api/world/move": async ({ req }) => {
        const b = await json(req);
        return worlds.move({ path: need(b.path, "path"), parent: b.parent ?? null, world: b.world, baseMtime: b.baseMtime });
    },
    "GET /api/map": ({ q }) => worlds.readMap(need(q.get("location"), "location")),
    "POST /api/map": async ({ req }) => {
        const b = JSON.parse((await readBody(req, 30 * 1024 * 1024)).toString("utf8") || "{}");
        return worlds.saveMap(need(b.location, "location"), b.doc, b.baseMtime);
    },
    "GET /api/stamps": () => ({ vault: worlds.vaultStamps() }),
    "GET /api/textures": () => worlds.textures(),
    "POST /api/textures": async ({ req }) => { const b = await json(req); return worlds.saveTextures(b.textures, b.baseMtime); },
    "POST /api/stamps": async ({ req, q }) => worlds.addStamp(need(q.get("filename"), "filename"), await readBody(req, 9 * 1024 * 1024), q.get("set") || "Pasted"),
    // ---- planning
    "GET /api/plan": ({ q }) => plans.overview(getNovel(q.get("novel"))),
    "POST /api/plan/chapter": async ({ req }) => {
        const b = await json(req);
        const n = Number(need(b.n, "chapter"));
        if (!Number.isFinite(n) || n < 0) throw fail(400, "Chapter must be a number");
        return plans.saveChapterPlan(getNovel(b.novel), n, { set: b.set ?? {}, baseMtime: b.baseMtime });
    },
    "POST /api/plan/volume": async ({ req }) => {
        const b = await json(req);
        const novel = getNovel(b.novel);
        const path = await plans.createVolume(novel, need(b.title, "title"), b.fm ?? {});
        await plans.syncVolumes(novel);
        return { path };
    },
    "POST /api/plan/plot": async ({ req }) => {
        const b = await json(req);
        return { path: await plans.createPlot(getNovel(b.novel), need(b.title, "title"), b.fm ?? {}) };
    },
    // ---- stats
    "GET /api/stats": ({ q }) => stats.view(getNovel(q.get("novel")), need(q.get("owner"), "owner"), { at: q.get("at") ? Number(q.get("at")) : undefined }),
    "POST /api/stats/view": async ({ req }) => {
        const b = await json(req);
        return stats.view(getNovel(b.novel), need(b.owner, "owner"), { at: b.at ?? undefined, template: b.template });
    },
    "GET /api/stats/novel": ({ q }) => {
        const novel = getNovel(q.get("novel"));
        return { templates: stats.templates(novel), holders: stats.holders(novel), configMtime: vault.notes.get(novel.configPath)?.mtime ?? null, creaturesFolder: stats.creaturesFolder(novel) };
    },
    "POST /api/stats/templates": async ({ req }) => {
        const b = await json(req);
        return stats.saveTemplates(getNovel(b.novel), b.templates ?? [], { baseMtime: b.baseMtime, renames: b.renames ?? {} });
    },
    "POST /api/stats/creature": async ({ req }) => {
        const b = await json(req);
        return { path: await stats.createCreature(getNovel(b.novel), need(b.creature, "creature"), need(b.template, "template")) };
    },
    "POST /api/character": async ({ req }) => {
        const b = await json(req);
        return { path: await novels.createCharacter(getNovel(b.novel), store.schema(), need(b.name, "name"), b.fm ?? {}) };
    },
    "POST /api/sync-sheets": async ({ q }) => {
        const novel = getNovel(q.get("novel"));
        const owners = new Set(novels.ledgers(novel).map((l) => l.owner));
        const out = [];
        for (const o of owners) { const s = await novels.syncSheet(novel, o); if (s) out.push(s); }
        return out;
    },
    "POST /api/promote-misc": async ({ req }) => {
        const b = await json(req);
        return store.promoteMisc(need(b.novel, "novel"), need(b.item, "item"), b.collection ?? "Items", b.fm ?? {});
    },
};

async function serveFile(res, rel) {
    const ext = path.extname(rel).slice(1).toLowerCase();
    if (!FILE_TYPES[ext]) throw fail(403, "Only images and PDFs are served");
    const abs = vault.abs(rel);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st?.isFile()) throw fail(404, "File not found");
    res.writeHead(200, { "content-type": FILE_TYPES[ext], "content-length": st.size, "cache-control": "max-age=60" });
    fs.createReadStream(abs).pipe(res);
}

// built-in map stamps (public/stamps), cached: they only change with the app
async function serveStamp(res, pathname) {
    const root = path.join(HERE, "public", "stamps");
    const abs = path.resolve(root, `.${decodeURIComponent(pathname.slice("/stamps".length))}`);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const type = ext === "json" ? "application/json" : FILE_TYPES[ext];
    if (!abs.startsWith(root + path.sep) || !type) throw fail(404, "Not found");
    const st = await fsp.stat(abs).catch(() => null);
    if (!st?.isFile()) throw fail(404, "Not found");
    res.writeHead(200, { "content-type": type, "content-length": st.size, "cache-control": ext === "json" ? "no-cache" : "max-age=86400" });
    fs.createReadStream(abs).pipe(res);
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
        if (req.method === "GET" && url.pathname === "/api/events") {
            res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
            res.write(`data: ${JSON.stringify({ version: version(), paths: [] })}\n\n`);
            clients.add(res);
            req.on("close", () => clients.delete(res));
            return;
        }
        if (req.method === "GET" && url.pathname.startsWith("/files/") && vault) return await serveFile(res, decodeURIComponent(url.pathname.slice(7)));
        if (req.method === "GET" && url.pathname.startsWith("/stamps/")) return await serveStamp(res, url.pathname);
        if (req.method === "GET" && STATIC[url.pathname]) {
            const [file, type] = STATIC[url.pathname];
            return send(res, 200, await fsp.readFile(path.join(HERE, file)), type);
        }
        const route = routes[`${req.method} ${url.pathname}`];
        if (!route) return send(res, 404, { error: "Not found" });
        if (!vault && !SETUP_ROUTES.has(`${req.method} ${url.pathname}`)) return send(res, 503, { error: "No vault folder chosen yet: open Settings", setup: true });
        if (req.method !== "GET" && req.headers["x-requested-with"] !== "books-meta-viewer") return send(res, 403, { error: "Missing request header" });
        const out = await route({ req, q: url.searchParams });
        send(res, 200, out ?? {});
    } catch (e) {
        if (!e.status) console.error(e);
        send(res, e.status ?? 500, { error: e.message });
    }
});

if (startSource) {
    const [source, value] = startSource;
    const dir = expand(value);
    if (isFolder(dir)) await openVault(dir, source);
    else { vaultProblem = `Vault folder not found: ${dir} (from ${source})`; console.error(`${vaultProblem}. Choose one on the Settings page.`); }
} else console.error("No vault folder set yet. Choose one on the Settings page.");
server.listen(PORT, HOST, () => {
    console.log(`Books meta viewer: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}  (${vault ? `vault: ${vault.root}, ${vault.notes.size} notes` : "no vault yet: open Settings"})`);
});
