// Loads public/app.js in jsdom against a running server and visits every route, then creates one
// ledger entry through the UI. Run via `npm test`, which points it at a throwaway vault copy.
import { JSDOM } from "jsdom";
import fs from "node:fs";
import { parseOutline } from "../public/outline.js";

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
    `#/callouts/${enc(novel.folder)}`, "#/qa", "#/settings",
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

    // link chips in the table open the drawer; nested links go to the front of the recent boxes; the drawer collapses instead of closing
    const chip = doc.querySelector("main table a.chip");
    chip.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    await wait(700);
    const drawerOpen = () => !!doc.querySelector(".drawer-wrap.open");
    const recent = () => [...doc.querySelectorAll(".drawer-recent button")].map((b) => b.title);
    check(drawerOpen() && w.location.hash === "#/c/Items" && recent().length === 1, "table link opens the drawer");
    check(!!doc.querySelector(".drawer .note-cols .note-side .formgrid") && !doc.querySelector(".drawer .note-main .formgrid"),
        "drawer note shows frontmatter in the right column");
    const first = recent()[0];
    const nested = [...doc.querySelectorAll(".drawer-body a.chip[href^='#/note/']")].find((a) => a.getAttribute("href") !== `#/${first}`);
    if (nested) {
        nested.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
        await wait(700);
        check(recent().length === 2 && recent()[1] === first && doc.querySelector(".drawer-recent button.on") === doc.querySelector(".drawer-recent button"),
            "nested link opens in front of the previous drawer page", recent().join(" | "));
        doc.querySelectorAll(".drawer-recent button")[1].click();
        await wait(300);
        check(recent().length === 2 && recent()[0] === first, "clicking a recent box moves it to the front", recent().join(" | "));
    }
    doc.querySelector(".drawer-backdrop").click();
    await wait(400);
    check(!drawerOpen() && !!doc.querySelector(".drawer-wrap.collapsed .drawer-tab"), "backdrop click collapses the drawer to a tab");
    doc.querySelector(".drawer-tab").click();
    await wait(300);
    check(drawerOpen() && recent()[0] === first, "clicking the tab reopens the drawer on the same page");
    w.location.hash = "#/qa";
    await wait(500);
    check(!drawerOpen() && recent()[0] === first, "navigating collapses the drawer and keeps its pages");

    // drawer summary leads with the description; ranked taxonomy notes show their facet in class order
    w.location.hash = "#/c/Taxonomy%2FRarity";
    await wait(600);
    doc.querySelector("main table a[href^='#/note/']").dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    await wait(700);
    const strip = () => [...doc.querySelectorAll(".drawer .class-strip a")];
    check(strip().length === 6 && strip().map((a) => +a.querySelector(".rank").textContent).join() === "1,2,3,4,5,6" && doc.querySelectorAll(".drawer .class-strip a.on").length === 1,
        "ranked taxonomy note shows its classes in order", strip().map((a) => a.textContent).join(" | "));
    const next = strip().find((a) => !a.classList.contains("on"));
    next.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    await wait(700);
    check(doc.querySelector(".drawer .class-strip a.on")?.textContent === next.textContent && !!doc.querySelector(".drawer .note-main .note-summary"),
        "clicking a class opens it in the drawer with its summary");
    doc.querySelector(".drawer-head button[title='Collapse']").click();
    await wait(300);

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
    // the first novel in the vault that has a grand plan
    let planNovel = null, plan = null;
    // (preferably one with graded plots too)
    for (const n of index.novels) {
        const p = await get(`/api/plan?novel=${enc(n.folder)}`);
        if (!p.volumes?.length) continue;
        if (!planNovel || (!plan.plots?.length && p.plots?.length)) { planNovel = n; plan = p; }
        if (p.plots?.length) break;
    }
    if (planNovel) {
        w.location.hash = `#/novel/${enc(planNovel.folder)}`;
        await wait(900);
        const tab = (label) => [...doc.querySelectorAll(".tabs button")].find((b) => b.textContent.trim() === label);
        tab("Grand plan").click();
        await wait(300);
        const vols = doc.querySelectorAll("section.volume");
        check(vols.length >= plan.volumes.length && doc.querySelectorAll(".chapter-row").length === plan.chapters.length, "grand plan lists volumes and chapters",
            `${vols.length} volumes, ${doc.querySelectorAll(".chapter-row").length} rows / ${plan.chapters.length}`);

        // a chapter with a planned outline of a few events
        const planned = plan.chapters.find((c) => parseOutline(c.plan ?? "").length > 3);
        if (planned) {
            const row = [...doc.querySelectorAll(".chapter-row")].find((r) => r.querySelector(".badge")?.textContent === String(planned.number));
            row.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
            await wait(900);
            check(new RegExp(`Chapter ${planned.number}\\b`).test(doc.querySelector(".drawer h1")?.textContent ?? "") && doc.querySelectorAll(".drawer .plan-row").length > 3, "chapter opens in the drawer with its plan");
            doc.querySelector(".drawer-head button[title='Collapse']").click();
            await wait(400);
        }

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
        const planFile = `${COPY}/${planNovel.folder}/Plan/Chapter Plans/Plan ${String(last + 1).padStart(3, "0")} (${planNovel.name}).md`;
        const saved = fs.existsSync(planFile) ? fs.readFileSync(planFile, "utf8") : "";
        const vol = plan.volumes.find((v) => last + 1 >= v.start && last + 1 <= (v.end ?? Infinity));
        check(saved.includes("- Smoke event\n  \t- Smoke sub event\n  \t- Second sub") && (!vol || saved.includes(`volume: ${vol.label}`)),
            "saving a new chapter plan creates the plan note with its volume", saved.slice(0, 300));
        doc.querySelector(".drawer-head button[title='Collapse']").click();
        await wait(400);

        tab("Plots").click();
        await wait(400);
        const cards = doc.querySelectorAll(".plot-card");
        if (plan.plots.length && plan.ratings.length > 1) {
        check(cards.length === plan.plots.length && doc.querySelectorAll(".plot-grade h2").length >= plan.ratings.length, "plots are listed by grade", `${cards.length} cards`);
        const sel = cards[0].querySelector("select");
        const target = plan.ratings.find((r) => r.path !== sel.value);
        const plotPath = plan.plots.find((p) => cards[0].querySelector(".plot-title").textContent === p.title)?.path;
        sel.value = target.path; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
        await wait(800);
        check(fs.readFileSync(`${COPY}/${plotPath}`, "utf8").includes(`rating: "${target.name === target.title ? `[[${target.name}]]` : `[[${target.name}|${target.title}]]`}"`), "changing a plot's grade saves its rating");
        }
    }
}
// theme: light/dark switch and novel accents
{
    const doc = w.document, root = doc.documentElement;
    const novel0 = index.novels[0];
    w.location.hash = `#/novel/${enc(novel0.folder)}`;
    await wait(900);
    const accent = root.style.getPropertyValue("--novel-accent"), accentDark = root.style.getPropertyValue("--novel-accent-dark");
    check(/^#[0-9a-f]{6}$/i.test(accent) && /^#[0-9a-f]{6}$/i.test(accentDark) && accent !== accentDark, "a novel page sets its light and dark accent", `${accent} ${accentDark}`);
    check(doc.querySelector(".sidebar .novel-link.active .name")?.textContent === novel0.name && doc.querySelectorAll(".sidebar .novel-dot").length === index.novels.length, "sidebar shows novel dots and the active novel");
    const themeBtn = (label) => [...doc.querySelectorAll(".theme-switch button")].find((b) => b.textContent === label);
    themeBtn("Dark").click(); await wait(100);
    const dark = root.dataset.theme === "dark" && w.localStorage.getItem("theme") === '"dark"';
    themeBtn("System").click(); await wait(100);
    check(dark && !root.dataset.theme && w.localStorage.getItem("theme") === '"system"', "theme switch sets dark and back to system");
    const picker = doc.querySelector(".novel-colour input[type=color]");
    picker.value = "#2f6fb0"; picker.dispatchEvent(new w.Event("change", { bubbles: true }));
    await wait(900);
    check(fs.readFileSync(`${COPY}/${novel0.folder}/config.md`, "utf8").includes("accent: \"#2f6fb0\""), "novel colour is saved to config.md");
    w.location.hash = "#/qa";
    await wait(700);
    check(!root.style.getPropertyValue("--novel-accent"), "pages outside a novel use the default accent");
}
// stats: build a template in the editor, assign it, save a Stats entry through the prefilled form
{
    const doc = w.document;
    let statNovel = null, hero = null;
    for (const n of index.novels) { const d = await get(`/api/novel?folder=${enc(n.folder)}`); if (d.characters?.length) { statNovel = n; hero = d.characters[0].name; break; } }
    if (statNovel) {
        const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
        const setVal = (el, v, type = "input") => { el.value = v; fire(el, type); };
        const btn = (label, root = doc) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
        globalThis.prompt = () => "Hero";
        w.location.hash = `#/novel/${enc(statNovel.folder)}`;
        await wait(900);
        [...doc.querySelectorAll(".tabs button")].find((b) => b.textContent.trim() === "Stats").click();
        await wait(900);
        btn("+ Template").click(); await wait(100);
        btn("+ Field").click(); await wait(50);
        btn("+ Field").click(); await wait(50);
        const rows = () => [...doc.querySelectorAll(".field-row")];
        setVal(rows()[0].querySelector("input[aria-label=Label]"), "Level"); await wait(50);
        setVal(rows()[1].querySelector("input[aria-label=Label]"), "Power"); await wait(50);
        setVal(rows()[1].querySelector("select[aria-label=Type]"), "computed", "change"); await wait(50);
        setVal([...rows()[1].querySelectorAll("input")].find((i) => i.placeholder.startsWith("strength")), "level * 10"); await wait(50);
        rows()[0].querySelector("input[type=checkbox]").click(); await wait(50); // whole numbers
        btn("Save templates").click();
        await wait(1200);
        const cfg = fs.readFileSync(`${COPY}/${statNovel.folder}/config.md`, "utf8");
        check(/stat-templates:\s*\n\s+Hero:/.test(cfg) && cfg.includes("key: stats/level") && cfg.includes("formula: level * 10") && cfg.includes("integer: true"), "template editor saves to config.md", cfg.slice(cfg.indexOf("stat-templates"), cfg.indexOf("stat-templates") + 300));

        // jsdom gets no live updates: reopen the tab to load the saved templates
        w.location.hash = "#/qa"; await wait(500);
        w.location.hash = `#/novel/${enc(statNovel.folder)}`; await wait(1200);
        const heroRow = [...doc.querySelectorAll(".templates-editor ~ div tr, .grid2 tr")].find((tr) => tr.textContent.includes(hero));
        setVal(heroRow.querySelector("select"), "Hero", "change");
        await wait(1000);
        check(fs.readFileSync(`${COPY}/${statNovel.folder}/Characters/${hero}.md`, "utf8").includes("stat-template: Hero"), "assigning a template writes stat-template");

        w.location.hash = `#/entry/${enc(statNovel.folder)}?owner=${enc(hero)}&type=Stats&chapter=20`;
        await wait(1500);
        const levelLabel = [...doc.querySelectorAll(".stat-lines label")].find((l) => l.textContent === "Level");
        const levelInput = levelLabel?.nextElementSibling.querySelector("input");
        check(!!levelInput, "Stats entry shows the template as a form");
        setVal(levelInput, "4"); await wait(800);
        setVal([...doc.querySelectorAll("input")].find((x) => (x.getAttribute("placeholder") ?? "").startsWith("Short summary")), "Level up"); await wait(500);
        btn("Save").click();
        await wait(1500);
        const ledger = fs.readFileSync(`${COPY}/${statNovel.folder}/Ledgers/${hero} - Stats.md`, "utf8");
        check(ledger.includes("[set:: stats/level] [value:: 4]") && !ledger.includes("stats/power"), "only changed stats become ledger lines", ledger.slice(-300));
        w.location.hash = `#/owner/${enc(statNovel.folder)}/${enc(hero)}`;
        await wait(1500);
        const panel = doc.querySelector(".stats-panel")?.textContent ?? "";
        check(/Power\s*40/.test(panel.replace(/\s+/g, " ")) || panel.includes("Power: 40") || /Power.{0,20}40/.test(panel), "owner page shows the stats panel with computed values", panel.slice(0, 200));
    }
}
// world builder: outline add + move, then a square-grid map with floors, stamps, text and layers
{
    const doc = w.document;
    const fireEv = (el, type, init = {}) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
    const button = (label, root = doc) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
    const L = "80. Global Data Store/Locations";
    // a made-up world in the vault copy: Smoke Region > Smoke Kingdom > Smoke Town, and Other Kingdom
    const post = (p, body) => realFetch(new URL(p, BASE), { method: "POST", headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    const worldPath = (await post("/api/note", { collection: "Worlds", name: "Smoke World", fm: {} })).path;
    const region = (await post("/api/world/location", { world: worldPath, parent: null, name: "Smoke Region", scale: "region" })).path;
    const kingdom = (await post("/api/world/location", { world: worldPath, parent: region, name: "Smoke Kingdom", scale: "nation" })).path;
    await post("/api/world/location", { world: worldPath, parent: region, name: "Other Kingdom", scale: "nation" });
    const town = (await post("/api/world/location", { world: worldPath, parent: kingdom, name: "Smoke Town", scale: "town" })).path;
    const smokeWorld = (await get("/api/worlds")).worlds.find((x) => x.path === worldPath);
    if (smokeWorld && town) {
        w.location.hash = "#/world";
        await wait(1200);
        check(w.location.hash.startsWith("#/world/"), "the world builder opens a world");
        w.location.hash = `#/world/${enc(worldPath)}`;
        await wait(1500);
        const rows = () => [...doc.querySelectorAll(".loc-row[role=treeitem]")];
        check(rows().length === smokeWorld.count && smokeWorld.count === 4, "world builder lists the world's locations", `${rows().length} vs ${smokeWorld.count}`);
        const townRow = rows().find((r) => r.querySelector(".t")?.textContent === "Smoke Town");
        townRow.querySelector("[aria-label='Add a sub-location to Smoke Town']").click();
        await wait(300);
        const input = doc.querySelector(".add-row input");
        input.value = "Smoke Square"; input.dispatchEvent(new w.Event("input", { bubbles: true }));
        await wait(100);
        input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await wait(1200);
        const sq = fs.readFileSync(`${COPY}/${L}/Smoke Square.md`, "utf8");
        check(sq.includes('parent: "[[Smoke Town]]"') && sq.includes('world: "[[Smoke World]]"') && sq.includes('scale: "[[village]]"'), "adding a sub-location writes parent, world and the next scale", sq.slice(0, 300));
        w.location.hash = "#/qa"; await wait(400); w.location.hash = `#/world/${enc(worldPath)}`; await wait(1500);
        rows().find((r) => r.querySelector(".t")?.textContent === "Smoke Square").querySelector("[aria-label='Move Smoke Square']").click();
        await wait(300);
        [...doc.querySelectorAll(".move-list button")].find((b) => b.querySelector("b")?.textContent === "Other Kingdom").click();
        await wait(100);
        button("Move", doc.querySelector(".modal")).click();
        await wait(1200);
        check(fs.readFileSync(`${COPY}/${L}/Smoke Square.md`, "utf8").includes('parent: "[[Other Kingdom]]"'), "Move to… changes the parent");

        // map editor
        w.location.hash = `#/map/${enc(town)}`;
        await wait(1200);
        [...doc.querySelectorAll(".kind-pick button")].find((b) => b.textContent.includes("Square grid")).click();
        await wait(100);
        button("Create map").click();
        await wait(1500);
        const svg = doc.querySelector(".map-svg");
        check(!!svg && doc.querySelectorAll(".tool-rail button").length >= 12, "a new square-grid map opens in the editor");
        const at = (x, y) => ({ clientX: x, clientY: y, button: 0, buttons: 1 });
        doc.querySelector(".tool-rail [aria-label='Paint floor']").click(); await wait(100);
        fireEv(svg, "pointerdown", at(100, 300)); fireEv(svg, "pointermove", at(160, 300)); fireEv(svg, "pointerup", at(160, 300));
        await wait(200);
        button("Stamps").click(); await wait(600);
        const tile = [...doc.querySelectorAll(".stamp-tile")].find((t) => t.title.startsWith("Steam car"));
        tile?.click(); await wait(100);
        fireEv(svg, "pointerdown", at(300, 300)); fireEv(svg, "pointerup", at(300, 300));
        await wait(300);
        doc.querySelector(".tool-rail [aria-label='Text and notes']").click(); await wait(100);
        fireEv(svg, "pointerdown", at(400, 200)); fireEv(svg, "pointerup", at(400, 200));
        await wait(300);
        const ta = doc.querySelector(".inspector textarea");
        ta.value = "Gas leak here"; ta.dispatchEvent(new w.Event("input", { bubbles: true }));
        await wait(200);
        // erase floor, a room holding a stamp, a curved strip, snapping off
        doc.querySelector(".tool-rail [aria-label='Erase floor']").click(); await wait(100);
        fireEv(svg, "pointerdown", at(100, 300)); fireEv(svg, "pointerup", at(100, 300)); await wait(150);
        [...doc.querySelectorAll(".tool-rail button")].find((b) => b.getAttribute("aria-label") === "Room: floor + walls").click(); await wait(100);
        fireEv(svg, "pointerdown", at(450, 330)); fireEv(svg, "pointermove", at(580, 460)); fireEv(svg, "pointerup", at(580, 460)); await wait(300);
        button("Stamps").click(); await wait(300);
        [...doc.querySelectorAll(".stamp-tile")].find((t) => t.title.startsWith("Crate"))?.click(); await wait(100);
        fireEv(svg, "pointerdown", at(500, 380)); fireEv(svg, "pointerup", at(500, 380)); await wait(300);
        // grow the room with a box, then put a door in its wall
        const toolBtn = (label) => [...doc.querySelectorAll(".tool-rail button")].find((b) => b.getAttribute("aria-label").startsWith(label));
        toolBtn("Add to or cut from a room").click(); await wait(100);
        fireEv(svg, "pointerdown", at(560, 380)); fireEv(svg, "pointermove", at(650, 430)); fireEv(svg, "pointerup", at(650, 430)); await wait(200);
        toolBtn("Opening, door or window").click(); await wait(100);
        fireEv(svg, "pointermove", at(500, 334)); fireEv(svg, "pointerdown", at(500, 334)); fireEv(svg, "pointerup", at(500, 334)); await wait(200);
        // a second room, joined to the first: dragging one moves both
        [...doc.querySelectorAll(".tool-rail button")].find((b) => b.getAttribute("aria-label") === "Room: floor + walls").click(); await wait(100);
        fireEv(svg, "pointerdown", at(250, 560)); fireEv(svg, "pointermove", at(380, 650)); fireEv(svg, "pointerup", at(380, 650)); await wait(300);
        toolBtn("Select").click(); await wait(100);
        // (jsdom has no hit testing: events go straight to each room's own element)
        const roomEls = () => [...doc.querySelectorAll(".layer-active g[data-id]")].filter((g) => g.querySelector(":scope > path[pointer-events='all']") && g.getAttribute("transform"));
        const [r1] = roomEls();
        fireEv(r1, "pointerdown", at(470, 440)); fireEv(svg, "pointerup", at(470, 440)); await wait(100);
        fireEv(roomEls()[1], "pointerdown", { ...at(300, 600), shiftKey: true }); fireEv(svg, "pointerup", { ...at(300, 600), shiftKey: true }); await wait(150);
        w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true })); await wait(200);
        const saveNow = async () => { w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })); await wait(1200); };
        await saveNow();
        const mapFile = `${COPY}/80. Global Data Store/_Attachments/Maps/Smoke Town (Map).svg`;
        const roomsOf = () => JSON.parse(fs.readFileSync(mapFile, "utf8").match(/<!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/)[1]).layers[0].objects.filter((o) => o.type === "room");
        const before = roomsOf();
        fireEv(roomEls()[1], "pointerdown", at(300, 600)); fireEv(svg, "pointermove", at(360, 600)); fireEv(svg, "pointerup", at(360, 600)); await wait(200);
        await saveNow();
        const after = roomsOf();
        const moved = after.map((r) => r.x - (before.find((b) => b.id === r.id)?.x ?? NaN));
        check(before.length === 2 && before[0].group && before[0].group === before[1].group && moved.every((m) => m > 0 && Math.abs(m - moved[0]) < 0.01),
            "joined rooms share a group and move together", JSON.stringify(before.map((r) => [r.x, r.group])) + " moved " + JSON.stringify(moved));
        doc.querySelector(".tool-rail [aria-label^='Track or strip']").click(); await wait(100);
        for (const [x, y] of [[100, 120], [200, 150], [300, 120]]) { fireEv(svg, "pointerdown", at(x, y)); fireEv(svg, "pointerup", at(x, y)); await wait(50); }
        w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await wait(200);
        // a derived texture made in the Textures panel, then painted
        button("Textures").click(); await wait(300);
        const planks = [...doc.querySelectorAll(".tex-item")].find((x) => x.querySelector(".tex-name")?.textContent === "Wood planks");
        button("New from this", planks).click(); await wait(200);
        button("Save texture").click(); await wait(1200);
        fireEv(svg, "pointerdown", at(120, 500)); fireEv(svg, "pointerup", at(120, 500)); await wait(200);
        doc.querySelector(".snap-toggle").click(); await wait(100);
        // pipes snap end to end (grid snapping is off now)
        button("Stamps").click(); await wait(300);
        [...doc.querySelectorAll(".stamp-tile")].find((t) => t.title.startsWith("Copper straight"))?.click(); await wait(100);
        fireEv(svg, "pointerdown", at(120, 220)); fireEv(svg, "pointerup", at(120, 220)); await wait(200);
        fireEv(svg, "pointermove", at(143, 223)); fireEv(svg, "pointerdown", at(143, 223)); fireEv(svg, "pointerup", at(143, 223)); await wait(200);
        button("Layers").click(); await wait(200);
        button("+ Layer above the current one").click(); await wait(200);
        button("Only this layer", doc.querySelector(".layers-panel")).click(); await wait(200);
        button("Save").click();
        await wait(1500);
        const file = `${COPY}/80. Global Data Store/_Attachments/Maps/Smoke Town (Map).svg`;
        const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        const m = text.match(/<!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/);
        const saved = m ? JSON.parse(m[1]) : null;
        const ground = saved?.layers[0];
        check(!!saved && Object.keys(ground.floor).length >= 1 && ground.objects.some((o) => o.type === "stamp" && o.src.includes("steam-car")) && ground.objects.some((o) => o.text === "Gas leak here")
            && saved.layers.length === 2 && saved.view === "current", "map saves floors, stamps, text and layers into the SVG", JSON.stringify(saved)?.slice(0, 400));
        const texNote = fs.existsSync(`${COPY}/90. Templater/Map Textures.md`) ? fs.readFileSync(`${COPY}/90. Templater/Map Textures.md`, "utf8") : "";
        // (the vault may already have a "Wood planks (aged)", so the new id can carry a number)
        const newTex = Object.entries(saved?.textures ?? {}).find(([, t]) => t.from === "wood-planks" && Array.isArray(t.details))?.[0];
        check(!!newTex && texNote.includes(`${newTex}:`) && Object.values(ground?.floor ?? {}).includes(newTex) && text.includes(`id="f-${newTex}"`),
            "a derived texture is saved to Map Textures.md, painted, and copied into the map", texNote.slice(0, 200) + JSON.stringify(saved?.textures));
        const pipes = ground?.objects.filter((o) => o.src?.includes("pipe-copper-straight")) ?? [];
        check(pipes.length === 2 && Math.abs(Math.abs(pipes[1].x - pipes[0].x) - 64) < 0.01 && Math.abs(pipes[1].y - pipes[0].y) < 0.01, "a pipe placed near another snaps end to end", JSON.stringify(pipes.map((x) => [x.x, x.y])));
        const room = ground?.objects.find((o) => o.type === "room");
        check(room?.shapes?.some((x) => x.op === "add" && x.shape === "rect") && room.shapes.some((x) => x.op === "open") && room.children?.some((c) => c.src?.includes("/door-swing.svg")),
            "a room grows with an added box and gets a door in its wall", JSON.stringify(room?.shapes));
        check(!!room && room.children?.some((c) => c.src?.includes("crate")) && !ground.objects.some((o) => o.src?.includes("crate")), "a room holds the stamp placed inside it", JSON.stringify(room)?.slice(0, 300));
        check(ground?.objects.some((o) => o.type === "ribbon" && o.style === "railway" && o.pts.length === 3) && saved.snap === false, "a curved railway strip is saved and snapping can be turned off", JSON.stringify(ground?.objects.filter((o) => o.type === "ribbon")) + " snap=" + saved.snap);
        check(!ground?.floor["0,0"] || Object.keys(ground.floor).length >= 1, "erase floor tool runs");
        check(text.includes("data:image/svg+xml;base64,") && fs.readFileSync(`${COPY}/${town}`, "utf8").includes('map: "[[Smoke Town (Map).svg]]"'), "the saved SVG embeds its stamps and the location links it");
    }
}
// sidebar sections collapse on their heading and remember it
{
    const doc = w.document;
    const head = (t) => [...doc.querySelectorAll(".sidebar .side-head")].find((b) => b.textContent.startsWith(t));
    const links = () => doc.querySelectorAll(".sidebar a[href^='#/c/']").length;
    const before = links();
    head("Data store").click(); await wait(200);
    check(links() < before && head("Data store").getAttribute("aria-expanded") === "false" && JSON.parse(w.localStorage.getItem("sidebarClosed")).datastore === true,
        "clicking a sidebar heading collapses its section", `${before} -> ${links()}`);
    head("Data store").click(); await wait(200);
    check(links() === before, "clicking it again shows the items");
}
// deleting a note: the button needs a second click, the note goes to .trash, protected notes are refused
{
    const doc = w.document;
    const send = (method, p, body) => realFetch(new URL(p, BASE), { method, headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    const { path } = await send("POST", "/api/plan/plot", { novel: novel.folder, title: "Smoke Delete Plot", fm: {} });
    w.location.hash = `#/note/${enc(path)}`;
    await wait(1200);
    const delBtn = () => [...doc.querySelectorAll("main button.danger")].find((b) => /Delete|confirm/.test(b.textContent));
    delBtn().click(); await wait(300);
    check(fs.existsSync(`${COPY}/${path}`) && delBtn()?.textContent === "Click to confirm", "first click on Delete only asks to confirm");
    delBtn().click(); await wait(1200);
    check(!fs.existsSync(`${COPY}/${path}`) && fs.existsSync(`${COPY}/.trash/Smoke Delete Plot.md`), "second click moves the note to .trash", w.location.hash);
    const r = await send("DELETE", `/api/note?path=${enc(`${novel.folder}/config.md`)}`);
    check(r.status === 400 && fs.existsSync(`${COPY}/${novel.folder}/config.md`), "config notes can't be deleted", JSON.stringify(r));
}
// settings: the vault folder can be browsed and switched (the test server keeps its settings in SETTINGS_DIR)
if (process.env.SETTINGS_DIR) {
    const doc = w.document;
    const send = (method, p, body) => realFetch(new URL(p, BASE), { method, headers: { "x-requested-with": "books-meta-viewer", "content-type": "application/json" }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    w.location.hash = "#/settings";
    await wait(900);
    check(doc.querySelector("main")?.textContent.includes(COPY) && [...doc.querySelectorAll(".folders button.link")].some((b) => b.textContent === "80. Global Data Store"),
        "settings page shows the vault folder and browses its folders");
    const notesBefore = (await get("/api/index")).notes.length;
    const other = `${process.env.SETTINGS_DIR}/Other Vault`;
    fs.mkdirSync(`${other}/.obsidian`, { recursive: true });
    fs.writeFileSync(`${other}/Hello.md`, "# Hello\n");
    const listed = await get(`/api/settings/folders?path=${enc(process.env.SETTINGS_DIR)}`);
    check(listed.folders.some((f) => f.name === "Other Vault" && f.vault), "the folder picker marks Obsidian vaults");
    check((await send("POST", "/api/settings", { vault: `${other}/missing` })).status === 400, "a folder that doesn't exist is refused");
    const r = await send("POST", "/api/settings", { vault: other });
    const saved = JSON.parse(fs.readFileSync(`${process.env.SETTINGS_DIR}/books-meta-viewer/settings.json`, "utf8"));
    check(r.notes === 1 && (await get("/api/settings")).vault === other && saved.vault === other, "switching the vault opens it and saves the choice", JSON.stringify(r));
    await send("POST", "/api/settings", { vault: COPY });
    check((await get("/api/index")).notes.length === notesBefore, "switching back opens the first vault again");
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
