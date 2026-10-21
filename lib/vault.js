// In-memory index of the vault: notes, frontmatter, links and live reload.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import YAML from "yaml";

export const DS = "80. Global Data Store";
export const SCHEMA_NOTE = "90. Templater/Data Store Schema.md";
export const LEDGER_TYPES_NOTE = "90. Templater/Ledger Types.md";

const IGNORE = /(^|\/)(\.git|\.obsidian|\.trash|\.data-browser|node_modules)(\/|$)/;
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
const LINK_RE = /!?\[\[([^\]\n]+?)\]\]/g;

/** Split a note into frontmatter text and body */
export function splitNote(text) {
    const m = text.match(FM_RE);
    if (!m) return { fmText: null, body: text };
    return { fmText: m[1], body: text.slice(m[0].length) };
}

/** Parse frontmatter text leniently (tabs and duplicate keys happen in hand-edited notes) */
export function parseFm(fmText) {
    if (fmText == null || !fmText.trim()) return { fm: {}, error: null };
    try {
        const v = YAML.parse(fmText.replace(/\t/g, "  "), { uniqueKeys: false });
        return { fm: v && typeof v === "object" && !Array.isArray(v) ? v : {}, error: null };
    } catch (e) {
        return { fm: {}, error: e.message };
    }
}

/** "[[a/b.md#h|c]]" -> "a/b.md" */
export function linkTarget(v) {
    let s = String(v ?? "").trim();
    const m = s.match(/^!?\[\[([^\]]+)\]\]$/);
    if (m) s = m[1];
    return s.split("|")[0].split("#")[0].trim();
}

/** "[[a/b|c]]" -> "c", "[[a/b]]" -> "b", "plain" -> "plain" */
export function linkLabel(v) {
    const s = String(v ?? "").trim();
    const m = s.match(/^!?\[\[([^\]]+)\]\]$/);
    if (!m) return s;
    const [target, alias] = m[1].split("|");
    return (alias ?? target.split("#")[0].split("/").pop().replace(/\.md$/, "")).trim();
}

export const isLink = (v) => typeof v === "string" && /^!?\[\[[^\]]+\]\]$/.test(v.trim());
export const noteName = (p) => path.posix.basename(p).replace(/\.md$/, "");

export class Vault extends EventEmitter {
    constructor(root) {
        super();
        this.root = path.resolve(root);
        this.notes = new Map();   // rel path -> note
        this.files = new Set();   // rel paths of non-markdown files
        this.byName = new Map();  // lower name -> [rel paths]
        this.byAlias = new Map();
        this.fileByName = new Map();
        this.version = 0;
    }

    abs(rel) {
        const p = path.resolve(this.root, rel);
        if (p !== this.root && !p.startsWith(this.root + path.sep)) throw Object.assign(new Error(`Path escapes vault: ${rel}`), { status: 403 });
        return p;
    }

    async load() {
        const walk = async (dir) => {
            for (const ent of await fsp.readdir(this.abs(dir), { withFileTypes: true })) {
                const rel = dir ? `${dir}/${ent.name}` : ent.name;
                if (IGNORE.test(rel) || ent.name.startsWith(".")) continue;
                if (ent.isDirectory()) await walk(rel);
                else await this.loadFile(rel);
            }
        };
        await walk("");
        this.rebuildNames();
    }

    async loadFile(rel) {
        let st;
        try { st = await fsp.stat(this.abs(rel)); } catch { this.notes.delete(rel); this.files.delete(rel); return; }
        if (!st.isFile()) return;
        if (!rel.endsWith(".md")) { this.files.add(rel); return; }
        const text = await fsp.readFile(this.abs(rel), "utf8");
        const { fmText, body } = splitNote(text);
        const { fm, error } = parseFm(fmText);
        const links = [];
        for (const m of text.matchAll(LINK_RE)) links.push(m[1]);
        this.notes.set(rel, {
            path: rel, name: noteName(rel), folder: path.posix.dirname(rel),
            fm, fmError: error, fmText, body, mtime: st.mtimeMs, links,
        });
    }

    rebuildNames() {
        this.byName.clear(); this.byAlias.clear(); this.fileByName.clear();
        const add = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
        for (const n of this.notes.values()) {
            add(this.byName, n.name.toLowerCase(), n.path);
            const al = n.fm.aliases;
            for (const a of Array.isArray(al) ? al : al ? [al] : []) add(this.byAlias, String(a).toLowerCase(), n.path);
        }
        for (const f of this.files) add(this.fileByName, path.posix.basename(f).toLowerCase(), f);
        for (const m of [this.byName, this.byAlias, this.fileByName]) for (const v of m.values()) v.sort((a, b) => a.length - b.length || a.localeCompare(b));
        this._backlinks = null;
        this.version++;
    }

    /** Resolve link text (or a "[[link]]" value) to a vault path, the way Obsidian does: by name, case-insensitive */
    resolve(v) {
        const t = linkTarget(v).replace(/\\/g, "/");
        if (!t) return null;
        if (t.includes("/")) {
            for (const c of [t, `${t}.md`]) if (this.notes.has(c) || this.files.has(c)) return c;
        }
        const base = t.split("/").pop();
        const lower = base.toLowerCase();
        return this.byName.get(lower.replace(/\.md$/, ""))?.[0] ?? this.fileByName.get(lower)?.[0] ?? this.byAlias.get(lower)?.[0] ?? null;
    }

    nameTaken(name) {
        return this.byName.has(String(name).toLowerCase());
    }

    /** Paths of notes linking to `target` */
    backlinks(target) {
        if (!this._backlinks) {
            this._backlinks = new Map();
            for (const n of this.notes.values()) {
                for (const l of new Set(n.links)) {
                    const r = this.resolve(l);
                    if (!r || r === n.path) continue;
                    if (!this._backlinks.has(r)) this._backlinks.set(r, new Set());
                    this._backlinks.get(r).add(n.path);
                }
            }
        }
        return [...(this._backlinks.get(target) ?? [])];
    }

    /** Notes directly inside a folder */
    inFolder(folder) {
        const out = [];
        for (const n of this.notes.values()) if (n.folder === folder) out.push(n);
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }

    watch() {
        const pending = new Set();
        let timer = null;
        fs.watch(this.root, { recursive: true }, (_ev, file) => {
            if (!file) return;
            const rel = file.split(path.sep).join("/");
            if (IGNORE.test(rel) || path.posix.basename(rel).startsWith(".")) return;
            pending.add(rel);
            clearTimeout(timer);
            timer = setTimeout(async () => {
                const batch = [...pending];
                pending.clear();
                for (const p of batch) {
                    let isDir = false;
                    try { isDir = (await fsp.stat(this.abs(p))).isDirectory(); } catch { /* deleted */ }
                    if (isDir) continue;
                    this.notes.delete(p); this.files.delete(p);
                    await this.loadFile(p);
                }
                this.rebuildNames();
                this.emit("change", batch);
            }, 150);
        });
    }
}
