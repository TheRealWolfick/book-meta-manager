// World builder page: a world's locations as an editable outline (add, drag to move, Move to…), a nested atlas, and maps.
import { h } from "preact";
import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import htm from "htm";
import { api, useApi, qs, toast, store, go, noteHref, openInDrawer, Loading } from "./app.js";

const html = htm.bind(h);

// scale rank -> colour group: land (realm…region), polity (multinational…province), settlement (city…district), site (estate…room)
const scaleGroup = (rank) => (rank <= 3 ? "land" : rank <= 6 ? "polity" : rank <= 10 ? "settle" : "site");
const ScaleBadge = ({ node }) => node.scale ? html`<span class=${`scale-badge sg-${scaleGroup(node.rank)}`}>${node.scale}</span>` : html`<span class="scale-badge">no scale</span>`;
const worldHref = (world, tab) => `#/world/${encodeURIComponent(world ?? "-")}${tab && tab !== "outline" ? `?tab=${tab}` : ""}`;
export const mapHref = (p) => `#/map/${encodeURIComponent(p)}`;

/** Tree helpers over the flat location list */
function useTree(locations) {
    return useMemo(() => {
        const byPath = new Map(locations.map((n) => [n.path, n]));
        const kids = new Map();
        const sort = (a, b) => a.rank - b.rank || a.title.localeCompare(b.title);
        for (const n of locations) {
            const p = n.parent && byPath.has(n.parent) ? n.parent : null;
            if (!kids.has(p)) kids.set(p, []);
            kids.get(p).push(n);
        }
        for (const l of kids.values()) l.sort(sort);
        const count = new Map();
        const below = (p) => { if (count.has(p)) return count.get(p); const c = (kids.get(p) ?? []).reduce((s, k) => s + 1 + below(k.path), 0); count.set(p, c); return c; };
        const pathTo = (p) => { const out = []; for (let n = byPath.get(byPath.get(p)?.parent); n; n = byPath.get(n.parent)) out.unshift(n); return out; };
        const descendants = (p) => { const out = new Set(); const walk = (q) => (kids.get(q) ?? []).forEach((k) => { out.add(k.path); walk(k.path); }); walk(p); return out; };
        return { byPath, kids: (p) => kids.get(p) ?? [], below, pathTo, descendants, roots: kids.get(null) ?? [] };
    }, [locations]);
}

export function WorldView({ world, params }) {
    const { data: worlds } = useApi("/api/worlds");
    const first = worlds?.worlds[0]?.path;
    const current = world && world !== "-" ? world : world === "-" ? null : first;
    useEffect(() => { if (!world && first) location.replace(worldHref(first)); }, [world, first]);
    const { data, error } = useApi(world || first ? `/api/world?${qs({ world: current ?? "" })}` : null);
    const tab = params.get("tab") ?? "outline";
    if (!worlds || !data) return html`<${Loading} error=${error} />`;
    return html`<div class="world-page">
        <div class="spread world-head">
            <div>
                <div class="muted"><a href="#/c/Worlds">Worlds</a> / ${data.title}</div>
                <h1>${data.title}</h1>
                ${data.description && html`<p class="lead world-lead">${data.description}</p>`}
            </div>
            <div class="row">
                <label class="row muted">World
                    <select value=${current ?? "-"} onChange=${(e) => go(worldHref(e.target.value, tab))}>
                        ${worlds.worlds.map((w) => html`<option value=${w.path}>${w.title} (${w.count})</option>`)}
                        ${worlds.unassigned > 0 && html`<option value="-">No world (${worlds.unassigned})</option>`}
                    </select></label>
                ${current && html`<a class="button-link" href=${noteHref(current)}>World note</a>`}
            </div>
        </div>
        <div class="tabs">${[["outline", "Outline"], ["atlas", "Atlas"], ["maps", "Maps"]].map(([t, l]) => html`<button class=${tab === t ? "on" : ""} onClick=${() => go(worldHref(current, t))}>${l}</button>`)}</div>
        ${tab === "outline" ? html`<${Outline} data=${data} world=${current} worlds=${worlds.worlds} />`
        : tab === "atlas" ? html`<${Atlas} data=${data} />`
        : html`<${MapsList} data=${data} />`}
    </div>`;
}

