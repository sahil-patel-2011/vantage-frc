---
name: cad-drawings
description: >-
  Make labeled Onshape drawings first, then cast the solid from those millimetres.
  Use when a brief needs detailed drawings, multiple sheets per part, notes a person
  can CAD from, or onshape_drawing_pack / onshape_create_drawing / onshape_drawing_notes.
---

# Onshape drawings first

Drawings come before sketch and extrude. A person should be able to CAD from the labels.

## Tools

1. `onshape_drawing_pack` — plan one or more labeled sheets (front/top, side, holes when the brief has those sizes).
2. `onshape_create_drawing` — one Drawing tab with controlling millimetres.
3. `onshape_drawing_views` — front, top, side, iso.
4. `onshape_drawing_notes` — notes and millimetre callouts. Never invent `valueMm`.
5. Then `onshape_sketch_rectangle` / `onshape_extrude` copy the same millimetres.

## Rules

- Never invent dimensions. Missing sizes stay missing — ask.
- Multiple drawings per part when faces need their own sizes.
- Fail honestly if Onshape rejects a Drawing, view, or label call. Do not invent an id.
- Not certified engineering software. Prefer a disposable document.
