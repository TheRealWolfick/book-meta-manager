// Books meta viewer front end: Preact + htm, no build step.
import { h, render } from "preact";
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import htm from "htm";
import { parseOutline, serializeOutline } from "./outline.js";
import { WorldView } from "./world.js";
import { MapEditor } from "./map-editor.js";
import { FIELD_TYPES, normalizeTemplates, checkTemplate, checkValue, fromText, toText, parseResource, computeValues, displayValue, defaultKey, fieldId, namesField, fieldNamed } from "./stats-core.js";

const html = htm.bind(h);

// ------------------------------------------------------------------ API + live updates

async function asJson(r) {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d;
}
const api = {
    get: (url) => fetch(url).then(asJson),
    send: (method, url, body, raw) => fetch(url, {
        method,
        headers: { "x-requested-with": "books-meta-viewer", ...(raw ? {} : { "content-type": "application/json" }) },
        body: raw ?? JSON.stringify(body ?? {}),
    }).then(asJson),
};
const qs = (o) => Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

let vaultVersion = 0;
const versionListeners = new Set();
new EventSource("/api/events").onmessage = (e) => {
    vaultVersion = JSON.parse(e.data).version;
    versionListeners.forEach((f) => f(vaultVersion));
};
function useVersion() {
    const [v, setV] = useState(vaultVersion);
    useEffect(() => { versionListeners.add(setV); return () => versionListeners.delete(setV); }, []);
    return v;
}
/** Fetch JSON, refetching whenever the vault changes */
function useApi(url) {
    const v = useVersion();
    const [state, set] = useState({ data: null, error: null });
    useEffect(() => {
        if (!url) return;
        let live = true;
        api.get(url).then((d) => live && set({ data: d, error: null })).catch((e) => live && set((s) => ({ data: s.data, error: e.message })));
        return () => { live = false; };
    }, [url, v]);
    return state;
}

// ------------------------------------------------------------------ helpers

const linkLabel = (v) => {
    const m = String(v ?? "").match(/^!?\[\[([^\]]+)\]\]$/);
    if (!m) return String(v ?? "");
    const [t, alias] = m[1].split("|");
    return (alias ?? t.split("#")[0].split("/").pop()).trim();
};
const isLink = (v) => typeof v === "string" && /^!?\[\[[^\]]+\]\]$/.test(v.trim());
const toLink = (name) => `[[${name}]]`;
const asList = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]);
const noteHref = (p) => `#/note/${encodeURIComponent(p)}`;
const collectionLabel = (c) => c?.replace(/^Taxonomy\//, "") ?? "";
const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ------------------------------------------------------------------ theme: light / dark / system, novel accents

const THEMES = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];
function applyTheme(mode) {
    if (mode === "light" || mode === "dark") document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
}
// Default colour per novel (by position in the novel list) until config.md sets `accent`
const NOVEL_PALETTE = ["#3D7A5A", "#2F6FB0", "#B03A5B", "#8A4FB8", "#A6621B", "#5E6B78", "#2E7F86", "#7A6A2E", "#B5482F", "#4A5DB0"];
const novelColour = (index, folder) => {
    const i = index?.novels.findIndex((n) => n.folder === folder) ?? -1;
    if (i < 0) return null;
    const own = index.novels[i].accent;
    return /^#[0-9a-f]{6}$/i.test(String(own ?? "")) ? own : NOVEL_PALETTE[i % NOVEL_PALETTE.length];
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mixHex = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const luminance = (hex) => {
    const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
/** Nudge a colour toward black (light theme) or white (dark theme) until text in it reads at 4.5:1 on every surface */
function readableAccent(hex, dark) {
    const panel = dark ? "#27262c" : "#f0eee9"; // --panel-2, the surface closest to the accent
    let c = dark ? mixHex(hex, "#ffffff", 0.3) : hex;
    for (let i = 0; i < 24 && contrast(c, panel) < 4.6; i++) c = mixHex(c, dark ? "#ffffff" : "#000000", 0.08);
    return c;
}
function applyNovelAccent(hex) {
    const st = document.documentElement.style;
    if (!hex) { st.removeProperty("--novel-accent"); st.removeProperty("--novel-accent-dark"); return; }
    st.setProperty("--novel-accent", readableAccent(hex, false));
    st.setProperty("--novel-accent-dark", readableAccent(hex, true));
}

let toastTimer;
/** Short message in the corner; `action` {label, run} adds a button (e.g. Undo) and keeps it up longer */
function toast(msg, action) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.append(el); }
    el.textContent = msg;
    if (action) {
        const b = Object.assign(document.createElement("button"), { textContent: action.label, className: "toast-action" });
        b.onclick = () => { el.style.display = "none"; action.run(); };
        el.append(b);
    }
    el.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = "none"; }, action ? 6000 : 2200);
}
async function copyText(text, label = "Copied to clipboard") {
    try { await navigator.clipboard.writeText(text); toast(label); }
    catch {
        const ta = Object.assign(document.createElement("textarea"), { value: text });
        document.body.append(ta); ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        toast(ok ? label : "Copy failed: select the text manually");
    }
}

// ------------------------------------------------------------------ router

function useRoute() {
    const [hash, setHash] = useState(location.hash);
    useEffect(() => { const f = () => setHash(location.hash); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
    const [path, query] = hash.replace(/^#\/?/, "").split("?");
    const parts = path.split("/").map(decodeURIComponent);
    return { name: parts[0] || "home", args: parts.slice(1), params: new URLSearchParams(query ?? "") };
}
const go = (href) => { location.hash = href; };

// ------------------------------------------------------------------ unsaved edits

const dirtyForms = new Map(); // `${scope}:${path}` -> true
const markDirty = (scope, path, dirty) => { if (dirty) dirtyForms.set(`${scope}:${path}`, true); else dirtyForms.delete(`${scope}:${path}`); };
const hasDirty = (scope) => [...dirtyForms.keys()].some((k) => k.startsWith(`${scope}:`));
const confirmDiscard = (scope) => !hasDirty(scope) || confirm("Discard unsaved changes?");
addEventListener("beforeunload", (e) => { if (dirtyForms.size) e.preventDefault(); });

// ------------------------------------------------------------------ side drawer (note and chapter links in tables and inside the drawer)

// the five most recent drawer pages (hrefs #/note/… or #/chapter/…), newest first; recent[0] is shown.
// The drawer never closes: it collapses to a tab on the right edge and stays mounted, so unsaved edits survive navigation.
const DRAWER_RECENT = 5;
let drawer = { recent: [], open: false };
const drawerListeners = new Set();
const setDrawer = (d) => { drawer = d; drawerListeners.forEach((f) => f(d)); };
function useDrawer() {
    const [d, set] = useState(drawer);
    useEffect(() => { drawerListeners.add(set); return () => drawerListeners.delete(set); }, []);
    return d;
}
function collapseDrawer() { if (drawer.open) setDrawer({ ...drawer, open: false }); }
function expandDrawer() { if (drawer.recent.length && !drawer.open) setDrawer({ ...drawer, open: true }); }
// opening a page moves it to the front of the recent list (a known page moves up, others shift right)
function openInDrawer(href) {
    if (drawer.recent[0] === href) return expandDrawer();
    if (!confirmDiscard("drawer")) return;
    setDrawer({ recent: [href, ...drawer.recent.filter((h) => h !== href)].slice(0, DRAWER_RECENT), open: true });
}
// Note and chapter links inside a [data-drawer] container open in the drawer; [data-page] links and modified clicks don't
document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href^="#/note/"], a[href^="#/chapter/"]');
    if (!a || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || a.hasAttribute("data-page") || !a.closest("[data-drawer]")) return;
    e.preventDefault();
    openInDrawer(a.getAttribute("href"));
});
addEventListener("keydown", (e) => { if (e.key === "Escape" && drawer.open && !document.querySelector(".lightbox")) collapseDrawer(); });

// a deleted note leaves the recent list; the drawer collapses when nothing is left
function dropFromDrawer(href) {
    const recent = drawer.recent.filter((h) => h !== href);
    setDrawer({ recent, open: drawer.open && recent.length > 0 });
}

const parseDrawerHref = (href) => href.replace(/^#\//, "").split("/").map(decodeURIComponent);
function drawerLabel(href, index) {
    const [name, ...args] = parseDrawerHref(href);
    if (name === "chapter") return `Chapter ${args[1]}`;
    const path = args.join("/");
    const n = index?.notes.find((x) => x.path === path);
    return n?.fm.title || n?.name || path.split("/").pop().replace(/\.md$/, "");
}

function Drawer({ index }) {
    const d = useDrawer();
    if (!d.recent.length) return null;
    const href = d.recent[0];
    const [name, ...args] = parseDrawerHref(href);
    const label = (h) => drawerLabel(h, index);
    return html`<div class=${`drawer-wrap ${d.open ? "open" : "collapsed"}`}>
        <div class="drawer-backdrop" onClick=${collapseDrawer} />
        <button class="drawer-tab" title=${`Open drawer: ${label(href)}`} onClick=${expandDrawer} tabIndex=${d.open ? -1 : 0}><span>${label(href)}</span></button>
        <aside class="drawer" data-drawer inert=${!d.open}>
            <div class="drawer-head">
                <div class="drawer-recent">${d.recent.map((h, i) => html`<button key=${h} class=${i ? "" : "on"} title=${h.replace(/^#\//, "")}
                    onClick=${() => openInDrawer(h)}>${label(h)}</button>`)}</div>
                <button onClick=${() => { collapseDrawer(); go(href); }}>Open page</button>
                <button title="Collapse" onClick=${collapseDrawer}>»</button>
            </div>
            <div class="drawer-body" key=${href}>${name === "chapter"
                ? html`<${ChapterView} folder=${args[0]} n=${args[1]} scope="drawer" />`
                : html`<${NoteView} index=${index} path=${args.join("/")} scope="drawer" />`}</div>
        </aside>
    </div>`;
}

// ------------------------------------------------------------------ animations

let flipPaused = false; // set while dragging a column edge
const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; } };
/**
 * FLIP animation for keyed children ([data-flip]) of a container: rows that stay slide from their old
 * position, new rows fade in. Call on every render; positions are measured after each commit.
 */
function useFlip() {
    const ref = useRef();
    const last = useRef(new Map());
    useLayoutEffect(() => {
        const root = ref.current;
        if (!root) return;
        const els = [...root.querySelectorAll("[data-flip]")];
        const now = new Map(els.map((el) => [el.dataset.flip, el.getBoundingClientRect()]));
        const prev = last.current;
        last.current = now;
        if (!prev.size || flipPaused || reducedMotion() || typeof Element.prototype.animate !== "function") return;
        for (const el of els) {
            const a = prev.get(el.dataset.flip), b = now.get(el.dataset.flip);
            if (!a) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" }); continue; }
            const dx = a.left - b.left, dy = a.top - b.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
            if (Math.abs(dy) > innerHeight * 1.5) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 }); continue; }
            el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" });
        }
    });
    return ref;
}

// ------------------------------------------------------------------ index context (data store listing)

function useIndex(enabled = true) {
    const { data } = useApi(enabled ? "/api/index" : null);
    return useMemo(() => {
        if (!data) return null;
        const byName = new Map();
        for (const n of data.notes) {
            byName.set(n.name.toLowerCase(), n);
            for (const a of asList(n.fm.aliases)) if (!byName.has(String(a).toLowerCase())) byName.set(String(a).toLowerCase(), n);
        }
        const inCollection = (c) => data.notes.filter((n) => n.collection === c);
        return { ...data, byName, inCollection, resolve: (v) => byName.get(linkLabel(v).toLowerCase()) ?? null };
    }, [data]);
}

// ------------------------------------------------------------------ small components

/** Destructive button: the first click arms it ("Click to confirm"), a second click within a few seconds runs it */
function ConfirmButton({ onConfirm, children, confirmLabel = "Click to confirm", class: cls = "small", ...rest }) {
    const [armed, setArmed] = useState(false);
    const timer = useRef();
    useEffect(() => () => clearTimeout(timer.current), []);
    const disarm = () => { clearTimeout(timer.current); setArmed(false); };
    const click = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!armed) { setArmed(true); clearTimeout(timer.current); timer.current = setTimeout(() => setArmed(false), 4000); return; }
        disarm();
        onConfirm();
    };
    return html`<button class=${`${cls} danger ${armed ? "armed" : ""}`} onClick=${click} onBlur=${disarm} ...${rest}>${armed ? confirmLabel : children}</button>`;
}

function Chip({ value, links, index, onRemove }) {
    if (!isLink(value)) return html`<span class="chip">${String(value)}${onRemove && html`<span class="x" onClick=${onRemove}>×</span>`}</span>`;
    const resolved = links ? links[value] : index?.resolve(value) ? { path: index.resolve(value).path } : undefined;
    const label = linkLabel(value);
    if (resolved === null || (links == null && !resolved)) return html`<span class="chip unresolved" title="No note with this name">${label}${onRemove && html`<span class="x" onClick=${onRemove}>×</span>`}</span>`;
    return html`<a class="chip" href=${noteHref(resolved.path)}>${label}${onRemove && html`<span class="x" onClick=${(e) => { e.preventDefault(); onRemove(); }}>×</span>`}</a>`;
}

function Value({ v, links, index }) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return html`<span class="muted">—</span>`;
    if (Array.isArray(v)) return html`${v.map((x) => html`<${Chip} value=${x} links=${links} index=${index} />`)}`;
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (typeof v === "object") return html`<code>${JSON.stringify(v)}</code>`;
    if (isLink(v)) return html`<${Chip} value=${v} links=${links} index=${index} />`;
    return String(v);
}

function Html({ html: content, class: cls = "md" }) {
    return html`<div class=${cls} dangerouslySetInnerHTML=${{ __html: content }} />`;
}

function Loading({ error }) {
    return error ? html`<p class="error">${error}</p>` : html`<p class="muted">Loading…</p>`;
}

/** Text input with suggestions; picks one value */
function Picker({ value, options, onChange, placeholder, allowFree = true, onCreate, createLabel = "Create", autoFocus }) {
    const [text, setText] = useState(value ?? "");
    const [open, setOpen] = useState(false);
    const [hl, setHl] = useState(0);
    useEffect(() => setText(value ?? ""), [value]);
    const matches = useMemo(() => {
        const t = text.trim().toLowerCase();
        const list = t ? options.filter((o) => o.label.toLowerCase().includes(t)) : options;
        return list.slice(0, 14);
    }, [text, options]);
    const exact = options.some((o) => o.label.toLowerCase() === text.trim().toLowerCase());
    const choose = (o) => { onChange(o); setText(o ? o.label : ""); setOpen(false); };
    const commitFree = () => { if (allowFree && text.trim() && text !== value) onChange({ label: text.trim(), free: true }); };
    return html`<div class="picker">
        <input value=${text} placeholder=${placeholder} autoFocus=${autoFocus}
            onInput=${(e) => { setText(e.target.value); setOpen(true); setHl(0); }}
            onFocus=${() => setOpen(true)} onBlur=${() => setTimeout(() => { setOpen(false); commitFree(); }, 150)}
            onKeyDown=${(e) => {
                if (e.key === "ArrowDown") { setHl((x) => Math.min(x + 1, matches.length - 1)); e.preventDefault(); }
                if (e.key === "ArrowUp") { setHl((x) => Math.max(x - 1, 0)); e.preventDefault(); }
                if (e.key === "Enter") { e.preventDefault(); if (open && matches[hl]) choose(matches[hl]); else commitFree(); }
                if (e.key === "Escape") setOpen(false);
            }} />
        ${open && (matches.length > 0 || (onCreate && text.trim() && !exact)) && html`<div class="results">
            ${matches.map((o, i) => html`<a class=${i === hl ? "hl" : ""} onMouseDown=${(e) => { e.preventDefault(); choose(o); }}><span>${o.label}</span><span class="muted">${o.hint ?? ""}</span></a>`)}
            ${onCreate && text.trim() && !exact && html`<a onMouseDown=${(e) => { e.preventDefault(); setOpen(false); onCreate(text.trim()); }}><span>${createLabel} “${text.trim()}”</span><span class="muted">new</span></a>`}
        </div>`}
    </div>`;
}

/** Multi or single link field editor backed by a data store folder */
function LinkField({ value, multiple, target, index, onChange, options: given }) {
    const computed = useMemo(() => (given ? null : ((target ? index?.inCollection(target) : index?.notes) ?? []).map((n) => ({ label: n.name, hint: n.fm.title !== n.name ? n.fm.title : "" }))), [index, target, given]);
    const options = given ?? computed;
    const values = asList(value);
    const add = async (o) => {
        if (!o) return;
        let name = o.label;
        // "@plots" style targets are novel folders: free text just links by name
        if (o.free && !index.resolve(name) && target && !target.startsWith("@")) {
            if (!confirm(`Create “${name}” in ${collectionLabel(target)}?`)) return;
            const r = await api.send("POST", "/api/note", { collection: target, name });
            name = r.path.split("/").pop().replace(/\.md$/, "");
        }
        onChange(multiple ? [...values.filter((v) => linkLabel(v) !== name), toLink(name)] : toLink(name));
    };
    return html`<div>
        ${multiple && html`<div>${values.map((v) => html`<${Chip} value=${v} index=${index} onRemove=${() => onChange(values.filter((x) => x !== v))} />`)}</div>`}
        <${Picker} value=${multiple ? "" : linkLabel(value ?? "")} options=${options} onChange=${add} placeholder=${target ? `Search ${collectionLabel(target.replace(/^@/, ""))}…` : "Search notes…"} />
    </div>`;
}

// ------------------------------------------------------------------ layout

const route0 = () => location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];

// Sidebar sections collapse on a click of their heading; closed ones are remembered (Taxonomy starts closed)
function SideSection({ id, title, closed, toggle, children }) {
    const open = !closed[id];
    return html`<section class=${`side-section ${open ? "open" : ""}`}>
        <h4><button class="side-head" aria-expanded=${open} onClick=${() => toggle(id)}>${title}<span class="caret" aria-hidden="true">▸</span></button></h4>
        ${open && html`<div class="side-items">${children}</div>`}
    </section>`;
}