// ------------------------------------------------------------------ outline

function Outline({ data, world, worlds }) {
    const tree = useTree(data.locations);
    const key = `worldClosed:${world ?? "-"}`;
    const [closed, setClosed] = useState(() => new Set(store.get(key, [])));
    const setC = (s) => { setClosed(s); store.set(key, [...s]); };
    const [sel, setSel] = useState(() => store.get(`worldSel:${world ?? "-"}`, null));
    const select = (p) => { setSel(p); store.set(`worldSel:${world ?? "-"}`, p); };
    const [adding, setAdding] = useState(null); // parent path being added to, "" = top level
    const [filter, setFilter] = useState("");
    const [drag, setDrag] = useState(null); // {path, over, zone}
    const [moving, setMoving] = useState(null);
    const selNode = tree.byPath.get(sel) ?? null;

    // rows in tree order; filtering shows matches with their ancestors
    const rows = useMemo(() => {
        const f = filter.trim().toLowerCase();
        const keep = new Set();
        if (f) for (const n of data.locations) if (n.title.toLowerCase().includes(f) || n.name.toLowerCase().includes(f)) { keep.add(n.path); tree.pathTo(n.path).forEach((a) => keep.add(a.path)); }
        const out = [];
        const walk = (list, depth) => { for (const n of list) { if (f && !keep.has(n.path)) continue; out.push({ n, depth }); if (f || !closed.has(n.path)) walk(tree.kids(n.path), depth + 1); } };
        walk(tree.roots, 0);
        return out;
    }, [tree, closed, filter]);

    const doMove = async (node, parent, targetWorld) => {
        const newParent = parent ? tree.byPath.get(parent) : null;
        if (newParent && newParent.rank >= node.rank && node.rank !== 99
            && !confirm(`${newParent.title} is a ${newParent.scale}, not larger than ${node.title} (${node.scale}). A parent is usually a larger scale. Move anyway?`)) return;
        const old = { parent: node.parent, world };
        try {
            const r = await api.send("POST", "/api/world/move", { path: node.path, parent, world: targetWorld, baseMtime: node.mtime });
            if (parent) setC(new Set([...closed].filter((c) => c !== parent)));
            toast(`Moved ${node.title}${r.moved > 1 ? ` and ${r.moved - 1} inside it` : ""} ${parent ? `into ${newParent?.title}` : "to the top level"}`, {
                label: "Undo", run: () => api.send("POST", "/api/world/move", { path: node.path, parent: old.parent, world: old.world }).then(() => toast("Move undone")).catch((e) => toast(e.message)),
            });
        } catch (e) { toast(e.message); }
    };
    const dropOn = (target, zone) => {
        const node = tree.byPath.get(drag?.path);
        setDrag(null);
        if (!node || node.path === target.path) return;
        const parent = zone === "inside" ? target.path : target.parent;
        if (parent === node.path || (parent && tree.descendants(node.path).has(parent))) return toast("A location can't go inside itself");
        if ((parent ?? null) === (node.parent ?? null)) return;
        doMove(node, parent ?? null);
    };

    const onKey = (e) => {
        if (e.target.closest("input, select, textarea")) return;
        const i = rows.findIndex((r) => r.n.path === sel);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const r = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]; if (r) select(r.n.path); }
        else if (e.key === "ArrowLeft" && sel) { if (!closed.has(sel) && tree.kids(sel).length) setC(new Set([...closed, sel])); else if (selNode?.parent) select(selNode.parent); }
        else if (e.key === "ArrowRight" && sel) setC(new Set([...closed].filter((c) => c !== sel)));
        else if (e.key === "Enter" && sel) openInDrawer(noteHref(sel));
        else if ((e.key === "a" || e.key === "+") && sel) { e.preventDefault(); setAdding(sel); }
        else if (e.key === "m" && selNode) { e.preventDefault(); setMoving(selNode); }
    };

    return html`<div class="world-outline">
        <section class="panel outline-panel" onKeyDown=${onKey}>
            <div class="row" style="margin-bottom:8px">
                <input class="grow" placeholder="Filter locations…" value=${filter} onInput=${(e) => setFilter(e.target.value)} aria-label="Filter locations" />
                <button onClick=${() => setC(new Set())}>Expand all</button>
                <button onClick=${() => setC(new Set(data.locations.filter((n) => tree.kids(n.path).length).map((n) => n.path)))}>Collapse</button>
                <button class="primary" onClick=${() => setAdding("")}>+ Top-level location</button>
            </div>
            ${adding === "" && html`<${AddRow} depth=${0} parent=${null} world=${world} scales=${data.scales} onDone=${() => setAdding(null)} onAdded=${select} />`}
            ${!rows.length && adding !== "" ? html`<p class="muted">No locations in this world yet. Add a top-level location to start.</p>` : ""}
            <div role="tree" class="loc-tree" tabIndex="0" aria-label=${`${data.title} locations`}>
                ${rows.map(({ n, depth }) => {
                    const kids = tree.kids(n.path).length;
                    const blocked = drag && (drag.path === n.path || tree.descendants(drag.path).has(n.path));
                    const zone = drag?.over === n.path ? drag.zone : null;
                    return html`<div key=${n.path}>
                        <div role="treeitem" aria-selected=${sel === n.path} aria-expanded=${kids ? !closed.has(n.path) : undefined}
                            class=${`loc-row ${sel === n.path ? "on" : ""} ${blocked ? "blocked" : ""} ${zone ? `drop-${zone}` : ""} ${drag?.path === n.path ? "dragging" : ""}`}
                            style=${`--depth:${depth}`} draggable="true"
                            onDragStart=${(e) => { e.dataTransfer.setData("text/plain", n.path); e.dataTransfer.effectAllowed = "move"; setDrag({ path: n.path }); }}
                            onDragEnd=${() => setDrag(null)}
                            onDragOver=${(e) => {
                                if (!drag || blocked) return;
                                e.preventDefault();
                                const r = e.currentTarget.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
                                const z = y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
                                if (drag.over !== n.path || drag.zone !== z) setDrag({ ...drag, over: n.path, zone: z });
                                if (z === "inside" && closed.has(n.path)) { clearTimeout(Outline.t); Outline.t = setTimeout(() => setC(new Set([...closed].filter((c) => c !== n.path))), 600); }
                            }}
                            onDrop=${(e) => { e.preventDefault(); dropOn(n, drag?.zone ?? "inside"); }}>
                            <span class="grip" aria-hidden="true" title="Drag to move">⠿</span>
                            <span class="indent" />
                            ${kids ? html`<button class="caret" aria-label=${`${closed.has(n.path) ? "Expand" : "Collapse"} ${n.title}`}
                                onClick=${() => setC(closed.has(n.path) ? new Set([...closed].filter((c) => c !== n.path)) : new Set([...closed, n.path]))}>${closed.has(n.path) ? "▸" : "▾"}</button>`
                                : html`<span class="caret leaf" aria-hidden="true">·</span>`}
                            <button class="loc-name" onClick=${() => select(n.path)} onDblClick=${() => openInDrawer(noteHref(n.path))}>
                                <span class="t">${n.title}</span><${ScaleBadge} node=${n} />${kids ? html`<span class="muted count">${tree.below(n.path)}</span>` : ""}
                                ${n.map && html`<span class="map-dot" title="Has a map">◈</span>`}
                            </button>
                            <span class="loc-acts">
                                <button class="small" title="Add a sub-location" aria-label=${`Add a sub-location to ${n.title}`} onClick=${() => { setAdding(n.path); setC(new Set([...closed].filter((c) => c !== n.path))); }}>+</button>
                                <button class="small" title="Move to…" aria-label=${`Move ${n.title}`} onClick=${() => setMoving(n)}>Move</button>
                                <a class="small-link" href=${mapHref(n.path)} title=${n.map ? "Open map" : "Create a map"}>Map</a>
                            </span>
                        </div>
                        ${adding === n.path && html`<${AddRow} depth=${depth + 1} parent=${n} world=${world} scales=${data.scales} onDone=${() => setAdding(null)} onAdded=${select} />`}
                    </div>`;
                })}
                ${drag && html`<div class="loc-row drop-root" onDragOver=${(e) => e.preventDefault()} onDrop=${(e) => { e.preventDefault(); const node = tree.byPath.get(drag.path); setDrag(null); if (node?.parent) doMove(node, null); }}>Drop here for the top level</div>`}
            </div>
            <p class="muted small-note">Drag a row onto another to move it inside (top or bottom edge: next to it). Keys: ↑↓ select, ←→ fold, A add, M move, Enter opens the note.</p>
        </section>
        ${selNode ? html`<${LocationDetail} node=${selNode} tree=${tree} scales=${data.scales} onSelect=${select} onAdd=${() => setAdding(selNode.path)} onMove=${() => setMoving(selNode)} />`
            : html`<section class="panel loc-detail"><p class="muted">Select a location to see it here.</p></section>`}
        ${moving && html`<${MoveDialog} node=${moving} tree=${tree} data=${data} world=${world} worlds=${worlds} onClose=${() => setMoving(null)} onMove=${(parent, w) => { setMoving(null); doMove(moving, parent, w); }} />`}
    </div>`;
}

