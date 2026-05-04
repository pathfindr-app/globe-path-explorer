# Amber CRT Interface Implementation Plan

> **For Hermes:** User requested planning only first. Do not implement until Kyle approves this plan.

**Goal:** Transform Geodesic Resolver into an original, instrument-grade amber CRT interface with authentic phosphor/scanline/globe-trace behavior while preserving the working mobile/desktop split.

**Architecture:** Build the CRT look as a disciplined rendering system, not a one-off filter. Start with design tokens and CSS overlays that safely affect DOM + globe, then add focused vector-line motion and only introduce heavier shader/postprocessing if it proves controllable with `react-globe.gl`. Mobile receives a lower-cost CRT treatment; desktop receives the richer CRT stack.

**Tech Stack:** React 19, Vite, Tailwind v4, `react-globe.gl`, Three.js, CSS custom properties, CSS pseudo-element overlays, optional Three.js shader/postprocessing prototype.

---

## Reference Direction

### Primary references
- IBM 5151 / amber monochrome CRT displays — warm phosphor, text bloom, scanline grain, instrument restraint.
- DEC VT100 / VT220 / Wyse terminals — fixed-grid panels, sparse command language, honest terminal UI.
- Tektronix 4010/4014 vector terminals — luminous technical line graphics; strongest reference for geodesic trace rendering.
- Radar / oscilloscope phosphor displays — persistence trails, sweep behavior, afterglow decay.
- Early CAD / GIS vector terminals — scientific plotting, not cyberpunk decoration.

### Film/UI references, used sparingly
- *Alien* / MU-TH-UR terminal graphics — slow terminal reveal, bureaucratic machine tone.
- *WarGames* NORAD terminals — command-center urgency without modern glow sludge.
- *The Andromeda Strain* displays — clinical grid/science instrumentation.

### Anti-references / avoid
- Purple-blue AI dashboard gradients.
- Glassmorphism cards.
- Random HUD rings/hexagons/particles.
- VHS glitch filters mixed into CRT.
- Fake unreadable data walls.
- Constant heavy flicker.
- Anything that feels like a generic “retro cyber terminal” prompt.

---

## Design System Target

### Palette
Use one primary phosphor family, not a rainbow:
- `--crt-bg`: near-black warm brown/green-black.
- `--crt-surface`: dark brown-black panel.
- `--crt-amber-dim`: desaturated brown-orange for inactive text.
- `--crt-amber`: readable phosphor amber.
- `--crt-amber-hot`: pale yellow-white only for active trace cores / lock pulses.
- `--crt-border`: dim amber with low opacity.
- Keep red/green/blue out unless needed for semantic alerts; even then, extremely restrained.

### Typography
- Keep JetBrains Mono initially, but tune like a terminal: lower modern letter spacing, stronger tabular alignment.
- Use uppercase labels only for short labels/statuses.
- Replace decorative phrases with operational labels:
  - `AWAITING VECTOR`
  - `ARC SOLUTION`
  - `NODE LOCK`
  - `TRACE LENGTH`
  - `LAT/LON`
  - `BEARING`
  - `SIGNAL`
  - `PHOSPHOR TRACE`

### Layout posture
- Desktop: still fixed left instrument panel + globe viewport.
- Mobile: bottom-sheet terminal control panel remains, but skinned as CRT hardware UI.
- All panels align to a subtle character-cell/grid rhythm.
- Reduce rounded SaaS card feeling; use thin borders, hard-edged terminal boxes, small radius only where needed for screen housing.

---

## Technical Strategy

### Layer 1: Tokenized amber CRT skin
Files:
- Modify `src/index.css`
- Modify `src/App.tsx`

Create CSS variables and utility classes:
- `.crt-app`
- `.crt-panel`
- `.crt-readout`
- `.crt-button`
- `.crt-label`
- `.crt-active`

Purpose:
- Replace scattered `#F27D26`, white, blue/green/purple colors with coherent amber tokens.
- Remove modern neon-multicolor styling from path colors or map them into amber intensity variants.
- Preserve current layout structure so this is visually transformative but low-risk.

### Layer 2: CRT screen frame overlays
Files:
- Create `src/components/CRTFrame.tsx` or inline first if we want less refactor.
- Modify `src/App.tsx`
- Modify `src/index.css`

Add a wrapper around the main viewport:

