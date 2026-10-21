// Markdown -> HTML with Obsidian flavour: wikilinks, image embeds, callouts, inline fields, %% comments %%.
import { marked } from "marked";
import { linkLabel } from "./vault.js";

const IMG = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const fileUrl = (p) => `/files/${p.split("/").map(encodeURIComponent).join("/")}`;
export const noteHref = (p) => `#/note/${encodeURIComponent(p)}`;

function wikilinks(md, vault) {
    return md.replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (whole, bang, inner) => {
        const p = vault.resolve(inner);
        const label = esc(linkLabel(whole));
        if (bang && p && IMG.test(p)) return `<img class="embed" src="${fileUrl(p)}" alt="${label}">`;
        if (!p) return `<span class="wl unresolved" title="No note named ${label}">${label}</span>`;
        if (!p.endsWith(".md")) return `<a class="wl" href="${fileUrl(p)}" target="_blank">${label}</a>`;
        return `<a class="wl" href="${noteHref(p)}">${label}</a>`;
    });
}

/** Render Obsidian callouts (> [!type] Title) as HTML blocks before markdown parsing */
function callouts(md, vault) {
    const lines = md.split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const m = /^>\s*\[!([\w-]+)\][+-]?\s*(.*)$/.exec(lines[i]);
        if (!m) { out.push(lines[i]); continue; }
        const inner = [];
        while (i + 1 < lines.length && /^>/.test(lines[i + 1])) inner.push(lines[++i].replace(/^>\s?/, ""));
        const html = `<div class="callout" data-callout="${esc(m[1])}"><div class="callout-title">${marked.parseInline(m[2] || m[1])}</div><div class="callout-content">${renderMarkdown(inner.join("\n"), vault)}</div></div>`;
        out.push("", html.replace(/\n\s*\n/g, "\n"), "");
    }
    return out.join("\n");
}

export function renderMarkdown(md, vault) {
    let s = String(md ?? "").replace(/%%[\s\S]*?%%/g, "");
    s = wikilinks(s, vault);
    s = s.replace(/\[([\w\/-]+)::\s*([^\]]*)\]/g, (_w, k, v) => `<span class="ifield"><b>${esc(k)}</b> ${v}</span>`);
    s = s.replace(/^([\w\/-]+)::\s?(.*)$/gm, (_w, k, v) => `<span class="ifield"><b>${esc(k)}</b> ${v}</span>  `);
    s = callouts(s, vault);
    return marked.parse(s, { gfm: true, breaks: false });
}