function AddRow({ depth, parent, world, scales, onDone, onAdded }) {
    const next = parent ? scales.find((s) => s.rank > parent.rank)?.name ?? parent.scale : scales[0]?.name ?? "";
    const [name, setName] = useState("");
    const [scale, setScale] = useState(next);
    const [busy, setBusy] = useState(false);
    const ref = useRef();
    useEffect(() => ref.current?.focus(), []);
    const add = async () => {
        if (!name.trim() || busy) return;
        setBusy(true);
        try {
            const r = await api.send("POST", "/api/world/location", { world, parent: parent?.path ?? null, name: name.trim(), scale });
            toast(`Added ${name.trim()}`);
            setName("");
            onAdded?.(r.path);
        } catch (e) { toast(e.message); }
        setBusy(false);
        ref.current?.focus();
    };
    return html`<div class="add-row" style=${`--depth:${depth}`}>
        <input ref=${ref} value=${name} placeholder=${parent ? `New location inside ${parent.title}` : "New top-level location"} aria-label="Name of the new location"
            onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") onDone(); }} />
        <select value=${scale} onChange=${(e) => setScale(e.target.value)} aria-label="Scale">${scales.map((s) => html`<option value=${s.name}>${s.title}</option>`)}</select>
        <button class="primary" disabled=${busy || !name.trim()} onClick=${add}>Add</button>
        <button onClick=${onDone}>Done</button>
        <span class="muted small-note">Enter adds it and starts the next one; the scale starts one step below the parent.</span>
    </div>`;
}

