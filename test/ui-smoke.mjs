// Loads public/app.js in jsdom against a running server and visits every route, then creates one
// ledger entry through the UI. Run via `npm test`, which points it at a throwaway vault copy.
import { JSDOM } from "jsdom";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:4398";
const COPY = process.env.VAULT_COPY;
if (!COPY) throw new Error("Run through `npm test` so writes go to a vault copy");

const dom = new JSDOM(`<!doctype html><body><div id="app"></div></body>`, { url: `${BASE}/`, pretendToBeVisual: true });
const w = dom.window;
const errors = [];
for (const k of ["window", "document", "location", "localStorage", "navigator", "history", "HTMLElement", "Node", "Event", "CustomEvent",
    "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "confirm", "prompt"]) {
    Object.defineProperty(globalThis, k, { value: k === "window" ? w : w[k], configurable: true, writable: true });
}
globalThis.addEventListener = w.addEventListener.bind(w);
globalThis.removeEventListener = w.removeEventListener.bind(w);
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(new URL(u, BASE), o);
globalThis.EventSource = class { };
w.console.error = console.error = (...a) => errors.push(a.map(String).join(" "));
process.on("unhandledRejection", (e) => errors.push(`unhandled: ${e?.stack ?? e}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
const get = (p) => realFetch(new URL(p, BASE)).then((r) => r.json());

// pick real data to visit
const index = await get("/api/index");
const novelWithLedgers = [];
for (const n of index.novels) { const d = await get(`/api/novel?folder=${enc(n.folder)}`); if (d.ledgers?.length) novelWithLedgers.push(d); }
const novel = novelWithLedgers[0] ?? (await get(`/api/novel?folder=${enc(index.novels[0].folder)}`));
const owner = novel.ledgers[0]?.owner ?? novel.characters[0]?.name;
const firstOf = (c) => index.notes.find((n) => n.collection === c)?.path;
const recipe = firstOf("Recipes");
const itemWithRecipe = index.notes.find((n) => n.collection === "Items" && n.fm.recipe)?.path;

await import("../public/app.js");
await wait(600);
const routes = [
    "#/", "#/c/Items", `#/c/${enc("Taxonomy/Genres")}`, "#/c/Locations",
    itemWithRecipe && `#/note/${enc(itemWithRecipe)}`, recipe && `#/note/${enc(recipe)}`,
    `#/edit/${enc(firstOf("Items"))}`, "#/new/Items", `#/newchar/${enc(novel.folder)}`,
    `#/novel/${enc(novel.folder)}`, owner && `#/owner/${enc(novel.folder)}/${enc(owner)}`,
    `#/chapter/${enc(novel.folder)}/${novel.latestChapter}`, `#/entry/${enc(novel.folder)}?owner=${enc(owner ?? "")}&type=Inventory`,
    `#/callouts/${enc(novel.folder)}`, "#/qa",
].filter(Boolean);

let failed = 0;
for (const r of routes) {
    const before = errors.length;
    w.location.hash = r;
    await wait(900);
    const main = w.document.querySelector("main");
    const text = (main?.textContent ?? "").replace(/\s+/g, " ").trim();
    const err = w.document.querySelector(".error")?.textContent;
    const ok = !err && !/Loading…$/.test(text) && errors.length === before;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${decodeURIComponent(r).slice(0, 100)}${err ? `\n     error: ${err}` : ""}`);
    for (const e of errors.slice(before)) console.log(`     console: ${e.slice(0, 300)}`);
}

// create an entry through the editor
if (owner) {
    const fire = (el, type, init = {}) => el.dispatchEvent(new (type.startsWith("key") ? w.KeyboardEvent : w.Event)(type, { bubbles: true, ...init }));
    const setVal = (el, v) => { el.value = v; fire(el, "input"); };
    w.location.hash = `#/entry/${enc(novel.folder)}?owner=${enc(owner)}&type=Inventory&chapter=999`;
    await wait(1200);
    const doc = w.document;
    setVal([...doc.querySelectorAll("input")].find((x) => (x.getAttribute("placeholder") ?? "").startsWith("Short summary")), "Smoke test entry");
    const item = doc.querySelector(".lines-editor input[placeholder^='Item']");
    fire(item, "focus"); setVal(item, "smoke test widget"); await wait(50); fire(item, "keydown", { key: "Enter" }); await wait(50);
    await wait(700);
    [...doc.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save").click();
    await wait(1200);
    const ledgerFile = `${COPY}/${novel.ledgersFolder}/${owner} - Inventory.md`;
    const saved = fs.existsSync(ledgerFile) && fs.readFileSync(ledgerFile, "utf8").includes("Smoke test entry");
    if (!saved) failed++;
    console.log(`${saved ? "ok  " : "FAIL"} create entry through the editor`);
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
