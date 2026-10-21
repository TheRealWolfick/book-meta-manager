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
const check = (ok, label, detail = "") => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? `\n     ${detail}` : ""}`); };
{
    const doc = w.document;
    w.location.hash = "#/c/Items";
    await wait(900);
    // facets: picking a value greys out (not hides) values with no remaining items
    const countChips = () => doc.querySelectorAll(".facet .chip").length;
    const before = countChips();
    const pick = [...doc.querySelectorAll(".facet .chip")].find((c) => !c.classList.contains("off"));
    pick.click();
    await wait(300);
    check(countChips() === before && doc.querySelectorAll(".facet .chip.off").length > 0, "facet values stay listed and grey out", `${before} -> ${countChips()}`);
    pick.click();
    await wait(300);

    // grouping by a list field puts an item in every matching group
    const catBtn = () => [...doc.querySelectorAll(".groupbar button")].find((b) => b.textContent.trim() === "cat");
    catBtn().click();
    await wait(300);
    const groups = doc.querySelectorAll("section.group");
    const rows = doc.querySelectorAll("section.group tbody tr").length;
    const items = index.notes.filter((n) => n.collection === "Items");
    const expected = items.reduce((s, n) => s + Math.max(1, new Set([n.fm.cat ?? []].flat()).size), 0);
    check(groups.length > 1 && rows === expected, "group by cat splits into tables", `${groups.length} groups, ${rows} rows, expected ${expected}`);

    // columns: drag an edge to resize every table; hold a header to collapse; both persist in localStorage
    const pointer = (el, type, init = {}) => el.dispatchEvent(new (w.PointerEvent ?? w.MouseEvent)(type, { bubbles: true, cancelable: true, button: 0, ...init }));
    const handle = doc.querySelector("section.group th[data-col='cat'] .resizer");
    pointer(handle, "pointerdown", { clientX: 0 }); pointer(handle, "pointermove", { clientX: 210 }); pointer(handle, "pointerup", { clientX: 210 });
    await wait(200);
    const catIdx = [...doc.querySelectorAll("section.group th[data-col]")].findIndex((x) => x.dataset.col === "cat");
    const colWidths = [...doc.querySelectorAll("main table.coltable")].map((tb) => tb.querySelectorAll("col")[catIdx]?.style.width);
    check(colWidths.length > 2 && colWidths.every((x) => x === "210px") && w.localStorage.getItem("colWidths:Items")?.includes("210"),
        "resizing a column applies to all tables and is saved", colWidths.join(","));
    const header = doc.querySelector("section.group th[data-col='cat']");
    pointer(header, "pointerdown"); await wait(600); pointer(header, "pointerup"); header.click();
    await wait(200);
    check(doc.querySelectorAll("section.group th.collapsed[data-col='cat']").length === groups.length && JSON.parse(w.localStorage.getItem("colHidden:Items")).includes("cat"),
        "holding a header collapses the column in every table and is saved");
    doc.querySelector("section.group th[data-col='cat']").click();
    await wait(200);
    check(!doc.querySelector("th.collapsed") && w.localStorage.getItem("colHidden:Items") === "[]", "clicking a collapsed column shows it again");

    catBtn().click();
    await wait(300);
    check(!doc.querySelector("section.group h2"), "clicking the active group button ungroups");

    // link chips in the table open the drawer; nested links navigate inside it; back closes at the first page
    const chip = doc.querySelector("main table a.chip");
    chip.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    await wait(700);
    const drawerOpen = () => !!doc.querySelector(".drawer") && !doc.querySelector(".drawer-wrap.closing");
    check(drawerOpen() && w.location.hash === "#/c/Items", "table link opens the drawer");
    const nested = doc.querySelector(".drawer-body a.chip[href^='#/note/']");
    if (nested) {
        nested.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
        await wait(700);
        check(doc.querySelector(".drawer-crumb")?.textContent.trim() === "2 / 2", "nested link navigates inside the drawer");
        doc.querySelector(".drawer-head button").click();
        await wait(300);
        check(doc.querySelector(".drawer-crumb")?.textContent.trim() === "1 / 2", "back returns to the previous drawer page");
    }
    doc.querySelector(".drawer-head button").click();
    await wait(500);
    check(!doc.querySelector(".drawer"), "back on the first drawer page closes it");

    // notes are editable in place with a Save changes button
    const note = index.notes.find((n) => n.collection === "Items");
    w.location.hash = `#/note/${enc(note.path)}`;
    await wait(900);
    const label = [...doc.querySelectorAll(".formgrid label")].find((l) => l.textContent === "description");
    const ta = label?.nextElementSibling;
    const saveBtn = () => [...doc.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save changes");
    check(!!saveBtn()?.disabled, "Save changes is disabled until something changes");
    ta.value = "Smoke test description"; ta.dispatchEvent(new w.Event("input", { bubbles: true }));
    await wait(100);
    saveBtn().click();
    await wait(1000);
    const text = fs.readFileSync(`${COPY}/${note.path}`, "utf8");
    check(text.includes("Smoke test description") && saveBtn()?.disabled, "editing a note saves only through Save changes");
}
// planning: grand plan, chapters in the drawer with the outline editor, plots by grade
{
    const doc = w.document;
    const novelA = index.novels.find((n) => n.name === "Sample Novel");
    if (novelA) {
        const plan = await get(`/api/plan?novel=${enc(novelA.folder)}`);
        w.location.hash = `#/novel/${enc(novelA.folder)}`;
        await wait(900);
        const tab = (label) => [...doc.querySelectorAll(".tabs button")].find((b) => b.textContent.trim() === label);
        tab("Grand plan").click();
        await wait(300);
        const vols = doc.querySelectorAll("section.volume");
        check(vols.length >= plan.volumes.length && doc.querySelectorAll(".chapter-row").length === plan.chapters.length, "grand plan lists volumes and chapters",
            `${vols.length} volumes, ${doc.querySelectorAll(".chapter-row").length} rows / ${plan.chapters.length}`);

        const row = [...doc.querySelectorAll(".chapter-row")].find((r) => r.querySelector(".badge")?.textContent === "14");
        row.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
        await wait(900);
        check(/Chapter 14/.test(doc.querySelector(".drawer h1")?.textContent ?? "") && doc.querySelectorAll(".drawer .plan-row").length > 3, "chapter opens in the drawer with its plan");
        doc.querySelector(".drawer-head button[title='Close']").click();
        await wait(400);

        // plan a new chapter: Enter keeps the level, Tab makes a sub event
        const last = Math.max(...plan.chapters.filter((c) => !c.draft).map((c) => c.number));
        const planLink = [...doc.querySelectorAll("a.button")].find((a) => a.textContent.includes(`Plan chapter ${last + 1}`));
        planLink.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
        await wait(900);
        const rows = () => [...doc.querySelectorAll(".drawer .plan-row textarea")];
        const type = (el, text) => { el.focus(); el.value = text; el.dispatchEvent(new w.Event("input", { bubbles: true })); el.setSelectionRange(text.length, text.length); };
        const key = (el, k, init = {}) => el.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
        type(rows()[0], "Smoke event"); await wait(50);
        key(rows()[0], "Enter"); await wait(50);
        type(rows()[1], "Smoke sub event"); await wait(50);
        key(rows()[1], "Tab"); await wait(50);
        key(rows()[1], "Enter"); await wait(50);
        type(rows()[2], "Second sub"); await wait(50);
        check(rows().length === 3 && doc.querySelectorAll(".drawer .plan-row.lvl-1").length === 2, "outline editor: Enter keeps the indent, Tab indents");
        [...doc.querySelectorAll(".drawer button")].find((b) => b.textContent.trim() === "Save changes").click();
        await wait(1200);
        const planFile = `${COPY}/${novelA.folder}/Plan/Chapter Plans/Plan ${String(last + 1).padStart(3, "0")} (${novelA.name}).md`;
        const saved = fs.existsSync(planFile) ? fs.readFileSync(planFile, "utf8") : "";
        const vol = plan.volumes.find((v) => last + 1 >= v.start && last + 1 <= (v.end ?? Infinity));
        check(saved.includes("- Smoke event\n  \t- Smoke sub event\n  \t- Second sub") && (!vol || saved.includes(`volume: ${vol.label}`)),
            "saving a new chapter plan creates the plan note with its volume", saved.slice(0, 300));
        doc.querySelector(".drawer-head button[title='Close']").click();
        await wait(400);

        tab("Plots").click();
        await wait(400);
        const cards = doc.querySelectorAll(".plot-card");
        check(cards.length === plan.plots.length && doc.querySelectorAll(".plot-grade h2").length >= plan.ratings.length, "plots are listed by grade", `${cards.length} cards`);
        const sel = cards[0].querySelector("select");
        const target = plan.ratings.find((r) => r.path !== sel.value);
        const plotPath = plan.plots.find((p) => cards[0].querySelector(".plot-title").textContent === p.title)?.path;
        sel.value = target.path; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
        await wait(800);
        check(fs.readFileSync(`${COPY}/${plotPath}`, "utf8").includes(`rating: "${target.name === target.title ? `[[${target.name}]]` : `[[${target.name}|${target.title}]]`}"`), "changing a plot's grade saves its rating");
    }
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