function LocationDetail({ node, tree, scales, onSelect, onAdd, onMove }) {
    const kids = tree.kids(node.path);
    return html`<section class="loc-detail">
        <div class="panel">
            <nav class="crumbs" aria-label="Path">${tree.pathTo(node.path).map((p) => html`<button class="linkish" onClick=${() => onSelect(p.path)}>${p.title}</button><span aria-hidden="true">›</span>`)}</nav>
            <div class="row" style="align-items:baseline"><h2 class="loc-title">${node.title}</h2><${ScaleBadge} node=${node} /></div>
            <div class="ladder" aria-label=${`Scale ${node.scale || "unknown"}`}>${scales.map((s) => html`<span title=${s.title} class=${s.name === node.scale ? "on" : ""} style=${`height:${8 + (scales.length - s.rank) * 1.6}px`} />`)}</div>
            <dl class="facts">
                <div><dt>Controlled by</dt><dd>${node.controlledBy.join(", ") || "—"}</dd></div>
                <div><dt>Population</dt><dd>${node.population || "—"}</dd></div>
                <div><dt>Inside it</dt><dd>${tree.below(node.path)} locations</dd></div>
            </dl>
            ${node.description ? html`<p class="lead">${node.description}</p>` : html`<p class="muted">No description yet.</p>`}
            <div class="row">
                <button onClick=${() => openInDrawer(noteHref(node.path))}>Open note</button>
                <button onClick=${onMove}>Move to…</button>
                <button onClick=${() => go(mapHref(node.path))}>${node.map ? "Open map" : "Create map"}</button>
            </div>
            ${node.map && html`<a href=${mapHref(node.path)} class="map-thumb"><img src=${`/files/${node.map.split("/").map(encodeURIComponent).join("/")}?v=${node.mtime}`} alt=${`Map of ${node.title}`} loading="lazy" /></a>`}
        </div>
        <div class="panel">
            <div class="spread"><h3 style="margin:0">Sub-locations <span class="muted">(${kids.length})</span></h3><button onClick=${onAdd}>+ Add sub-location</button></div>
            ${!kids.length && html`<p class="muted">Nothing inside ${node.title} yet.</p>`}
            <div class="kid-cards">${kids.map((k) => html`<button class="kid-card" onClick=${() => onSelect(k.path)}><b>${k.title}</b><span class="muted">${k.scale || "no scale"} · ${tree.below(k.path)} inside</span></button>`)}</div>
        </div>
    </section>`;
}

