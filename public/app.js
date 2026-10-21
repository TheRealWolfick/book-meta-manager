// Books meta viewer front end: Preact + htm, no build step.
import { h, render } from "preact";
import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import htm from "htm";

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

let toastTimer;
function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.append(el); }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = "none"; }, 2200);
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

// ------------------------------------------------------------------ index context (data store listing)

function useIndex() {
    const { data } = useApi("/api/index");
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
function LinkField({ value, multiple, target, index, onChange }) {
    const options = useMemo(() => (index?.inCollection(target) ?? []).map((n) => ({ label: n.name, hint: n.fm.title !== n.name ? n.fm.title : "" })), [index, target]);
    const values = asList(value);
    const add = async (o) => {
        if (!o) return;
        let name = o.label;
        if (o.free && !index.resolve(name) && target) {
            if (!confirm(`Create “${name}” in ${collectionLabel(target)}?`)) return;
            const r = await api.send("POST", "/api/note", { collection: target, name });
            name = r.path.split("/").pop().replace(/\.md$/, "");
        }
        onChange(multiple ? [...values.filter((v) => linkLabel(v) !== name), toLink(name)] : toLink(name));
    };
    return html`<div>
        ${multiple && html`<div>${values.map((v) => html`<${Chip} value=${v} index=${index} onRemove=${() => onChange(values.filter((x) => x !== v))} />`)}</div>`}
        <${Picker} value=${multiple ? "" : linkLabel(value ?? "")} options=${options} onChange=${add} placeholder=${`Search ${collectionLabel(target)}…`} />
    </div>`;
}

// ------------------------------------------------------------------ layout

function Sidebar({ index }) {
    const active = (href) => (location.hash === href ? "active" : "");
    const [showTax, setShowTax] = useState(store.get("showTax", false));
    if (!index) return html`<nav class="sidebar"><div class="brand">Books Meta Viewer</div></nav>`;
    const cols = Object.keys(index.schema.collections);
    const main = cols.filter((c) => !c.startsWith("Taxonomy/"));
    const tax = cols.filter((c) => c.startsWith("Taxonomy/"));
    return html`<nav class="sidebar">
        <div class="brand"><a href="#/" style="padding:0">Books Meta Viewer</a></div>
        <h4>Novels</h4>
        ${index.novels.map((n) => html`<a class=${active(`#/novel/${encodeURIComponent(n.folder)}`)} href=${`#/novel/${encodeURIComponent(n.folder)}`}><span>${n.name}</span><span class="count">${n.number}</span></a>`)}
        <h4>Data store</h4>
        ${main.map((c) => html`<a class=${active(`#/c/${encodeURIComponent(c)}`)} href=${`#/c/${encodeURIComponent(c)}`}><span>${c}</span><span class="count">${index.counts[c] ?? 0}</span></a>`)}
        <h4 style="cursor:pointer" onClick=${() => { setShowTax(!showTax); store.set("showTax", !showTax); }}>Taxonomy ${showTax ? "▾" : "▸"}</h4>
        ${showTax && tax.map((c) => html`<a class=${active(`#/c/${encodeURIComponent(c)}`)} href=${`#/c/${encodeURIComponent(c)}`}><span>${collectionLabel(c)}</span><span class="count">${index.counts[c] ?? 0}</span></a>`)}
        <h4>Tools</h4>
        <a class=${active("#/qa")} href="#/qa"><span>Quality checks</span></a>
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
    useEffect(() => { setFilters({}); setQ(""); }, [collection]);
    if (!index) return html`<${Loading} />`;
    const col = index.schema.collections[collection];
    if (!col) return html`<p class="error">Unknown collection ${collection}</p>`;
    const all = index.inCollection(collection);
    const facetKeys = Object.keys(col.links).filter((k) => !["novels"].includes(k)).concat(col.fields.some(([k]) => k === "tier") ? ["tier"] : []);
    const values = (n, k) => asList(n.fm[k]).map((v) => (isLink(v) ? linkLabel(v) : String(v)));
    const base = all.filter((n) => !novelFilter || values(n, "novels").includes(novelFilter));
    const matches = base.filter((n) => {
        const t = q.trim().toLowerCase();
        if (t && !`${n.name} ${n.fm.title ?? ""} ${n.fm.description ?? ""}`.toLowerCase().includes(t)) return false;
        return Object.entries(filters).every(([k, set]) => !set.length || values(n, k).some((v) => set.includes(v)));
    });
    const facets = facetKeys.map((k) => {
        const counts = new Map();
        for (const n of matches) for (const v of values(n, k)) counts.set(v, (counts.get(v) ?? 0) + 1);
        for (const v of filters[k] ?? []) if (!counts.has(v)) counts.set(v, 0);
        return { key: k, values: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
    }).filter((f) => f.values.length > 1 || (filters[f.key]?.length));
    const toggle = (k, v) => setFilters((f) => { const cur = f[k] ?? []; return { ...f, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }; });
    const columns = col.fields.map(([k]) => k).filter((k) => !HIDDEN_COLS.has(k) && all.some((n) => asList(n.fm[k]).length && n.fm[k] !== false)).slice(0, 7);
    const sortVal = (n, k) => (k === "name" ? n.name.toLowerCase() : values(n, k).join(", ").toLowerCase());
    const sorted = [...matches].sort((a, b) => {
        const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
        const nx = Number(x), ny = Number(y);
        return (x !== "" && y !== "" && !isNaN(nx) && !isNaN(ny) ? nx - ny : x.localeCompare(y)) * sort.dir;
    });
    const th = (k, label = k) => html`<th onClick=${() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : 1 }))}>${label}${sort.key === k ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</th>`;
    return html`<div>
        <div class="spread">
            <h1>${collectionLabel(collection)} <span class="muted" style="font-size:14px">${matches.length} / ${base.length}</span></h1>
            <div class="row">
                <input placeholder="Filter…" value=${q} onInput=${(e) => setQ(e.target.value)} />
                <button onClick=${() => { const m = mode === "table" ? "cards" : "table"; setMode(m); store.set("viewMode", m); }}>${mode === "table" ? "Cards" : "Table"}</button>
                <button class="primary" onClick=${() => go(`#/new/${encodeURIComponent(collection)}`)}>New</button>
            </div>
        </div>
        <div class="facets">
            ${facets.map((f) => html`<div class="facet"><b>${f.key}</b>${f.values.slice(0, 40).map(([v, c]) => html`<a class=${`chip ${(filters[f.key] ?? []).includes(v) ? "on" : ""}`} href="javascript:" onClick=${() => toggle(f.key, v)}>${v} <span class="muted">${c}</span></a>`)}</div>`)}
        </div>
        ${mode === "cards" ? html`<div class="cards">${sorted.map((n) => html`<a class="card" href=${noteHref(n.path)}>
                ${n.cover && html`<div class="cover" style=${`background-image:url("${n.cover}")`} />`}
                <div class="body"><h3>${n.fm.title && n.fm.title !== n.name ? n.fm.title : n.name}</h3>
                    <div>${asList(n.fm.cat).slice(0, 3).map((v) => html`<span class="chip">${linkLabel(v)}</span>`)}${n.fm.tier ? html`<span class="badge">tier ${n.fm.tier}</span>` : ""}</div>
                    <p>${n.fm.description ?? ""}</p></div></a>`)}</div>`
        : html`<div class="panel" style="padding:0;overflow-x:auto"><table>
            <thead><tr>${th("name", "name")}${columns.map((k) => th(k))}<th>description</th></tr></thead>
            <tbody>${sorted.map((n) => html`<tr>
                <td><a href=${noteHref(n.path)}>${n.name}</a></td>
                ${columns.map((k) => html`<td><${Value} v=${n.fm[k]} index=${index} /></td>`)}
                <td class="desc">${String(n.fm.description ?? "").slice(0, 160)}</td>
            </tr>`)}</tbody></table></div>`}
    </div>`;
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

function Fields({ page, index, order }) {
    const keys = [...order.filter((k) => k in page.fm), ...Object.keys(page.fm).filter((k) => !order.includes(k))]
        .filter((k) => !["title", "description", "images"].includes(k));
    return html`<dl class="fields">${keys.map((k) => html`<dt>${k}</dt><dd><${Value} v=${page.fm[k]} links=${page.links} index=${index} /></dd>`)}</dl>`;
}

function NoteView({ index, path }) {
    const { data: page, error } = useApi(`/api/note?${qs({ path })}`);
    if (!page) return html`<${Loading} error=${error} />`;
    const schema = index?.schema;
    const order = (page.collection ? schema?.collections[page.collection]?.fields : page.fm.type === "character" ? schema?.characters?.fields : null)?.map(([k]) => k) ?? [];
    const novel = index?.novels.find((n) => page.path.startsWith(`${n.folder}/`));
    return html`<div>
        <div class="spread">
            <div>
                <div class="muted">${page.collection ? html`<a href=${`#/c/${encodeURIComponent(page.collection)}`}>${collectionLabel(page.collection)}</a>` : page.path.split("/").slice(0, -1).join(" / ")}</div>
                <h1>${page.fm.title && page.fm.title !== page.name ? html`${page.fm.title} <span class="muted" style="font-size:14px">${page.name}</span>` : page.name}
                    ${page.fm.status ? html` <span class="badge">${page.fm.status}</span>` : ""}</h1>
            </div>
            <div class="row">
                ${page.fm.type === "character" && novel && html`<button onClick=${() => go(`#/owner/${encodeURIComponent(novel.folder)}/${encodeURIComponent(page.name)}`)}>Ledgers</button>`}
                <button onClick=${() => go(`#/edit/${encodeURIComponent(page.path)}`)}>Edit</button>
            </div>
        </div>
        ${page.fmError && html`<div class="warnbox">Frontmatter could not be read: ${page.fmError}</div>`}
        ${page.fm.description && html`<p style="font-size:15px">${page.fm.description}</p>`}
        <${Gallery} images=${page.images} />
        <div class="grid2">
            <div class="panel"><${Fields} page=${page} index=${index} order=${order} /></div>
            <div>
                ${page.heldBy?.length > 0 && html`<div class="panel"><h3>Held by</h3>${page.heldBy.map((x) => html`<div><a href=${`#/owner/${encodeURIComponent(x.novel)}/${encodeURIComponent(x.owner)}`}>${x.owner}</a> <span class="muted">${x.qtyText}${x.store !== "inventory" ? ` @ ${x.store}` : ""} · ${x.novel}</span></div>`)}</div>`}
                ${page.whereUsed?.length > 0 && html`<div class="panel"><h3>Used in</h3><${WhereUsed} uses=${page.whereUsed} /></div>`}
                <div class="panel"><${ImageDrop} path=${page.path} /></div>
            </div>
        </div>
        ${page.blueprint && html`<${BlueprintPanel} page=${page} />`}
        ${page.body.trim() && html`<div class="panel"><${Html} html=${page.html} /></div>`}
        ${Object.keys(page.backlinks).length > 0 && html`<div class="panel"><h3>Linked from</h3>
            ${Object.entries(page.backlinks).sort((a, b) => b[1].length - a[1].length).map(([c, list]) => html`<div style="margin-bottom:6px"><b class="muted">${collectionLabel(c)} (${list.length})</b><div>${list.slice(0, 60).map((b) => html`<a class="chip" href=${noteHref(b.path)}>${b.name}</a>`)}${list.length > 60 ? html`<span class="muted"> +${list.length - 60} more</span>` : ""}</div></div>`)}</div>`}
    </div>`;
}

// ------------------------------------------------------------------ create / edit notes

function fieldInput({ key, def, target, value, onChange, index }) {
    if (target) return html`<${LinkField} value=${value} multiple=${Array.isArray(def)} target=${target} index=${index} onChange=${onChange} />`;
    if (typeof def === "boolean") return html`<input type="checkbox" checked=${!!value} onChange=${(e) => onChange(e.target.checked)} style="width:auto" />`;
    if (Array.isArray(def)) return html`<input value=${asList(value).join(", ")} placeholder="comma separated" onChange=${(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />`;
    if (["description", "personality", "appearance"].includes(key)) return html`<textarea value=${value ?? ""} onInput=${(e) => onChange(e.target.value)} style="font-family:inherit" />`;
    return html`<input value=${value ?? ""} onInput=${(e) => onChange(e.target.value)} style="width:100%" />`;
}
const coerce = (v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v);

function NoteForm({ index, collection, path, novel }) {
    const editing = !!path;
    const { data: page } = useApi(editing ? `/api/note?${qs({ path })}` : null);
    const schema = index?.schema;
    const col = collection === "characters" ? schema?.characters : schema?.collections[collection ?? page?.collection];
    const charCol = page && !page.collection && page.fm.type === "character" ? schema?.characters : null;
    const spec = col ?? charCol;
    const [vals, setVals] = useState(null);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    useEffect(() => {
        if (!spec || vals) return;
        if (editing && !page) return;
        const init = {};
        for (const [k, def] of spec.fields) init[k] = editing ? page.fm[k] ?? (Array.isArray(def) ? [] : "") : Array.isArray(def) ? [...def] : def;
        setVals(init);
    }, [spec, page]);
    if (!index || !vals || !spec) return html`<${Loading} />`;
    const generated = new Set(spec.generated ?? []);
    const save = async () => {
        setBusy(true); setErr("");
        try {
            if (editing) {
                const set = {};
                for (const [k] of spec.fields) if (!generated.has(k) && JSON.stringify(coerce(vals[k]) ?? "") !== JSON.stringify(page.fm[k] ?? (Array.isArray(vals[k]) ? [] : ""))) set[k] = coerce(vals[k]);
                await api.send("PATCH", "/api/note", { path, set, baseMtime: page.mtime });
                toast("Saved"); go(noteHref(path));
            } else if (collection === "characters") {
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
    const title = editing ? `Edit ${page.name}` : collection === "characters" ? "New character" : `New ${spec.label ?? collection}`;
    return html`<div>
        <h1>${title}</h1>
        <div class="panel"><div class="formgrid">
            ${!editing && html`<label>File name</label><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Unique note name" autoFocus style="width:100%" />`}
            ${spec.fields.filter(([k]) => !["type", "created-date", "images", "facet"].includes(k) && !generated.has(k)).map(([k, def]) => html`
                <label>${k}</label>
                ${fieldInput({ key: k, def, target: spec.links?.[k], value: vals[k], index, onChange: (v) => setVals((s) => ({ ...s, [k]: v })) })}`)}
        </div></div>
        ${err && html`<p class="error">${err}</p>`}
        <div class="row"><button class="primary" disabled=${busy || (!editing && !name.trim())} onClick=${save}>${editing ? "Save" : "Create"}</button>
            <button onClick=${() => history.back()}>Cancel</button></div>
        ${generated.size > 0 && html`<p class="muted">Generated from ledgers (not editable here): ${[...generated].join(", ")}</p>`}
    </div>`;
}

// ------------------------------------------------------------------ novels

const novelHref = (folder) => `#/novel/${encodeURIComponent(folder)}`;
const ownerHref = (folder, owner) => `#/owner/${encodeURIComponent(folder)}/${encodeURIComponent(owner)}`;
const chapterHref = (folder, n) => `#/chapter/${encodeURIComponent(folder)}/${n}`;
const entryHref = (folder, p) => `#/entry/${encodeURIComponent(folder)}?${qs(p)}`;

function NovelView({ folder }) {
    const { data: novel, error } = useApi(`/api/novel?${qs({ folder })}`);
    if (!novel) return html`<${Loading} error=${error} />`;
    const characterNames = new Set(novel.characters.map((c) => c.name.toLowerCase()));
    const otherOwners = [...new Set(novel.ledgers.map((l) => l.owner))].filter((o) => !characterNames.has(o.toLowerCase()));
    const ledgersOf = (o) => novel.ledgers.filter((l) => l.owner.toLowerCase() === o.toLowerCase());
    return html`<div>
        <div class="spread">
            <div><div class="muted">${novel.folder}</div><h1>${novel.name}</h1></div>
            <div class="row">
                <button class="primary" onClick=${() => go(entryHref(folder, {}))}>New entry</button>
                <button onClick=${() => go(`#/newchar/${encodeURIComponent(folder)}`)}>New character</button>
                <button onClick=${() => go(`#/callouts/${encodeURIComponent(folder)}`)}>Callouts</button>
                <button onClick=${async () => { const r = await api.send("POST", `/api/sync-sheets?${qs({ novel: folder })}`); toast(`Synced ${r.filter((x) => x.changed.length).length} sheets`); }}>Sync sheets</button>
            </div>
        </div>
        <h2>Characters</h2>
        <div class="cards">${novel.characters.map((c) => html`<a class="card" href=${ownerHref(folder, c.name)}>
            ${c.cover && html`<div class="cover" style=${`background-image:url("${c.cover}")`} />`}
            <div class="body"><h3>${c.name}</h3>
                <div>${ledgersOf(c.name).map((l) => html`<span class="chip">${l.type} ${l.entries}</span>`)}</div>
                <p>${c.fm.personality ?? ""}</p></div></a>`)}</div>
        ${otherOwners.length > 0 && html`<h2>Other ledger owners</h2><div class="cards">${otherOwners.map((o) => html`<a class="card" href=${ownerHref(folder, o)}><div class="body"><h3>${o}</h3><div>${ledgersOf(o).map((l) => html`<span class="chip">${l.type} ${l.entries}</span>`)}</div></div></a>`)}</div>`}
        <h2>Chapters</h2>
        <div class="chapters">${novel.chapters.map((c) => html`<a href=${chapterHref(folder, c.number)} class="row"><span class="badge">${c.number}</span> ${c.title} ${c.draft ? html`<span class="badge">draft</span>` : ""} ${c.entries ? html`<span class="chip">${c.entries} entries</span>` : ""}</a>`)}</div>
        <h2>Ledger types</h2>
        <div class="panel"><table><tbody>${Object.values(novel.ledgerTypes).map((t) => html`<tr><td><b>${t.name}</b></td><td><span class="badge">${t.behaviour}</span></td><td class="muted">${t.description ?? ""}</td><td>${Object.keys(t.callouts).map((c) => html`<span class="chip">${c}</span>`)}</td></tr>`)}</tbody></table></div>
    </div>`;
}

function EntryCard({ e, folder, behaviour, future, showOwner }) {
    const [showText, setShowText] = useState(false);
    const del = async () => {
        if (!confirm(`Delete ${e.key} ${e.title}?`)) return;
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
                <button class="small danger" onClick=${del}>Delete</button>
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

function holdingsTable(stacks) {
    if (!stacks.length) return html`<p class="muted">Nothing held.</p>`;
    const byStore = new Map();
    for (const s of stacks) { if (!byStore.has(s.store)) byStore.set(s.store, []); byStore.get(s.store).push(s); }
    return html`${[...byStore.entries()].map(([st, list]) => html`<div style="margin-bottom:8px"><b class="muted">${st}</b>
        <table><tbody>${list.map((s) => html`<tr><td>${s.itemPath ? html`<a href=${noteHref(s.itemPath)}>${s.itemName}</a>` : html`<span title="Misc item">${s.itemName} <span class="badge">misc</span></span>`}${s.condition ? html` <span class="muted">(${s.condition})</span>` : ""}</td><td class="num" style=${s.qty < 0 ? "color:var(--bad)" : ""}>${s.qtyText}</td></tr>`)}</tbody></table></div>`)}`;
}

function ChapterView({ folder, n }) {
    const num = Number(n);
    const { data, error } = useApi(`/api/chapter?${qs({ novel: folder, n: num })}`);
    const { data: novel } = useApi(`/api/novel?${qs({ folder })}`);
    const [type, setType] = useState("");
    if (!data || !novel) return html`<${Loading} error=${error} />`;
    const entries = data.entries.filter((e) => !type || e.type === type);
    const types = [...new Set(data.entries.map((e) => e.type))];
    const beh = (t) => novel.ledgerTypes[t]?.behaviour;
    const nums = novel.chapters.map((c) => c.number);
    const prev = nums.filter((x) => x < num).at(-1), next = nums.find((x) => x > num);
    return html`<div>
        <div class="spread">
            <div><div class="muted"><a href=${novelHref(folder)}>${novel.name}</a></div>
                <h1>Chapter ${num}${data.chapter ? `: ${data.chapter.title}` : ""}</h1></div>
            <div class="row">
                ${prev != null && html`<button onClick=${() => go(chapterHref(folder, prev))}>← ${prev}</button>`}
                ${next != null && html`<button onClick=${() => go(chapterHref(folder, next))}>${next} →</button>`}
                <button class="primary" onClick=${() => go(entryHref(folder, { chapter: num }))}>New entry</button>
                <button disabled=${!entries.length} onClick=${() => copyText(entries.map((e) => e.callout).join("\n\n"), `Copied ${entries.length} callouts`)}>⧉ Copy all</button>
            </div>
        </div>
        ${data.chapter && html`<p><a href=${noteHref(data.chapter.path)}>Open chapter note</a> · <span class="muted">${data.entries.filter((e) => !e.placed && !e.fields["mirror-of"]).length} entries not yet in the chapter text</span></p>`}
        ${types.length > 1 && html`<div class="row" style="margin-bottom:10px"><a class=${`chip ${!type ? "on" : ""}`} href="javascript:" onClick=${() => setType("")}>All</a>${types.map((t) => html`<a class=${`chip ${type === t ? "on" : ""}`} href="javascript:" onClick=${() => setType(t)}>${t}</a>`)}</div>`}
        ${entries.length ? entries.map((e) => html`<${EntryCard} e=${e} folder=${folder} behaviour=${beh(e.type)} showOwner=${true} />`) : html`<p class="muted">No entries in this chapter.</p>`}
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
                <td><button class="small danger" onClick=${() => remove(i)}>×</button></td></tr>`)}
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
            <td><button class="small danger" onClick=${() => remove(i)}>×</button></td></tr>`)}
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
                : html`<div class="panel" style="overflow-x:auto"><${LinesEditor} behaviour=${type?.behaviour} lines=${lines} setLines=${setLines} index=${index} novel=${novel} owner=${owner}
                    createNotes=${createNotes} setCreateNotes=${setCreateNotes} withTarget=${typeName === "Relationships" || type?.["with-target"]} /></div>`}
                ${!editKey && html`<div class="panel">
                    ${!linked ? html`<div class="row"><b>Linked entry</b><span class="muted">for another ledger of the same owner, e.g. a journal entry's reward</span>
                        <select onChange=${(e) => e.target.value && setLinked({ type: e.target.value, entry: { title: "", fields: {}, body: "" }, lines: novel.ledgerTypes[e.target.value].behaviour === "stock" ? [{ action: "add", item: "", qty: "1" }] : [] })}>
                            <option value="">+ add…</option>${Object.keys(novel.ledgerTypes).filter((t) => t !== typeName).map((t) => html`<option>${t}</option>`)}</select></div>`
                    : html`<div class="spread"><b>Linked ${linked.type} entry</b><button class="small danger" onClick=${() => setLinked(null)}>Remove</button></div>
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
                    <div class="spread"><b>${n}</b>${n in own ? html`<span class="row"><span class="badge ok">novel override</span><button class="small danger" onClick=${() => removeCallout(t.name, n)}>Use shared</button></span>` : html`<span class="row"><span class="badge">shared</span><button class="small" onClick=${() => setCallout(t.name, n, t.sharedCallouts[n])}>Override for this novel</button></span>`}</div>
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
        ${section("Misc items (no data note)", [...misc.values()], (m) => html`<tr><td>${m.item}</td><td class="muted">${m.novel} · ${m.count} line${m.count > 1 ? "s" : ""}</td><td><button class="small" onClick=${() => promote(m)}>Create entry & relink</button></td></tr>`)}
        ${section("Unresolved links", data.unresolved, (x) => html`<tr><td><a href=${noteHref(x.path)}>${x.path.split("/").pop()}</a></td><td>${x.field}</td><td>${x.value}</td></tr>`)}
        ${section("Name collisions", data.collisions, (x) => html`<tr><td>${x.name}</td><td>${x.paths.map((p) => html`<div><a href=${noteHref(p)}>${p}</a></div>`)}</td></tr>`)}
        ${section("Untitled notes", data.untitled, (x) => html`<tr><td><a href=${noteHref(x.path)}>${x.path}</a></td></tr>`)}
        ${section("Unreadable frontmatter", data.fmErrors, (x) => html`<tr><td><a href=${noteHref(x.path)}>${x.path}</a></td><td class="muted">${x.error}</td></tr>`)}
    </div>`;
}

// ------------------------------------------------------------------ app

function App() {
    const route = useRoute();
    const index = useIndex();
    const [novelFilter, setNovelFilter] = useState(store.get("novelFilter", ""));
    const setNF = (v) => { setNovelFilter(v); store.set("novelFilter", v); };
    const [a, b] = route.args;
    let view;
    switch (route.name) {
        case "c": view = html`<${CollectionView} index=${index} collection=${a} novelFilter=${novelFilter} />`; break;
        case "note": view = html`<${NoteView} key=${a} index=${index} path=${a} />`; break;
        case "edit": view = html`<${NoteForm} key=${a} index=${index} path=${a} />`; break;
        case "new": view = html`<${NoteForm} key=${a} index=${index} collection=${a} />`; break;
        case "newchar": view = html`<${NoteForm} key=${a} index=${index} collection="characters" novel=${a} />`; break;
        case "novel": view = html`<${NovelView} key=${a} folder=${a} />`; break;
        case "owner": view = html`<${OwnerView} key=${a + b} folder=${a} owner=${b} params=${route.params} />`; break;
        case "chapter": view = html`<${ChapterView} key=${a + b} folder=${a} n=${b} />`; break;
        case "entry": view = html`<${EntryEditor} key=${location.hash} index=${index} folder=${a} params=${route.params} />`; break;
        case "callouts": view = html`<${CalloutSettings} key=${a} folder=${a} />`; break;
        case "qa": view = html`<${QAView} />`; break;
        default: view = html`<${Home} index=${index} />`;
    }
    return html`<div class="layout">
        <${Sidebar} index=${index} />
        <main class="main">
            <div class="topbar"><${Search} index=${index} /><${NovelFilter} index=${index} value=${novelFilter} onChange=${setNF} /></div>
            ${view}
        </main>
    </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