```tsx
<CRTFrame quality={isMobile ? 'low' : 'high'}>
  <Globe ... />
</CRTFrame>
```

Effects:
- scanlines via `repeating-linear-gradient`
- subtle phosphor aperture/mask texture
- vignette / curved-glass impression
- very light noise layer
- optional rolling refresh band on desktop only
- `prefers-reduced-motion` support

Important:
- Do not apply a heavy CRT filter directly to controls until text readability is checked.
- Mobile uses static/low-frequency overlay only.
- Desktop can animate a very subtle refresh sweep.

### Layer 3: Globe + geodesic line treatment
Files:
- Modify `src/App.tsx`
- Possibly create `src/lib/crtTheme.ts`

Change globe visual language:
- Default globe style should become closer to monochrome/vector CRT.
- Existing Earth texture can stay dim under amber overlay initially.
- Active geodesic paths become luminous amber with brighter core.
- Inactive paths become dim afterimage traces.
- Markers become amber phosphor dots with hover labels in terminal style.
- Path colors should no longer be blue/green/purple by default; use amber trace variants or dim/hot states.

Line animation direction:
- Use existing `pathDashAnimateTime`, `pathDashArray`, `pathDashLength`, and stroke settings for first-pass trace motion.
- Active path should “plot” rather than smoothly swoosh.
- Longest-arc/full-orbit modes can use dashed amber persistence, not modern neon dashes.

### Layer 4: Purposeful terminal/status language pass
Files:
- Modify `src/App.tsx`

Replace current sci-fi labels:
- `Engine Core` → `Vector Drive` or keep if it works.
- `Globe Configuration` → `Display Mode`.
- `City Index Search` → `Coordinate Search`.
- `Route Profiles` → `Trace Buffers`.
- `Navigation Logic` → `Arc Solver`.
- `Geodesic Line Stats` → `Trace Metrics`.
- `Node Telemetry` → `Node Telemetry` stays.

Replace vague footer/hero statuses:
- `System Awaiting Input` → `AWAITING VECTOR INPUT`.
- `Satellite Link Established` → only if there is a functional meaning; otherwise use `TRACE ENGINE IDLE`.
- `Geodetic Frame 88.4% Nominal` → avoid fake precise value unless tied to real state.

### Layer 5: Optional shader prototype, not immediate production coupling
Files:
- Create `src/lib/crtShader.ts` if we proceed.
- Possibly create a throwaway `scripts` or separate test scene.

Research says the best CRT effects come from shader passes:
- barrel distortion
- chromatic aberration
- scanlines
- phosphor mask
- noise
- vignette

But with `react-globe.gl`, renderer loop access may be limited. So the correct plan is:
1. First implement CSS/DOM CRT layers and line animation safely.
2. Inspect whether `globeRef.current.renderer()` / scene/camera APIs are available in this version.
3. If available, prototype an `EffectComposer` pass on desktop only.
4. If not clean, avoid invasive render-loop hacks and keep the effect as CSS/WebGL overlay.

---

## Task Breakdown

### Task 1: Capture baseline screenshots

**Objective:** Preserve current desktop/mobile state before CRT work.

**Files:** none.

**Steps:**
1. Use Playwright to capture:
   - desktop 1440×1000
   - mobile 390×844 collapsed
   - mobile 390×844 expanded
2. Save screenshots under `/tmp` or `docs/screenshots/` if we want committed references.
3. Confirm no horizontal overflow before starting.

**Verification:** screenshots exist and match current deployed layout.

---

### Task 2: Add CRT design tokens

**Objective:** Create a coherent amber palette without touching behavior.

**Files:**
- Modify `src/index.css`

**Steps:**
1. Add `:root` CRT variables.
2. Add `body` warm-black background.
3. Add reduced-motion baseline for future CRT animations.
4. Run `npm run lint && npm run build`.

**Verification:** app still builds; no visual changes beyond global background if classes are not yet applied.

---

### Task 3: Apply amber skin to existing components

**Objective:** Replace modern orange/multicolor styling with amber phosphor styling while keeping layout unchanged.

**Files:**
- Modify `src/App.tsx`

**Steps:**
1. Replace hard-coded `#F27D26` usage with CRT variable-backed class names or consistent amber values.
2. Convert route color palette into amber trace intensities.
3. Remove or dim blue/green/purple/red route colors from defaults.
4. Adjust panels from rounded SaaS cards toward terminal readout blocks.
5. Build and inspect desktop + mobile screenshots.