function MoveDialog({ node, tree, data, world, worlds, onClose, onMove }) {
    const [q, setQ] = useState("");
    const [target, setTarget] = useState(undefined); // path, null = top level
    const [otherWorld, setOtherWorld] = useState(null);
    const banned = useMemo(() => new Set([node.path, ...tree.descendants(node.path)]), [node]);
    const options = data.locations.filter((n) => !banned.has(n.path) && (!q.trim() || n.title.toLowerCase().includes(q.trim().toLowerCase())))
        .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title)).slice(0, 60);
    const t = target ? tree.byPath.get(target) : null;
    const count = tree.below(node.path);
    useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
    return html`<div class="modal-back" onClick=${(e) => e.target === e.currentTarget && onClose()}>
        <div class="modal" role="dialog" aria-label=${`Move ${node.title}`}>
            <h2 style="margin-top:0">Move ${node.title}</h2>
            <input autoFocus placeholder="Search for the new parent…" value=${q} onInput=${(e) => setQ(e.target.value)} style="width:100%" />
            <div class="move-list">
                <button class=${target === null && !otherWorld ? "on" : ""} onClick=${() => { setTarget(null); setOtherWorld(null); }}>Top level of ${data.title}</button>
                ${options.map((n) => html`<button class=${target === n.path ? "on" : ""} disabled=${n.path === node.parent} onClick=${() => { setTarget(n.path); setOtherWorld(null); }}>
                    <span class="row"><b>${n.title}</b><${ScaleBadge} node=${n} />${n.path === node.parent ? html`<span class="muted">current parent</span>` : ""}</span>
                    <span class="muted small-note">${tree.pathTo(n.path).map((p) => p.title).join(" › ") || "top level"}</span></button>`)}
                ${worlds.filter((w) => w.path !== world).map((w) => html`<button class=${otherWorld === w.path ? "on" : ""} onClick=${() => { setOtherWorld(w.path); setTarget(null); }}>Top level of ${w.title} <span class="muted">(another world)</span></button>`)}
            </div>
            ${(target !== undefined || otherWorld) && html`<div class="move-summary">
                <div>Moves <b>${node.title}</b>${count ? html` and the <b>${count}</b> locations inside it` : ""}.</div>
                ${t && t.rank >= node.rank && node.rank !== 99 && html`<div class="warnbox">${t.title} is a ${t.scale}, not larger than a ${node.scale}. A parent is usually a larger scale.</div>`}
                ${otherWorld && html`<div class="warnbox">Also sets <code>world</code> on ${count + 1} notes.</div>`}
            </div>`}
            <div class="row" style="justify-content:flex-end;margin-top:12px">
                <button onClick=${onClose}>Cancel</button>
                <button class="primary" disabled=${target === undefined && !otherWorld} onClick=${() => onMove(otherWorld ? null : target, otherWorld ?? undefined)}>Move</button>
            </div>
        </div>
    </div>`;
}

// ------------------------------------------------------------------ atlas: nested boxes

