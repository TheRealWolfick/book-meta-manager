// Stat templates: typed fields, validation, text <-> value conversion, formulas and stats panels.
// Shared by the browser (template editor, inputs) and the server (ledger saves, sheet sync, panels).

export const FIELD_TYPES = {
    number: "Number",
    text: "Text",
    longtext: "Long text",
    list: "List of text",
    boolean: "Yes / no",
    choice: "Choice",
    link: "Link",
    links: "List of links",
    resource: "Current / max",
    computed: "Computed",
};

const slug = (s) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** Identifier used in formulas and custom panels: the last part of the key, e.g. "character/level" -> "level" */
export const fieldId = (key) => String(key ?? "").split("/").pop().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
export const defaultKey = (label) => `stats/${slug(label) || "field"}`;
/** Does a ledger line's `set` name this field? Full key, last part of the key, formula name or label, any case */
export const namesField = (f, name) => {
    const n = String(name ?? "").trim().toLowerCase();
    return !!n && [f.key, f.key.split("/").pop(), f.id, f.label].some((x) => String(x).toLowerCase() === n);
};
export const fieldNamed = (template, name) => template.fields.find((f) => namesField(f, name)) ?? null;

const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const list = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);

/** config.md `stat-templates` -> {name: template} with every field filled in */
export function normalizeTemplates(raw) {
    const out = {};
    for (const [name, t] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
        const fields = list(t?.fields).filter((f) => f && typeof f === "object").map((f) => {
            const label = String(f.label ?? "").trim() || String(f.key ?? "").split("/").pop();
            const key = String(f.key ?? "").trim() || defaultKey(label);
            const type = FIELD_TYPES[f.type] ? f.type : "text";
            return {
                key, label, type, id: fieldId(key), section: String(f.section ?? "").trim(),
                integer: !!f.integer, min: num(f.min), max: num(f.max),
                options: list(f.options).map(String).filter(Boolean),
                collection: String(f.collection ?? "").trim(),
                describe: !!f.describe,
                "max-field": String(f["max-field"] ?? "").trim(),
                formula: String(f.formula ?? "").trim(),
                unit: String(f.unit ?? "").trim(),
                // character frontmatter field that supplies the value until a ledger entry sets one
                source: String(f.source ?? "").trim(),
            };
        });
        out[name] = {
            name, description: String(t?.description ?? ""), default: !!t?.default, callout: String(t?.callout || "system"),
            "show-empty": !!t?.["show-empty"], panel: String(t?.panel ?? ""), fields,
        };
    }
    return out;
}

/** Template -> the shape written to config.md (defaults left out so the YAML stays short) */
export function serializeTemplate(t) {
    const out = {};
    if (t.description) out.description = t.description;
    if (t.default) out.default = true;
    if (t.callout && t.callout !== "system") out.callout = t.callout;
    if (t["show-empty"]) out["show-empty"] = true;
    if (t.panel?.trim()) out.panel = t.panel;
    out.fields = t.fields.map((f) => {
        const o = { key: f.key, label: f.label, type: f.type };
        if (f.section) o.section = f.section;
        if (f.type === "number" || f.type === "resource") {
            if (f.integer) o.integer = true;
            if (f.min != null) o.min = f.min;
            if (f.max != null) o.max = f.max;
        }
        if (f.type === "resource" && f["max-field"]) o["max-field"] = f["max-field"];
        if (f.type === "choice") o.options = f.options;
        if (f.type === "link" || f.type === "links") { if (f.collection) o.collection = f.collection; if (f.describe) o.describe = true; }
        if (f.type === "computed") o.formula = f.formula;
        if (f.unit) o.unit = f.unit;
        if (f.source && f.type !== "computed") o.source = f.source;
        return o;
    });
    return out;
}

/** Problems with a template definition (empty = fine) */
export function checkTemplate(t) {
    const errors = [];
    const ids = new Map(), keys = new Set();
    for (const f of t.fields) {
        if (keys.has(f.key)) errors.push(`Two fields use the key "${f.key}"`);
        keys.add(f.key);
        if (ids.has(f.id)) errors.push(`"${f.label}" and "${ids.get(f.id)}" both have the formula name "${f.id}"; give one a different key`);
        ids.set(f.id, f.label);
        if (f.type === "choice" && !f.options.length) errors.push(`"${f.label}" needs at least one option`);
        if (f.min != null && f.max != null && f.min > f.max) errors.push(`"${f.label}": min is above max`);
        if (f.type === "computed") {
            if (!f.formula) errors.push(`"${f.label}" needs a formula`);
            else try { for (const ref of parseFormula(f.formula).refs) if (!t.fields.some((x) => x.id === ref)) errors.push(`"${f.label}": unknown field "${ref}" in the formula`); }
            catch (e) { errors.push(`"${f.label}": ${e.message}`); }
        }
        if (f.type === "resource" && f["max-field"] && !t.fields.some((x) => x.key === f["max-field"] || x.id === f["max-field"])) errors.push(`"${f.label}": max field "${f["max-field"]}" is not in the template`);
    }
    return errors;
}

// ------------------------------------------------------------------ values

