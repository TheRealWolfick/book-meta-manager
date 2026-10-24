---
type: config
ledger-types:
  Inventory:
    behaviour: stock
    description: Items held by an owner. Quantities add up over time; view holdings at any chapter.
    actions:
      - add
      - remove
      - move
      - transfer-out
      - transfer-in
    default-callout: default
    callouts:
      default: |-
        [!inventory] {{ownerName}}
        {{#added}}
        - {{qtyText}} {{item}}{{plural}} added to {{destination}}{{#condition}} ({{condition}}){{/condition}}
        {{/added}}
        {{#removed}}
        - {{qtyText}} {{item}}{{plural}} removed from {{source}}{{#note}} ({{note}}){{/note}}
        {{/removed}}
        {{#transferredOut}}
        - {{qtyText}} {{item}}{{plural}} given to {{toName}}
        {{/transferredOut}}
        {{#transferredIn}}
        - {{qtyText}} {{item}}{{plural}} received from {{fromName}}
        {{/transferredIn}}
        {{#moved}}
        - {{qtyText}} {{item}}{{plural}} moved to {{destination}}
        {{/moved}}
        {{eventLink}}
      grouped: |-
        [!inventory] {{title}}
        {{#items}}
        ##### Items
        {{#lines}}
        - {{qtyText}} {{item}}{{plural}} ({{action}})
        {{/lines}}
        {{/items}}
        {{#materials}}
        ##### Materials
        {{#lines}}
        - {{qtyText}} {{item}} ({{action}})
        {{/lines}}
        {{/materials}}
        {{eventLink}}
  Journal:
    behaviour: log
    description: Written entries such as journals, diaries or letters. Kept in order; nothing is totalled.
    fields:
      date:
        label: In-world date
      callout:
        label: Callout variant
    default-callout: default
    callouts:
      default: |-
        [!journal] {{ownerName}}'s Journal{{#date}} — {{date}}{{/date}}
        {{#title}}
        #### {{title}}
        {{/title}}
        {{body}}
        {{eventLink}}
  Stats:
    behaviour: state
    description: Sheet fields that change over time (level, talent, age, alive...). The latest values are written to the character sheet.
    default-callout: default
    callouts:
      default: |-
        [!system] {{ownerName}}
        {{#set}}
        - {{setField}}: {{setValue}}
        {{/set}}
        {{eventLink}}
  Relationships:
    behaviour: state
    description: How the owner feels about other characters. Each line has a "with" target; the latest values become relations/<value> lists on the sheet.
    default-callout: default
    callouts:
      default: |-
        [!note] {{ownerName}}
        {{#set}}
        - {{withName}}: {{setValue}}
        {{/set}}
        {{eventLink}}
---
# Ledger Types
Shared ledger type definitions used by the books meta viewer (`~/Projects/books-meta-viewer`). Each novel can add types or override any part of a type (behaviour, fields, callouts) under `ledger-types` in its own `config.md` frontmatter.

- **behaviour**: `stock` (quantities add up), `log` (ordered entries), or `state` (fields set over time).
- **callouts**: chapter callout templates. An entry chooses one with `callout:: <name>`; otherwise `default-callout` is used. Lookup order: novel variant, novel default, shared variant, shared default.
- Template data: `added`, `removed`, `transferredIn`, `transferredOut`, `moved`, `gained` (added + received), `lost` (removed + given), `set`, `lines`, and `items` / `materials` (each `[{lines}]` when present). Per line: `item`, `itemName`, `qty`, `unit`, `qtyText`, `plural`, `haveHas`, `condition`, `destination`, `source`, `toName`, `fromName`, `note`, `setField`, `setValue`, `withName`. Per entry: `ownerName`, `chapter`, `title`, `body`, `eventLink` and any entry field such as `date`.
- Template syntax: `{{var}}`, `{{#list}}...{{/list}}` (repeat or show if present), `{{^list}}...{{/list}}` (show if empty). A tag alone on its line removes the line. Do not include the `> ` prefix; it is added to every line.