function Atlas({ data }) {
    const tree = useTree(data.locations);
    const [root, setRoot] = useState(null);
    const [levels, setLevels] = useState(() => store.get("atlasLevels", 5));
    const [sel, setSel] = useState(null);
    const top = root ? [tree.byPath.get(root)].filter(Boolean) : tree.roots;
    const box = (n, depth) => {
        const kids = tree.kids(n.path);
        const deeper = depth + 1 < levels && kids.length > 0;
        return html`<div class=${`atlas-box sg-${scaleGroup(n.rank)} ${sel === n.path ? "on" : ""}`} style=${`flex-grow:${1 + tree.below(n.path)}`}
            onClick=${(e) => { e.stopPropagation(); setSel(n.path); }} onDblClick=${(e) => { e.stopPropagation(); if (kids.length) setRoot(n.path); else openInDrawer(noteHref(n.path)); }}
            title=${`${n.title} (${n.scale || "no scale"})`}>
            <div class="atlas-label"><b>${n.title}</b> <span class="muted">${n.scale}${kids.length ? ` · ${tree.below(n.path)}` : ""}</span></div>
            ${deeper && html`<div class=${`atlas-kids ${depth % 2 ? "col" : ""}`}>${kids.map((k) => box(k, depth + 1))}</div>`}
            ${!deeper && kids.length > 0 && html`<span class="muted small-note">+${tree.below(n.path)} inside</span>`}
        </div>`;
    };
    const s = sel ? tree.byPath.get(sel) : null;
    return html`<div class="atlas-wrap">
        <div class="row" style="margin-bottom:10px">
            <span class="muted">Zoomed to</span>
            <button class=${!root ? "on-chip" : ""} onClick=${() => setRoot(null)}>${data.title}</button>
            ${root && tree.pathTo(root).map((p) => html`<span aria-hidden="true">›</span><button onClick=${() => setRoot(p.path)}>${p.title}</button>`)}
            ${root && html`<span aria-hidden="true">›</span><button class="on-chip">${tree.byPath.get(root)?.title}</button>`}
            <label class="row muted" style="margin-left:auto">Levels <input type="range" min="1" max="8" value=${levels} onInput=${(e) => { setLevels(+e.target.value); store.set("atlasLevels", +e.target.value); }} /> ${levels}</label>
        </div>
        <div class="atlas-cols">
            <div class="atlas" onClick=${() => setSel(null)}>${top.length ? html`<div class="atlas-kids">${top.map((n) => box(n, 0))}</div>` : html`<p class="muted">No locations yet.</p>`}</div>
            <aside class="panel atlas-side">
                ${s ? html`<div class="muted small-note">${tree.pathTo(s.path).map((p) => p.title).join(" › ")}</div>
                    <h3>${s.title} <${ScaleBadge} node=${s} /></h3>
                    ${s.description ? html`<p class="lead">${s.description}</p>` : html`<p class="muted">No description yet.</p>`}
                    <div class="row">${tree.kids(s.path).length > 0 && html`<button onClick=${() => setRoot(s.path)}>Zoom in</button>`}<button onClick=${() => openInDrawer(noteHref(s.path))}>Open note</button><button onClick=${() => go(mapHref(s.path))}>${s.map ? "Open map" : "Create map"}</button></div>`
                : html`<p class="muted">Click a box to see it, double-click to zoom in.</p>`}
                <h4 style="margin-top:14px">Scale colours</h4>
                <div class="legend"><span class="sg-land">realm · continent · region</span><span class="sg-polity">multinational · nation · province</span><span class="sg-settle">city · town · village · district</span><span class="sg-site">estate · building · room</span></div>
            </aside>
        </div>
    </div>`;
}

// ------------------------------------------------------------------ maps list

function MapsList({ data }) {
    const tree = useTree(data.locations);
    const rows = [];
    const walk = (list, depth) => list.forEach((n) => { rows.push({ n, depth }); walk(tree.kids(n.path), depth + 1); });
    walk(tree.roots, 0);
    const withMaps = rows.filter((r) => r.n.map);
    return html`<div>
        ${withMaps.length > 0 && html`<div class="map-cards">${withMaps.map(({ n }) => html`<a class="card" href=${mapHref(n.path)}>
            <div class="cover map-cover" style=${`background-image:url("/files/${n.map.split("/").map(encodeURIComponent).join("/")}?v=${n.mtime}")`} />
            <div class="body"><h3>${n.title}</h3><p>${n.scale}</p></div></a>`)}</div>`}
        <div class="panel" style="margin-top:14px">
            <h3>All locations</h3>
            ${rows.map(({ n, depth }) => html`<div class="spread map-row" style=${`padding-left:${depth * 18}px`}>
                <span>${n.title} <${ScaleBadge} node=${n} /></span>
                <a href=${mapHref(n.path)}>${n.map ? "Open map" : "Create map"}</a></div>`)}
        </div>
    </div>`;
}