const isLinkText = (v) => /^\[\[[^\]]+\]\]$/.test(String(v ?? "").trim());
/** Split "a, [[b, c]], d" on commas outside [[links]] */
function splitList(text) {
    const out = [];
    let cur = "", depth = 0;
    const s = String(text ?? "");
    for (let i = 0; i < s.length; i++) {
        if (s.startsWith("[[", i)) depth++;
        if (s.startsWith("]]", i)) depth = Math.max(0, depth - 1);
        if (s[i] === "," && !depth) { out.push(cur.trim()); cur = ""; continue; }
        cur += s[i];
    }
    if (cur.trim()) out.push(cur.trim());
    return out.filter(Boolean);
}
const asLink = (v) => (isLinkText(v) ? String(v).trim() : `[[${String(v).trim()}]]`);

/** Ledger line text (or loosely typed frontmatter) -> a typed value */
export function fromText(field, text) {
    if (text == null) return field.type === "list" || field.type === "links" ? [] : "";
    if (Array.isArray(text)) return field.type === "links" ? text.map(asLink) : field.type === "list" ? text.map(String) : text.join(", ");
    const s = String(text).trim();
    switch (field.type) {
        case "number": return s === "" ? "" : num(s) ?? s;
        case "boolean": return /^(true|yes|y|1)$/i.test(s) ? true : /^(false|no|n|0)$/i.test(s) ? false : s === "" ? "" : s;
        case "list": return splitList(s);
        case "links": return splitList(s).map(asLink);
        case "link": return s === "" ? "" : asLink(s);
        case "resource": return s;
        default: return typeof text === "string" ? text : String(text);
    }
}

/** Typed value -> text for a ledger line */
export function toText(field, value) {
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "boolean") return value ? "yes" : "no";
    return value == null ? "" : String(value);
}

/** Resource text "80/100" (or just "80" when the max comes from elsewhere) -> {cur, max} */
export function parseResource(v) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:\/\s*(-?\d+(?:\.\d+)?))?\s*$/.exec(String(v ?? ""));
    return m ? { cur: Number(m[1]), max: m[2] != null ? Number(m[2]) : null } : null;
}

const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

/** Check a typed value against its field. Returns null when fine, else a message */
export function checkValue(field, value, { resolve } = {}) {
    if (empty(value)) return null;
    const label = field.label;
    const range = (n) => {
        if (field.integer && !Number.isInteger(n)) return `${label} must be a whole number`;
        if (field.min != null && n < field.min) return `${label} must be at least ${field.min}`;
        if (field.max != null && n > field.max) return `${label} must be at most ${field.max}`;
        return null;
    };
    switch (field.type) {
        case "number": return typeof value === "number" && Number.isFinite(value) ? range(value) : `${label} must be a number`;
        case "boolean": return typeof value === "boolean" ? null : `${label} must be yes or no`;
        case "choice": return field.options.includes(String(value)) ? null : `${label} must be one of: ${field.options.join(", ")}`;
        case "list": return Array.isArray(value) ? null : `${label} must be a list`;
        case "link": case "links": {
            const vals = field.type === "link" ? [value] : value;
            if (!Array.isArray(vals)) return `${label} must be a list of links`;
            for (const v of vals) {
                if (!isLinkText(v)) return `${label}: "${v}" is not a [[link]]`;
                if (resolve && field.collection) {
                    const r = resolve(v);
                    if (r && r.collection !== field.collection) return `${label}: ${v} is not in ${field.collection}`;
                }
            }
            return null;
        }
        case "resource": {
            const r = parseResource(value);
            if (!r) return `${label} must look like 80/100${field["max-field"] || field.max != null ? " or 80" : ""}`;
            return range(r.cur) ?? (r.max != null && field.integer && !Number.isInteger(r.max) ? `${label} max must be a whole number` : null);
        }
        case "computed": return `${label} is computed and can't be set`;
        default: return null;
    }
}

// ------------------------------------------------------------------ formulas: numbers, field names, + - * / ^ ( ) and min max floor ceil round abs

const FUNCS = { min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs, sqrt: Math.sqrt };

export function parseFormula(src) {
    const tokens = String(src).match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|\{[^}]+\}|[-+*/^(),]|\S/g) ?? [];
    let i = 0;
    const refs = new Set();
    const peek = () => tokens[i];
    const take = (t) => { if (tokens[i] !== t) throw new Error(`expected "${t}" in the formula`); i++; };
    const primary = () => {
        const t = tokens[i++];
        if (t == null) throw new Error("the formula ends too early");
        if (/^\d/.test(t)) return () => Number(t);
        if (t === "(") { const e = expr(); take(")"); return e; }
        if (t === "-") { const e = power(); return (v) => -e(v); }
        if (t === "+") return power();
        if (t.startsWith("{")) { const id = fieldId(t.slice(1, -1)); refs.add(id); return (v) => v(id); }
        if (/^[A-Za-z_]/.test(t)) {
            if (peek() === "(" && FUNCS[t.toLowerCase()]) {
                i++;
                const args = [];
                if (peek() !== ")") { args.push(expr()); while (peek() === ",") { i++; args.push(expr()); } }
                take(")");
                const fn = FUNCS[t.toLowerCase()];
                return (v) => fn(...args.map((a) => a(v)));
            }
            refs.add(t);
            return (v) => v(t);
        }
        throw new Error(`unexpected "${t}" in the formula`);
    };
    const power = () => { const b = primary(); if (peek() === "^") { i++; const e = power(); return (v) => b(v) ** e(v); } return b; };
    const term = () => {
        let l = power();
        while (peek() === "*" || peek() === "/") { const op = tokens[i++], r = power(), a = l; l = op === "*" ? (v) => a(v) * r(v) : (v) => a(v) / r(v); }
        return l;
    };
    const expr = () => {
        let l = term();
        while (peek() === "+" || peek() === "-") { const op = tokens[i++], r = term(), a = l; l = op === "+" ? (v) => a(v) + r(v) : (v) => a(v) - r(v); }
        return l;
    };
    const fn = expr();
    if (i < tokens.length) throw new Error(`unexpected "${tokens[i]}" in the formula`);
    return { fn, refs: [...refs] };
}

