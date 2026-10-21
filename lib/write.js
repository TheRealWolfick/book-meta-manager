// Safe writes: atomic replace, mtime conflict checks, frontmatter edits that keep key order and unknown keys.
import fsp from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { splitNote, parseYamlLenient } from "./vault.js";

const YAML_OUT = { lineWidth: 0, nullStr: "" };

export class ConflictError extends Error {
    constructor(rel) { super(`${rel} changed since it was loaded. Reload and try again.`); this.status = 409; }
}

export async function atomicWrite(vault, rel, text) {
    const abs = vault.abs(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
    await fsp.writeFile(tmp, text, "utf8");
    await fsp.rename(tmp, abs);
    await vault.loadFile(rel);
    vault.rebuildNames();
    return vault.notes.get(rel);
}

async function checkMtime(vault, rel, baseMtime) {
    if (baseMtime == null) return;
    const st = await fsp.stat(vault.abs(rel));
    if (Math.abs(st.mtimeMs - Number(baseMtime)) > 1) throw new ConflictError(rel);
}

/** Frontmatter object -> "---\n...\n---\n" */
export function fmBlock(obj) {
    const doc = new YAML.Document(obj);
    return `---\n${doc.toString(YAML_OUT)}---\n`;
}

/**
 * Change frontmatter keys (set / unset) and optionally the body, preserving everything else.
 * @param {{set?: Object, unset?: string[], body?: string, baseMtime?: number}} change
 */
export async function patchNote(vault, rel, { set = {}, unset = [], body, baseMtime } = {}) {
    await checkMtime(vault, rel, baseMtime);
    const text = await fsp.readFile(vault.abs(rel), "utf8");
    const parts = splitNote(text);
    const doc = parts.fmText != null ? parseYamlLenient(parts.fmText, (t) => YAML.parseDocument(t, { uniqueKeys: false })) : new YAML.Document({});
    if (!doc.contents) doc.contents = doc.createNode({});
    for (const [k, v] of Object.entries(set)) doc.set(k, v === undefined ? null : v);
    for (const k of unset) doc.delete(k);
    const out = `---\n${doc.toString(YAML_OUT)}---\n${body ?? parts.body}`;
    if (out === text) return vault.notes.get(rel);
    return atomicWrite(vault, rel, out);
}

export async function createNote(vault, rel, fm, body = "") {
    try { await fsp.access(vault.abs(rel)); throw Object.assign(new Error(`${rel} already exists`), { status: 409 }); }
    catch (e) { if (e.status) throw e; }
    return atomicWrite(vault, rel, fmBlock(fm) + body);
}

export const sanitizeName = (s) => String(s ?? "").replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim().replace(/\.+$/, "");

/** Same rule as the Data Store Maintenance script: "Name", then "Name (Label)", then "Name (Label 2)"... */
export function uniqueName(vault, base, label, reserved = new Set()) {
    const taken = (n) => vault.nameTaken(n) || reserved.has(n.toLowerCase());
    if (!taken(base)) return base;
    let c = `${base} (${label})`;
    for (let i = 2; taken(c); i++) c = `${base} (${label} ${i})`;
    return c;
}