**Verification:** no clipping; mobile bottom sheet still works; desktop sidebar still usable.

---

### Task 4: Add CRT viewport overlays

**Objective:** Add authentic screen texture without compromising usability.

**Files:**
- Create `src/components/CRTFrame.tsx`
- Modify `src/App.tsx`
- Modify `src/index.css`

**Steps:**
1. Implement `CRTFrame` with children and `quality` prop.
2. Add pseudo-element overlays for scanlines, vignette, glass, and noise.
3. Wrap the globe viewport only at first.
4. Add mobile-safe low-quality mode.
5. Respect `prefers-reduced-motion`.

**Verification:** screenshots show visible but subtle CRT character; no text becomes unreadable.

---

### Task 5: Add vector/phosphor line animation pass

**Objective:** Make geodesic lines feel plotted by a vector CRT, not rendered by a modern map library.

**Files:**
- Modify `src/App.tsx`
- Optional: create `src/lib/crtMotion.ts`

**Steps:**
1. Tune `pathDashArray`, `pathDashLength`, `pathDashGap`, and `pathDashAnimateTime`.
2. Increase active path core brightness and use dim persistence for inactive paths.
3. Use hover labels that look like terminal readouts.
4. Add marker lock pulse with CSS animation on active nodes.
5. Disable or reduce pulse if reduced-motion is enabled.

**Verification:** line animation is purposeful, not noisy; mobile performance acceptable.

---

### Task 6: Terminal language/copy pass

**Objective:** Remove generic sci-fi wording and make the UI sound like a real geodesic instrument.

**Files:**
- Modify `src/App.tsx`

**Steps:**
1. Rename sections to technical but clear labels.
2. Remove fake metrics that do not map to state.
3. Ensure every visible label corresponds to actual app behavior or state.
4. Keep user-facing controls understandable.

**Verification:** read the whole UI in desktop and mobile screenshots; no “AI dashboard” filler remains.

---

### Task 7: Investigate shader feasibility

**Objective:** Decide whether to add real WebGL CRT shader/postprocessing or keep CSS overlays.

**Files:**
- None initially.

**Steps:**
1. Inspect `react-globe.gl` runtime API via `globeRef.current` in browser console/local test.
2. Check access to renderer, scene, camera, controls, and render loop.
3. If clean access exists, prototype a `CRTShaderPass` in a separate file.
4. If not clean, do not hack the render loop.

**Verification:** written decision note: “shader viable” or “CSS overlay only for now,” with reason.

---

### Task 8: Optional desktop shader pass

**Objective:** Add high-end CRT distortion only if Task 7 proves safe.

**Files:**
- Create `src/lib/crtShader.ts`
- Modify `src/App.tsx` or `src/components/CRTFrame.tsx`

**Effects:**
- subtle barrel distortion
- edge-only chromatic aberration
- shader scanlines/mask
- vignette
- low-amplitude noise/flicker

**Constraints:**
- Desktop only by default.
- Off or low mode on mobile.
- User-facing toggle if effect is heavy.
- Never make text hard to read.

**Verification:** desktop screenshot visual QA; mobile unaffected; build passes.

---

### Task 9: Final QA and deploy

**Objective:** Ship only after visual and performance sanity checks.

**Steps:**
1. Run `npm run lint && npm run build`.
2. Capture desktop screenshot.
3. Capture mobile collapsed screenshot.
4. Capture mobile expanded screenshot.
5. Check mobile horizontal overflow: `scrollWidth === clientWidth`.
6. Check console for JS errors.
7. Commit and push.
8. Watch GitHub Pages workflow.
9. Curl live page and verify new asset names.

**Verification:** deployed live site at `https://pathfindr-app.github.io/globe-path-explorer/` returns 200 and screenshots match intended CRT direction.

---

## Decision Gate Before Coding

Before implementation, Kyle should approve one of these depth levels:

1. **Safe CRT skin first** — amber tokens + overlays + line motion, no shader risk. Fastest and safest.
2. **Deep CRT system** — do safe skin first, then investigate/attempt desktop shader pass if the globe renderer allows it.
3. **Full instrument redesign** — deeper copy/layout refactor into terminal panels, trace log, and command-line metaphor.

Recommended: **Option 2**. It gives us a serious CRT direction without gambling the working mobile/desktop deployment on shader integration too early.
