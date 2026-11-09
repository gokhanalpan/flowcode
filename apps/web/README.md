# @flowcode/web

The FlowCode app: React + Vite, wrapped with Capacitor for Android (iOS later). It consumes
`@flowcode/core` straight from source via a Vite alias, so there is no build step for the core
and HMR covers both packages.

```bash
npm install            # at the repo root
npm run dev            # http://localhost:5173
npm run build          # type-check + production build into apps/web/dist
```

## Android

Needs Android Studio once. From `apps/web`:

```bash
npx cap add android    # first time only; creates apps/web/android (git-ignored)
npm run build
npm run android        # cap sync + open in Android Studio, then Run
```

## What is where

| file | job |
|---|---|
| `src/App.tsx` | screens: Home → Load / Editor; language; Android back button returns to Home |
| `src/components/Home.tsx` | Home (Continue, Tutorial, Open, New) and the Open list (saved charts with delete, examples) |
| `src/components/Editor.tsx` | the chart screen: state, Save/rename/back with unsaved-changes guard, draft autosave, runner wiring, tutorial coach, draggable panel height |
| `src/tutorial.ts` + `src/components/Coach.tsx` | the interactive tutorial: steps with checks against the chart and the runs; the coach advances itself when a step is done |
| `src/components/ChartCanvas.tsx` | SVG renderer for `layoutBlocks()`: pan, pinch/wheel zoom, tap a node to edit, tap "+" on an edge to insert |
| `src/components/BlockEditor.tsx` | one form per block kind; variables are dropdowns of what's in scope. The insert menu shows six beginner blocks, the rest under "More" |
| `src/components/ExprBuilder.tsx` | tap-to-build expressions (variables, keypad, operators, text); produces the same expression text the keyboard would, with a Keyboard toggle |
| `src/components/Panels.tsx` | Run panel (Play with speed, Step, Stop, Run-to-end; console with inline input; variables; errors in beginner language) and Code panel (language chips, copy, paywall preview) |
| `src/i18n.ts` | all UI strings in English and Turkish, plus Turkish text for every diagnostic code |
| `src/labels.ts` | the one-line node text for each block kind |
| `src/entitlements.ts` | `isUnlocked()` / `unlock()` — a localStorage stand-in for Google Play Billing; nothing else in the UI knows how purchases work |
| `src/storage.ts` | multiple named charts + the working draft, in localStorage (migrates the old single chart) |
| `src/examples.ts` | loads `packages/core/examples/*.json` into the Examples menu |

## Audience

Ages 10–15 and adult beginners. That drives the choices: no typing of expressions (the builder), six visible blocks named in plain words (Ask, Say, New variable…), Play as an animation that walks the chart block by block with the canvas following, errors rewritten in beginner language, and text never scaled below readable.

## Design notes

The canvas carries the identity (squared-notebook grid, navy ink, textbook shape tints: yellow decisions, blue I/O, green loops); everything else is quiet system type. Blue is reserved for the one primary affordance, the "+" insert buttons; amber marks the block the runner is on, red a runtime error or a breakpoint. Light and dark follow the system. Touch targets are 44 px or larger.

## Not done yet

- Creating and editing functions (parameters, return type). Existing functions in a chart can be viewed and edited; the picker is in the top bar.
- More tutorials (If, loops, lists) — `tutorial.ts` takes a step list, so each is data plus strings.
- Google Play Billing behind `entitlements.ts`.
- Undo/redo, rename variable, duplicate block, multiple saved charts.
- Checker warnings: value-returning function whose end is reachable, loop variable used after the loop, `int` overflow for C#.
