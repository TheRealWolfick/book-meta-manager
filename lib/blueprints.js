// Hierarchical blueprints: build trees, rolled-up bill of materials, where-used.
import { DS, linkLabel } from "./vault.js";
import { normQty, qtyText } from "./ledger.js";

const RECIPES = `${DS}/Recipes`;

/** component:: / count:: and material:: / quantity:: / unit:: pairs from a recipe body */
export function parseRecipeBody(body) {
    const components = [], materials = [];
    let cur = null;
    for (const line of String(body ?? "").split("\n")) {
        const m = /^\s*([\w-]+)::\s*(.*?)\s*$/.exec(line);
        if (!m) continue;
        const [, k, v] = m;
        if (k === "component") { cur = { item: v, count: 1 }; components.push(cur); }
        else if (k === "count" && cur && cur.item) cur.count = Number(v) || 1;
        else if (k === "material") { cur = { material: v, qty: 0, unit: "g" }; materials.push(cur); }
        else if (k === "quantity" && cur && cur.material) cur.qty = Number(v) || 0;
        else if (k === "unit" && cur && cur.material) cur.unit = v || "g";
    }
    return { components: components.filter((c) => c.item), materials: materials.filter((m) => m.material) };
}

export class Blueprints {
    constructor(vault) { this.vault = vault; this._v = -1; }

    /** item path -> recipe note, rebuilt when the vault changes */
    index() {
        if (this._v === this.vault.version) return this._idx;
        const idx = new Map();
        const usedIn = new Map();
        for (const r of this.vault.inFolder(RECIPES)) {
            const item = r.fm.item ? this.vault.resolve(r.fm.item) : null;
            const parsed = parseRecipeBody(r.body);
            if (item) idx.set(item, { note: r, item, ...parsed });
            for (const c of parsed.components) {
                const cp = this.vault.resolve(c.item);
                if (!cp) continue;
                if (!usedIn.has(cp)) usedIn.set(cp, []);
                usedIn.get(cp).push({ recipe: r.path, item, count: c.count });
            }
        }
        this._idx = { recipes: idx, usedIn };
        this._v = this.vault.version;
        return this._idx;
    }

    recipeFor(itemPath) { return this.index().recipes.get(itemPath) ?? null; }

    /** Recursive build tree for an item and a total bill of materials */
    tree(itemPath, count = 1) {
        const bill = new Map();      // material -> {qty, unit}
        const parts = new Map();     // components with no blueprint (loot / base parts)
        const disciplines = new Set();
        let maxTier = 0;
        const build = (path, n, seen) => {
            const note = this.vault.notes.get(path);
            const r = this.recipeFor(path);
            const node = { item: path, name: note?.name ?? path, count: n, recipe: r?.note.path ?? null, tier: note?.fm.tier ?? null, children: [], materials: [] };
            if (node.tier) maxTier = Math.max(maxTier, Number(node.tier) || 0);
            if (!r) {
                if (seen.size) { const p = parts.get(path) ?? { item: path, name: node.name, count: 0 }; p.count += n; parts.set(path, p); }
                return node;
            }
            if (seen.has(path)) return { ...node, cycle: true };
            const next = new Set(seen).add(path);
            for (const d of [].concat(r.note.fm.disciplines ?? [])) disciplines.add(linkLabel(d));
            for (const m of r.materials) {
                const mp = this.vault.resolve(m.material);
                const { q, unit } = normQty(m.qty * n, m.unit);
                const key = `${mp ?? linkLabel(m.material)}|${unit}`;
                const b = bill.get(key) ?? { material: mp, name: linkLabel(m.material), qty: 0, unit };
                b.qty += q;
                bill.set(key, b);
                node.materials.push({ material: mp, name: linkLabel(m.material), qty: q, unit, qtyText: qtyText(q, unit) });
            }
            for (const c of r.components) {
                const cp = this.vault.resolve(c.item);
                if (!cp) { node.children.push({ item: null, name: linkLabel(c.item), count: c.count * n, missing: true, children: [], materials: [] }); continue; }
                node.children.push(build(cp, c.count * n, next));
            }
            return node;
        };
        const root = build(itemPath, count, new Set());
        const billList = [...bill.values()].map((b) => ({ ...b, qtyText: qtyText(b.qty, b.unit) })).sort((a, b) => a.name.localeCompare(b.name));
        return { root, bill: billList, parts: [...parts.values()], disciplines: [...disciplines].sort(), maxTier };
    }

    /** What this item goes into, recursively upward */
    whereUsed(itemPath, seen = new Set()) {
        const uses = this.index().usedIn.get(itemPath) ?? [];
        return uses.map((u) => {
            const name = u.item ? this.vault.notes.get(u.item)?.name : linkLabel(u.recipe);
            if (!u.item || seen.has(u.item)) return { ...u, name, parents: [], cycle: seen.has(u.item) };
            return { ...u, name, parents: this.whereUsed(u.item, new Set(seen).add(itemPath)) };
        });
    }
}
