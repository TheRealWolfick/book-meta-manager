// Logic-less "mustache" subset for callout templates: {{var}}, {{#list}}...{{/list}}, {{^empty}}...{{/empty}}.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function lookup(stack, name) {
    if (name === ".") return stack.at(-1);
    for (let i = stack.length - 1; i >= 0; i--) {
        const s = stack[i];
        if (s && typeof s === "object" && name in s) return s[name];
    }
    return "";
}

function render(tpl, stack) {
    let out = "";
    let i = 0;
    const tag = /\{\{([#^/]?)\s*([\w.\-]+)\s*\}\}/g;
    while (true) {
        tag.lastIndex = i;
        const m = tag.exec(tpl);
        if (!m) { out += tpl.slice(i); break; }
        out += tpl.slice(i, m.index);
        const [whole, type, name] = m;
        const after = m.index + whole.length;
        if (!type) {
            const v = lookup(stack, name);
            out += v == null ? "" : String(v);
            i = after;
            continue;
        }
        if (type === "/") { i = after; continue; }
        // find the matching close tag, allowing nesting of the same name
        const re = new RegExp(`\\{\\{([#^/])\\s*${escapeRe(name)}\\s*\\}\\}`, "g");
        re.lastIndex = after;
        let depth = 1, inner = null, end = tpl.length, m2;
        while ((m2 = re.exec(tpl))) {
            if (m2[1] === "/") { if (--depth === 0) { inner = tpl.slice(after, m2.index); end = m2.index + m2[0].length; break; } }
            else depth++;
        }
        if (inner == null) inner = tpl.slice(after);
        const v = lookup(stack, name);
        const truthy = Array.isArray(v) ? v.length > 0 : !!v;
        if (type === "#") {
            if (Array.isArray(v)) for (const item of v) out += render(inner, [...stack, item]);
            else if (truthy) out += render(inner, [...stack, v]);
        } else if (!truthy) out += render(inner, stack);
        i = end;
    }
    return out;
}

export function renderTemplate(tpl, ctx) {
    // a section tag alone on its line removes that line, so templates can be written one tag per line
    const prepared = String(tpl ?? "").replace(/^[ \t]*(\{\{[#^/][^}]+\}\})[ \t]*\r?\n/gm, "$1");
    return render(prepared, [ctx]);
}

/** Prefix every line with "> " so the text is an Obsidian callout */
export function asCallout(text) {
    const lines = String(text).replace(/\s+$/, "").split("\n");
    const out = [];
    for (const l of lines) {
        if (!l.trim() && (!out.length || out.at(-1) === ">")) continue; // collapse blank runs
        out.push(l.trim() ? `> ${l}` : ">");
    }
    while (out.at(-1) === ">") out.pop();
    return out.join("\n");
}
