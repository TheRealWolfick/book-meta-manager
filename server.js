// Books meta viewer: browse and edit the Obsidian data store and novel ledgers in a web browser.
// Usage: node server.js [--vault <path>] [--port 4321] [--host 127.0.0.1]
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "./lib/vault.js";
import { Novels } from "./lib/novels.js";
import { Blueprints } from "./lib/blueprints.js";
import { DataStore } from "./lib/datastore.js";
import { Plans } from "./lib/plans.js";
import { patchNote } from "./lib/write.js";
import { renderMarkdown } from "./lib/render.js";
import { asCallout, renderTemplate } from "./lib/template.js";
import { foldStock } from "./lib/ledger.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const VAULT = path.resolve(arg("vault", process.env.BOOKS_VAULT ?? path.join(process.env.HOME, "Documents/Obsidian/books")));
const PORT = Number(arg("port", process.env.PORT ?? 4321));
const HOST = arg("host", "127.0.0.1");

const vault = new Vault(VAULT);
const novels = new Novels(vault);
const blueprints = new Blueprints(vault);
const store = new DataStore(vault, novels, blueprints);
const plans = new Plans(vault, novels, store);

const STATIC = {
    "/": ["public/index.html", "text/html"],
    "/app.js": ["public/app.js", "text/javascript"],
    "/style.css": ["public/style.css", "text/css"],
    "/outline.js": ["public/outline.js", "text/javascript"],
    "/fonts/newsreader-latin.woff2": ["public/fonts/newsreader-latin.woff2", "font/woff2"],
    "/vendor/preact.mjs": ["node_modules/preact/dist/preact.mjs", "text/javascript"],
    "/vendor/hooks.mjs": ["node_modules/preact/hooks/dist/hooks.mjs", "text/javascript"],
    "/vendor/htm.mjs": ["node_modules/htm/dist/htm.module.js", "text/javascript"],
};
const FILE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", pdf: "application/pdf" };

const clients = new Set();
vault.on("change", (paths) => {
    const msg = `data: ${JSON.stringify({ version: vault.version, paths })}\n\n`;
    for (const res of clients) res.write(msg);
});

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

const routes = {
    "GET /api/index": () => store.index(),
    "GET /api/note": ({ q }) => {
        const p = need(q.get("path"), "path");
        return { ...found(store.page(p), "Note"), plan: plans.describe(p) };
    },
    "GET /api/blueprint": ({ q }) => blueprints.tree(need(q.get("item"), "item"), Number(q.get("count") ?? 1)),
    "GET /api/qa": () => store.qa(),
    "POST /api/render": async ({ req }) => ({ html: renderMarkdown((await json(req)).markdown ?? "", vault) }),

    "POST /api/note": async ({ req }) => {
        const b = await json(req);
        return { path: await store.create(need(b.collection, "collection"), need(b.name, "name"), b.fm ?? {}, b.body ?? "") };
    },
    "PATCH /api/note": async ({ req }) => {
        const b = await json(req);
        const p = need(b.path, "path");
        if (!vault.notes.has(p)) throw fail(404, "Note not found");
        const n = await patchNote(vault, p, { set: b.set ?? {}, unset: b.unset ?? [], body: b.body, baseMtime: b.baseMtime });
        await plans.afterPatch(p);
        return { path: p, mtime: vault.notes.get(p)?.mtime ?? n.mtime };
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
        return out;
    },
    "DELETE /api/ledger/entry": async ({ q }) => {
        const ledger = ledgerAt(q.get("ledger"));
        const novel = novelOfPath(ledger.path);
        await novels.deleteEntry(novel, ledger.path, need(q.get("key"), "key"), q.get("baseMtime"));
        await novels.syncSheet(novel, ledger.owner);
        return { ok: true };
    },
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

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
        if (req.method === "GET" && url.pathname === "/api/events") {
            res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
            res.write(`data: ${JSON.stringify({ version: vault.version, paths: [] })}\n\n`);
            clients.add(res);
            req.on("close", () => clients.delete(res));
            return;
        }
        if (req.method === "GET" && url.pathname.startsWith("/files/")) return await serveFile(res, decodeURIComponent(url.pathname.slice(7)));
        if (req.method === "GET" && STATIC[url.pathname]) {
            const [file, type] = STATIC[url.pathname];
            return send(res, 200, await fsp.readFile(path.join(HERE, file)), type);
        }
        const route = routes[`${req.method} ${url.pathname}`];
        if (!route) return send(res, 404, { error: "Not found" });
        if (req.method !== "GET" && req.headers["x-requested-with"] !== "books-meta-viewer") return send(res, 403, { error: "Missing request header" });
        const out = await route({ req, q: url.searchParams });
        send(res, 200, out ?? {});
    } catch (e) {
        if (!e.status) console.error(e);
        send(res, e.status ?? 500, { error: e.message });
    }
});

await vault.load();
vault.watch();
server.listen(PORT, HOST, () => {
    console.log(`Books meta viewer: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}  (vault: ${VAULT}, ${vault.notes.size} notes)`);
});
