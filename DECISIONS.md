# Design decisions

Where the spec was ambiguous, or where I took a liberty, it's noted here.

## Platform and build

- **Single file plus optional PWA extras.** `npm run build` produces one
  self-contained `dist/index.html` (all code and data inlined) that runs from
  anywhere, including `file://`. A service worker cannot be inlined into a
  page, so `manifest.webmanifest`, `icon.svg` and `sw.js` sit next to it in
  `dist/`. They're only needed for add-to-home-screen and offline use when the
  game is served over http(s); the page works without them.
- **Copper colours live above index 31.** The framebuffer is 8-bit. Indices
  0–31 are the 32-colour palette; 32–255 are the "copper" sky/ground gradient,
  recomputed every frame. That is how the copper gets smooth bands without
  using palette colours, as the spec asks.
- **Palette fades are quantised to 12 bits** each frame, so G greyout, redout
  and the debrief fade step visibly, as on real hardware.
- **Screen-edge clipping** is done per scanline inside the polygon filler
  (spans are clamped to the clip rectangle) rather than by a second
  Sutherland–Hodgman pass in 2D. The result is identical for convex polygons
  and it's cheaper. Near-plane clipping is a real Sutherland–Hodgman pass in
  camera space, and it's unit tested.

## Controls

- **Debug key.** The spec gives `D` for the debug overlay and also WASD for
  the stick. `D` is roll-right, so the debug overlay is on `` ` `` (backtick)
  or **Shift+D**. The three-finger tap works on touch.
- Other keys the spec didn't assign: `Z`/`X` rudder, `E` emergency boost
  ("through the gate"), `I` start-up (or primer/mags/starter from the
  buttons), `J` bail out, `M` map, `C` canopy, `K` collapse the panel,
  `,` wheel brakes, `N` toggle mouse-as-stick, `Esc` pause, `H` help.
  Holding `G` works the Spitfire's hand pump.

## Renderer

- **Models are built from data by a kit.** Each aircraft in
  `content/models/` is a data description (fuselage cross-sections, wing
  planform, tail, markings) that `kit.ts` turns into vertex/face lists at
  load time, in three detail levels. Writing 100-face meshes out by hand as
  raw numbers would be unreviewable; the generated data is still plain
  vertex lists and convex faces, and the model viewer shows face counts.
- **Decals** (roundels, crosses, fin flashes) are faces tagged with a parent
  face. They're drawn immediately after the parent, so the painter's sort
  never puts a roundel behind its wing.
- **Half-Lambert shading** (0.5 + 0.5·n·sun) picks the ramp step, so faces
  in shadow stay readable at 32 colours instead of going black.
- **Perf check (milestone 2).** In headless Chromium with 6× CPU
  throttling as a stand-in for a mid-range phone, 40 aircraft in view held
  60 fps (about 1.6 ms of render time unthrottled). This still needs
  confirming on a real phone.

## Flight model

- **The stick commands load factor, not elevator angle.** Neutral stick holds
  about 1 g, as a trimmed aeroplane would. Pulling asks for more G, up to the
  aircraft's limit. The elevator then drives angle of attack towards
  whatever that G needs, capped a little past the stall. So full back stick
  at low speed stalls, and at high speed it pulls the G limit. Turn
  performance comes out of lift and G limits, and a hard turn bleeds energy
  through induced drag. This feels predictable on a touch stick and is the
  same for the AI.
- **Rotation is a command model** (target rates with first-order lags)
  rather than integrated moments of inertia. It's stable at 50 Hz and easy
  to tune per type.
- **Relative performance** is checked by tests (`tests/flight.test.ts`)
  rather than by matching historical figures:
  - The Spitfire out-turns the 109 at every height.
  - The Hurricane turns tightest below about 10,000 ft.
  - The 109 has the best climb and dive.
  - The Spitfire is fastest at altitude.
  - The Hurricane is slowest.
- **Big liberty: the 109's dive.** In the model the 109's dive advantage
  comes partly from a later high-speed drag rise (`dragRiseV`/`dragRiseK`).
  Historically it owed more to fuel injection, which let pilots bunt
  straight into a dive. That is also modelled, through the Merlin's
  negative-G cut-out.
- **Engine heat** is a simple first-order model. Full power on the ground
  heats slowly, emergency boost is fine within its time limit and overheats
  well beyond it, and a glycol leak (from M4) cuts cooling until the engine
  seizes.
- **G tolerance** starts greying at 4.3 g. Sustained 6.5 g blacks out in a
  few seconds, and 7.5 g in about 3. A blacked-out pilot's stick goes
  neutral, which also holds for AI pilots.
