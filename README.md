# Books Meta Viewer

A local web app for writing novels in an [Obsidian](https://obsidian.md) vault. It browses and edits a shared worldbuilding database (items, materials, creatures, factions, locations…), tracks each novel's characters through chapter-based ledgers (inventory, journal, stats, relationships) whose entries you paste into chapters as callouts, plans books chapter by chapter, and builds worlds and maps.

All data stays in the vault as markdown. There is no database: the app reads the notes, watches them for changes, and writes back frontmatter in the same shape Obsidian, Dataview, Bases and Templater expect. Everything it makes can be read and edited in Obsidian too.

## Features

- **Data store**: every collection as a filterable table or cards, grouping, resizable columns, search, editable note pages with typed fields and link pickers, a side drawer, images, backlinks, quality checks.
- **Blueprints**: hierarchical recipes with a build tree, bill of materials and where-used.
- **Novels and ledgers**: per character (or any owner) ledgers of inventory, journal, stats and relationships, viewable at any chapter; an entry editor with live callout preview; transfers mirrored between owners; copy callouts into chapters and see which are already pasted.
- **Plans**: volumes, chapter plans with an outline editor, graded plot ideas.
- **Stats**: per-novel stat templates with formulas, checks and stat panels.
- **World builder**: locations of each world as an editable outline (add, drag to move, Move to…), a nested atlas, and maps.
- **Map builder**: freeform fantasy maps and square-grid battle maps with layers, ~600 stamps (fantasy relief, settlements, monsters, steampunk furniture, machinery, vehicles, pipework…), lines, curved tracks and roads, procedural floor and roof textures, rooms with walls, doors and their own grid, pins for sub-locations and text notes. Maps are saved as SVGs that Obsidian displays.

## Requirements

- [Node.js](https://nodejs.org) 20 or newer (the vault watcher needs recursive `fs.watch`).
- An Obsidian vault, existing or new (see [Vault structure](#vault-structure) and [Seeding](#seeding-a-vault)). Obsidian itself is optional; the plugins Templater, Dataview and Bases are optional and only matter for working in Obsidian.
- Linux with systemd if you want it as a background service; otherwise any OS that runs Node.

## Installation

```sh
git clone https://github.com/TheRealWolfick/book-meta-manager.git
cd book-meta-manager
npm install

# a new vault, or the missing pieces of an existing one (never overwrites anything)
npm run seed -- ~/Documents/Obsidian/books --novel "My First Novel" --world "My World"

# run it, then open http://127.0.0.1:4321 and choose your vault folder on the Settings page
node server.js
```

The vault folder is set on the app's **Settings** page (sidebar → Tools → Settings): type the path or browse to it; folders Obsidian has opened are marked "vault". The app switches to it at once and remembers it in `~/.config/books-meta-viewer/settings.json`. Until a folder is chosen the app shows only that page.

Options: `--vault <folder>` (wins over the Settings page), `--port <n>` (default 4321), `--host <address>` (default 127.0.0.1). The environment variables `BOOKS_VAULT` (used when nothing is chosen on the Settings page), `PORT` and `BOOKS_HOST` do the same.

### As a service (Linux, systemd user unit)

```sh
sh scripts/install-service.sh [--vault ~/Documents/Obsidian/books] [--port 4321] [--host 127.0.0.1]
```

This installs `~/.config/systemd/user/books-meta-viewer.service` with the port and host (and the vault folder, if you give one) as its settings, plus this checkout's location and your `node`, then enables and starts it. Each device keeps its own settings, so after cloning onto another machine you run the script and choose that machine's vault on the Settings page (or pass `--vault`). Run it again to change a setting (the others keep their values); `--dry-run` shows the unit without installing it.

```sh
systemctl --user status books-meta-viewer
journalctl --user -u books-meta-viewer -f
systemctl --user restart books-meta-viewer   # after pulling server changes; front-end changes only need a browser reload
```

> The server has no login. It listens on localhost only; don't expose it to a network without putting authentication in front of it.

## Vault structure

```
<vault>/
├── 1. My First Novel/              a novel: "<number>. <Name>", number below 20
│   ├── config.md                   novel settings (frontmatter)
│   ├── Chapters/                   "001 - Title.md"; number from frontmatter `chapter` or the file name (048.5 works)
│   ├── Characters/                 character sheets, one note per character
│   ├── Ledgers/                    "<Owner> - <Ledger type>.md" (made by the app)
│   ├── Creatures/                  per-novel creature stat notes (optional)
│   ├── Plots/                      plot ideas
│   └── Plan/
│       ├── Book Plan/              volumes
│       └── Chapter Plans/          "Plan 014 (<Novel>).md"
├── 80. Global Data Store/          shared worldbuilding data, used by every novel
│   ├── Items/ Materials/ Recipes/ Abilities/ Races/ Creatures/
│   ├── Power Systems/ Power Levels/ Worlds/ Locations/ Factions/
│   ├── Taxonomy/<Facet>/           category values: Rarity, Genres, Location Scales, Item Categories…
│   └── _Attachments/               images, Maps/ (map SVGs), Map Stamps/ (your own stamp images)
└── 90. Templater/
    ├── Data Store Schema.md        the fields of every collection (JSON block): the single source of truth
    ├── Ledger Types.md             ledger types and their callout templates (frontmatter)
    └── Map Textures.md             your own map floor textures (made by the app)
```

The rules the app relies on:

- **Collections are flat folders.** Sub-categories are fields, never subfolders (Obsidian Bases select rows by folder).
- **Categories are links to taxonomy notes**, e.g. `rarity: "[[rare]]"`, `genre: ["[[Steampunk]]"]`. A new category is a new note in `Taxonomy/<Facet>/`. Taxonomy notes can have `parent` (hierarchy) and `ordered: true` + `class` (ranked lists such as Rarity or Location Scales).
- **Note names are unique across the vault**, ignoring case, because Obsidian resolves `[[links]]` by name. Clashes get a label: `Good (Rating)`, `Good (Item Condition)`. The display name lives in `title`.
- **Locations** form a hierarchy through `parent` and belong to a world through `world`; their scale is a link to `Taxonomy/Location Scales`.
- **Field order and defaults** come from `Data Store Schema.md`; edit it to add fields or collections.

`config.md` of a novel holds its settings in frontmatter, for example:

```yaml
type: config
blueprints: true              # the novel uses crafting blueprints
draft-chapter-from: 900       # chapters from this number on are drafts
accent: "#b03a5b"             # the novel's colour in the app
ledger-types:                 # add ledger types or override callout templates for this novel
  Journal:
    default-callout: maven
stat-templates: {}            # stat templates (made on the novel's Stats tab)
```

Folder names inside a novel can be changed with `characters-folder`, `chapters-folder`, `ledgers-folder`, `volumes-folder`, `chapter-plans-folder`, `plots-folder` and `creatures-folder`.

### Seeding a vault

```sh
npm run seed -- <vault folder> [--novel "Name"] [--number 3] [--world "Name"] [--no-taxonomy] [--dry-run]
```

The seed adds whatever is missing, and never overwrites:

- `90. Templater/Data Store Schema.md` and `Ledger Types.md` (Inventory, Journal, Stats, Relationships, with callout templates);
- a folder for every collection in the schema;
- a basic taxonomy: Rarity, Item Condition, Rating and Location Scales (ranked), Units, Genres, Elements, Energy Sources, Traditions, Material, Creature, Ability and Recipe Categories, Faction Types, Location Types and Item Categories;
- with `--novel`, a novel folder with its subfolders, `config.md` and its `Taxonomy/Novels` note (numbered after the existing novels unless you give `--number`);
- with `--world`, a world note.

Use `--dry-run` to see what it would change. The seed data lives in `seed/`.

## Development

```sh
npm test
```

The tests copy the vault (the one given as an argument, `BOOKS_VAULT`, or the installed service's) to a temporary folder, run the server against the copy, render every page in jsdom and exercise the editors and the map builder. The real vault is never written.

The code has no build step: `server.js` (node:http) with modules in `lib/`, and a Preact + htm front end in `public/` served as-is. `CLAUDE.md` describes the conventions, the API and the internals in detail. `node scripts/build-stamps.js` regenerates the stamp library in `public/stamps/`.

## Licence

The code is released under the [MIT License](LICENSE). The bundled map stamps keep their own licences, listed below.

## Credits

The map stamps come from [Azgaar's Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) (MIT), [Kenney](https://kenney.nl) (CC0), and [game-icons.net](https://game-icons.net) (CC BY 3.0; credit them if you publish maps that use those icons); the steampunk, plant and pipework stamps are drawn by `scripts/build-stamps.js`. Details in [`public/stamps/CREDITS.md`](public/stamps/CREDITS.md). The heading font Newsreader is under the SIL Open Font License.
