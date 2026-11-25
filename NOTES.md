# Notes for builders

You do not need this page to use Clay Blocks. The buyer guide is [INSTALL.md](INSTALL.md).

## What was kept honest

The print check in `js/printcheck.js` reports only what the code measures.

- **Fit.** Bounding box against the Bambu Lab X2D main-nozzle space, 256 × 256 × 260 mm. Dual-nozzle mode on that printer is smaller (about 235.5 × 256 × 256 mm). The card names the main space.
- **Plate.** The bottom of the exported mesh is compared with y = 0, with a 0.5 mm slack.
- **Separate shapes.** Before Make it clay, holes are not cut and the solids are not joined. The card says that, and the button says **Make it clay**.
- **Skin.** After Make it clay, vertices closer than 0.05 mm are welded and edges are paired. An edge used by one triangle is unpaired. Many unpaired edges are T-junctions from the joiner: the edge still lies on the skin. The check only calls it a gap when the middle of that edge is more than 0.2 mm from every other triangle. Edges used by more than two triangles are reported as messy, with no repair. Separate shells are counted. There is no inside/outside test and no self-intersection test. The card says this is not a promise that the skin is fully closed. There is no repair button on that line.

**Fix it for me** calls `dropToPlate` or `shrinkToFit` only. Shrink scales the model so the box fits, then sits it on the plate. It writes one history step.

Export turns the Y-up scene into Z-up millimetres before it writes STL or 3MF. The lowest point of a model on the plate is Z = 0. The swap keeps triangle winding (the axis change has determinant +1).

Make it clay uses three-bvh-csg (union, then subtraction). That library does not prove a closed skin. A failed join shows a plain error and leaves the shapes as they were.

The mesh is subdivided after the join so sculpting has more triangles, one step at a time. A step is kept only when it does not add edges shared by more than two faces, and does not add a gap. On a plain box the mesh stays fine (about 3000 triangles, none of those edges). On a box with a round hole the first extra step would add those edges, so that model keeps the joined mesh (about 520 triangles). Before this guard, the same hole had 28 of those edges. Each was shorter than 0.09 mm, about 1.2 mm altogether. The guard stops them being created. It does not repair a skin, and the card still does not promise the skin is closed. The hole also has unpaired edges that lie on the surface (T-junctions). The check does not call those a gap unless the middle of the edge is more than 0.2 mm off the rest of the skin.

## Shop zip

From this folder:

```
python3 scripts/make-shop-zip.py
```

That writes `dist/Clay-Blocks.zip`. It does not upload anything and it does not make a release. The zip leaves out `tests/`, `.git`, and `dist/`.

## Offline app

`sw.js` caches the shell, the scripts, the vendor libraries, the icons, and the reading font. Bump the `CACHE` name in `sw.js` when those files change, or returning visitors keep the old copy.

`serve.py` listens on 127.0.0.1 only and sends a JavaScript type for `.js` plus a manifest type for `.webmanifest`.

## Accessibility

- Icon, word, and `data-speak` on the controls. Voice uses the computer’s own speech, and stays quiet if speech is missing.
- Reading font is Atkinson Hyperlegible, loaded from `fonts/`, including the bold file.
- High contrast is a theme switch. The print card also uses a different mark for a tick, a warning, and a note.
- Targets are at least 52 px. The six tools are taller.
- `prefers-reduced-motion: reduce` turns off transitions.
- No timers, streaks, or nagging. Bin asks first.

## A test hook

`window.ClayBlocks` is for the headless check in `tests/smoke.mjs`. It is not a public API and it is not shown in the interface.

## Known limits

- Sculpting moves the vertices that are already there. It does not add new triangles.
- Snapping sits a shape on the plate or on the footprint under it.
- Balls, cylinders, and cones keep a round cross-section.
- Very large histories can fill browser storage. The app keeps working in memory if a save does not fit.
- Suggestion-box ideas stay in local storage on this computer.
- There is no cloud account and no printer connection.