function Sidebar({ index, novelFolder }) {
    const active = (href) => (location.hash === href ? "active" : "");
    const [closed, setClosed] = useState(() => store.get("sidebarClosed", { taxonomy: !store.get("showTax", false) }));
    const toggle = (id) => { const c = { ...closed, [id]: !closed[id] }; setClosed(c); store.set("sidebarClosed", c); };
    const [theme, setThemeState] = useState(store.get("theme", "system"));
    const setTheme = (m) => { setThemeState(m); store.set("theme", m); applyTheme(m); };
    if (!index) return html`<nav class="sidebar"><div class="brand">Books Meta Viewer</div>
        <div class="side-section"><a class=${active("#/settings")} href="#/settings"><span>Settings</span></a></div></nav>`;
    const cols = Object.keys(index.schema.collections);
    const main = cols.filter((c) => !c.startsWith("Taxonomy/"));
    const tax = cols.filter((c) => c.startsWith("Taxonomy/"));
    const section = (id, title, items) => html`<${SideSection} id=${id} title=${title} closed=${closed} toggle=${toggle}>${items}<//>`;
    return html`<nav class="sidebar">
        <div class="brand"><a href="#/" style="padding:0">Books Meta Viewer</a></div>
        ${section("novels", "Novels", index.novels.map((n) => html`<a class=${`novel-link ${n.folder === novelFolder ? "active" : ""}`} href=${`#/novel/${encodeURIComponent(n.folder)}`}>
            <span class="novel-dot" style=${`--dot:${novelColour(index, n.folder)}`} aria-hidden="true" /><span class="name">${n.name}</span><span class="count">${n.number}</span></a>`))}
        <a class=${`side-pill ${route0() === "world" || route0() === "map" ? "active" : ""}`} href="#/world">World builder<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg></a>
        ${section("datastore", "Data store", main.map((c) => html`<a class=${active(`#/c/${encodeURIComponent(c)}`)} href=${`#/c/${encodeURIComponent(c)}`}><span>${c}</span><span class="count">${index.counts[c] ?? 0}</span></a>`))}
        ${section("taxonomy", "Taxonomy", tax.map((c) => html`<a class=${active(`#/c/${encodeURIComponent(c)}`)} href=${`#/c/${encodeURIComponent(c)}`}><span>${collectionLabel(c)}</span><span class="count">${index.counts[c] ?? 0}</span></a>`))}
        ${section("tools", "Tools", html`<a class=${active("#/qa")} href="#/qa"><span>Quality checks</span></a><a class=${active("#/settings")} href="#/settings"><span>Settings</span></a>`)}
        <div class="theme-switch" role="group" aria-label="Theme">${THEMES.map(([m, label]) => html`<button class=${theme === m ? "on" : ""} aria-pressed=${theme === m} onClick=${() => setTheme(m)}>${label}</button>`)}</div>
    </nav>`;
}

function Search({ index }) {
    const [q, setQ] = useState("");
    const [hl, setHl] = useState(0);
    const results = useMemo(() => {
        const t = q.trim().toLowerCase();
        if (!t || !index) return [];
        return index.notes.filter((n) => n.name.toLowerCase().includes(t) || String(n.fm.title ?? "").toLowerCase().includes(t)).slice(0, 20);
    }, [q, index]);
    const open = (n) => { setQ(""); go(noteHref(n.path)); };
    return html`<div class="search">
        <input placeholder="Search the data store…" value=${q} onInput=${(e) => { setQ(e.target.value); setHl(0); }}
            onKeyDown=${(e) => { if (e.key === "ArrowDown") setHl(Math.min(hl + 1, results.length - 1)); if (e.key === "ArrowUp") setHl(Math.max(hl - 1, 0)); if (e.key === "Enter" && results[hl]) open(results[hl]); if (e.key === "Escape") setQ(""); }} />
        ${results.length > 0 && html`<div class="results">${results.map((n, i) => html`<a class=${i === hl ? "hl" : ""} href=${noteHref(n.path)} onClick=${() => setQ("")}><span>${n.name}</span><span class="muted">${collectionLabel(n.collection)}</span></a>`)}</div>`}
    </div>`;
}

function NovelFilter({ index, value, onChange }) {
    if (!index) return null;
    return html`<label class="row muted">Novel
        <select value=${value} onChange=${(e) => onChange(e.target.value)}>
            <option value="">All novels</option>
            ${index.novels.map((n) => html`<option value=${n.name}>${n.name}</option>`)}
        </select></label>`;
}

// ------------------------------------------------------------------ home

function Home({ index }) {
    if (!index) return html`<${Loading} />`;
    const cols = Object.keys(index.schema.collections).filter((c) => !c.startsWith("Taxonomy/"));
    return html`<div>
        <h1>Books Meta Viewer</h1>
        <p class="muted">${index.notes.length} data store notes across ${cols.length} collections.</p>
        <div class="cards">
            ${cols.map((c) => html`<a class="card" href=${`#/c/${encodeURIComponent(c)}`}><div class="body"><h3>${c}</h3><p>${index.counts[c] ?? 0} entries</p></div></a>`)}
        </div>
        <h2>Novels</h2>
        <div class="cards">
            ${index.novels.map((n) => html`<a class="card" href=${`#/novel/${encodeURIComponent(n.folder)}`}><div class="body"><h3>${n.name}</h3><p>${n.folder}</p></div></a>`)}
        </div>
    </div>`;
}

// ------------------------------------------------------------------ collection view

const HIDDEN_COLS = new Set(["title", "aliases", "type", "created-date", "tags", "description", "images", "facet"]);

