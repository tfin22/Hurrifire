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
