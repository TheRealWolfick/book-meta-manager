// Plan outlines: events, sub events, sub sub events... Stored as markdown bullets indented with tabs and a
// blank line before each top-level event, which reads well in Obsidian and Bases. Shared by the browser
// editor and the server (migration, saves).

/** Markdown (or loosely indented text) -> [{level, text}] */
export function parseOutline(md) {
    const lines = String(md ?? "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
    // indents made of spaces: the smallest one present is one level
    const spaceUnit = Math.min(...lines.map((l) => /^ +/.exec(l.replace(/^\t*/, ""))?.[0].length ?? Infinity).filter((n) => n > 0), 4);
    const items = [];
    for (const line of lines) {
        const ws = /^[\t ]*/.exec(line)[0];
        const tabs = (ws.match(/\t/g) ?? []).length;
        const spaces = ws.length - tabs;
        const level = Math.min(tabs + Math.floor(spaces / spaceUnit), (items.at(-1)?.level ?? -1) + 1);
        items.push({ level, text: line.slice(ws.length).replace(/^([-*+]|\d+[.)])(\s+|$)/, "").trimEnd() });
    }
    return items;
}

/** [{level, text}] -> markdown; empty items are dropped and levels can't skip a step */
export function serializeOutline(items) {
    const out = [];
    let prev = -1;
    for (const it of items) {
        const text = String(it.text ?? "").trim();
        if (!text) continue;
        const level = Math.max(0, Math.min(it.level, prev + 1));
        if (level === 0 && out.length) out.push("");
        out.push(`${"\t".repeat(level)}- ${text}`);
        prev = level;
    }
    return out.join("\n");
}

export const normalizeOutline = (md) => serializeOutline(parseOutline(md));