function CollectionView({ index, collection, novelFilter }) {
    const [q, setQ] = useState("");
    const [filters, setFilters] = useState({});
    const [mode, setMode] = useState(store.get("viewMode", "table"));
    const [sort, setSort] = useState({ key: "name", dir: 1 });
    const [groupBy, setGroupBy] = useState(store.get(`groupBy:${collection}`, ""));
    const flip = useFlip();
    useEffect(() => { setFilters({}); setQ(""); setGroupBy(store.get(`groupBy:${collection}`, "")); }, [collection]);
    if (!index) return html`<${Loading} />`;
    const col = index.schema.collections[collection];
    if (!col) return html`<p class="error">Unknown collection ${collection}</p>`;
    const all = index.inCollection(collection);
    const facetKeys = Object.keys(col.links).filter((k) => !["novels"].includes(k)).concat(col.fields.some(([k]) => k === "tier") ? ["tier"] : []);
    const values = (n, k) => asList(n.fm[k]).map((v) => (isLink(v) ? linkLabel(v) : String(v)));
    const base = all.filter((n) => !novelFilter || values(n, "novels").includes(novelFilter));
    const t = q.trim().toLowerCase();
    const passes = (n, skip) => {
        if (t && !`${n.name} ${n.fm.title ?? ""} ${n.fm.description ?? ""}`.toLowerCase().includes(t)) return false;
        return Object.entries(filters).every(([k, set]) => k === skip || !set.length || values(n, k).some((v) => set.includes(v)));
    };
    const matches = base.filter((n) => passes(n));
    // Every value present in the collection stays listed in a fixed order (it never moves while filtering);
    // counts ignore the facet's own selection (values within a facet are OR-ed), so a 0 means picking it
    // would leave nothing and it is greyed out.
    const facets = facetKeys.map((k) => {
        const counts = new Map();
        for (const n of base) for (const v of values(n, k)) counts.set(v, 0);
        for (const n of base) if (passes(n, k)) for (const v of values(n, k)) counts.set(v, counts.get(v) + 1);
        return { key: k, values: [...counts.entries()].sort(([a], [b]) => compareValues(a, b, index)) };
    }).filter((f) => f.values.length > 1 || (filters[f.key]?.length));
    const toggle = (k, v) => setFilters((f) => { const cur = f[k] ?? []; return { ...f, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }; });
    const columns = col.fields.map(([k]) => k).filter((k) => !HIDDEN_COLS.has(k) && all.some((n) => asList(n.fm[k]).length && n.fm[k] !== false)).slice(0, 7);
    const groupKeys = [...new Set([...columns, ...facetKeys])];
    const setGroup = (k) => { setGroupBy(k); store.set(`groupBy:${collection}`, k); };
    const sortVal = (n, k) => (k === "name" ? n.name.toLowerCase() : values(n, k).join(", ").toLowerCase());
    const sorted = [...matches].sort((a, b) => {
        const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
        const nx = Number(x), ny = Number(y);
        return (x !== "" && y !== "" && !isNaN(nx) && !isNaN(ny) ? nx - ny : x.localeCompare(y)) * sort.dir;
    });
    const groups = groupKeys.includes(groupBy) ? groupRows(sorted, groupBy, values, index) : [[null, sorted]];
    const cards = (rows, g) => html`<div class="cards" data-drawer>${rows.map((n) => html`<a class="card" href=${noteHref(n.path)} key=${n.path} data-flip=${`${g}|${n.path}`}>
        ${n.cover && html`<div class="cover" style=${`background-image:url("${n.cover}")`} />`}
        <div class="body"><h3>${n.fm.title && n.fm.title !== n.name ? n.fm.title : n.name}</h3>
            <div>${asList(n.fm.cat).slice(0, 3).map((v) => html`<span class="chip">${linkLabel(v)}</span>`)}${n.fm.tier ? html`<span class="badge">tier ${n.fm.tier}</span>` : ""}</div>
            <p>${n.fm.description ?? ""}</p></div></a>`)}</div>`;
    const groupBtn = (k) => html`<button class=${`small ${groupBy === k ? "on" : ""}`} aria-pressed=${groupBy === k}
        title=${groupBy === k ? "Ungroup" : `Group by ${k}`} onClick=${() => setGroup(groupBy === k ? "" : k)}>${k}</button>`;
    const cell = (n, k) => (k === "name" ? html`<a href=${noteHref(n.path)}>${n.name}</a>`
        : k === "description" ? String(n.fm.description ?? "").slice(0, 160) : html`<${Value} v=${n.fm[k]} index=${index} />`);
    return html`<div ref=${flip}>
        <div class="spread">
            <h1>${collectionLabel(collection)} <span class="muted" style="font-size:14px">${matches.length} / ${base.length}</span></h1>
            <div class="row">
                <input placeholder="Filter…" value=${q} onInput=${(e) => setQ(e.target.value)} />
                <button onClick=${() => { const m = mode === "table" ? "cards" : "table"; setMode(m); store.set("viewMode", m); }}>${mode === "table" ? "Cards" : "Table"}</button>
                <button class="primary" onClick=${() => go(`#/new/${encodeURIComponent(collection)}`)}>New</button>
            </div>
        </div>
        <div class="facets">
            ${facets.map((f) => html`<div class="facet"><b>${f.key}</b>${f.values.slice(0, 40).map(([v, c]) => {
                const on = (filters[f.key] ?? []).includes(v);
                return html`<a class=${`chip ${on ? "on" : ""} ${!c && !on ? "off" : ""}`} href="javascript:" aria-disabled=${!c && !on}
                    onClick=${() => (c || on) && toggle(f.key, v)}>${v} <span class="muted">${c}</span></a>`;
            })}</div>`)}
        </div>
        ${mode === "cards" ? html`
            <div class="groupbar row"><b>Group by</b>${groupKeys.map(groupBtn)}</div>
            ${groups.map(([g, rows]) => html`<section class="group" key=${g ?? ""} data-flip=${`group|${g}`}>
                ${g !== null && html`<h2>${g} <span class="muted" style="font-size:13px">${rows.length}</span></h2>`}
                ${cards(rows, g)}</section>`)}`
        : html`<${ColumnTables} id=${collection} cols=${["name", ...columns, "description"]} groups=${groups} sort=${sort} setSort=${setSort}
            cell=${cell} groupBtn=${(k) => (groupKeys.includes(k) ? groupBtn(k) : null)} extraGroupKeys=${groupKeys.filter((k) => !columns.includes(k))} />`}
    </div>`;
}

const COLLAPSED_W = 9;
const LONG_PRESS_MS = 450;
const LAST_MIN_W = 220;

/**
 * One table per group, all sharing one set of column widths. Widths start from the first table's natural
 * layout; dragging a header edge resizes (double-click resets), holding a header collapses the column to a
 * thin strip (click or hold to restore). Resized widths and hidden columns are kept in localStorage.
 * The last column takes the remaining width.
 */
function ColumnTables({ id, cols, groups, sort, setSort, cell, groupBtn, extraGroupKeys }) {
    const [userW, setUserW] = useState(() => store.get(`colWidths:${id}`, {}));
    const [measured, setMeasured] = useState({});
    const [hidden, setHidden] = useState(() => store.get(`colHidden:${id}`, []));
    const [pressing, setPressing] = useState(null);
    const first = useRef();
    const press = useRef({});
    const userRef = useRef(userW);
    userRef.current = userW;
    const last = cols[cols.length - 1];
    const isHidden = (k) => hidden.includes(k);
    const width = (k) => (isHidden(k) ? COLLAPSED_W : k === last ? null : userW[k] ?? measured[k]);
    const fixed = cols.filter((k) => k !== last);
    const measuring = fixed.some((k) => width(k) == null);
    useLayoutEffect(() => {
        if (!measuring || !first.current) return;
        const ths = new Map([...first.current.querySelectorAll("thead th[data-col]")].map((el) => [el.dataset.col, el]));
        const m = {};
        for (const k of fixed) if (width(k) == null) m[k] = Math.round(Math.min(320, Math.max(60, ths.get(k)?.getBoundingClientRect().width ?? 120)));
        setMeasured((s) => ({ ...s, ...m }));
    });
    const saveWidths = (next) => { setUserW(next); store.set(`colWidths:${id}`, next); };
    const toggleHidden = (k) => setHidden((h) => {
        const next = h.includes(k) ? h.filter((x) => x !== k) : [...h, k];
        store.set(`colHidden:${id}`, next);
        return next;
    });
    const startResize = (k) => (e) => {
        if (e.button) return;
        e.preventDefault(); e.stopPropagation();
        const handle = e.currentTarget;
        const x0 = e.clientX, w0 = handle.parentElement.getBoundingClientRect().width;
        let w = Math.round(w0);
        handle.setPointerCapture?.(e.pointerId);
        handle.classList.add("active");
        flipPaused = true;
        const move = (ev) => { w = Math.max(40, Math.round(w0 + ev.clientX - x0)); setUserW((s) => ({ ...s, [k]: w })); };
        const up = () => {
            for (const [t, f] of [["pointermove", move], ["pointerup", up], ["pointercancel", up]]) handle.removeEventListener(t, f);
            handle.classList.remove("active");
            flipPaused = false;
            saveWidths({ ...userRef.current, [k]: w });
        };
        for (const [t, f] of [["pointermove", move], ["pointerup", up], ["pointercancel", up]]) handle.addEventListener(t, f);
    };
    const resetWidth = (k) => (e) => { e.stopPropagation(); const { [k]: _, ...rest } = userRef.current; saveWidths(rest); };
    const endPress = () => { clearTimeout(press.current.t); setPressing(null); };
    const th = (k) => html`<th data-col=${k} class=${`${isHidden(k) ? "collapsed" : ""} ${pressing === k ? "pressing" : ""}`}
        title=${isHidden(k) ? `${k} (hidden): click to show` : "Click to sort, hold to hide"}
        onPointerDown=${(e) => {
            if (e.button) return;
            clearTimeout(press.current.t);
            setPressing(k);
            press.current = { fired: false, t: setTimeout(() => { press.current.fired = true; setPressing(null); toggleHidden(k); }, LONG_PRESS_MS) };
        }}
        onPointerUp=${endPress} onPointerLeave=${endPress} onPointerCancel=${endPress}
        onContextMenu=${(e) => pressing && e.preventDefault()}
        onClick=${() => {
            if (press.current.fired) { press.current.fired = false; return; }
            if (isHidden(k)) toggleHidden(k);
            else setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : 1 }));
        }}>
        ${!isHidden(k) && html`<span class="th-label">${k}${sort.key === k ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</span>`}
        ${!isHidden(k) && k !== last && html`<span class="resizer" title="Drag to resize, double-click to reset"
            onPointerDown=${startResize(k)} onClick=${(e) => e.stopPropagation()} onDblClick=${resetWidth(k)} />`}
    </th>`;
    // explicit widths of all columns, so panels can scroll together in one container
    const total = fixed.reduce((s, k) => s + (width(k) ?? 0), 0) + (isHidden(last) ? COLLAPSED_W : LAST_MIN_W) + 2;
    const panelStyle = measuring ? "" : isHidden(last) ? `width:${total}px` : `width:max(100%, ${total}px)`;
    const tableStyle = `table-layout:${measuring ? "auto" : "fixed"}`;
    const colgroup = html`<colgroup>${cols.map((k) => html`<col style=${width(k) != null ? `width:${width(k)}px` : ""} />`)}</colgroup>`;
    const td = (k, content) => html`<td class=${`${isHidden(k) ? "collapsed" : ""} ${k === "description" ? "desc" : ""}`}>${isHidden(k) ? "" : content}</td>`;
    return html`<div class="coltables">
        <div class="panel groupbar-panel" style=${panelStyle}><table class="coltable" style=${tableStyle}>${colgroup}
            <tbody><tr class="groupbar">${cols.map((k, i) => td(k, i === 0 ? html`<b>Group by</b>` : k === last ? extraGroupKeys.map(groupBtn) : groupBtn(k)))}</tr></tbody>
        </table></div>
        ${isHidden(last) && extraGroupKeys.length > 0 && html`<div class="groupbar row">${extraGroupKeys.map(groupBtn)}</div>`}
        ${groups.map(([g, rows], gi) => html`<section class="group" key=${g ?? ""} data-flip=${`group|${g}`}>
            ${g !== null && html`<h2>${g} <span class="muted" style="font-size:13px">${rows.length}</span></h2>`}
            <div class="panel" style=${panelStyle} data-drawer><table class="coltable" style=${tableStyle} ref=${gi === 0 ? first : null}>${colgroup}
                <thead><tr>${cols.map(th)}</tr></thead>
                <tbody>${rows.map((n) => html`<tr key=${n.path} data-flip=${`${g}|${n.path}`}>${cols.map((k) => td(k, cell(n, k)))}</tr>`)}</tbody>
            </table></div></section>`)}
    </div>`;
}

/** Split rows into [label, rows] groups by a field; list values put a row in every matching group */
function groupRows(rows, key, values, index) {
    const groups = new Map();
    for (const n of rows) {
        const vs = values(n, key);
        for (const v of vs.length ? [...new Set(vs)] : ["(none)"]) {
            if (!groups.has(v)) groups.set(v, []);
            groups.get(v).push(n);
        }
    }
    return [...groups.entries()].sort(([a], [b]) => (a === "(none)") - (b === "(none)") || compareValues(a, b, index));
}

/** Ranked taxonomies (Rarity, Rating…) sort by their class, everything else by name */
function compareValues(a, b, index) {
    const rank = (v) => { const c = Number(index.resolve(toLink(v))?.fm.class); return Number.isFinite(c) ? c : Infinity; };
    return rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// ------------------------------------------------------------------ note view

function Tree({ node, depth = 0 }) {
    const [open, setOpen] = useState(depth < 2);
    const kids = node.children ?? [];
    return html`<li>
        <span class="node">
            <span class="toggle" onClick=${() => setOpen(!open)}>${kids.length ? (open ? "▾" : "▸") : "·"}</span>
            <b>${node.count}×</b>
            ${node.item ? html`<a href=${noteHref(node.item)}>${node.name}</a>` : html`<span class="unresolved">${node.name}</span>`}
            ${node.tier ? html`<span class="badge">T${node.tier}</span>` : ""}
            ${!node.recipe && node.item && depth > 0 ? html`<span class="badge warn">no blueprint</span>` : ""}
            ${node.cycle ? html`<span class="badge bad">cycle</span>` : ""}
            ${node.missing ? html`<span class="badge bad">missing</span>` : ""}
        </span>
        ${open && node.materials?.length > 0 && html`<div class="mats">${node.materials.map((m) => `${m.qtyText} ${m.name}`).join(" · ")}</div>`}
        ${open && kids.length > 0 && html`<ul>${kids.map((k) => html`<${Tree} node=${k} depth=${depth + 1} />`)}</ul>`}
    </li>`;
}

function WhereUsed({ uses }) {
    if (!uses?.length) return null;
    return html`<ul>${uses.map((u) => html`<li>${u.count}× in ${u.item ? html`<a href=${noteHref(u.item)}>${u.name}</a>` : u.name}${u.parents?.length ? html`<${WhereUsed} uses=${u.parents} />` : ""}</li>`)}</ul>`;
}

function BlueprintPanel({ page }) {
    const [count, setCount] = useState(1);
    const item = page.collection === "Recipes" ? page.blueprint.root.item : page.path;
    const { data } = useApi(count === 1 ? null : `/api/blueprint?${qs({ item, count })}`);
    const bp = count === 1 ? page.blueprint : data ?? page.blueprint;
    return html`<div class="panel">
        <div class="spread"><h2 style="margin:0">Build tree</h2>
            <label class="row muted">Build <input type="number" min="1" value=${count} style="width:70px" onInput=${(e) => setCount(Math.max(1, Number(e.target.value) || 1))} /></label></div>
        <div class="grid2" style="margin-top:10px">
            <div class="tree"><ul><${Tree} node=${bp.root} /></ul></div>
            <div>
                <h3>Total materials</h3>
                <table><tbody>${bp.bill.map((b) => html`<tr><td>${b.material ? html`<a href=${noteHref(b.material)}>${b.name}</a>` : b.name}</td><td class="num">${b.qtyText}</td></tr>`)}</tbody></table>
                ${bp.parts.length > 0 && html`<h3 style="margin-top:12px">Parts without a blueprint</h3>
                    <table><tbody>${bp.parts.map((p) => html`<tr><td><a href=${noteHref(p.item)}>${p.name}</a></td><td class="num">${p.count}×</td></tr>`)}</tbody></table>`}
                <h3 style="margin-top:12px">Knowledge needed</h3>
                <div>${bp.disciplines.map((d) => html`<span class="chip">${d}</span>`)}${bp.maxTier ? html` <span class="badge">max tier ${bp.maxTier}</span>` : ""}</div>
            </div>
        </div>
    </div>`;
}

function ImageDrop({ path, onDone }) {
    const [over, setOver] = useState(false);
    const [busy, setBusy] = useState(false);
    const input = useRef();
    const upload = async (files) => {
        setBusy(true);
        try {
            for (const f of files) {
                if (!f.type.startsWith("image/")) continue;
                await api.send("POST", `/api/images?${qs({ path, filename: f.name || "pasted.png" })}`, null, f);
            }
            toast("Image added");
            onDone?.();
        } catch (e) { toast(e.message); }
        setBusy(false);
    };
    useEffect(() => {
        const paste = (e) => { const files = [...(e.clipboardData?.files ?? [])]; if (files.length) { e.preventDefault(); upload(files); } };
        addEventListener("paste", paste);
        return () => removeEventListener("paste", paste);
    }, [path]);
    return html`<div class=${`drop ${over ? "over" : ""}`} onClick=${() => input.current.click()}
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
        onDrop=${(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]); }}>
        ${busy ? "Uploading…" : "Drop, paste or click to add images"}
        <input ref=${input} type="file" accept="image/*" multiple style="display:none" onChange=${(e) => upload([...e.target.files])} />
    </div>`;
}

function Gallery({ images }) {
    const [big, setBig] = useState(null);
    if (!images?.length) return null;
    return html`<div class="gallery">${images.map((src) => html`<img src=${src} onClick=${() => setBig(src)} />`)}
        ${big && html`<div class="lightbox" onClick=${() => setBig(null)}><img src=${big} /></div>`}</div>`;
}

const READONLY_KEYS = new Set(["type", "created-date", "facet"]);
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
const sameValue = (a, b) => (isEmpty(coerce(a)) ? "" : JSON.stringify(coerce(a))) === (isEmpty(coerce(b)) ? "" : JSON.stringify(coerce(b)));

/** Frontmatter of any note as an always-editable form; only changed keys are patched */
function FieldsEditor({ page, index, spec, scope, linkOptions }) {
    const [edits, setEdits] = useState({});
    const [baseMtime, setBaseMtime] = useState(null);
    // values just saved, shown until the refetched page catches up
    const [saved, setSaved] = useState({ mtime: 0, fm: {} });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const fm = page.mtime >= saved.mtime ? page.fm : { ...page.fm, ...saved.fm };
    const mtime = Math.max(page.mtime, saved.mtime);
    const defs = new Map(spec?.fields ?? []);
    const generated = new Set(spec?.generated ?? []);
    // stat template fields of a character sheet / creature note get typed inputs in their own block
    const statsInfo = page.stats;
    const tplName = "stat-template" in edits ? edits["stat-template"] : fm["stat-template"] || statsInfo?.holder.template || "";
    const statTpl = statsInfo?.templates?.[tplName] ?? null;
    const statKeys = new Set(statTpl?.fields.map((f) => f.key) ?? []);
    const keys = [...defs.keys(), ...Object.keys(fm).filter((k) => !defs.has(k))].filter((k) => k !== "images" && k !== "stat-template" && !statKeys.has(k));
    const changed = Object.keys(edits).filter((k) => !sameValue(edits[k], fm[k]));
    const dirty = changed.length > 0;
    useEffect(() => markDirty(scope, page.path, dirty), [dirty]);
    useEffect(() => () => markDirty(scope, page.path, false), []);
    const edit = (k, v) => { if (baseMtime == null) setBaseMtime(mtime); setEdits((s) => ({ ...s, [k]: v })); };
    const reset = () => { setEdits({}); setBaseMtime(null); setErr(""); };
    const save = async () => {
        if (!dirty || busy) return;
        setBusy(true); setErr("");
        try {
            const set = Object.fromEntries(changed.map((k) => [k, coerce(edits[k])]));
            const r = await api.send("PATCH", "/api/note", { path: page.path, set, baseMtime: baseMtime ?? mtime });
            setSaved({ mtime: r.mtime, fm: { ...(page.mtime >= saved.mtime ? {} : saved.fm), ...set } });
            reset();
            toast("Saved");
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const readOnly = (k) => READONLY_KEYS.has(k) || generated.has(k) || (fm[k] && typeof fm[k] === "object" && asList(fm[k]).some((x) => x && typeof x === "object"));
    const input = (k) => {
        const value = k in edits ? edits[k] : fm[k];
        const def = defs.has(k) ? defs.get(k) : Array.isArray(fm[k]) ? [] : typeof fm[k] === "boolean" ? false : "";
        // unknown keys holding links get a link picker over all notes
        const target = spec?.links?.[k] ?? (asList(fm[k]).some(isLink) ? "" : undefined);
        return fieldInput({ key: k, def, target, value, index, options: target?.startsWith("@") ? linkOptions?.[target] ?? [] : undefined, onChange: (v) => edit(k, v) });
    };
    return html`<div onKeyDown=${(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); } }}>
        <div class="formgrid">${keys.map((k) => html`
            <label class=${changed.includes(k) ? "changed" : ""}>${k}</label>
            ${readOnly(k) ? html`<div class="ro"><${Value} v=${fm[k]} links=${page.links} index=${index} /></div>` : input(k)}`)}
        </div>
        ${statsInfo && html`<${SheetStats} info=${statsInfo} tpl=${statTpl} tplName=${tplName} fm=${fm} edits=${edits} edit=${edit} changed=${changed} index=${index} />`}
        ${err && html`<p class="error">${err}</p>`}
        <div class=${`savebar ${dirty ? "dirty" : ""}`}>
            <button class="primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save changes"}</button>
            ${dirty && html`<button onClick=${reset}>Discard</button><span class="muted">${changed.length} changed · Ctrl+S</span>`}
        </div>
    </div>`;
}

// ------------------------------------------------------------------ note summary (drawer)

// What matters per collection: `facts` print as a compact row, `sections` as subheadings with their values.
// The description always leads. A schema collection's `summary: {facts, sections}` overrides these.
const SUMMARY = {
    Items: { facts: ["cat", "subcat", "rarity", "tier", "grade", "slot", "value", "power-system", "elements"], sections: ["applies-to", "teaches"] },
    Materials: { facts: ["cat", "rarity", "tier", "density", "power-system", "elements"], sections: ["usage", "sources"] },
    Recipes: { facts: ["item", "tier", "disciplines", "rarity"], sections: ["components", "materials"] },
    Abilities: { facts: ["cat", "subcat", "grade", "power-system", "elements", "parent-art"], sections: ["requirements", "reagents", "classes", "sub-arts"] },
    Races: { facts: ["parent-race", "sapient", "lifespan", "homeworld", "power-system"], sections: ["appearance", "culture", "traits"] },
    Creatures: { facts: ["cat", "subcat", "temperament", "intelligence", "potential", "potential-sub", "power-system"], sections: ["habitat", "drops"] },
    "Power Systems": { facts: ["parent", "energy-source", "tradition"], sections: [] },
    "Power Levels": { facts: ["power-system", "level-kind", "class"], sections: ["sub-levels"] },
    Worlds: { facts: ["power-system"], sections: ["races"] },
    Locations: { facts: ["scale", "parent", "world", "cat", "controlled-by", "population", "size", "climate"], sections: [] },
    Factions: { facts: ["cat", "world", "seat", "power-system"], sections: ["territory", "members", "relations/friendly", "relations/neutral", "relations/hostile"] },
    taxonomy: { facts: ["parent", "class"], sections: [] },
    characters: { facts: ["race", "gender", "alive", "age-current", "member-of", "character/power-system", "character/level", "character/sub-level", "character/talent"], sections: ["personality", "appearance", "character/skills"] },
};
const fieldLabel = (k) => { const t = k.split("/").pop().replace(/-/g, " "); return t[0].toUpperCase() + t.slice(1); };
const filled = (v) => !(v == null || v === "" || (Array.isArray(v) && !v.length));

function NoteSummary({ page, index }) {
    const fm = page.fm;
    const spec = index?.schema?.collections[page.collection]?.summary
        ?? SUMMARY[page.collection] ?? (page.collection?.startsWith("Taxonomy/") ? SUMMARY.taxonomy : fm.type === "character" ? SUMMARY.characters : null);
    const facts = (spec?.facts ?? []).filter((k) => filled(fm[k]));
    const sections = (spec?.sections ?? []).filter((k) => filled(fm[k]));
    if (!filled(fm.description) && !facts.length && !sections.length) return null;
    const value = (k) => k === "value" && filled(fm.currency) ? html`${fm.value} <${Value} v=${fm.currency} links=${page.links} index=${index} />`
        : html`<${Value} v=${fm[k]} links=${page.links} index=${index} />`;
    return html`<div class="panel note-summary">
        ${filled(fm.description) && html`<p class="lead">${String(fm.description)}</p>`}
        ${facts.length > 0 && html`<dl class="facts">${facts.map((k) => html`<div><dt>${fieldLabel(k)}</dt><dd>${value(k)}</dd></div>`)}</dl>`}
        ${sections.map((k) => html`<h4>${fieldLabel(k)}</h4><div class="summary-section">${typeof fm[k] === "string" && !isLink(fm[k])
            ? html`<p>${fm[k]}</p>` : value(k)}</div>`)}
    </div>`;
}

// Ranked taxonomy notes (`ordered: true`) show every value of their facet in `class` order
const ranked = (n) => n.fm.ordered === true && n.fm.class !== "" && n.fm.class != null && !Number.isNaN(Number(n.fm.class));
function ClassStrip({ page, index }) {
    if (!page.collection?.startsWith("Taxonomy/") || !ranked(page)) return null;
    const sibs = (index?.inCollection(page.collection) ?? []).filter(ranked)
        .sort((a, b) => Number(a.fm.class) - Number(b.fm.class) || a.name.localeCompare(b.name));
    if (sibs.length < 2) return null;
    return html`<nav class="class-strip">${sibs.map((n) => html`<a href=${noteHref(n.path)} class=${n.path === page.path ? "on" : ""}>
        <span class="rank">${n.fm.class}</span>${n.fm.title || n.name}</a>`)}</nav>`;
}

function NoteView({ index, path, scope = "page" }) {
    const { data: page, error } = useApi(`/api/note?${qs({ path })}`);
    const { data: plan } = useApi(page?.plan ? `/api/plan?${qs({ novel: page.plan.novel })}` : null);
    const linkOptions = useMemo(() => plan && {
        "@plots": plan.plots.map((p) => ({ label: p.name, hint: p.title !== p.name ? p.title : p.rating?.title ?? "" })),
        "@characters": plan.characters.map((c) => ({ label: c.name })),
    }, [plan]);
    if (!page) return html`<${Loading} error=${error} />`;
    const schema = index?.schema;
    const spec = page.plan?.spec ?? (page.collection ? schema?.collections[page.collection] : page.fm.type === "character" ? schema?.characters : null);
    const novel = index?.novels.find((n) => page.path.startsWith(`${n.folder}/`));
    const linkGroups = (groups) => Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([c, list]) => html`<div style="margin-bottom:6px"><b class="muted">${c === "Unresolved" ? c : collectionLabel(c)} (${list.length})</b><div>${list.slice(0, 60).map((b) => b.path ? html`<a class="chip" href=${noteHref(b.path)}>${b.name}</a>` : html`<span class="chip muted">${b.name}</span>`)}${list.length > 60 ? html`<span class="muted"> +${list.length - 60} more</span>` : ""}</div></div>`);
    const fields = html`<div class="panel">${page.fmError ? html`<p class="muted">Fix the frontmatter in Obsidian to edit fields here.</p>`
        : html`<${FieldsEditor} key=${page.path} page=${page} index=${index} spec=${spec} scope=${scope} linkOptions=${linkOptions} />`}</div>`;
    const usage = html`
        ${page.heldBy?.length > 0 && html`<div class="panel"><h3>Held by</h3>${page.heldBy.map((x) => html`<div><a href=${`#/owner/${encodeURIComponent(x.novel)}/${encodeURIComponent(x.owner)}`}>${x.owner}</a> <span class="muted">${x.qtyText}${x.store !== "inventory" ? ` @ ${x.store}` : ""} · ${x.novel}</span></div>`)}</div>`}
        ${page.whereUsed?.length > 0 && html`<div class="panel"><h3>Used in</h3><${WhereUsed} uses=${page.whereUsed} /></div>`}
        ${page.creatureStats && html`<${CreatureNovels} page=${page} index=${index} />`}`;
    const imageDrop = html`<div class="panel"><${ImageDrop} path=${page.path} /></div>`;
    const content = html`
        ${page.blueprint && html`<${BlueprintPanel} page=${page} />`}
        ${page.body.trim() && (page.plan
            ? html`<details class="panel"><summary class="muted">Note body (not used by the plan, edit it in Obsidian)</summary><${Html} html=${page.html} /></details>`
            : html`<div class="panel"><${Html} html=${page.html} /></div>`)}`;
    const linkedFrom = Object.values(page.backlinks).reduce((n, l) => n + l.length, 0);
    const deletable = !page.path.startsWith("90. Templater/") && !["config", "ledger"].includes(page.fm.type);
    const del = async () => {
        try {
            const r = await api.send("DELETE", `/api/note?${qs({ path: page.path, baseMtime: page.mtime })}`);
            markDirty(scope, page.path, false);
            toast(`Moved to ${r.trashed}`);
            if (scope === "drawer") dropFromDrawer(noteHref(page.path));
            else go(page.collection ? `#/c/${encodeURIComponent(page.collection)}` : novel ? `#/novel/${encodeURIComponent(novel.folder)}` : "#/");
        } catch (e) { toast(e.message); }
    };
    const backlinks = Object.keys(page.backlinks).length > 0 && html`<div class="panel"><h3>Linked from</h3>${linkGroups(page.backlinks)}</div>`;
    const outlinks = Object.keys(page.outlinks ?? {}).length > 0 && html`<div class="panel"><h3>Links to</h3>${linkGroups(page.outlinks)}</div>`;
    return html`<div>
        <div class="spread">
            <div>
                <div class="muted">${page.collection ? html`<a href=${`#/c/${encodeURIComponent(page.collection)}`}>${collectionLabel(page.collection)}</a>` : page.path.split("/").slice(0, -1).join(" / ")}</div>
                <h1>${page.fm.title && page.fm.title !== page.name ? html`${page.fm.title} <span class="muted" style="font-size:14px">${page.name}</span>` : page.name}
                    ${page.fm.status ? html` <span class="badge">${page.fm.status}</span>` : ""}</h1>
            </div>
            <div class="row">
                ${page.fm.type === "character" && novel && html`<button onClick=${() => go(`#/owner/${encodeURIComponent(novel.folder)}/${encodeURIComponent(page.name)}`)}>Ledgers</button>`}
                ${deletable && html`<${ConfirmButton} class="" onConfirm=${del}
                    title=${`Move to the vault's .trash folder${linkedFrom ? `. ${linkedFrom} note${linkedFrom > 1 ? "s" : ""} link here and will show it as unresolved` : ""}${page.heldBy?.length ? ". Ledger lines still name it" : ""}`}>Delete<//>`}
            </div>
        </div>
        ${page.fmError && html`<div class="warnbox">Frontmatter could not be read: ${page.fmError}</div>`}
        ${scope === "drawer"
            // drawer: summary, content, then images on the left; frontmatter and links on the right
            // (plan notes keep their fields, which are the plan, on the left)
            ? html`<${ClassStrip} page=${page} index=${index} />
            <div class="note-cols">
                <div class="note-main">${page.plan ? fields : html`<${NoteSummary} page=${page} index=${index} />`}${usage}${content}<${Gallery} images=${page.images} />${imageDrop}</div>
                <div class="note-side">${!page.plan && fields}${backlinks}${outlinks}</div>
            </div>`
            : html`<${Gallery} images=${page.images} />
                <div class=${page.plan ? "" : "grid2"}>${fields}<div>${usage}${imageDrop}</div></div>
                ${content}${backlinks}${outlinks}`}
    </div>`;
}

// ------------------------------------------------------------------ create / edit notes

/**
 * Sizes textareas to their content. Setting height to auto briefly shrinks the page, which clamps the
 * scroll position of the drawer or page, so scrolled ancestors are restored afterwards.
 */
function fitHeights(els, extra = 0) {
    els = els.filter(Boolean);
    if (!els.length) return;
    const scrolled = [];
    for (let n = els[0].parentElement; n; n = n.parentElement) if (n.scrollTop) scrolled.push([n, n.scrollTop]);
    const root = document.scrollingElement;
    if (root?.scrollTop && !scrolled.some(([n]) => n === root)) scrolled.push([root, root.scrollTop]);
    for (const el of els) el.style.height = "auto";
    for (const el of els) el.style.height = `${el.scrollHeight + extra}px`;
    for (const [n, top] of scrolled) n.scrollTop = top;
}

/** Textarea that grows with its content */
function AutoTextarea({ value, onInput, class: cls = "", ...rest }) {
    const ref = useRef();
    useLayoutEffect(() => fitHeights([ref.current], 2));
    return html`<textarea ref=${ref} class=${`auto ${cls}`} value=${value ?? ""} onInput=${onInput} ...${rest} />`;
}

/** Read-only plan outline: nested lists, extra space between top-level events */
function PlanView({ text, limit }) {
    const items = parseOutline(text);
    if (!items.length) return html`<p class="muted">No plan yet.</p>`;
    const shown = limit ? items.filter((it) => it.level === 0).slice(0, limit) : items;
    const tree = [];
    const stack = [{ level: -1, children: tree }];
    for (const it of shown) {
        while (stack.at(-1).level >= it.level) stack.pop();
        const node = { ...it, children: [] };
        stack.at(-1).children.push(node);
        stack.push(node);
    }
    const list = (nodes, depth) => html`<ul class=${`plan-list depth-${Math.min(depth, 3)}`}>${nodes.map((n) => html`<li>${n.text}${n.children.length > 0 && list(n.children, depth + 1)}</li>`)}</ul>`;
    const more = limit ? items.filter((it) => it.level === 0).length - shown.length : 0;
    return html`<div class=${`plan ${limit ? "compact" : ""}`}>${list(tree, 0)}${more > 0 && html`<div class="muted plan-more">+${more} more</div>`}</div>`;
}

/**
 * Outline editor for event plans. One item per line; its indent is the event level. Enter starts the next
 * item at the same level, Tab / Shift+Tab indent and outdent (with sub events), Backspace at the start
 * outdents or joins the previous item, Alt+↑/↓ moves an item, pasted text is split into items.
 * Emits markdown bullets (see outline.js).
 */
function PlanEditor({ value, onChange, placeholder = "First event…" }) {
    const fromValue = (v) => { const it = parseOutline(v); return it.length ? it : [{ level: 0, text: "" }]; };
    const [items, setItems] = useState(() => fromValue(value));
    const emitted = useRef(value ?? "");
    const refs = useRef([]);
    const focus = useRef(null);
    const box = useRef();
    // external changes (saved elsewhere, reloaded) replace the outline unless they are our own output
    useEffect(() => { if ((value ?? "") !== emitted.current) { emitted.current = value ?? ""; setItems(fromValue(value)); } }, [value]);
    const fit = () => fitHeights(refs.current);
    useLayoutEffect(() => {
        fit();
        if (focus.current) {
            const { i, pos } = focus.current;
            focus.current = null;
            const el = refs.current[i];
            if (el) { el.focus(); const p = Math.min(pos ?? el.value.length, el.value.length); el.setSelectionRange(p, p); }
        }
    });
    useEffect(() => {
        if (typeof ResizeObserver !== "function" || !box.current) return;
        const ro = new ResizeObserver(fit);
        ro.observe(box.current);
        return () => ro.disconnect();
    }, []);
    const commit = (next, f) => {
        if (f) focus.current = f;
        setItems(next);
        const md = serializeOutline(next);
        if (md !== emitted.current) { emitted.current = md; onChange(md); }
    };
    // an item and the sub events under it
    const subtree = (list, i) => { let j = i + 1; while (j < list.length && list[j].level > list[i].level) j++; return [i, j]; };
    const shift = (list, i, by) => {
        const [a, b] = subtree(list, i);
        return list.map((it, k) => (k >= a && k < b ? { ...it, level: Math.max(0, it.level + by) } : it));
    };
    const onKeyDown = (i) => (e) => {
        const el = e.target, it = items[i];
        const start = el.selectionStart, end = el.selectionEnd;
        if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (!it.text && it.level > 0) return commit(shift(items, i, -1), { i, pos: 0 });
            const next = [...items];
            next.splice(i, 1, { ...it, text: it.text.slice(0, start) }, { level: it.level, text: it.text.slice(end) });
            return commit(next, { i: i + 1, pos: 0 });
        }
        if (e.key === "Tab") {
            e.preventDefault();
            if (e.shiftKey) { if (it.level > 0) commit(shift(items, i, -1), { i, pos: start }); }
            else if (i > 0 && it.level <= items[i - 1].level) commit(shift(items, i, 1), { i, pos: start });
            return;
        }
        if (e.key === "Backspace" && start === 0 && end === 0) {
            if (it.level > 0) { e.preventDefault(); return commit(shift(items, i, -1), { i, pos: 0 }); }
            if (i > 0) {
                e.preventDefault();
                const prev = items[i - 1];
                const next = [...items];
                next.splice(i - 1, 2, { ...prev, text: prev.text + it.text });
                return commit(next, { i: i - 1, pos: prev.text.length });
            }
        }
        if (e.key === "Delete" && start === it.text.length && end === start && i < items.length - 1) {
            e.preventDefault();
            const next = [...items];
            next.splice(i, 2, { ...it, text: it.text + items[i + 1].text });
            return commit(next, { i, pos: start });
        }
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            const j = e.key === "ArrowUp" ? i - 1 : i + 1;
            if (j < 0 || j >= items.length) return;
            const next = [...items];
            [next[i], next[j]] = [next[j], next[i]];
            return commit(next, { i: j, pos: start });
        }
        // move between items when the caret can't move further inside this one
        const oneRow = el.scrollHeight <= parseFloat(getComputedStyle(el).lineHeight || "0") * 1.5 + 8;
        if (e.key === "ArrowUp" && i > 0 && (start === 0 || oneRow)) { e.preventDefault(); focus.current = { i: i - 1, pos: start }; setItems([...items]); }
        if (e.key === "ArrowDown" && i < items.length - 1 && (start === it.text.length || oneRow)) { e.preventDefault(); focus.current = { i: i + 1, pos: start }; setItems([...items]); }
    };
    const onPaste = (i) => (e) => {
        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (!text.includes("\n")) return;
        e.preventDefault();
        const it = items[i];
        const pasted = parseOutline(text).map((p) => ({ ...p, level: p.level + it.level }));
        if (!pasted.length) return;
        const next = [...items];
        const el = e.target;
        const before = it.text.slice(0, el.selectionStart), after = it.text.slice(el.selectionEnd);
        pasted[0] = { ...pasted[0], level: it.level, text: before + pasted[0].text };
        const last = pasted.length - 1;
        const caret = pasted[last].text.length;
        pasted[last] = { ...pasted[last], text: pasted[last].text + after };
        next.splice(i, 1, ...pasted);
        commit(next, { i: i + last, pos: caret });
    };
    refs.current.length = items.length;
    return html`<div class="plan-editor" ref=${box}>
        ${items.map((it, i) => html`<div class=${`plan-row lvl-${Math.min(it.level, 3)} ${it.level === 0 && i > 0 ? "top" : ""}`} style=${`--level:${it.level}`}>
            <span class="plan-bullet" aria-hidden="true" />
            <textarea ref=${(el) => { refs.current[i] = el; }} rows="1" value=${it.text} placeholder=${i === 0 ? placeholder : ""} spellcheck="true"
                onInput=${(e) => commit(items.map((x, k) => (k === i ? { ...x, text: e.target.value.replace(/\n/g, " ") } : x)))}
                onKeyDown=${onKeyDown(i)} onPaste=${onPaste(i)} />
        </div>`)}
        <div class="plan-hint muted">Enter: next event · Tab / Shift+Tab: sub event / back out · Alt+↑↓: move</div>
    </div>`;
}

function fieldInput({ key, def, target, value, onChange, index, options }) {
    if (target != null) return html`<${LinkField} value=${value} multiple=${Array.isArray(def)} target=${target} index=${index} onChange=${onChange} options=${options} />`;
    if (typeof def === "boolean") return html`<input type="checkbox" checked=${!!value} onChange=${(e) => onChange(e.target.checked)} style="width:auto" />`;
    if (Array.isArray(def)) return html`<input value=${asList(value).join(", ")} placeholder="comma separated" onChange=${(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />`;
    if (key === "plan") return html`<${PlanEditor} value=${value ?? ""} onChange=${onChange} />`;
    if (key === "plot") return html`<${AutoTextarea} class="prose" value=${value} onInput=${(e) => onChange(e.target.value)} placeholder="The plot idea…" />`;
    if (["description", "personality", "appearance"].includes(key)) return html`<${AutoTextarea} value=${value} onInput=${(e) => onChange(e.target.value)} style="font-family:inherit" />`;
    return html`<input value=${value ?? ""} onInput=${(e) => onChange(e.target.value)} style="width:100%" />`;
}
const coerce = (v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v);

/** Create a data store note or a character (existing notes are edited in place on their page) */
function NoteForm({ index, collection, novel }) {
    const schema = index?.schema;
    const spec = collection === "characters" ? schema?.characters : schema?.collections[collection];
    const [vals, setVals] = useState(null);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    useEffect(() => {
        if (!spec || vals) return;
        const init = {};
        for (const [k, def] of spec.fields) init[k] = Array.isArray(def) ? [...def] : def;
        setVals(init);
    }, [spec]);
    if (!index || !vals || !spec) return html`<${Loading} />`;
    const generated = new Set(spec.generated ?? []);
    const save = async () => {
        setBusy(true); setErr("");
        try {
            if (collection === "characters") {
                const fm = Object.fromEntries(Object.entries(vals).filter(([k, v]) => v !== "" && !(Array.isArray(v) && !v.length) && !generated.has(k)).map(([k, v]) => [k, coerce(v)]));
                const r = await api.send("POST", "/api/character", { novel, name, fm });
                go(noteHref(r.path));
            } else {
                const fm = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, coerce(v)]));
                const r = await api.send("POST", "/api/note", { collection, name, fm });
                go(noteHref(r.path));
            }
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const title = collection === "characters" ? "New character" : `New ${spec.label ?? collection}`;
    return html`<div>
        <h1>${title}</h1>
        <div class="panel"><div class="formgrid">
            <label>File name</label><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Unique note name" autoFocus style="width:100%" />
            ${spec.fields.filter(([k]) => !["type", "created-date", "images", "facet"].includes(k) && !generated.has(k)).map(([k, def]) => html`
                <label>${k}</label>
                ${fieldInput({ key: k, def, target: spec.links?.[k], value: vals[k], index, onChange: (v) => setVals((s) => ({ ...s, [k]: v })) })}`)}
        </div></div>
        ${err && html`<p class="error">${err}</p>`}
        <div class="row"><button class="primary" disabled=${busy || !name.trim()} onClick=${save}>Create</button>
            <button onClick=${() => history.back()}>Cancel</button></div>
        ${generated.size > 0 && html`<p class="muted">Generated from ledgers (not editable here): ${[...generated].join(", ")}</p>`}
    </div>`;
}

// ------------------------------------------------------------------ novels

const novelHref = (folder) => `#/novel/${encodeURIComponent(folder)}`;
const ownerHref = (folder, owner) => `#/owner/${encodeURIComponent(folder)}/${encodeURIComponent(owner)}`;
const chapterHref = (folder, n) => `#/chapter/${encodeURIComponent(folder)}/${n}`;
const entryHref = (folder, p) => `#/entry/${encodeURIComponent(folder)}?${qs(p)}`;

/** Stat fields on a character sheet or creature note: template choice and typed values */
function SheetStats({ info, tpl, tplName, fm, edits, edit, changed, index }) {
    const managed = new Set(info.managed ?? []);
    const def = Object.values(info.templates ?? {}).find((t) => t.default)?.name;
    const chosen = "stat-template" in edits ? edits["stat-template"] : fm["stat-template"] ?? "";
    const typed = (f) => fromText(f, f.key in edits ? edits[f.key] : fm[f.key]);
    const values = tpl ? Object.fromEntries(tpl.fields.map((f) => [f.key, managed.has(f.key) ? info.values?.[f.key] : typed(f)])) : {};
    const sections = tpl ? [...new Set(tpl.fields.map((f) => f.section))] : [];
    return html`<div class="sheet-stats">
        <div class="spread"><h3 style="margin:0">Stats</h3>
            <label class=${`row muted ${changed.includes("stat-template") ? "changed" : ""}`}>Template
                <select value=${chosen} onChange=${(e) => edit("stat-template", e.target.value)}>
                    <option value="">${info.holder.kind === "character" && def ? `Novel default (${def})` : "None"}</option>
                    ${Object.keys(info.templates ?? {}).map((n) => html`<option value=${n}>${n}</option>`)}
                </select></label></div>
        ${!tpl ? html`<p class="muted">${Object.keys(info.templates ?? {}).length ? "Choose a template to give this note stats." : "This novel has no stat templates yet (novel page, Stats tab)."}</p>`
        : html`${info.problems?.length > 0 && html`<div class="warnbox">${info.problems.map((p) => html`<div>${p}</div>`)}</div>`}
            ${sections.map((s) => html`${s && html`<h4 class="stat-section">${s}</h4>`}<div class="formgrid">${tpl.fields.filter((f) => f.section === s).map((f) => {
                const o = info.origin?.[f.key];
                const err = !managed.has(f.key) && f.type !== "computed" && statError(index, f, values[f.key]);
                return html`<label class=${changed.includes(f.key) ? "changed" : ""} title=${f.key}>${f.label}</label>
                    <div class="stat-cell">${managed.has(f.key)
                        ? html`<span>${displayValue(tpl, f, values) || "—"}</span> <span class="muted stat-was">set by the Stats ledger${o?.chapter != null ? ` (ch ${o.chapter})` : ""}; change it with a Stats entry</span>`
                        : html`<${StatInput} field=${f} value=${values[f.key]} onChange=${(v) => edit(f.key, v)} index=${index} template=${tpl} values=${values} />
                            ${o?.from === "source" && !(f.key in edits) && html`<span class="muted stat-was">prefilled from ${o.field}: ${displayValue(tpl, f, info.values ?? {})}</span>`}`}
                        ${err && html`<div class="error">${err}</div>`}</div>`;
            })}</div>`)}`}
    </div>`;
}

// ------------------------------------------------------------------ stats: novel tab (templates and who uses them)

const blankTemplate = (name) => ({ name, description: "", default: false, callout: "system", "show-empty": false, panel: "", fields: [] });
const blankField = () => normalizeTemplates({ t: { fields: [{ label: "", type: "number" }] } }).t.fields[0];

function StatsTab({ folder, novel }) {
    const index = useIndex();
    const { data, error } = useApi(`/api/stats/novel?${qs({ novel: folder })}`);
    if (!data || !index) return html`<${Loading} error=${error} />`;
    return html`<div>
        <${TemplatesEditor} key=${folder} folder=${folder} data=${data} index=${index} />
        <${StatHolders} folder=${folder} data=${data} index=${index} novel=${novel} />
    </div>`;
}

function StatHolders({ folder, data, index }) {
    const [creature, setCreature] = useState("");
    const [tpl, setTpl] = useState("");
    const names = Object.keys(data.templates);
    const def = Object.values(data.templates).find((t) => t.default)?.name;
    const assign = async (h, name) => {
        const n = await api.get(`/api/note?${qs({ path: h.path })}`);
        try { await api.send("PATCH", "/api/note", name ? { path: h.path, set: { "stat-template": name }, baseMtime: n.mtime } : { path: h.path, unset: ["stat-template"], baseMtime: n.mtime }); toast(`${h.name}: ${name || "default"}`); }
        catch (e) { toast(e.message); }
    };
    const used = new Set(data.holders.filter((h) => h.kind === "creature").map((h) => h.creaturePath));
    const creatures = index.inCollection("Creatures").filter((c) => !used.has(c.path)).map((c) => ({ label: c.name, hint: c.fm.title !== c.name ? c.fm.title : "" }));
    const addCreature = async () => {
        try { const r = await api.send("POST", "/api/stats/creature", { novel: folder, creature: toLink(creature), template: tpl }); setCreature(""); openInDrawer(noteHref(r.path)); }
        catch (e) { toast(e.message); }
    };
    const row = (h) => html`<tr key=${h.path}>
        <td><a href=${noteHref(h.path)}>${h.name}</a>${h.kind === "creature" && h.creaturePath && html` <span class="muted">· <a href=${noteHref(h.creaturePath)}>data store</a></span>`}</td>
        <td><select value=${h.assigned ? h.template : ""} onChange=${(e) => assign(h, e.target.value)}>
            <option value="">${h.kind === "character" && def ? `Default (${def})` : "None"}</option>${names.map((n) => html`<option>${n}</option>`)}
            ${h.assigned && !names.includes(h.template) && html`<option value=${h.template}>${h.template} (missing)</option>`}</select></td>
        <td>${h.template && names.includes(h.template) && html`<a href=${ownerHref(folder, h.name)} data-page>Stats panel</a>`}</td>
    </tr>`;
    return html`<div class="grid2" style="margin-top:14px" data-drawer>
        <div class="panel"><h3>Characters</h3><table><tbody>${data.holders.filter((h) => h.kind === "character").map(row)}</tbody></table></div>
        <div class="panel"><h3>Creatures <span class="muted" style="font-weight:400;font-size:12px">base stats in this novel</span></h3>
            <table><tbody>${data.holders.filter((h) => h.kind === "creature").map(row)}</tbody></table>
            <div class="row" style="margin-top:10px">
                <div style="flex:1;min-width:180px"><${Picker} value=${creature} options=${creatures} allowFree=${false} placeholder="Add a creature from the data store…" onChange=${(o) => setCreature(o?.label ?? "")} /></div>
                <select value=${tpl} onChange=${(e) => setTpl(e.target.value)}><option value="">Template…</option>${names.map((n) => html`<option>${n}</option>`)}</select>
                <button class="primary small" disabled=${!creature || !tpl} onClick=${addCreature}>Add</button>
            </div></div>
    </div>`;
}

function TemplatesEditor({ folder, data, index }) {
    const initial = () => Object.values(data.templates).map((t) => ({ ...t, fields: t.fields.map((f) => ({ ...f })), orig: t.name }));
    const [list, setList] = useState(initial);
    const [sel, setSel] = useState(0);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [previewOwner, setPreviewOwner] = useState("");
    const [preview, setPreview] = useState(null);
    const saved = JSON.stringify(initial().map(({ orig, ...t }) => t));
    const dirty = JSON.stringify(list.map(({ orig, ...t }) => t)) !== saved;
    useEffect(() => markDirty("page", `stat-templates:${folder}`, dirty), [dirty]);
    useEffect(() => () => markDirty("page", `stat-templates:${folder}`, false), []);
    // after a save (or an edit in Obsidian) take the vault's version when there are no local edits
    useEffect(() => { if (!dirty) setList(initial()); }, [data.configMtime]);
    const t = list[sel];
    const setT = (patch) => setList(list.map((x, i) => (i === sel ? { ...x, ...patch } : x)));
    const setField = (fi, patch) => setT({ fields: t.fields.map((f, i) => {
        if (i !== fi) return f;
        const next = { ...f, ...patch };
        // the key follows the label until it is edited by hand
        if ("label" in patch && f.key === defaultKey(f.label)) next.key = defaultKey(patch.label);
        next.id = fieldId(next.key);
        return next;
    }) });
    const moveField = (fi, by) => { const fs = [...t.fields]; const j = fi + by; if (j < 0 || j >= fs.length) return; [fs[fi], fs[j]] = [fs[j], fs[fi]]; setT({ fields: fs }); };
    const problems = t ? checkTemplate(normalizeTemplates({ [t.name || "x"]: t })[t.name || "x"]) : [];
    const holders = data.holders.filter((h) => h.template && (h.template === t?.orig || !t?.orig));
    const previewWith = previewOwner || holders[0]?.name || data.holders[0]?.name || "";
    useEffect(() => {
        if (!t || !previewWith) { setPreview(null); return; }
        const tm = setTimeout(() => api.send("POST", "/api/stats/view", { novel: folder, owner: previewWith, template: { ...t, name: t.name || "Draft" } }).then(setPreview).catch((e) => setPreview({ error: e.message })), 350);
        return () => clearTimeout(tm);
    }, [JSON.stringify(t), previewWith]);
    const charFields = useMemo(() => [...new Set([...(index.schema.characters?.fields.map(([k]) => k) ?? [])])], [index]);
    const sections = t ? [...new Set(t.fields.map((f) => f.section).filter(Boolean))] : [];
    const collections = Object.keys(index.schema.collections);
    const save = async () => {
        setBusy(true); setErr("");
        try {
            const renames = Object.fromEntries(list.filter((x) => x.orig && x.orig !== x.name).map((x) => [x.orig, x.name]));
            await api.send("POST", "/api/stats/templates", { novel: folder, templates: list.map(({ orig, ...x }) => x), renames, baseMtime: data.configMtime });
            setList(list.map((x) => ({ ...x, orig: x.name })));
            toast("Templates saved");
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const addTemplate = () => { const name = prompt("Template name", list.length ? "" : "Character"); if (!name?.trim()) return; setList([...list, blankTemplate(name.trim())]); setSel(list.length); };
    const templateUsers = data.holders.filter((h) => h.assigned && h.template === t?.orig).map((h) => h.name);
    const removeTemplate = () => {
        setList(list.filter((_, i) => i !== sel)); setSel(0);
    };
    return html`<div class="panel templates-editor">
        <div class="spread"><h2 style="margin:0">Stat templates</h2>
            <div class="row">${dirty && html`<span class="muted">unsaved changes</span>`}<button onClick=${addTemplate}>+ Template</button>
                <button class="primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save templates"}</button></div></div>
        ${err && html`<pre class="error" style="white-space:pre-wrap">${err}</pre>`}
        ${!list.length ? html`<p class="muted">No templates yet. A template lists the stats a character or creature has in this novel (Level, HP, Skills…) and how its stats panel looks.</p>`
        : html`<div class="tabs" style="margin-top:10px">${list.map((x, i) => html`<button class=${i === sel ? "on" : ""} onClick=${() => setSel(i)}>${x.name || "Untitled"}${x.default ? " ★" : ""}</button>`)}</div>
        <div class="formgrid template-meta">
            <label>Name</label><input value=${t.name} onInput=${(e) => setT({ name: e.target.value })} />
            <label>Description</label><input value=${t.description} onInput=${(e) => setT({ description: e.target.value })} placeholder="What this template is for" />
            <label>Options</label><div class="row">
                <label class="row"><input type="checkbox" style="width:auto" checked=${t.default} onChange=${(e) => setList(list.map((x, i) => ({ ...x, default: i === sel ? e.target.checked : e.target.checked ? false : x.default })))} /> default for characters</label>
                <label class="row"><input type="checkbox" style="width:auto" checked=${t["show-empty"]} onChange=${(e) => setT({ "show-empty": e.target.checked })} /> show empty fields in panels</label>
                <label class="row muted">callout <input style="width:110px" value=${t.callout} onInput=${(e) => setT({ callout: e.target.value })} /></label>
                <${ConfirmButton} onConfirm=${removeTemplate}
                    title=${templateUsers.length ? `${templateUsers.length} notes use it: ${templateUsers.slice(0, 5).join(", ")}${templateUsers.length > 5 ? "…" : ""}` : "No notes use it"}>Delete template<//></div>
        </div>
        <h3 style="margin-top:14px">Fields</h3>
        <datalist id="stat-sections">${sections.map((s) => html`<option value=${s} />`)}</datalist>
        <datalist id="char-fields">${charFields.map((k) => html`<option value=${k} />`)}</datalist>
        <div class="field-list">${t.fields.map((f, fi) => html`<div class="field-row" key=${fi}>
            <div class="field-main">
                <input aria-label="Label" placeholder="Label" value=${f.label} onInput=${(e) => setField(fi, { label: e.target.value })} />
                <select aria-label="Type" value=${f.type} onChange=${(e) => setField(fi, { type: e.target.value })}>${Object.entries(FIELD_TYPES).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select>
                <input aria-label="Section" placeholder="Section (optional)" list="stat-sections" value=${f.section} onInput=${(e) => setField(fi, { section: e.target.value })} />
                <input aria-label="Frontmatter key" class="mono" title="Frontmatter key on the sheet" value=${f.key} onInput=${(e) => setField(fi, { key: e.target.value })} />
                <span class="row"><button class="small" title="Move up" onClick=${() => moveField(fi, -1)}>↑</button><button class="small" title="Move down" onClick=${() => moveField(fi, 1)}>↓</button>
                    <${ConfirmButton} title="Remove field" confirmLabel="Confirm" onConfirm=${() => setT({ fields: t.fields.filter((_, i) => i !== fi) })}>×<//></span>
            </div>
            <div class="field-opts">
                ${(f.type === "number" || f.type === "resource") && html`
                    <label class="row"><input type="checkbox" style="width:auto" checked=${f.integer} onChange=${(e) => setField(fi, { integer: e.target.checked })} /> whole numbers</label>
                    <label class="row">min <input type="number" style="width:80px" value=${f.min ?? ""} onInput=${(e) => setField(fi, { min: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                    <label class="row">${f.type === "resource" ? "fixed max" : "max"} <input type="number" style="width:80px" value=${f.max ?? ""} onInput=${(e) => setField(fi, { max: e.target.value === "" ? null : Number(e.target.value) })} /></label>`}
                ${f.type === "resource" && html`<label class="row">max from <select value=${f["max-field"]} onChange=${(e) => setField(fi, { "max-field": e.target.value })}><option value="">its own value (80/100)</option>
                    ${t.fields.filter((x) => x !== f && (x.type === "number" || x.type === "computed")).map((x) => html`<option value=${x.key}>${x.label}</option>`)}</select></label>`}
                ${f.type === "choice" && html`<label class="row" style="flex:1">options <input style="flex:1" value=${f.options.join(", ")} placeholder="Common, Rare, Epic" onChange=${(e) => setField(fi, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></label>`}
                ${(f.type === "link" || f.type === "links") && html`
                    <label class="row">from <select value=${f.collection} onChange=${(e) => setField(fi, { collection: e.target.value })}><option value="">any note</option>${collections.map((c) => html`<option value=${c}>${collectionLabel(c)}</option>`)}</select></label>
                    <label class="row"><input type="checkbox" style="width:auto" checked=${f.describe} onChange=${(e) => setField(fi, { describe: e.target.checked })} /> show descriptions in panels</label>`}
                ${f.type === "computed" && html`<label class="row" style="flex:1">formula <input class="mono" style="flex:1" value=${f.formula} placeholder="strength * 2 + floor(level / 5)" onInput=${(e) => setField(fi, { formula: e.target.value })} /></label>
                    <span class="muted">names: ${t.fields.filter((x) => x !== f).map((x) => x.id).join(", ") || "—"}</span>`}
                ${(f.type === "number" || f.type === "resource" || f.type === "computed") && html`<label class="row">unit <input style="width:70px" value=${f.unit} onInput=${(e) => setField(fi, { unit: e.target.value })} /></label>`}
                ${f.type !== "computed" && html`<label class="row" title="Use this character frontmatter field as the value until a Stats entry sets one">prefill from <input class="mono" style="width:150px" list="char-fields" value=${f.source} placeholder="sheet field" onInput=${(e) => setField(fi, { source: e.target.value })} /></label>`}
            </div>
        </div>`)}</div>
        <button class="small" onClick=${() => setT({ fields: [...t.fields, blankField()] })}>+ Field</button>
        ${problems.length > 0 && html`<div class="warnbox" style="margin-top:10px">${problems.map((p) => html`<div>${p}</div>`)}</div>`}
        <div class="grid2" style="margin-top:14px">
            <details open=${!!t.panel}><summary><b>Custom panel layout</b> <span class="muted">(optional; the default is built from the sections)</span></summary>
                <textarea class="mono" style="min-height:160px;margin-top:6px" value=${t.panel} onInput=${(e) => setT({ panel: e.target.value })}
                    placeholder=${`[!${t.callout}] {{ownerName}}\n**Level:** {{stat.level}}\n{{#sections}}\n#### {{name}}\n{{#fields}}\n**{{label}}:** {{value}}\n{{/fields}}\n{{/sections}}`} />
                <p class="muted" style="font-size:12px">Values: ${t.fields.map((f) => `{{stat.${f.id}}}`).join(" ") || "add fields first"}. Lists of links: ${"{{#list.<name>}}{{title}} {{description}}{{/list.<name>}}"}. Written without "> ".</p>
            </details>
            <div><div class="spread"><b>Preview</b>
                <select value=${previewWith} onChange=${(e) => setPreviewOwner(e.target.value)}>${data.holders.map((h) => html`<option value=${h.name}>${h.name}</option>`)}</select></div>
                ${preview?.error ? html`<p class="error">${preview.error}</p>` : preview?.panel ? html`<${CalloutRender} text=${preview.panel} />` : html`<p class="muted">${data.holders.length ? "…" : "No characters to preview with."}</p>`}
            </div>
        </div>`}
    </div>`;
}

const NOVEL_TABS = [["plan", "Grand plan"], ["plots", "Plots"], ["people", "Characters & ledgers"], ["stats", "Stats"]];

function NovelView({ folder }) {
    const { data: novel, error } = useApi(`/api/novel?${qs({ folder })}`);
    const { data: plan } = useApi(`/api/plan?${qs({ novel: folder })}`);
    const [tab, setTabState] = useState(store.get("novelTab", "plan"));
    const setTab = (t) => { setTabState(t); store.set("novelTab", t); };
    if (!novel) return html`<${Loading} error=${error} />`;
    return html`<div>
        <div class="spread">
            <div><div class="muted">${novel.folder}</div><h1>${novel.name}</h1></div>
            <div class="row">
                <${NovelColour} novel=${novel} />
                <button class="primary" onClick=${() => go(entryHref(folder, {}))}>New entry</button>
                <button onClick=${() => go(`#/newchar/${encodeURIComponent(folder)}`)}>New character</button>
                <button onClick=${() => go(`#/callouts/${encodeURIComponent(folder)}`)}>Callouts</button>
                <button onClick=${async () => { const r = await api.send("POST", `/api/sync-sheets?${qs({ novel: folder })}`); toast(`Synced ${r.filter((x) => x.changed.length).length} sheets`); }}>Sync sheets</button>
            </div>
        </div>
        <div class="tabs">${NOVEL_TABS.map(([k, label]) => html`<button class=${tab === k ? "on" : ""} onClick=${() => setTab(k)}>${label}</button>`)}</div>
        <div class="tab-body" key=${tab}>
            ${tab === "people" ? html`<${NovelPeople} folder=${folder} novel=${novel} />`
                : tab === "stats" ? html`<${StatsTab} folder=${folder} novel=${novel} />`
                : !plan ? html`<${Loading} />`
                : tab === "plots" ? html`<${PlotBoard} folder=${folder} plan=${plan} />`
                : html`<${GrandPlan} folder=${folder} plan=${plan} />`}
        </div>
    </div>`;
}

/** The novel's accent colour, saved as `accent` in its config.md */
function NovelColour({ novel }) {
    const index = useIndex();
    const current = novelColour(index, novel.folder) ?? "#6a4fc4";
    const save = async (set, unset = []) => {
        try { await api.send("PATCH", "/api/note", { path: novel.configPath, set, unset, baseMtime: novel.configMtime }); toast("Novel colour saved"); }
        catch (e) { toast(e.message); }
    };
    return html`<label class="novel-colour muted" title="Saved as accent in config.md">Colour
        <input type="color" value=${current} onChange=${(e) => save({ accent: e.target.value })} />
        ${novel.config.accent && html`<button class="small" onClick=${(e) => { e.preventDefault(); save({}, ["accent"]); }}>Default</button>`}
    </label>`;
}

function NovelPeople({ folder, novel }) {
    const characterNames = new Set(novel.characters.map((c) => c.name.toLowerCase()));
    const otherOwners = [...new Set(novel.ledgers.map((l) => l.owner))].filter((o) => !characterNames.has(o.toLowerCase()));
    const ledgersOf = (o) => novel.ledgers.filter((l) => l.owner.toLowerCase() === o.toLowerCase());
    return html`<div>
        <h2 style="margin-top:0">Characters</h2>
        <div class="cards">${novel.characters.map((c) => html`<a class="card" href=${ownerHref(folder, c.name)}>
            ${c.cover && html`<div class="cover" style=${`background-image:url("${c.cover}")`} />`}
            <div class="body"><h3>${c.name}</h3>
                <div>${ledgersOf(c.name).map((l) => html`<span class="chip">${l.type} ${l.entries}</span>`)}</div>
                <p>${c.fm.personality ?? ""}</p></div></a>`)}</div>
        ${otherOwners.length > 0 && html`<h2>Other ledger owners</h2><div class="cards">${otherOwners.map((o) => html`<a class="card" href=${ownerHref(folder, o)}><div class="body"><h3>${o}</h3><div>${ledgersOf(o).map((l) => html`<span class="chip">${l.type} ${l.entries}</span>`)}</div></div></a>`)}</div>`}
        <h2>Ledger types</h2>
        <div class="panel"><table><tbody>${Object.values(novel.ledgerTypes).map((t) => html`<tr><td><b>${t.name}</b></td><td><span class="badge">${t.behaviour}</span></td><td class="muted">${t.description ?? ""}</td><td>${Object.keys(t.callouts).map((c) => html`<span class="chip">${c}</span>`)}</td></tr>`)}</tbody></table></div>
    </div>`;
}

/** Link value -> plot of this novel (by name, alias-free like the rest of the vault) */
const plotByLink = (plan, v) => plan.plots.find((p) => p.name.toLowerCase() === linkTarget(v).toLowerCase()) ?? null;
const linkTarget = (v) => String(v ?? "").replace(/^!?\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();
const ratingLink = (r) => (r.name === r.title ? toLink(r.name) : `[[${r.name}|${r.title}]]`);

function PlotChip({ plan, value, main }) {
    const p = plotByLink(plan, value);
    const label = p?.title ?? linkLabel(value);
    if (!p) return html`<span class="chip unresolved" title="No plot note with this name">${label}</span>`;
    return html`<a class=${`chip plot-chip ${main ? "main" : ""}`} href=${noteHref(p.path)} title=${main ? "Main plot" : "Subplot"}>${main ? "★ " : ""}${label}</a>`;
}

function ChapterRow({ folder, c }) {
    return html`<a class="chapter-row" href=${chapterHref(folder, c.number)} data-flip=${`ch|${c.number}`}>
        <div class="chapter-head">
            <span class="badge">${c.number}</span>
            <b>${c.title || html`<span class="muted">Untitled</span>`}</b>
            ${c.written ? html`<span class="badge ok">written</span>` : c.notePath ? html`<span class="badge" title="The chapter note has no text yet">empty note</span>` : html`<span class="badge">planned</span>`}
            ${c.draft && html`<span class="badge">draft</span>`}
            ${!c.plan.trim() && html`<span class="badge warn">no plan</span>`}
            ${c.entries > 0 && html`<span class="chip">${c.entries} entries</span>`}
        </div>
        ${c.plan.trim() && html`<${PlanView} text=${c.plan} limit=${3} />`}
    </a>`;
}

function GrandPlan({ folder, plan }) {
    const flip = useFlip();
    const nonDraft = plan.chapters.filter((c) => !c.draft);
    const inVolume = (v) => nonDraft.filter((c) => c.volume === v.path);
    const loose = nonDraft.filter((c) => !c.volume);
    const drafts = plan.chapters.filter((c) => c.draft);
    const lastChapter = Math.max(0, ...nonDraft.map((c) => c.number));
    const newVolume = async () => {
        const title = prompt("Volume title");
        if (!title?.trim()) return;
        const prev = plan.volumes.at(-1);
        const start = (prev?.end ?? lastChapter) + 1;
        try {
            const r = await api.send("POST", "/api/plan/volume", { novel: folder, title: title.trim(), fm: { number: (prev?.number ?? 0) + 1, "chapter-start": start } });
            openInDrawer(noteHref(r.path));
        } catch (e) { toast(e.message); }
    };
    const nextIn = (v, list) => {
        const n = Math.max((v.start ?? 1) - 1, ...list.map((c) => c.number)) + 1;
        return v.end == null || n <= v.end ? n : null;
    };
    return html`<div ref=${flip} data-drawer>
        <div class="spread" style="margin-bottom:12px">
            <p class="muted" style="margin:0">${plan.volumes.length} volumes · ${nonDraft.length} chapters · ${nonDraft.filter((c) => c.plan.trim()).length} planned</p>
            <div class="row">
                <a class="button" href=${chapterHref(folder, lastChapter + 1)}>Plan chapter ${lastChapter + 1}</a>
                <button class="primary" onClick=${newVolume}>New volume</button>
            </div>
        </div>
        ${!plan.volumes.length && html`<p class="muted">No volumes yet. A volume groups a chapter range and the plots it covers.</p>`}
        ${plan.volumes.map((v) => {
            const list = inVolume(v);
            const next = nextIn(v, list);
            return html`<section class="panel volume" key=${v.path} data-flip=${`vol|${v.path}`}>
                <div class="spread">
                    <h2><a href=${noteHref(v.path)}>${v.number != null ? html`<span class="muted">Volume ${v.number} · </span>` : ""}${v.title}</a></h2>
                    <span class="muted">Chapters ${v.start ?? "?"}–${v.end ?? "…"} · ${list.length} listed</span>
                </div>
                <div class="volume-plots">
                    ${v.fm.plot && html`<${PlotChip} plan=${plan} value=${v.fm.plot} main=${true} />`}
                    ${asList(v.fm.subplots).map((sp) => html`<${PlotChip} plan=${plan} value=${sp} />`)}
                </div>
                ${v.fm.description && html`<p>${v.fm.description}</p>`}
                ${String(v.fm.plan ?? "").trim() && html`<details class="volume-outline"><summary>Volume outline</summary><${PlanView} text=${v.fm.plan} /></details>`}
                <div class="chapter-list">${list.map((c) => html`<${ChapterRow} key=${c.number} folder=${folder} c=${c} />`)}</div>
                ${next != null && html`<a class="add-chapter" href=${chapterHref(folder, next)}>+ Plan chapter ${next}</a>`}
            </section>`;
        })}
        ${loose.length > 0 && html`<section class="panel volume" data-flip="vol|loose"><h2>Not in a volume</h2>
            <p class="muted">Set a volume's chapter range to include these.</p>
            <div class="chapter-list">${loose.map((c) => html`<${ChapterRow} key=${c.number} folder=${folder} c=${c} />`)}</div></section>`}
        ${drafts.length > 0 && html`<section class="panel volume" data-flip="vol|drafts"><h2>Drafts <span class="muted" style="font-size:13px">chapter ${plan.draftFrom}+</span></h2>
            <div class="chapter-list">${drafts.map((c) => html`<${ChapterRow} key=${c.number} folder=${folder} c=${c} />`)}</div></section>`}
    </div>`;
}

function PlotBoard({ folder, plan }) {
    const flip = useFlip();
    const usage = (p) => plan.volumes.flatMap((v) => [
        ...(plotByLink(plan, v.fm.plot)?.path === p.path ? [{ v, main: true }] : []),
        ...asList(v.fm.subplots).filter((sp) => plotByLink(plan, sp)?.path === p.path).map(() => ({ v, main: false })),
    ]);
    const groups = [...plan.ratings.map((r) => [r, plan.plots.filter((p) => p.rating?.path === r.path)]), [null, plan.plots.filter((p) => !p.rating)]]
        .filter(([r, list]) => list.length || r);
    const newPlot = async () => {
        const title = prompt("Plot title");
        if (!title?.trim()) return;
        try { const r = await api.send("POST", "/api/plan/plot", { novel: folder, title: title.trim() }); openInDrawer(noteHref(r.path)); }
        catch (e) { toast(e.message); }
    };
    const grade = async (p, path) => {
        const r = plan.ratings.find((x) => x.path === path);
        try { await api.send("PATCH", "/api/note", { path: p.path, set: { rating: r ? ratingLink(r) : "" }, baseMtime: p.mtime }); toast(`${p.title}: ${r?.title ?? "unrated"}`); }
        catch (e) { toast(e.message); }
    };
    return html`<div ref=${flip} data-drawer>
        <div class="spread" style="margin-bottom:12px">
            <p class="muted" style="margin:0">${plan.plots.length} plot ideas, graded by Rating</p>
            <button class="primary" onClick=${newPlot}>New plot</button>
        </div>
        ${groups.map(([r, list]) => html`<section class="plot-grade" key=${r?.path ?? "none"}>
            <h2>${r ? r.title : "Unrated"} <span class="muted" style="font-size:13px">${list.length}</span></h2>
            ${list.length ? html`<div class="plot-cards">${list.map((p) => html`<div class="plot-card" key=${p.path} data-flip=${`plot|${p.path}`}>
                <div class="spread">
                    <a class="plot-title" href=${noteHref(p.path)}>${p.title}</a>
                    <select value=${p.rating?.path ?? ""} onChange=${(e) => grade(p, e.target.value)} title="Grade">
                        <option value="">Unrated</option>
                        ${plan.ratings.map((x) => html`<option value=${x.path}>${x.title}</option>`)}
                    </select>
                </div>
                <div>${usage(p).map((u) => html`<span class=${`chip ${u.main ? "on" : ""}`}>${u.main ? "★ " : ""}Vol ${u.v.number ?? "?"} ${u.main ? "main" : "sub"}</span>`)}
                    ${p.fm.mood && html`<span class="chip">${p.fm.mood}</span>`}
                    ${asList(p.fm.characters).map((c) => html`<span class="chip">${linkLabel(c)}</span>`)}</div>
                <p class="plot-text">${String(p.fm.plot ?? "").trim() || html`<span class="muted">No plot text yet.</span>`}</p>
            </div>`)}</div>` : html`<p class="muted">None.</p>`}
        </section>`)}
    </div>`;
}

function EntryCard({ e, folder, behaviour, future, showOwner }) {
    const [showText, setShowText] = useState(false);
    const del = async () => {
        try { await api.send("DELETE", `/api/ledger/entry?${qs({ ledger: e.ledger, key: e.key })}`); toast("Deleted"); } catch (x) { toast(x.message); }
    };
    const copyLinked = async () => { const r = await api.get(`/api/callout?${qs({ ledger: e.ledger, key: e.key, linked: 1 })}`); copyText(r.text, `Copied ${r.count} linked callouts`); };
    return html`<div class=${`entry ${future ? "future" : ""}`}>
        <div class="spread">
            <h4><span class="badge">${e.key}</span> ${e.title || html`<span class="muted">untitled</span>`}
                ${showOwner && html` <span class="muted">· <a href=${ownerHref(folder, e.owner)}>${e.owner}</a> · ${e.type}</span>`}</h4>
            <div class="row">
                ${e.placed ? html`<span class="badge ok" title=${`Marker found in ${e.placed}`}>in chapter text</span>` : e.fields["mirror-of"] ? html`<span class="badge">mirror</span>` : html`<span class="badge warn">not in text yet</span>`}
                <button class="small" onClick=${() => copyText(e.callout)}>⧉ Copy</button>
                ${e.fields.ref && html`<button class="small" onClick=${copyLinked}>⧉ Linked</button>`}
                <button class="small" onClick=${() => setShowText(!showText)}>${showText ? "Hide" : "Callout"}</button>
                ${!e.fields["mirror-of"] && html`<button class="small" onClick=${() => go(entryHref(folder, { owner: e.owner, type: e.type, ledger: e.ledger, key: e.key }))}>Edit</button>`}
                <${ConfirmButton} title=${`Delete ${e.key} ${e.title}`} onConfirm=${del}>Delete<//>
            </div>
        </div>
        ${Object.entries(e.fields).filter(([k]) => !["id", "ref", "mirror-of"].includes(k)).map(([k, v]) => html`<span class="chip"><b>${k}</b> ${v}</span>`)}
        ${e.lines.length > 0 && html`<ul style="margin:6px 0 0;padding-left:18px">${e.lines.map((l) => html`<li>${behaviour === "state"
            ? html`<b>${l.set}</b>${l.with ? html` (${linkLabel(l.with)})` : ""} → ${linkLabel(l.value ?? "")}`
            : html`<span class="badge">${l.action ?? "add"}</span> ${l.qty ?? 1}${l.unit ? ` ${l.unit}` : ""} ${isLink(l.item) ? html`<${Chip} value=${l.item} />` : html`<span class="chip unresolved" title="Misc item, no data note">${l.item}</span>`}
                ${l.to ? html` → ${linkLabel(l.to)}` : ""}${l["to-store"] ? html` → ${l["to-store"]}` : ""}${l.from ? html` ← ${linkLabel(l.from)}` : ""}${l.store && l.store !== "inventory" ? html` <span class="muted">@ ${l.store}</span>` : ""}${l.note ? html` <span class="muted">(${l.note})</span>` : ""}`}</li>`)}</ul>`}
        ${e.body && behaviour === "log" && html`<div class="md" style="margin-top:6px;white-space:pre-wrap">${e.body}</div>`}
        ${showText && html`<pre>${e.callout}</pre>`}
    </div>`;
}

function OwnerView({ folder, owner, params }) {
    const [at, setAt] = useState(params.get("at") ? Number(params.get("at")) : null);
    const [compare, setCompare] = useState(null);
    const [tab, setTab] = useState(params.get("type") ?? null);
    const { data, error } = useApi(`/api/owner?${qs({ novel: folder, owner, at, compare })}`);
    const { data: novel } = useApi(`/api/novel?${qs({ folder })}`);
    if (!data || !novel) return html`<${Loading} error=${error} />`;
    const chapter = at ?? data.latestChapter;
    const types = data.ledgers.map((l) => l.type);
    const current = data.ledgers.find((l) => l.type === (tab ?? types[0]));
    const behaviour = current?.computed.behaviour;
    const missingTypes = Object.keys(novel.ledgerTypes).filter((t) => !types.includes(t));
    const sheet = data.sheet;
    return html`<div>
        <div class="spread">
            <div><div class="muted"><a href=${novelHref(folder)}>${novel.name}</a></div><h1>${owner}</h1></div>
            <div class="row">
                ${sheet && html`<button onClick=${() => go(noteHref(sheet.path))}>Sheet</button>`}
                <button class="primary" onClick=${() => go(entryHref(folder, { owner, type: current?.type ?? "Inventory" }))}>New ${current?.type ?? ""} entry</button>
            </div>
        </div>
        ${sheet && html`<div class="panel"><div class="row" style="align-items:flex-start">
            ${sheet.images[0] && html`<img src=${sheet.images[0]} style="height:110px;border-radius:6px" />`}
            <div style="flex:1"><dl class="fields">${["race", "member-of", "character/power-system", "character/level", "character/sub-level", "character/talent", "alive", "age-current"].filter((k) => sheet.fm[k] != null && sheet.fm[k] !== "").map((k) => html`<dt>${k}</dt><dd><${Value} v=${sheet.fm[k]} links=${sheet.links} /></dd>`)}</dl></div>
        </div></div>`}
        <div class="panel slider">
            <b>Chapter</b>
            <input type="range" min="0" max=${data.latestChapter} value=${chapter} onInput=${(e) => setAt(Number(e.target.value))} />
            <input type="number" min="0" value=${chapter} style="width:70px" onInput=${(e) => setAt(Number(e.target.value))} />
            <label class="row muted"><input type="checkbox" style="width:auto" checked=${compare != null} onChange=${(e) => setCompare(e.target.checked ? Math.max(0, chapter - 1) : null)} /> compare with</label>
            ${compare != null && html`<input type="number" min="0" value=${compare} style="width:70px" onInput=${(e) => setCompare(Number(e.target.value))} />`}
        </div>
        <${StatsPanel} folder=${folder} owner=${owner} at=${chapter} />
        <div class="tabs">
            ${data.ledgers.map((l) => html`<button class=${l === current ? "on" : ""} onClick=${() => setTab(l.type)}>${l.type} <span class="muted">${l.entries.length}</span></button>`)}
            ${missingTypes.length > 0 && html`<select onChange=${(e) => e.target.value && go(entryHref(folder, { owner, type: e.target.value }))} style="margin-left:8px"><option value="">+ start a ledger…</option>${missingTypes.map((t) => html`<option>${t}</option>`)}</select>`}
        </div>
        ${!current ? html`<p class="muted">No ledgers yet.</p>` : html`
            ${current.computed.warnings.length > 0 && html`<div class="warnbox">${current.computed.warnings.map((w) => html`<div>${w.entry}: ${w.message}</div>`)}</div>`}
            ${behaviour === "stock" && html`<div class="grid2">
                <div class="panel"><h3>Held at chapter ${chapter}</h3>${holdingsTable(current.computed.stacks)}</div>
                ${current.computed.diff && html`<div class="panel"><h3>Changes from chapter ${compare} to ${chapter}</h3>
                    <table><tbody>${current.computed.diff.map((d) => html`<tr><td>${d.itemPath ? html`<a href=${noteHref(d.itemPath)}>${d.itemName}</a>` : d.itemName}</td><td class="muted">${d.store}</td><td class="num" style=${`color:var(${d.change > 0 ? "--ok" : "--bad"})`}>${d.changeText}</td></tr>`)}</tbody></table></div>`}
            </div>`}
            ${behaviour === "state" && html`<div class="panel"><h3>Values at chapter ${chapter}</h3>
                <table><tbody>${current.computed.values.map((v) => html`<tr><td><b>${v.field}</b>${v.with ? html` · ${v.withName}` : ""}</td><td>${linkLabel(v.value)}</td><td class="muted">since ${v.entry}</td></tr>`)}</tbody></table></div>`}
            <h3>Entries</h3>
            ${[...current.entries].reverse().map((e) => html`<${EntryCard} e=${e} folder=${folder} behaviour=${behaviour} future=${e.chapter > chapter} />`)}
        `}
    </div>`;
}

// ------------------------------------------------------------------ stats: panels on owner and note pages

const originText = (o) => (!o ? "" : o.from === "ledger" ? `ch ${o.chapter}` : o.from === "source" ? `from ${o.field}` : "sheet");

/** Stat values at a chapter as a table plus the stats panel callout */
function StatsPanel({ folder, owner, at }) {
    const { data, error } = useApi(`/api/stats?${qs({ novel: folder, owner, at })}`);
    if (error || !data) return null;
    if (!data.template) return html`<div class="panel muted">No stat template for ${owner}. Assign one on the novel's Stats tab${data.templates.length ? "" : " (create a template first)"}.</div>`;
    const t = data.template;
    return html`<div class="panel stats-panel">
        <div class="spread"><h3 style="margin:0">${t.name} stats${data.chapter != null ? html` <span class="muted" style="font-weight:400">at chapter ${data.chapter}</span>` : ""}</h3>
            <div class="row"><a class="button" href=${entryHref(folder, { owner, type: "Stats", chapter: data.chapter ?? "" })}>Change stats</a>
                <button class="small" onClick=${() => copyText(data.panel, "Copied stats panel")}>⧉ Copy panel</button></div></div>
        ${data.problems.length > 0 && html`<div class="warnbox">${data.problems.map((p) => html`<div>${p}</div>`)}</div>`}
        <div class="grid2" style="margin-top:8px">
            <table><tbody>${t.fields.map((f) => html`<tr><td class="muted">${f.section ? `${f.section} · ` : ""}${f.label}</td>
                <td>${f.type === "link" || f.type === "links" ? html`<${Value} v=${data.values[f.key]} />` : data.display[f.key] || html`<span class="muted">—</span>`}</td>
                <td class="muted" style="font-size:12px">${f.type === "computed" ? "computed" : originText(data.origin[f.key])}</td></tr>`)}</tbody></table>
            <div><${CalloutRender} text=${data.panel} /></div>
        </div>
    </div>`;
}

/** Data store creature: its base stats in each novel, and adding it to another novel */
function CreatureNovels({ page, index }) {
    const [novel, setNovel] = useState("");
    const [tpl, setTpl] = useState("");
    const { data: ns } = useApi(novel ? `/api/stats/novel?${qs({ novel })}` : null);
    const used = new Set(page.creatureStats.map((u) => u.novel));
    const add = async () => {
        try { const r = await api.send("POST", "/api/stats/creature", { novel, creature: toLink(page.name), template: tpl }); openInDrawer(noteHref(r.path)); }
        catch (e) { toast(e.message); }
    };
    const names = ns ? Object.keys(ns.templates) : [];
    return html`<div class="panel" data-drawer><h3>Stats in novels</h3>
        ${page.creatureStats.length ? page.creatureStats.map((u) => html`<div><a href=${noteHref(u.path)}>${u.novelName}</a> <span class="muted">${u.template ?? "no template"}</span></div>`) : html`<p class="muted">Not used in any novel yet.</p>`}
        <div class="row" style="margin-top:8px">
            <select value=${novel} onChange=${(e) => { setNovel(e.target.value); setTpl(""); }}><option value="">Add to novel…</option>
                ${(index?.novels ?? []).filter((n) => !used.has(n.folder)).map((n) => html`<option value=${n.folder}>${n.name}</option>`)}</select>
            ${novel && html`<select value=${tpl} onChange=${(e) => setTpl(e.target.value)}><option value="">${names.length ? "Template…" : "No templates in this novel"}</option>${names.map((n) => html`<option>${n}</option>`)}</select>
                <button class="primary small" disabled=${!tpl} onClick=${add}>Add</button>`}
        </div>
    </div>`;
}

function holdingsTable(stacks) {
    if (!stacks.length) return html`<p class="muted">Nothing held.</p>`;
    const byStore = new Map();
    for (const s of stacks) { if (!byStore.has(s.store)) byStore.set(s.store, []); byStore.get(s.store).push(s); }
    return html`${[...byStore.entries()].map(([st, list]) => html`<div style="margin-bottom:8px"><b class="muted">${st}</b>
        <table><tbody>${list.map((s) => html`<tr><td>${s.itemPath ? html`<a href=${noteHref(s.itemPath)}>${s.itemName}</a>` : html`<span title="Misc item">${s.itemName} <span class="badge">misc</span></span>`}${s.condition ? html` <span class="muted">(${s.condition})</span>` : ""}</td><td class="num" style=${s.qty < 0 ? "color:var(--bad)" : ""}>${s.qtyText}</td></tr>`)}</tbody></table></div>`)}`;
}

/** A chapter's plan (and working title while there's no chapter note); saved with "Save changes" */
function ChapterPlan({ folder, n, plan, hasNote, scope }) {
    const server = { plan: String(plan?.fm.plan ?? ""), title: String(plan?.fm.title ?? "") };
    const mtime = plan?.mtime ?? 0;
    const [edits, setEdits] = useState({});
    const [baseMtime, setBaseMtime] = useState(null);
    const [saved, setSaved] = useState({ mtime: 0, vals: {} });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const cur = mtime >= saved.mtime ? server : { ...server, ...saved.vals };
    const val = (k) => (k in edits ? edits[k] : cur[k]);
    const changed = Object.keys(edits).filter((k) => edits[k] !== cur[k]);
    const dirty = changed.length > 0;
    const key = `plan:${folder}:${n}`;
    useEffect(() => markDirty(scope, key, dirty), [dirty]);
    useEffect(() => () => markDirty(scope, key, false), []);
    const edit = (k, v) => { if (baseMtime == null) setBaseMtime(mtime); setEdits((s) => ({ ...s, [k]: v })); };
    const reset = () => { setEdits({}); setBaseMtime(null); setErr(""); };
    const save = async () => {
        if (!dirty || busy) return;
        setBusy(true); setErr("");
        try {
            const set = Object.fromEntries(changed.map((k) => [k, edits[k]]));
            const r = await api.send("POST", "/api/plan/chapter", { novel: folder, n, set, baseMtime: plan ? baseMtime ?? mtime : undefined });
            setSaved({ mtime: r.mtime, vals: { ...(mtime >= saved.mtime ? {} : saved.vals), ...set } });
            reset();
            toast("Plan saved");
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    return html`<div class="panel chapter-plan" onKeyDown=${(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); } }}>
        <div class="spread"><h2 style="margin:0">Plan</h2>${plan && html`<a class="muted" href=${noteHref(plan.path)} title="The plan note in the vault">${plan.path.split("/").pop().replace(/\.md$/, "")}</a>`}</div>
        ${!hasNote && html`<label class="row muted" style="margin:8px 0">Working title
            <input style="flex:1" value=${val("title")} onInput=${(e) => edit("title", e.target.value)} placeholder="Chapter title" /></label>`}
        <${PlanEditor} value=${val("plan")} onChange=${(v) => edit("plan", v)} />
        ${err && html`<p class="error">${err}</p>`}
        <div class=${`savebar ${dirty ? "dirty" : ""}`}>
            <button class="primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save changes"}</button>
            ${dirty && html`<button onClick=${reset}>Discard</button><span class="muted">Ctrl+S</span>`}
        </div>
    </div>`;
}

function ChapterView({ folder, n, scope = "page" }) {
    const num = Number(n);
    const { data, error } = useApi(`/api/chapter?${qs({ novel: folder, n: num })}`);
    const { data: novel } = useApi(`/api/novel?${qs({ folder })}`);
    const [type, setType] = useState("");
    if (!data || !novel) return html`<${Loading} error=${error} />`;
    const entries = data.entries.filter((e) => !type || e.type === type);
    const types = [...new Set(data.entries.map((e) => e.type))];
    const beh = (t) => novel.ledgerTypes[t]?.behaviour;
    const title = data.chapter?.title || data.plan?.fm.title || "";
    const unplaced = data.entries.filter((e) => !e.placed && !e.fields["mirror-of"]).length;
    return html`<div>
        <div class="spread">
            <div><div class="muted"><a href=${novelHref(folder)} data-page>${novel.name}</a>${data.volume && html` · <a href=${noteHref(data.volume.path)}>${data.volume.label}</a>`}</div>
                <h1>Chapter ${num}${title ? `: ${title}` : ""}</h1></div>
            <div class="row">
                ${data.prev != null && html`<a class="button" href=${chapterHref(folder, data.prev)}>← ${data.prev}</a>`}
                ${html`<a class="button" href=${chapterHref(folder, data.next ?? num + 1)}>${data.next ?? num + 1} →</a>`}
            </div>
        </div>
        <p class="row">
            ${data.chapter ? html`<a href=${noteHref(data.chapter.path)}>Open chapter note</a>` : html`<span class="badge">not written yet</span>`}
            ${data.entries.length > 0 && html`<span class="muted">${unplaced} ${unplaced === 1 ? "entry" : "entries"} not yet in the chapter text</span>`}
        </p>
        <${ChapterPlan} key=${`${folder}:${num}`} folder=${folder} n=${num} plan=${data.plan} hasNote=${!!data.chapter} scope=${scope} />
        <div class="spread" style="margin-top:18px">
            <h2 style="margin:0">Ledger entries <span class="muted" style="font-size:13px">${data.entries.length}</span></h2>
            <div class="row">
                <button class="primary" onClick=${() => go(entryHref(folder, { chapter: num }))}>New entry</button>
                <button disabled=${!entries.length} onClick=${() => copyText(entries.map((e) => e.callout).join("\n\n"), `Copied ${entries.length} callouts`)}>⧉ Copy all</button>
            </div>
        </div>
        ${types.length > 1 && html`<div class="row" style="margin:10px 0">${[["", "All"], ...types.map((t) => [t, t])].map(([t, label]) => html`<a class=${`chip ${type === t ? "on" : ""}`} href="javascript:" onClick=${() => setType(t)}>${label}</a>`)}</div>`}
        <div style="margin-top:10px">${entries.length ? entries.map((e) => html`<${EntryCard} e=${e} folder=${folder} behaviour=${beh(e.type)} showOwner=${true} />`) : html`<p class="muted">No entries in this chapter.</p>`}</div>
    </div>`;
}

// ------------------------------------------------------------------ entry editor

const ACTIONS = ["add", "remove", "move", "transfer-out"];
const UNITS = ["ea", "g", "kg", "t"];

function ItemPicker({ value, index, onChange, onCreate }) {
    const options = useMemo(() => [...(index?.inCollection("Items") ?? []), ...(index?.inCollection("Materials") ?? [])]
        .map((n) => ({ label: n.name, hint: n.collection === "Materials" ? "material" : linkLabel(asList(n.fm.cat)[0] ?? "") })), [index]);
    return html`<${Picker} value=${linkLabel(value ?? "")} options=${options} placeholder="Item, material or misc text"
        onChange=${(o) => onChange(o ? (o.free ? o.label : toLink(o.label)) : "")} onCreate=${onCreate} createLabel="Create data entry for" />`;
}

function CreateItemForm({ name, index, onSave, onCancel }) {
    const [collection, setCollection] = useState("Items");
    const [fm, setFm] = useState({ cat: [], rarity: "", description: "" });
    const target = collection === "Items" ? "Taxonomy/Item Categories" : "Taxonomy/Material Categories";
    return html`<div class="panel" style="background:var(--panel-2)">
        <b>New data entry: ${name}</b>
        <div class="formgrid" style="margin-top:8px">
            <label>Collection</label><select value=${collection} onChange=${(e) => setCollection(e.target.value)}><option>Items</option><option>Materials</option></select>
            <label>Category</label><${LinkField} value=${fm.cat} multiple=${true} target=${target} index=${index} onChange=${(v) => setFm({ ...fm, cat: v })} />
            <label>Rarity</label><${LinkField} value=${fm.rarity} multiple=${false} target="Taxonomy/Rarity" index=${index} onChange=${(v) => setFm({ ...fm, rarity: v })} />
            <label>Description</label><textarea style="font-family:inherit" value=${fm.description} onInput=${(e) => setFm({ ...fm, description: e.target.value })} />
        </div>
        <div class="row" style="margin-top:8px"><button class="primary" onClick=${() => onSave({ collection, name, fm })}>Add with entry</button><button onClick=${onCancel}>Cancel</button></div>
        <p class="muted">The note is created when you save the entry.</p>
    </div>`;
}

function LinesEditor({ behaviour, lines, setLines, index, novel, owner, createNotes, setCreateNotes, withTarget }) {
    const [creating, setCreating] = useState(null); // {row, name}
    const owners = useMemo(() => [...new Set([...novel.characters.map((c) => c.name), ...novel.ledgers.map((l) => l.owner)])].filter((o) => o !== owner).map((o) => ({ label: o })), [novel, owner]);
    const conditions = index?.inCollection("Taxonomy/Item Condition").map((n) => n.fm.title ?? n.name) ?? [];
    const upd = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    const remove = (i) => setLines(lines.filter((_, j) => j !== i));
    if (behaviour === "state") {
        return html`<table class="lines-editor"><thead><tr><th>field</th>${withTarget && html`<th>with</th>`}<th>value</th><th></th></tr></thead><tbody>
            ${lines.map((l, i) => html`<tr>
                <td><input list="setfields" value=${l.set ?? ""} onInput=${(e) => upd(i, { set: e.target.value })} /></td>
                ${withTarget && html`<td><${Picker} value=${linkLabel(l.with ?? "")} options=${owners} onChange=${(o) => upd(i, { with: o ? toLink(o.label) : "" })} /></td>`}
                <td><input value=${l.value ?? ""} onInput=${(e) => upd(i, { value: e.target.value })} placeholder="value or [[link]]" /></td>
                <td><${ConfirmButton} confirmLabel="Confirm" onConfirm=${() => remove(i)}>×<//></td></tr>`)}
            </tbody></table>
            <datalist id="setfields">${[...new Set([...(novel.setFields ?? []), ...(index?.schema.characters?.fields.map(([k]) => k) ?? [])])].map((f) => html`<option value=${f} />`)}</datalist>
            <button class="small" onClick=${() => setLines([...lines, withTarget ? { set: "relation", with: "", value: "" } : { set: "", value: "" }])}>+ Line</button>`;
    }
    return html`<table class="lines-editor"><thead><tr><th style="width:110px">action</th><th>item</th><th style="width:70px">qty</th><th style="width:64px">unit</th><th style="width:110px">condition</th><th>store</th><th>to</th><th>note</th><th></th></tr></thead><tbody>
        ${lines.map((l, i) => html`<tr>
            <td><select value=${l.action ?? "add"} onChange=${(e) => upd(i, { action: e.target.value })}>${ACTIONS.map((a) => html`<option>${a}</option>`)}</select></td>
            <td><${ItemPicker} value=${l.item} index=${index} onChange=${(v) => upd(i, { item: v })} onCreate=${(name) => setCreating({ row: i, name })} />
                ${createNotes.some((c) => toLink(c.name) === l.item) && html`<span class="badge ok">new entry</span>`}</td>
            <td><input value=${l.qty ?? "1"} onInput=${(e) => upd(i, { qty: e.target.value })} /></td>
            <td><select value=${l.unit ?? "ea"} onChange=${(e) => upd(i, { unit: e.target.value === "ea" ? "" : e.target.value })}>${UNITS.map((u) => html`<option>${u}</option>`)}</select></td>
            <td><select value=${l.condition ?? ""} onChange=${(e) => upd(i, { condition: e.target.value ? toLink(e.target.value) : "" })}><option value=""></option>${conditions.map((c) => html`<option value=${c} selected=${linkLabel(l.condition ?? "") === c}>${c}</option>`)}</select></td>
            <td><input list="stores" value=${l.store ?? ""} placeholder="inventory" onInput=${(e) => upd(i, { store: e.target.value })} /></td>
            <td>${l.action === "transfer-out" ? html`<${Picker} value=${linkLabel(l.to ?? "")} options=${owners} placeholder="receiver" onChange=${(o) => upd(i, { to: o ? toLink(o.label) : "" })} />`
                : l.action === "move" ? html`<input list="stores" value=${l["to-store"] ?? ""} placeholder="to store" onInput=${(e) => upd(i, { "to-store": e.target.value })} />` : ""}</td>
            <td><input value=${l.note ?? ""} onInput=${(e) => upd(i, { note: e.target.value })} /></td>
            <td><${ConfirmButton} confirmLabel="Confirm" onConfirm=${() => remove(i)}>×<//></td></tr>`)}
        </tbody></table>
        <datalist id="stores">${["inventory", ...(novel.stores ?? [])].map((s) => html`<option value=${s} />`)}</datalist>
        <button class="small" onClick=${() => setLines([...lines, { action: "add", item: "", qty: "1" }])}>+ Line</button>
        ${creating && html`<${CreateItemForm} name=${creating.name} index=${index} onCancel=${() => setCreating(null)}
            onSave=${(c) => { setCreateNotes([...createNotes.filter((x) => x.name !== c.name), c]); upd(creating.row, { item: toLink(c.name) }); setCreating(null); }} />`}`;
}

function EntryFields({ type, entry, setEntry }) {
    const fields = Object.entries(type?.fields ?? {}).filter(([k]) => k !== "callout");
    const variants = Object.keys(type?.callouts ?? {});
    return html`
        ${fields.map(([k, f]) => html`<label>${f.label ?? k}</label><input value=${entry.fields[k] ?? ""} onInput=${(e) => setEntry({ ...entry, fields: { ...entry.fields, [k]: e.target.value } })} />`)}
        ${variants.length > 1 && html`<label>Callout</label><select value=${entry.fields.callout ?? ""} onChange=${(e) => setEntry({ ...entry, fields: { ...entry.fields, callout: e.target.value } })}>
            <option value="">default (${type["default-callout"] ?? "default"})</option>${variants.map((v) => html`<option>${v}</option>`)}</select>`}`;
}

// ------------------------------------------------------------------ stats: inputs

/** Comma separated list input that keeps what you type until you leave it */
function ListInput({ value, onChange, placeholder = "comma separated" }) {
    const [text, setText] = useState(asList(value).join(", "));
    useEffect(() => { if (document.activeElement?.dataset?.listInput !== "1") setText(asList(value).join(", ")); }, [JSON.stringify(value)]);
    return html`<input data-list-input="1" value=${text} placeholder=${placeholder} onInput=${(e) => { setText(e.target.value); onChange(fromText({ type: "list" }, e.target.value)); }}
        onBlur=${() => setText(asList(value).join(", "))} />`;
}

/** Typed input for one stat field; values are typed (numbers, booleans, arrays of links...) */
function StatInput({ field, value, onChange, index, template, values }) {
    const f = field;
    switch (f.type) {
        case "number":
            return html`<input type="number" step=${f.integer ? 1 : "any"} min=${f.min ?? undefined} max=${f.max ?? undefined} value=${value ?? ""}
                onInput=${(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />`;
        case "boolean":
            return html`<select value=${value === true ? "yes" : value === false ? "no" : ""} onChange=${(e) => onChange(e.target.value === "" ? "" : e.target.value === "yes")}>
                <option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select>`;
        case "choice":
            return html`<select value=${value ?? ""} onChange=${(e) => onChange(e.target.value)}><option value="">—</option>
                ${f.options.map((o) => html`<option value=${o}>${o}</option>`)}${value && !f.options.includes(value) && html`<option value=${value}>${value} (not an option)</option>`}</select>`;
        case "list": return html`<${ListInput} value=${value} onChange=${onChange} />`;
        case "link": case "links":
            return html`<${LinkField} value=${f.type === "links" ? asList(value) : value || ""} multiple=${f.type === "links"} target=${f.collection || ""} index=${index} onChange=${onChange} />`;
        case "longtext": return html`<${AutoTextarea} value=${value} onInput=${(e) => onChange(e.target.value)} style="font-family:inherit" />`;
        case "resource": {
            const r = parseResource(value) ?? { cur: "", max: null };
            const fixedMax = f["max-field"] || f.max != null;
            const set = (cur, max) => onChange(cur === "" ? "" : fixedMax || max === "" || max == null ? String(cur) : `${cur}/${max}`);
            return html`<span class="resource-input">
                <input type="number" aria-label=${`${f.label} current`} value=${r.cur} onInput=${(e) => set(e.target.value, r.max ?? "")} />
                <span class="muted">/</span>
                ${fixedMax ? html`<span class="muted" title=${f["max-field"] ? `Max from ${f["max-field"]}` : "Fixed max"}>${template && values ? displayValue(template, f, { ...values, [f.key]: String(r.cur || 0) }).split("/")[1] ?? "?" : f.max ?? "max"}</span>`
                    : html`<input type="number" aria-label=${`${f.label} max`} value=${r.max ?? ""} placeholder="max" onInput=${(e) => set(r.cur, e.target.value)} />`}
            </span>`;
        }
        case "computed": return html`<span class="muted" title=${f.formula}>${template && values ? displayValue(template, f, computeValues(template, values)) || "—" : "computed"}</span>`;
        default: return html`<input value=${value ?? ""} onInput=${(e) => onChange(e.target.value)} />`;
    }
}

const statError = (index, f, v) => checkValue(f, v, { resolve: (x) => { const n = index?.resolve(x); return n ? { path: n.path, collection: n.collection } : null; } });

/**
 * Stats entry lines as a form over the owner's template: every field starts at its previous value; only the
 * fields you change become `set` lines. Lines for other fields stay in the generic editor below.
 */
function StatLinesEditor({ template, before, lines, setLines, index }) {
    const lineFor = (f) => lines.find((l) => !l.with && namesField(f, l.set));
    const valueOf = (f) => { const l = lineFor(f); return l ? fromText(f, l.value) : before[f.key]; };
    const current = Object.fromEntries(template.fields.map((f) => [f.key, valueOf(f)]));
    const setField = (f, v) => {
        const rest = lines.filter((l) => l !== lineFor(f));
        const same = JSON.stringify(v ?? "") === JSON.stringify(before[f.key] ?? "") || (Array.isArray(v) && !v.length && (before[f.key] == null || before[f.key] === ""));
        setLines(same ? rest : [...rest, { set: f.key, value: toText(f, v) }]);
    };
    const sections = [...new Set(template.fields.map((f) => f.section))];
    return html`<div class="stat-lines">
        <div class="spread"><b>${template.name} <span class="muted" style="font-weight:400">stats</span></b>
            <span class="muted">${lines.filter((l) => fieldNamed(template, l.set)).length} changed</span></div>
        ${sections.map((s) => html`${s && html`<h4 class="stat-section">${s}</h4>`}
            <div class="formgrid">${template.fields.filter((f) => f.section === s).map((f) => {
                const changed = !!lineFor(f);
                const err = f.type !== "computed" && statError(index, f, current[f.key]);
                return html`<label class=${changed ? "changed" : ""} title=${f.key}>${f.label}</label>
                    <div class="stat-cell">
                        <${StatInput} field=${f} value=${current[f.key]} onChange=${(v) => setField(f, v)} index=${index} template=${template} values=${current} />
                        <span class="muted stat-was">${f.type === "computed" ? "" : changed ? html`was ${displayValue(template, f, before) || "—"} <button class="small" onClick=${() => setField(f, before[f.key])}>undo</button>` : "unchanged"}</span>
                        ${err && html`<div class="error">${err}</div>`}
                    </div>`;
            })}</div>`)}
    </div>`;
}

function EntryEditor({ index, folder, params }) {
    const { data: novel } = useApi(`/api/novel?${qs({ folder })}`);
    const editKey = params.get("key");
    const [owner, setOwner] = useState(params.get("owner") ?? "");
    const [typeName, setTypeName] = useState(params.get("type") ?? "Inventory");
    const { data: ownerData } = useApi(editKey && owner ? `/api/owner?${qs({ novel: folder, owner })}` : null);
    const [entry, setEntry] = useState(null);
    const [lines, setLines] = useState([]);
    const [createNotes, setCreateNotes] = useState([]);
    const [linked, setLinked] = useState(null); // {type, entry:{title, fields, body}, lines}
    const [preview, setPreview] = useState(null);
    const [err, setErr] = useState("");
    const [busy, setBusy] = useState(false);
    const [baseMtime, setBaseMtime] = useState(null);

    useEffect(() => {
        if (!novel || entry) return;
        if (editKey) {
            if (!ownerData) return;
            const l = ownerData.ledgers.find((x) => x.path === params.get("ledger"));
            const e = l?.entries.find((x) => x.key === editKey);
            if (!e) { setErr("Entry not found"); return; }
            setEntry({ chapter: e.chapter, title: e.title, fields: e.fields, body: e.body });
            setLines(e.lines);
            setBaseMtime(l.mtime);
        } else {
            setEntry({ chapter: Number(params.get("chapter") ?? novel.latestChapter), title: "", fields: {}, body: "" });
            setLines(novel.ledgerTypes[typeName]?.behaviour === "stock" ? [{ action: "add", item: "", qty: "1" }] : []);
        }
    }, [novel, ownerData]);

    const type = novel?.ledgerTypes[typeName];
    const payload = useMemo(() => entry && ({
        novel: folder, owner, type: typeName, replaceKey: editKey ?? undefined, baseMtime: baseMtime ?? undefined,
        entry: { ...entry, lines: lines.filter((l) => l.item || l.set) }, createNotes,
        linked: linked ? [{ type: linked.type, entry: { ...linked.entry, lines: linked.lines.filter((l) => l.item || l.set) } }] : [],
    }), [entry, lines, createNotes, linked, owner, typeName]);

    useEffect(() => {
        if (!payload || !owner || !type) return;
        const t = setTimeout(() => api.send("POST", "/api/ledger/preview", payload).then(setPreview).catch((e) => setPreview({ error: e.message })), 300);
        return () => clearTimeout(t);
    }, [payload]);

    if (!novel || !entry) return html`<${Loading} error=${err} />`;
    const owners = [...new Set([...novel.characters.map((c) => c.name), ...novel.ledgers.map((l) => l.owner)])].map((o) => ({ label: o }));
    const save = async (copy) => {
        setBusy(true); setErr("");
        try {
            const r = await api.send("POST", "/api/ledger/entry", payload);
            if (copy) await copyText(r.linkedCallout || r.callout, "Saved and copied callout");
            else toast("Saved");
            go(ownerHref(folder, owner) + `?type=${encodeURIComponent(typeName)}`);
        } catch (e) { setErr(e.message); }
        setBusy(false);
    };
    const linkedType = linked && novel.ledgerTypes[linked.type];
    const withTarget = typeName === "Relationships" || !!type?.["with-target"];
    // a state ledger for an owner with a stat template edits as a form prefilled with the previous values
    const statTemplate = type?.behaviour === "state" && !withTarget && preview?.stats?.template ? preview.stats.template : null;
    const otherLines = statTemplate ? lines.filter((l) => !fieldNamed(statTemplate, l.set)) : [];
    return html`<div>
        <div class="muted"><a href=${novelHref(folder)}>${novel.name}</a></div>
        <h1>${editKey ? `Edit entry ${editKey}` : "New entry"}</h1>
        <div class="grid2" style="grid-template-columns: minmax(0,1.4fr) minmax(0,1fr)">
            <div>
                <div class="panel"><div class="formgrid">
                    <label>Owner</label>${editKey ? html`<b style="padding-top:5px">${owner}</b>` : html`<${Picker} value=${owner} options=${owners} placeholder="Character or other owner" onChange=${(o) => setOwner(o?.label ?? "")} autoFocus=${!owner} />`}
                    <label>Ledger</label>${editKey ? html`<b style="padding-top:5px">${typeName}</b>` : html`<select value=${typeName} onChange=${(e) => { setTypeName(e.target.value); setLines(novel.ledgerTypes[e.target.value]?.behaviour === "stock" ? [{ action: "add", item: "", qty: "1" }] : []); }}>${Object.values(novel.ledgerTypes).map((t) => html`<option value=${t.name}>${t.name} (${t.behaviour})</option>`)}</select>`}
                    <label>Chapter</label><input type="number" min="0" value=${entry.chapter} onInput=${(e) => setEntry({ ...entry, chapter: Number(e.target.value) })} style="width:90px" />
                    <label>Title</label><input value=${entry.title} onInput=${(e) => setEntry({ ...entry, title: e.target.value })} placeholder="Short summary of the event" />
                    <${EntryFields} type=${type} entry=${entry} setEntry=${setEntry} />
                </div></div>
                ${type?.behaviour === "log" ? html`<div class="panel"><b>Text</b><textarea style="min-height:220px;font-family:inherit;font-size:14px" value=${entry.body} onInput=${(e) => setEntry({ ...entry, body: e.target.value })} /></div>`
                : statTemplate ? html`<div class="panel"><${StatLinesEditor} template=${statTemplate} before=${preview.stats.before} lines=${lines} setLines=${setLines} index=${index} /></div>
                    <details class="panel" open=${otherLines.length > 0}><summary class="muted">Other fields (not in the ${statTemplate.name} template)</summary>
                        <div style="overflow-x:auto;margin-top:8px"><${LinesEditor} behaviour="state" lines=${otherLines} setLines=${(ls) => setLines([...lines.filter((l) => !otherLines.includes(l)), ...ls])} index=${index} novel=${novel} owner=${owner}
                            createNotes=${createNotes} setCreateNotes=${setCreateNotes} withTarget=${false} /></div></details>`
                : html`<div class="panel" style="overflow-x:auto"><${LinesEditor} behaviour=${type?.behaviour} lines=${lines} setLines=${setLines} index=${index} novel=${novel} owner=${owner}
                    createNotes=${createNotes} setCreateNotes=${setCreateNotes} withTarget=${withTarget} /></div>`}
                ${!editKey && html`<div class="panel">
                    ${!linked ? html`<div class="row"><b>Linked entry</b><span class="muted">for another ledger of the same owner, e.g. a journal entry's reward</span>
                        <select onChange=${(e) => e.target.value && setLinked({ type: e.target.value, entry: { title: "", fields: {}, body: "" }, lines: novel.ledgerTypes[e.target.value].behaviour === "stock" ? [{ action: "add", item: "", qty: "1" }] : [] })}>
                            <option value="">+ add…</option>${Object.keys(novel.ledgerTypes).filter((t) => t !== typeName).map((t) => html`<option>${t}</option>`)}</select></div>`
                    : html`<div class="spread"><b>Linked ${linked.type} entry</b><${ConfirmButton} onConfirm=${() => setLinked(null)}>Remove<//></div>
                        <div class="formgrid" style="margin-top:8px"><label>Title</label><input value=${linked.entry.title} onInput=${(e) => setLinked({ ...linked, entry: { ...linked.entry, title: e.target.value } })} />
                            <${EntryFields} type=${linkedType} entry=${linked.entry} setEntry=${(en) => setLinked({ ...linked, entry: en })} /></div>
                        ${linkedType.behaviour === "log" ? html`<textarea style="margin-top:8px;font-family:inherit" value=${linked.entry.body} onInput=${(e) => setLinked({ ...linked, entry: { ...linked.entry, body: e.target.value } })} />`
                        : html`<div style="margin-top:8px;overflow-x:auto"><${LinesEditor} behaviour=${linkedType.behaviour} lines=${linked.lines} setLines=${(ls) => setLinked({ ...linked, lines: ls })} index=${index} novel=${novel} owner=${owner} createNotes=${createNotes} setCreateNotes=${setCreateNotes} withTarget=${linked.type === "Relationships"} /></div>`}`}
                </div>`}
                ${err && html`<p class="error">${err}</p>`}
                <div class="row">
                    <button class="primary" disabled=${busy || !owner} onClick=${() => save(true)}>Save & copy callout</button>
                    <button disabled=${busy || !owner} onClick=${() => save(false)}>Save</button>
                    <button onClick=${() => history.back()}>Cancel</button>
                </div>
            </div>
            <div>
                <div class="panel"><b>Callout preview</b>
                    ${preview?.error ? html`<p class="error">${preview.error}</p>` : preview ? html`<pre class="callout-text">${preview.callout}</pre><${CalloutRender} text=${preview.callout} />` : html`<p class="muted">Choose an owner to preview.</p>`}
                </div>
                ${preview?.warnings?.length > 0 && html`<div class="warnbox">${preview.warnings.map((w) => html`<div>${w.message}</div>`)}</div>`}
                ${preview?.after && html`<div class="panel"><b>Held after this entry (chapter ${entry.chapter})</b>${holdingsTable(preview.after)}</div>`}
                ${preview?.stats?.panel && html`<div class="panel"><div class="spread"><b>Stats panel after this entry</b><button class="small" onClick=${() => copyText(preview.stats.panel, "Copied stats panel")}>⧉ Copy</button></div>
                    <${CalloutRender} text=${preview.stats.panel} /></div>`}
            </div>
        </div>
    </div>`;
}

function CalloutRender({ text }) {
    const [out, setOut] = useState("");
    useEffect(() => {
        const t = setTimeout(() => api.send("POST", "/api/render", { markdown: text }).then((r) => setOut(r.html)).catch(() => {}), 200);
        return () => clearTimeout(t);
    }, [text]);
    return html`<${Html} html=${out} />`;
}

// ------------------------------------------------------------------ callout settings

function CalloutSettings({ folder }) {
    const { data: novel } = useApi(`/api/novel?${qs({ folder })}`);
    const [draft, setDraft] = useState(null);
    const [err, setErr] = useState("");
    useEffect(() => { if (novel && !draft) setDraft(JSON.parse(JSON.stringify(novel.config["ledger-types"] ?? {}))); }, [novel]);
    if (!novel || !draft) return html`<${Loading} />`;
    const setCallout = (type, name, text) => setDraft((d) => ({ ...d, [type]: { ...(d[type] ?? {}), callouts: { ...(d[type]?.callouts ?? {}), [name]: text } } }));
    const removeCallout = (type, name) => setDraft((d) => { const c = { ...(d[type]?.callouts ?? {}) }; delete c[name]; return { ...d, [type]: { ...d[type], callouts: c } }; });
    const setDefault = (type, name) => setDraft((d) => ({ ...d, [type]: { ...(d[type] ?? {}), "default-callout": name || undefined } }));
    const save = async () => {
        setErr("");
        const clean = {};
        for (const [t, def] of Object.entries(draft)) {
            const x = { ...def };
            if (x.callouts && !Object.keys(x.callouts).length) delete x.callouts;
            if (!x["default-callout"]) delete x["default-callout"];
            if (Object.keys(x).length) clean[t] = x;
        }
        try {
            await api.send("PATCH", "/api/note", Object.keys(clean).length ? { path: novel.configPath, set: { "ledger-types": clean }, baseMtime: novel.configMtime } : { path: novel.configPath, unset: ["ledger-types"], baseMtime: novel.configMtime });
            toast("Saved to config.md");
            setDraft(null);
        } catch (e) { setErr(e.message); }
    };
    return html`<div>
        <div class="muted"><a href=${novelHref(folder)}>${novel.name}</a></div>
        <h1>Callout templates</h1>
        <p class="muted">Overrides are saved under <code>ledger-types</code> in <code>${novel.configPath}</code>. Shared defaults live in <code>90. Templater/Ledger Types.md</code>.</p>
        ${Object.values(novel.ledgerTypes).map((t) => {
            const own = draft[t.name]?.callouts ?? {};
            const names = [...new Set([...Object.keys(t.sharedCallouts), ...Object.keys(own)])];
            return html`<div class="panel">
                <div class="spread"><h2 style="margin:0">${t.name} <span class="badge">${t.behaviour}</span></h2>
                    <label class="row muted">Default variant <select value=${draft[t.name]?.["default-callout"] ?? ""} onChange=${(e) => setDefault(t.name, e.target.value)}>
                        <option value="">inherit (${t.sharedCallouts && t["default-callout"] ? t["default-callout"] : "default"})</option>${names.map((n) => html`<option>${n}</option>`)}</select></label></div>
                ${names.map((n) => html`<div style="margin-top:10px">
                    <div class="spread"><b>${n}</b>${n in own ? html`<span class="row"><span class="badge ok">novel override</span><${ConfirmButton} onConfirm=${() => removeCallout(t.name, n)}>Use shared<//></span>` : html`<span class="row"><span class="badge">shared</span><button class="small" onClick=${() => setCallout(t.name, n, t.sharedCallouts[n])}>Override for this novel</button></span>`}</div>
                    ${n in own ? html`<textarea value=${own[n]} onInput=${(e) => setCallout(t.name, n, e.target.value)} />` : html`<pre class="callout-text">${t.sharedCallouts[n]}</pre>`}
                </div>`)}
                <button class="small" style="margin-top:8px" onClick=${() => { const n = prompt("Variant name"); if (n) setCallout(t.name, n.trim(), "[!note] {{title}}\n{{body}}\n{{eventLink}}"); }}>+ New variant</button>
            </div>`;
        })}
        ${err && html`<p class="error">${err}</p>`}
        <div class="row"><button class="primary" onClick=${save}>Save</button><button onClick=${() => setDraft(null)}>Discard changes</button></div>
    </div>`;
}

// ------------------------------------------------------------------ QA

function QAView() {
    const { data, error } = useApi("/api/qa");
    if (!data) return html`<${Loading} error=${error} />`;
    const promote = async (m) => {
        const collection = prompt(`Create a data note for “${m.item}” in which collection? (Items or Materials)`, "Items");
        if (!collection) return;
        try { const r = await api.send("POST", "/api/promote-misc", { novel: m.novel, item: m.item, collection }); toast(`Created and relinked ${r.changed} lines`); }
        catch (e) { toast(e.message); }
    };
    const misc = new Map();
    for (const m of data.misc) { const k = `${m.novel}|${m.item.toLowerCase()}`; if (!misc.has(k)) misc.set(k, { ...m, count: 0 }); misc.get(k).count++; }
    const section = (title, list, row) => html`<div class="panel"><h3>${title} <span class="badge ${list.length ? "warn" : "ok"}">${list.length}</span></h3>${list.length ? html`<table><tbody>${list.slice(0, 300).map(row)}</tbody></table>` : html`<p class="muted">None.</p>`}</div>`;
    return html`<div>
        <h1>Quality checks</h1>
        ${section("Ledger problems", data.ledgers, (x) => html`<tr><td><a href=${noteHref(x.ledger)}>${x.ledger.split("/").pop()}</a></td><td>${x.entry}</td><td>${x.message}</td></tr>`)}
        ${section("Stat problems", data.stats ?? [], (x) => html`<tr><td><a href=${noteHref(x.path)}>${x.name}</a></td><td class="muted">${x.novel}</td><td>${x.message}</td></tr>`)}
        ${section("Misc items (no data note)", [...misc.values()], (m) => html`<tr><td>${m.item}</td><td class="muted">${m.novel} · ${m.count} line${m.count > 1 ? "s" : ""}</td><td><button class="small" onClick=${() => promote(m)}>Create entry & relink</button></td></tr>`)}
        ${section("Unresolved links", data.unresolved, (x) => html`<tr><td><a href=${noteHref(x.path)}>${x.path.split("/").pop()}</a></td><td>${x.field}</td><td>${x.value}</td></tr>`)}
        ${section("Name collisions", data.collisions, (x) => html`<tr><td>${x.name}</td><td>${x.paths.map((p) => html`<div><a href=${noteHref(p)}>${p}</a></div>`)}</td></tr>`)}
        ${section("Untitled notes", data.untitled, (x) => html`<tr><td><a href=${noteHref(x.path)}>${x.path}</a></td></tr>`)}
        ${section("Unreadable frontmatter", data.fmErrors, (x) => html`<tr><td><a href=${noteHref(x.path)}>${x.path}</a></td><td class="muted">${x.error}</td></tr>`)}
    </div>`;
}

// ------------------------------------------------------------------ settings

/** The vault folder: shown, typed or picked from a folder browser; switching reloads the app on the new vault */
function SettingsView({ settings }) {
    const [path, setPath] = useState(settings?.vault ?? "");
    const [browse, setBrowse] = useState(settings?.vault ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const { data: dir, error: dirError } = useApi(`/api/settings/folders?${qs({ path: browse })}`);
    useEffect(() => { if (settings?.vault && !path) { setPath(settings.vault); setBrowse(settings.vault); } }, [settings?.vault]);
    if (!settings) return html`<${Loading} />`;
    const use = async (folder) => {
        setBusy(true); setError(null);
        try {
            await api.send("POST", "/api/settings", { vault: folder });
            location.hash = "#/";
            location.reload();
        } catch (e) { setError(e.message); setBusy(false); }
    };
    const SOURCES = { settings: "chosen here", BOOKS_VAULT: "from the service settings (BOOKS_VAULT)", "--vault": "from the --vault option" };
    return html`<div class="settings">
        <h1>Settings</h1>
        <div class="panel">
            <h3>Vault folder</h3>
            ${settings.vault
                ? html`<p><code>${settings.vault}</code></p>
                    <p class="muted">${settings.notes} notes · ${SOURCES[settings.source] ?? settings.source}${settings.looksLikeVault ? "" : " · no .obsidian folder here, so Obsidian hasn't opened it as a vault"}</p>
                    ${!settings.hasSchema && html`<p class="muted">This vault has no <code>90. Templater/Data Store Schema.md</code> yet. Run <code>npm run seed -- "${settings.vault}"</code> to add the schema, ledger types and a basic taxonomy.</p>`}
                    ${settings.overridden && html`<p class="muted">The app was started with <code>--vault</code>, which wins over a folder chosen here when it restarts.</p>`}`
                : html`<p>${settings.problem ?? "No vault folder chosen yet."} Choose your Obsidian vault below.</p>`}
            <div class="row settings-path">
                <input type="text" value=${path} placeholder="/path/to/Obsidian/vault" aria-label="Vault folder" onInput=${(e) => setPath(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && path.trim() && use(path.trim())} />
                <button class="primary" disabled=${busy || !path.trim() || path.trim() === settings.vault} onClick=${() => use(path.trim())}>${busy ? "Opening…" : "Use this folder"}</button>
            </div>
            ${error && html`<p class="error">${error}</p>`}
            <p class="muted">Saved in <code>${settings.settingsFile}</code>, so it is kept when the app restarts.</p>
        </div>
        <div class="panel folder-picker">
            <h3>Browse</h3>
            ${dirError && html`<p class="error">${dirError}</p>`}
            ${dir && html`<div class="row">
                    <button class="small" disabled=${!dir.parent} onClick=${() => setBrowse(dir.parent)}>↑ Up</button>
                    <button class="small" onClick=${() => setBrowse(dir.home)}>Home</button>
                    <code class="picker-here">${dir.path}</code>
                    <button class="small" onClick=${() => setPath(dir.path)}>Choose this folder</button>
                </div>
                <ul class="folders">
                    ${dir.folders.map((f) => html`<li><button class="link" onClick=${() => setBrowse(f.path)}>${f.name}</button>${f.vault && html` <span class="badge ok">vault</span>`}
                        ${f.vault && html` <button class="small" onClick=${() => setPath(f.path)}>Choose</button>`}</li>`)}
                    ${!dir.folders.length && html`<li class="muted">No folders here.</li>`}
                </ul>`}
        </div>
    </div>`;
}

// ------------------------------------------------------------------ app

function App() {
    const route = useRoute();
    const { data: settings } = useApi("/api/settings");
    const noVault = settings && !settings.vault;
    const index = useIndex(!noVault);
    const [novelFilter, setNovelFilter] = useState(store.get("novelFilter", ""));
    const setNF = (v) => { setNovelFilter(v); store.set("novelFilter", v); };
    const [a, b] = route.args;
    useEffect(() => collapseDrawer(), [location.hash]);
    // the novel you're in tints the app; data store pages follow the novel filter
    const novelFolder = !index ? null
        : ["novel", "owner", "chapter", "entry", "callouts", "newchar"].includes(route.name) ? a
        : route.name === "note" || route.name === "edit" ? index.novels.find((n) => a?.startsWith(`${n.folder}/`))?.folder ?? null
        : index.novels.find((n) => n.name === novelFilter)?.folder ?? null;
    const accent = novelColour(index, novelFolder);
    useEffect(() => applyNovelAccent(accent), [accent]);
    let view;
    switch (route.name) {
        case "c": view = html`<${CollectionView} index=${index} collection=${a} novelFilter=${novelFilter} />`; break;
        case "edit": // old edit links: notes are editable on their page
        case "note": view = html`<${NoteView} key=${a} index=${index} path=${a} />`; break;
        case "new": view = html`<${NoteForm} key=${a} index=${index} collection=${a} />`; break;
        case "newchar": view = html`<${NoteForm} key=${a} index=${index} collection="characters" novel=${a} />`; break;
        case "novel": view = html`<${NovelView} key=${a} folder=${a} />`; break;
        case "owner": view = html`<${OwnerView} key=${a + b} folder=${a} owner=${b} params=${route.params} />`; break;
        case "chapter": view = html`<${ChapterView} key=${a + b} folder=${a} n=${b} />`; break;
        case "entry": view = html`<${EntryEditor} key=${location.hash} index=${index} folder=${a} params=${route.params} />`; break;
        case "callouts": view = html`<${CalloutSettings} key=${a} folder=${a} />`; break;
        case "qa": view = html`<${QAView} />`; break;
        case "settings": view = html`<${SettingsView} settings=${settings} />`; break;
        case "world": view = html`<${WorldView} key=${a ?? ""} index=${index} world=${a ?? null} params=${route.params} />`; break;
        case "map": view = html`<${MapEditor} key=${a} index=${index} location=${a} />`; break;
        default: view = html`<${Home} index=${index} />`;
    }
    // no vault folder yet: the Settings page is all there is
    if (noVault) view = html`<${SettingsView} settings=${settings} />`;
    return html`<div class="layout">
        <${Sidebar} index=${index} novelFolder=${novelFolder} />
        <main class="main">
            <div class="topbar"><${Search} index=${index} /><${NovelFilter} index=${index} value=${novelFilter} onChange=${setNF} /></div>
            <div class=${`view view-${route.name}`} key=${route.name + (a ?? "")}>${view}</div>
        </main>
        <${Drawer} index=${index} />
    </div>`;
}

render(html`<${App} />`, document.getElementById("app"));

// shared with world.js and map-editor.js (used only inside components, so the import cycle is safe)
export { api, useApi, qs, toast, store, go, noteHref, linkLabel, isLink, asList, openInDrawer, ConfirmButton, markDirty, confirmDiscard, Loading, useRoute };
