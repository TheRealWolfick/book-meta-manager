// Ledger files: one per owner per ledger type. Parsing, serialising and folding (stock / state / log).
import { linkTarget, linkLabel } from "./vault.js";

const H1 = /^#\s+Chapter\s+(\d+)\s*$/i;
const H2 = /^##\s+(\d+)\.(\d+)\s*(.*)$/;
const FIELD = /^([A-Za-z0-9_\/-]+)::\s?(.*)$/;
const LINE_KEY_ORDER = ["action", "set", "with", "value", "item", "qty", "unit", "condition", "store", "to-store", "to", "from", "ref", "note"];
const WEIGHT = { g: 1, kg: 1000, t: 1e6 };

/** Parse "[k:: v] [k2:: [[link]]]" allowing [[links]] inside values */
export function parseBracketFields(line) {
    const out = [];
    for (let i = 0; i < line.length; i++) {
        if (line[i] !== "[" || line[i + 1] === "[") continue;
        const m = /^\[([A-Za-z0-9_\/-]+)::\s?/.exec(line.slice(i));
        if (!m) continue;
        let j = i + m[0].length, depth = 0, val = "";
        for (; j < line.length; j++) {
            const c = line[j];
            if (c === "[") depth++;
            else if (c === "]") { if (depth === 0) break; depth--; }
            val += c;
        }
        out.push([m[1], val.trim()]);
        i = j;
    }
    return out;
}

const trimBlank = (lines) => {
    let a = 0, b = lines.length;
    while (a < b && !lines[a].trim()) a++;
    while (b > a && !lines[b - 1].trim()) b--;
    return lines.slice(a, b);
};

/** Ledger body -> { preamble, entries } */
export function parseLedger(body) {
    const preamble = [];
    const entries = [];
    let cur = null;
    for (const line of body.split(/\r?\n/)) {
        let m;
        if ((m = H2.exec(line))) {
            cur = { chapter: Number(m[1]), seq: Number(m[2]), title: m[3].trim(), fields: {}, lines: [], bodyLines: [], raw: [line], warnings: [] };
            entries.push(cur);
            continue;
        }
        if (H1.test(line)) { cur = null; continue; } // chapter headings are regenerated on save
        if (!cur) { preamble.push(line); continue; }
        cur.raw.push(line);
        if (/^\s*[-*]\s*\[/.test(line)) {
            const fields = parseBracketFields(line);
            if (fields.length) { cur.lines.push(Object.fromEntries(fields)); continue; }
            cur.warnings.push(`Could not read line: ${line.trim()}`);
        }
        if ((m = FIELD.exec(line)) && cur.bodyLines.every((l) => !l.trim())) {
            cur.fields[m[1]] = m[2].trim();
            continue;
        }
        cur.bodyLines.push(line);
    }
    for (const e of entries) {
        e.body = trimBlank(e.bodyLines).join("\n");
        e.raw = trimBlank(e.raw).join("\n");
        e.key = `${e.chapter}.${e.seq}`;
        delete e.bodyLines;
    }
    return { preamble: trimBlank(preamble).join("\n"), entries };
}

export const headingOf = (e) => `${e.chapter}.${e.seq}${e.title ? ` ${e.title}` : ""}`;

export function serializeEntry(e) {
    const out = [`## ${headingOf(e)}`];
    const fields = { ...(e.fields ?? {}) };
    const id = fields.id; delete fields.id; // id last: it is bookkeeping
    for (const [k, v] of Object.entries(fields)) if (v !== "" && v != null) out.push(`${k}:: ${v}`);
    if (id) out.push(`id:: ${id}`);
    for (const l of e.lines ?? []) {
        const keys = [...LINE_KEY_ORDER.filter((k) => k in l), ...Object.keys(l).filter((k) => !LINE_KEY_ORDER.includes(k))];
        const parts = keys.filter((k) => l[k] !== "" && l[k] != null).map((k) => `[${k}:: ${l[k]}]`);
        if (parts.length) out.push(`- ${parts.join(" ")}`);
    }
    if (e.body?.trim()) out.push(e.body.trimEnd());
    return out.join("\n");
}

const byOrder = (a, b) => a.chapter - b.chapter || a.seq - b.seq;

/** Rebuild a ledger body. Untouched entries keep their original text. */
export function serializeLedger(preamble, entries) {
    const sorted = [...entries].sort(byOrder);
    const chapters = [];
    for (const e of sorted) {
        if (!chapters.length || chapters.at(-1).n !== e.chapter) chapters.push({ n: e.chapter, entries: [] });
        chapters.at(-1).entries.push(e);
    }
    const blocks = chapters.map((c) => `# Chapter ${c.n}\n${c.entries.map((e) => e.raw ?? serializeEntry(e)).join("\n\n")}`);
    return `${preamble ? `${preamble}\n\n` : ""}${blocks.join("\n\n")}\n`;
}

export const newId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ---------------------------------------------------------------- stock

export function normQty(qty, unit) {
    const u = String(unit || "ea").trim().toLowerCase();
    const q = Number(String(qty ?? 1).replace(/,/g, "")) || 0;
    return u in WEIGHT ? { q: q * WEIGHT[u], unit: "g" } : { q, unit: u };
}

export function qtyText(q, unit) {
    const r = (n) => Number.isInteger(n) ? String(n) : n.toFixed(2);
    if (unit === "g") {
        if (Math.abs(q) >= 1e6) return `${r(q / 1e6)}t`;
        if (Math.abs(q) >= 1000) return `${r(q / 1000)}kg`;
        return `${r(q)}g`;
    }
    if (unit === "ea") return `${r(q)}x`;
    return `${r(q)} ${unit}`;
}

/** Identity of an item in a stock: its note path when linked, else its normalised text */
export function itemKey(vault, item) {
    const p = /\[\[/.test(item ?? "") ? vault.resolve(item) : null;
    return p ?? `misc:${linkLabel(item).toLowerCase()}`;
}

/**
 * Replay stock entries.
 * @param {"end"|"start"} mode "end" includes entries in chapter `until`, "start" stops before it
 */
export function foldStock(vault, entries, { until = Infinity, mode = "end" } = {}) {
    const stacks = new Map();
    const warnings = [];
    const history = [];
    for (const e of [...entries].sort(byOrder)) {
        if (mode === "start" ? e.chapter >= until : e.chapter > until) break;
        for (const l of e.lines) {
            if (!l.item) continue;
            const action = String(l.action || "add").toLowerCase();
            const key = itemKey(vault, l.item);
            const { q, unit } = normQty(l.qty, l.unit);
            const condition = l.condition ? linkLabel(l.condition) : "";
            const bump = (store, delta) => {
                store = String(store || "inventory").trim();
                const k = [store.toLowerCase(), key, unit, condition.toLowerCase()].join("|");
                const s = stacks.get(k) ?? { store, item: l.item, itemName: linkLabel(l.item), itemKey: key, itemPath: key.startsWith("misc:") ? null : key, unit, condition, qty: 0 };
                s.qty += delta;
                if (s.qty < -1e-9) warnings.push({ entry: e.key, message: `${s.itemName} in ${store} goes below zero (${qtyText(s.qty, unit)})` });
                stacks.set(k, s);
            };
            switch (action) {
                case "add": case "transfer-in": bump(l.store, q); break;
                case "remove": case "transfer-out": bump(l.store, -q); break;
                case "move": bump(l.store, -q); bump(l["to-store"], q); break;
                default: warnings.push({ entry: e.key, message: `Unknown action "${action}"` });
            }
            history.push({ entry: e.key, chapter: e.chapter, title: e.title, action, itemKey: key, itemName: linkLabel(l.item), qty: q, unit, store: l.store || "inventory", to: l.to || l["to-store"] || "", from: l.from || "" });
        }
    }
    const list = [...stacks.values()].filter((s) => Math.abs(s.qty) > 1e-9).map((s) => ({ ...s, qtyText: qtyText(s.qty, s.unit) }));
    list.sort((a, b) => a.store.localeCompare(b.store) || a.itemName.localeCompare(b.itemName));
    return { stacks: list, warnings, history };
}

/** Holdings gained/lost between two chapters */
export function diffStock(vault, entries, from, to) {
    const a = foldStock(vault, entries, { until: from }).stacks;
    const b = foldStock(vault, entries, { until: to }).stacks;
    const k = (s) => [s.store.toLowerCase(), s.itemKey, s.unit, s.condition.toLowerCase()].join("|");
    const map = new Map(a.map((s) => [k(s), { ...s, before: s.qty, after: 0 }]));
    for (const s of b) map.set(k(s), { ...(map.get(k(s)) ?? { ...s, before: 0 }), after: s.qty });
    return [...map.values()].filter((s) => Math.abs(s.after - s.before) > 1e-9)
        .map((s) => ({ ...s, change: s.after - s.before, changeText: `${s.after > s.before ? "+" : "−"}${qtyText(Math.abs(s.after - s.before), s.unit)}` }));
}

// ---------------------------------------------------------------- state

export function foldState(entries, { until = Infinity } = {}) {
    const values = new Map();
    const history = [];
    for (const e of [...entries].sort(byOrder)) {
        if (e.chapter > until) break;
        for (const l of e.lines) {
            if (!l.set) continue;
            const key = l.with ? `${l.set}|${linkTarget(l.with).toLowerCase()}` : l.set;
            const rec = { field: l.set, with: l.with ?? "", withName: l.with ? linkLabel(l.with) : "", value: l.value ?? "", entry: e.key, chapter: e.chapter };
            values.set(key, rec);
            history.push(rec);
        }
    }
    return { values: [...values.values()], history };
}