/** A field's value as a number for formulas (lists count their items, yes/no is 1/0, resources use current) */
function numeric(field, value) {
    if (empty(value)) return NaN;
    if (Array.isArray(value)) return value.length;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (field?.type === "resource") return parseResource(value)?.cur ?? NaN;
    return Number(value);
}

/** Fill in computed fields (in template order, so later formulas can use earlier ones) */
export function computeValues(template, values) {
    const out = { ...values };
    const byId = new Map(template.fields.map((f) => [f.id, f]));
    for (const f of template.fields) {
        if (f.type !== "computed") continue;
        try {
            const { fn } = parseFormula(f.formula);
            const r = fn((id) => numeric(byId.get(id), out[byId.get(id)?.key]));
            out[f.key] = Number.isFinite(r) ? Math.round(r * 1000) / 1000 : "";
        } catch { out[f.key] = ""; }
    }
    return out;
}

/** The max of a resource field: its own "/max", a fixed max, or another field */
function resourceMax(template, field, values, r) {
    if (r?.max != null) return r.max;
    if (field["max-field"]) {
        const mf = template.fields.find((x) => x.key === field["max-field"] || x.id === field["max-field"]);
        const v = mf ? numeric(mf, values[mf.key]) : NaN;
        if (Number.isFinite(v)) return v;
    }
    return field.max;
}

/** How a value reads in a panel or table */
export function displayValue(template, field, values) {
    const v = values[field.key];
    if (empty(v)) return "";
    if (field.type === "resource") {
        const r = parseResource(v);
        if (!r) return String(v);
        const max = resourceMax(template, field, values, r);
        return `${r.cur}${max != null ? `/${max}` : ""}${field.unit ? ` ${field.unit}` : ""}`;
    }
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (Array.isArray(v)) return v.join(", ");
    return `${v}${field.unit ? ` ${field.unit}` : ""}`;
}

// ------------------------------------------------------------------ panels

/**
 * Data for a stats panel. `describe(link)` returns {title, description} for describe-links fields.
 * Custom panels can use {{ownerName}}, {{chapter}}, {{stat.<id>}}, {{#sections}}{{name}}{{#fields}}{{label}}: {{value}}{{/fields}}{{/sections}}
 * and {{#list.<id>}}{{title}} {{description}}{{/list.<id>}} for link fields.
 */
export function panelData(template, values, { ownerName, chapter, describe = () => null } = {}) {
    const all = computeValues(template, values);
    const stat = {}, lists = {};
    const sections = [];
    for (const f of template.fields) {
        const value = displayValue(template, f, all);
        stat[f.id] = value;
        const links = (f.type === "link" || f.type === "links") ? list(all[f.key]).map((l) => ({ link: l, ...(describe(l) ?? { title: String(l).replace(/^\[\[|\]\]$/g, "").split("|").pop(), description: "" }) })) : [];
        lists[f.id] = links;
        if (!value && !template["show-empty"]) continue;
        let s = sections.find((x) => x.name === f.section);
        if (!s) sections.push(s = { name: f.section, fields: [] });
        s.fields.push({ id: f.id, key: f.key, label: f.label, value: value || "—", describe: f.describe && links.length > 0, links, type: f.type });
    }
    return { ownerName, chapter, template: template.name, stat, list: lists, sections, values: all };
}

/** Default panel layout: unsectioned fields first, then "#### Section" blocks; described links as "##### Title" + description */
export function defaultPanel(data, callout = "system") {
    const lines = [`[!${callout}] ${data.ownerName ?? ""}`.trimEnd()];
    const ordered = [...data.sections.filter((s) => !s.name), ...data.sections.filter((s) => s.name)];
    for (const s of ordered) {
        if (s.name) lines.push(`#### ${s.name}`);
        for (const f of s.fields) {
            if (f.describe) {
                if (f.label !== s.name) lines.push(`**${f.label}:**`);
                for (const l of f.links) { lines.push(`##### ${l.title}`); lines.push(l.description || "*No description*"); }
            } else lines.push(`**${f.label}:** ${f.value}`);
        }
    }
    return lines.join("\n");
}
