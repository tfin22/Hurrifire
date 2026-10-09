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

## Dogfight

- **Bullets are grouped.** Each simulated rifle-calibre bullet stands for 2
  real rounds (`TUNING.guns.roundsPerBullet`) with double damage; 20 mm
  shells are simulated one by one. That keeps eight Brownings plus a sky
  full of gunners cheap enough for a phone without changing the hit
  statistics much.
- **Harmonisation is static.** Guns converge on the sight line at the chosen
  range for the muzzle velocity alone, as they were harmonised on the
  ground. In flight the aircraft's own speed makes rounds strike slightly
  high, which is real. Hits ahead of convergence scatter visibly, as the
  spec asks; there's a test for it.
- **Damage overflow.** A part already shot away (elevator, rudder,
  aileron, radiator) passes further hits to the structure behind it.
  Without this, a tail control surface shielded the fuselage from a dead
  astern attack forever.
- **Fire** is a countdown: about 25–40 s from first flames to the tank going
  up, depending on how far it has spread. A fast dive may blow it out. The
  BAIL OUT button shows the seconds left.
- **AI spotting** uses range against the target's span, a blind spot behind
  and below, sun glare (a target within ~14° of the sun is roughly 12× harder
  to see), cloud line of sight and skill. The same rules apply to every AI
  pilot.
- **109 tactics.** Disciplined 109 pilots (average/experte) keep their energy:
  they extend and zoom rather than turn. With a Merlin-engined fighter on
  their tail they often bunt into a dive, which the pursuer can't follow
  without cutting out.

## The world

- **Generated geography.** `scripts/build-world.mjs` (`npm run world`) reads
  Natural Earth 10m land, minor islands and rivers, and SRTM 1-arc-second
  elevation (AWS "skadi" tiles), and caches the downloads in `.cache/`. It
  writes `src/content/world/terrainData.ts` (~110 KB, committed), so the
  build never needs the network. The output is:
  - a 500 m surface-class grid (sea, fields, wood, downs, marsh, town, city,
    river, mud, beach, orchard, hops, France, airfield, cliff, suburb),
    run-length encoded;
  - a 1 km height grid in 2 m units.
- **The hand-authored layer** is `src/content/world/places.json`: airfields,
  towns, landmarks, balloon barrages, extra rivers (the Medway, Swale,
  Stour and others aren't in Natural Earth) and region shapes (Weald
  woods, Downs, marshes, orchards, hops, mudflats, cliffs). The generator
  rasterises these into the class grid, so per-tile surface types live in
  the map data.
- **Fields are generated, but consistently.** Each farmland cell is split
  into one to four rectangular fields with hedges, hashed from its
  coordinates. The renderer draws exactly the fields that `fieldAt()` and
  `clearRun()` report to the landing model. Crops change with the date:
  green corn, then gold, stubble, and ploughed land.
- **Thames width** is stepped by longitude (1 cell in London, widening to
  the estuary) because Natural Earth gives only a centreline there.
- **Battersea has two chimneys.** The second pair was only built in 1955.
- **Cliffs** are drawn as chalk-white coastal cells rather than vertical
  faces. At 500 m resolution they read as the white line along the coast,
  which is how they look from the air.
- **Off the map** nothing is drawn, so the copper haze shows through.

## Up and down

- **The touchdown model** (`landing.ts`) scores each factor at contact:
  sink, bank, drift, speed over the stall, and nose-down attitude. Each
  is scaled so 1.0 is the edge of acceptable; the worst factor drives the
  outcome, through thresholds in `TUNING.landing`. The surface table and
  gear state (down, one leg, up) pick the row. The `luck` input only
  matters within ±0.12 of a threshold. Fatal outcomes need a genuinely bad
  impact: sink over 9 m/s, steep nose-down at speed, a large bank at
  speed, a big fire, or hitting obstacles fast. A test throws 5,000 random
  clean approaches at every landable surface and gear state, and none is
  fatal.
- **Bounces are physical.** A bounce puts the aircraft back in the air with
  a rebound speed. Each further contact counts for more (+15% per bounce).
- **The roll-out is simulated, not predicted.** Hedges, trees, buildings,
  water and craters are checked as the aircraft actually rolls through
  them, using the same hedged fields the renderer draws. A float in the
  flare can carry you over a hedge and into the next field, as it should.
- **Taildragger yaw.** On the ground a yaw rate feeds itself above walking
  pace (the CG is behind the main wheels), so torque swing grows into a
  ground loop unless rudder catches it. Auto-rudder catches it, less
  perfectly at full throttle (about 10° of swing on a full-power run). It
  can't pivot a stationary aircraft.
- **Spitfire hand pump.** Select gear up, then hold GEAR to pump (18
  strokes, about 7 s). The stick hand moves, so the aircraft wobbles in
  pitch and roll while you pump. Other types' gear is hydraulic.
- **Manual rudder adds to auto-rudder in the air**, so you can side-slip
  off height with a fire on, even with auto-rudder on.
- **Best glide speeds** in `content/aircraft.ts` are computed from the same
  drag polar the flight model uses, with the prop windmilling (Spitfire
  about 1:12 at ~120 mph). A test checks a simulated dead-stick glide
  against `glide.ts` to within 15%.
- **Oil on the windscreen** stipples out the centre of the windscreen and
  leaves the side panels clear, so a curved approach looking out of the
  side works.

## The sortie

- **Raids are abstract until met.** A raid is a plot moving along its route
  until any RAF fighter comes within 30 km, then it becomes real aircraft
  in formation. This keeps big days cheap. A raid nobody meets bombs
  abstractly (about half its bombs on target).
- **The controller works from the plot, not the truth.** Positions carry a
  few kilometres of error, and each raid's height has a fixed radar error of
  up to about ±1,800 m (±6,000 ft) plus noise. Strength is an estimate
  (×0.7–1.4). Vectors are collision-course intercepts from the plot.
- **Every discrete action is a recorded command** in the control stream:
  gear, flaps, bail-out, primer, mags, starter, tally-ho and orders. Same
  seed plus same frames gives the same sortie, which the replay camera needs.
- **Start-up**: primer, magnetos, starter; or one START in Assist. Cranking
  without priming or with the mags off coughs but won't catch.
- **Tally-ho needs something within 9 km.** When the player isn't leading,
  the AI leader calls it when he spots the enemy.
- **Claims**: the pilot claims from what they last saw. A target seen going
  down is claimed destroyed; a heavily hit target seen smoking is claimed
  destroyed 60% of the time. Intelligence confirms a claim only on evidence:
  a wreck in England, seen to crash, or a parachute. Otherwise it is allowed
  as a probable. Over-claiming therefore happens, as it did.
- **Rescue at sea** depends on distance from the English coast: about 85%
  within 5 km, falling to about 12% far out. Coming down in France means
  captivity.
- **Bomber gunners** were made much less accurate after the first
  playtests, where a box of Do 17s shot down a whole section before it
  closed. Aim error grows quickly with range, as flexible guns from a
  moving bomber did.
- **Quick Combat** starts you at height, 10 km off a raid of your choosing.

## The raid

- **Escort roles.** Close escort sticks to the bombers and turns on
  anything that attacks them; top cover sits 2,000 m higher and up-sun and
  dives on fighters below. Free-hunting sweeps go where they like.
- **The 110 circle** is shared state: the first 110 to see an RAF fighter
  within 4 km fixes a centre, and every 110 in the group flies round it,
  each covering the tail of the one ahead. It breaks up 40 seconds after
  the last threat. This is what they did, and it makes them stubborn but
  easy to get away from.
- **Vic or pairs.** In a tight vic a wingman's spotting is cut to 45%,
  because he is flying formation on his leader. Pairs (line abreast,
  wide) spot at full strength. The campaign makes the switch available
  part way through; Quick Combat uses whatever the date suggests.
- **15 September** in Quick Combat is the set piece: 33 bombers, 28 escorts
  and your squadron of 12 in one place, plus the second raid on its way.
  118 aircraft in all.
- **Performance.** That raid ran at 17 fps under a 6× CPU throttle in
  Chrome (a rough stand-in for a mid-range phone). Three things fixed most
  of it: building for ES2022 (class fields were being transpiled to
  `defineProperty` calls, which made every `new Vec3` slow), scratch vectors
  in the flight model instead of allocating about ten vectors per aircraft
  per tick, and caching each aircraft's flight environment and
  damage-to-handling result (recomputed on a hit, or once a second as
  glycol and engines wear). Now about 0.8 ms per tick for the sim and
  1.8 ms per frame for the render on a desktop: 34 fps at 6×, 48 fps at 4×.
  On the phone itself the 1990 mode cap is the fallback.

## Campaign

- **Only the big days are flown**: 31 days from 10 July to 29 October, with
  1-3 sorties each (two on 15 September). At 5-10 minutes a sortie the
  whole campaign is a few hours. The days in between pass off-screen: the
  squadron flies, claims, loses pilots, gets replacements and rests, and the
  sector stations are bombed and mended. The board says what happened.
- **The roster** is 17 invented pilots plus you, with a CO and two flight
  commanders. Replacements are mostly green, straight from an OTU, and from
  August more of them are Polish, Czech or from the Dominions. Pilots get
  better with sorties (average after 8; experte after 25 and 3 victories).
- **Fatigue** builds 0.13 a sortie and recovers 0.22 a night. Above 0.8 a
  pilot is stood down. In the air it means a little less G tolerance and
  slower spotting, for you as well.
- **Rank.** Pilot Officer flies as a wingman in the CO's squadron. Flight
  Lieutenant leads B Flight (six aircraft). Squadron Leader leads the
  squadron (twelve). Promotion comes on merit (sorties and confirmed
  victories) or by vacancy, when the man above is lost and you have enough
  sorties. A promotion on merit posts the incumbent away, so nobody has to
  die for it.
- **Vic or pairs.** The board offers pairs from Adlertag (13 August). The
  choice is yours whatever your rank: as a junior you are the one who has
  talked the CO round. Vics spot worse in the air (see the raid) and lose
  about a third more pilots off-screen.
- **Airfields.** Each sector station has a damage level; 40 bombs close
  one, and it mends by a quarter a day. Damage puts flagged craters on the
  grass (placed from a seed, so they stay put across a day). A raid on your
  own field is a scramble under attack.
- **Score** (out of 1000): sector stations open 300, raids turned back
  250, the squadron's survival 250, your record 150, rank 50. Victories
  alone can't win it.
- **Dying.** In Ironman a lost pilot ends the career, and leaving a sortie
  part way counts as turning back with a rough engine (no walking away
  from a fight going badly). Otherwise the sortie is struck from the record
  and flown again with a fresh seed.
- **Saves** are a single versioned JSON blob in localStorage, written after
  every sortie and every change on the board. A save from another version
  is refused with a clear message, and the player can start again.
- **The docks plume** burns from 7 September: a column of smoke kilometres
  high above the Surrey and West India Docks, leaning downwind, visible
  from most of Kent. It is tallest in the first days.

## Juice

- **Sound** is built at startup from oscillators and seeded noise (about
  20 ms), crushed to 8 bits at 11 kHz, and played through four channels
  with Amiga-style panning and a 4.4 kHz low-pass for the LED filter. In
  flight: engine, guns, one-shots, and wind or buffet. One-shots steal a
  channel by priority, so an explosion can briefly drown the wind, as on
  the real chip. The Merlin is a smooth, deep twelve; the DB 601 is
  harder-edged and a different note.
- **Music** is a tiny tracker: four channels, patterns written as
  `note:length` lines, an order list, and synthesised instruments (pulse,
  square, triangle, "brass", "flute", kick, snare). Two original tunes: a
  march in D for the title and a quiet piece in D minor for the debrief.
  None in flight, nor in the dispersal hut, which has the telephone and
  the bell.
- **Audio starts on the first touch or key**, because mobile browsers
  insist. Until then everything is silent and nothing breaks.
- **Replay** re-runs the sortie from its seed and the recorded control
  frames (every discrete action is a command in the frame). A sortie
  snapshots the shared map state (craters, wrecked hangars, balloons) when
  it starts and can rewind it, so the replay starts from the same world.
  Watch from the chase, fly-by, combat (over the shoulder towards the
  nearest enemy) or cockpit cameras, follow any aircraft, and run at up to
  the time-compression limit.

## The other side (stretch)

- **A 109 escort to London**, from the title menu: you lead a Schwarm of
  four (in pairs, of course) as close escort for a dozen or more Dorniers
  or Heinkels, from Cap Gris Nez to the docks or Woolwich and back, on one
  of the big days of late August or September.
- **The fuel gauge is the enemy.** You start at the rendezvous with 80% of
  the 109's 400 litres. London and back at escort speed leaves about ten
  minutes in hand; a fight at full throttle eats it. The red lamp lights
  at 20%, roughly ten minutes at cruise, and blinks in the last few
  minutes. Run dry over the Channel and it's a ditching, and the
  Seenotdienst's chances depend on how close to France you are.
- **Fighter Command sends squadrons up** as the raid comes in: Hurricanes
  low for the bombers, Spitfires high for the escort (as Park wanted), more
  over the target, and a few Spitfires chasing the raid home. Their
  leaders are steered onto the raid every five seconds, as radar and the
  controllers did.
- **Home** is back over France with no RAF fighter within 8 km for 20
  seconds: we skip the circuit at Marquise. Coming down in England means
  captivity.
- **Claims** follow the Luftwaffe rule: a witness, or a wreck on our side of
  the Channel. Over England there is no wreck to inspect.
- **R/T** is in English with the handful of words every 109 pilot used:
  Indianer (enemy fighters), Pauke pauke (attacking), Horrido (a victory).
  Callsigns and names are invented.
- The sortie shares the world, raid, AI, debrief and replay with the RAF
  sortie; the screen talks to either through one small interface.

## Finding the enemy

- Playtesting said it was very hard to find the enemy, so the markers now
  work at every range and in Authentic mode too (Settings: ENEMY MARKERS).
- **Reported raids** (radar plots not yet in sight) are a yellow oblong with
  the radar's estimate, "RAID 30+ AIRCRAFT / OFF HYTHE 18 MI", drawn at the
  radar's height, which may be thousands of feet out, as it was.
- **Formations in sight** within 45 km are a white oblong round the whole
  group, "11 BOMBERS + 8 FIGHTERS / OFF DUNGENESS 7.5 MI".
- **Inside 4.5 km** the oblong breaks into brackets on each aircraft. The
  nearest six get their type, and experten get "ACE!" in yellow. Labels
  that would overlap are moved or dropped.
- **Off screen**, an arrow on the edge of the view points to the nearest
  group, with its strength and distance.
- The lead pipper stays an Assist feature.

## Playtest fixes (handling, sea, readouts)

- **Negative G.** Forward stick used to reach negative G a third of the way
  forward, and the Merlin cut out the instant G went below -0.15, so any
  push into a dive starved it. Now the first 70% of forward travel unloads
  smoothly to zero G and only the last 30% goes negative. The engine needs a
  quarter of a second below -0.2 G before it cuts. A hard bunt still does
  it, as it should. Easing into a dive doesn't.
- **Stalls.** Pulling was linear, so half stick asked for 4 G and slow
  pulls went straight past the stall. The pull is now progressive
  (G rises with stick^1.5), and short of the last 12% of travel the wing is
  held just below the stall angle: it buffets and mushes rather than
  breaking. Full back stick still stalls it, and spins are still there.
- **The Stuka's dive.** Its dive brakes were only a closed throttle, so it
  dived at up to 460 mph and nothing could catch it. Dive brakes are now
  drag, holding it at about 310 mph, near the real figure.
- **The sea** went to haze grey in the first fog band because its colour
  ramp had only three steps. It now stays sea-blue until the last band,
  like the land.
- **Big readouts.** The dials are faithful but unreadable on a phone.
  Airspeed (red with SLOW! near the stall) and height are drawn large in
  the lower corners of the view, with the climb or sink rate. They can be
  switched off in Settings.
- **Raids keep to their bombers' pace.** Quick Combat's Stuka raid swapped
  Ju 87s into whatever template the Channel day drew, once a 109 sweep
  ordered to 246 mph at 17,000 ft, so the Stukas began faster than a
  Spitfire's starting speed. Every raid's speed is now capped at its
  slowest bomber's formation cruise (Ju 87 170 mph, He 111 190, Do 17 197,
  Ju 88 212, Bf 110 257), and the Stuka raid flies below 10,500 ft.

## Finding home, and finishing in a field

- **Airfields from the air.** The ground's detail polygons (perimeter track,
  craters) only draw below about 5,000 ft, and the grass square is the same
  green as the pasture round it, so fields vanished from height. Each
  airfield is now also drawn as a ground marking at any range: the grass
  square, a grey perimeter track and a pale worn landing run along the main
  direction, with its bomb craters. The track and run are wider than life
  so they read at a distance. These are drawn straight after the terrain,
  before anything that stands on it.
- **Homing over the R/T.** A HOMING button (key V) asks the controller for a
  course to the nearest friendly field. He answers after three seconds with
  the course, the distance and the landing direction into the wind. The 109
  pilot gets a bearing to Marquise or Calais-Marck in kilometres. The field
  is then marked like a raid: its name, distance and landing direction,
  and a line down the landing run with an arrow the way to land. Off
  screen, an arrow points to it from the edge of the view. It shows whether
  or not enemy markers are switched on, because the player asked for it.
  The button is hidden when enemies are within visual range.
- **Switching off.** A landing only ended when the aircraft stopped with
  the throttle closed, so rolling about a field with some power on went on
  for ever. After any landing an ENGINE OFF button (key X) appears, with a
  prompt once she slows. Switching off puts the brakes on, and when she
  stops the sortie ends.
- **Written up.** Putting a sound aircraft down in a field is now a
  reprimand. That means no damage, the pilot unhurt, the engine sound and
  more than 6% fuel in the tank. The debrief says so in red, and in the
  campaign each reprimand puts promotion back by three sorties. Any forced
  landing in a field also costs the squadron that aircraft for a day while
  it's fetched back. An RAF pilot who lands in France is taken prisoner.

## Freedom to fight (playtest)

- **Blackout came too soon.** Greying began at 4.3 G and a 7 G pull blacked
  out in under two seconds, so every hard turn ended in the dark. Greying
  now starts at 5 G and builds at 60% of the old rate, and recovery is
  faster. A 6.5 G turn greys within a second, holds for several seconds
  without blacking out, and only goes black after about ten. AI pilots are
  bound by the same limits.
- **Stall guard** (setting, on by default; also in the pause menu). Below
  about 215 mph the last 12% of back-stick travel took the wing past the
  stall, and in a fight that's where the stick lives. With the guard on,
  full back stick holds the wing at the buffet: maximum lift, the shudder
  and the energy bleed, but no departure. With it off the wing can be
  stalled and spun as before. It applies to the player's aircraft only.
- **Big targets** (setting, on by default; also in the pause menu). At 320
  pixels across, a true-size 109 at 300 yards is a few pixels, so gunnery
  was mostly luck. Enemy aircraft are now drawn up to twice their size
  with distance: true size inside 60 m, so close passes and collisions
  look right, and full scale beyond 300 m. The player's rounds hit them
  as large as they're drawn, by scaling the round's path into the body
  frame. AI gunnery is unchanged, so this only helps the player. The
  setting is kept with the world so a replay re-runs the same hits.
- **The pause menu** had outgrown its box. It's taller now, with tighter
  rows.
- **Compass strip** (setting, on by default). A heading tape across the top
  of the view, in the cockpit and chase views. It moves one pixel per
  degree, with ticks every 5 degrees and numbers every 30, and the heading
  in a box over the centre. A green caret marks the course to steer: the
  homing field if one was asked for, otherwise the controller's last vector
  until the fight starts. When the course is off the strip, the caret turns
  yellow and sits at the end you should turn towards. It's not period (the
  real compass is on the panel), but the dial is too small to fly a vector
  by on a phone.
- The keys line under Settings ran off the screen. It now takes three lines
  and includes V (homing) and X (engine off).

## Arcade mode

The playtest verdict was that the game is accurate but not fun: too much
chasing, a fight too quick for the aircraft's responses, and no loop
without blacking out. Arcade is now a third mode (Settings: MODE cycles
Arcade, Assist, Authentic), and it is the default. Arcade includes
everything Assist does, plus:

- **Straight into the fight.** Scrambles and campaign sorties start in the
  air, 800 m above the raid and about 7 km off it, turned in towards it. The
  raid is just crossing the coast. Contact comes in about 20 seconds
  instead of a ten-minute climb.
- **A quicker, stronger aircraft.** Pitch and roll respond 50% faster, and
  the engine gives 35% more thrust, so you can overhaul bombers and climb
  out of trouble.
- **No blackout or greying, no negative-G cut-out, no spins.** Full back
  stick always holds the wing at the buffet. A loop from 300 mph at full
  stick goes all the way round.
- **Gunnery that rewards a hit.** Your rounds do 2.5 times the damage and
  enemy rounds do you half. Big targets still applies if it's on.
- **A softer enemy.** Every raid group is one grade less skilled (aces
  become average pilots, average become green).

All of it applies only to the player's aircraft and the raid. The real
model is untouched underneath, and Assist and Authentic play exactly as
before. The arcade flag is kept with the world, so replays re-run the same
fight. The other side (the 109 escort) gets the arcade handling and
damage rules too. It already starts in the air with the bombers.

## Engine sounds

The engines were one generic pulse loop, sped up and slowed down. They're
now built from how each engine actually runs, still synthesised (nothing
sampled) and still crushed to 8 bits:

- **Merlin III.** 12 cylinders firing evenly, six times a revolution, so the
  note is 260 Hz at 2,600 rpm. The two banks alternate through the exhaust
  stubs at slightly different strengths, which gives the growl an octave
  below. The de Havilland three-blade prop, geared 0.477, chops the note
  1.43 times a revolution: the throb. The supercharger whines at about
  1.3 kHz. Each cylinder has its own slightly different voice, so it isn't
  a pure buzz.
- **Throttled back.** A second Merlin loop is lumpy, misfiring, and
  crackling and popping on the overrun, the sound of a Merlin coming in to
  land. It cross-fades in as the throttle closes and is played at the same
  rpm, so a dive with the throttle shut crackles at full revs.
- **DB 601.** Fuel injection means no pops. It has a harder, raspier pulse,
  240 Hz at 2,400 rpm, a quicker prop throb (VDM prop geared 0.645) and the
  supercharger's whine well up.
- **The bomber drone.** German twins (Jumo 211s in the He 111 and Ju 88) ran
  their engines unsynchronised, and the two props beat against each other
  in the pulsing drone everyone in the south learned to recognise. It's
  heard within about a mile and a half of any bomber, under the wind.
- Engine loops are now built at 22 kHz (the rest stay at 11 kHz) so the
  supercharger is clear. Every component makes a whole number of cycles in
  the loop, so it repeats without a click. The pitch now follows the true
  rpm against the rpm the loop was built at.
- To do the cross-fade and the drone, a Paula channel can now carry two
  looped layers (engine power and overrun; wind and drone). There are still
  four channels, and one-shots still take a channel over as before.

## The docking computer (jump home)

In Assist and Arcade, once the controller has given a homing, a JUMP HOME
button (key N) appears:

- It puts you on a 3 km final approach to the homing field, lined up on
  the landing direction into the wind, wheels and flaps down, at approach
  speed.
- The approach autopilot (the same one the AI wingmen use) then flies the
  glide path, flares, three-points it, brakes and switches off. The sortie
  ends as a normal landing at that field, with no reprimand.
- Moving the stick (more than about a third of its travel) hands control
  back at any point. AUTOLAND flashes in the view while it's flying.
- It refuses without a homing, on the ground, or with any enemy aircraft
  within 9 km. You have to get clear of the fight first.
- It's an instant jump. No fuel or time is charged for the trip home, and
  the raid carries on without you.
- It works the same for the 109 on the other side, to Marquise or
  Calais-Marck.
- The jump is a recorded command and the autopilot runs inside the
  simulation, so a replay shows the same jump and the same landing.

Also: the debrief no longer says "Airborne 0 seconds after the scramble"
for sorties that start in the air (Quick Combat and Arcade).

## The off-screen arrow (playtest fix)

"Following the red arrow I can never find the plane; it flicks from one
side of the screen to the other without being visible." Three bugs:

- **It pointed the wrong way for anything behind.** The arrow flipped a
  target's camera-space direction when it was behind the camera. That's
  right for a projected point, but wrong for a raw direction (camera x is
  right whether the target is ahead or behind). A bandit behind-left got
  an arrow pointing right. Following it turned you away, and the arrow
  swapped sides as the bandit passed astern. Behind, it now points to the
  side the target is on, leaning sideways ("turn this way").
- **No arrow just off the edge of the view.** Whether something needed an
  arrow was decided by "in front of the camera", not "on screen". So a
  bandit 50 degrees off the nose had neither an arrow nor a visible
  bracket: it seemed to flick past. The arrow now shows whenever the
  target isn't actually in view.
- **Labels pinned to the edge.** Type labels for aircraft off screen were
  clamped to the edge of the view, which looked like a target that wasn't
  there. Brackets and labels are now drawn only for aircraft in view.

The arrow also stays on one group instead of hopping between two at
similar range, and its label gives the clock position as a pilot would
call it: "1 FIGHTER 0.9 MI 8 O'CLOCK HIGH".

## Music level

The music now plays about 3 dB quieter (channel level 0.7 instead of 1.0),
so it sits under the sound effects rather than competing with them. The
effects, and the bell and phone that cut through the menu music, are
unchanged.

## Arcade take-off, hit feedback, bigger targets (playtest)

- **Arcade keeps the take-off.** Arcade is now two modes: **Arcade** (the
  default) and **Arcade, air start**, the old behaviour. MODE in Settings
  cycles Arcade, Arcade air start, Assist, Authentic. In Arcade, the
  scramble is as it was: readiness, START, the take-off run. The raid is
  already on its way, and the enemy is a grade softer. Once you're more
  than 100 m up, **JUMP TO RAID** (key R) puts the whole squadron, in
  formation, ahead of the raid wherever it now is. It's the same picture
  as the air start: about 7 km off, to one side, 800 m above, turned in.
  It works once a sortie, and not with the enemy already in sight.
- **Hit feedback.** Your rounds striking home now:
  - make a bright metallic tick, rate-limited so the eight Brownings don't
    turn it into a buzz;
  - put a flashing X of ticks on the aircraft being hit, in any view.
  When one you shot goes down, a big banner names it ("HE 111
  DESTROYED!") with a tally for the sortie, and the phone pulses. An enemy
  you've hit catching fire says so.
- **Bigger targets.** Big targets now scales enemies up to 3 times their
  size, from 2. They're true size inside 40 m and grow to full scale by
  350 m. The player's rounds still hit them as drawn.

## Updates show up straight away

The offline cache served its saved copy of the game first and refreshed it
in the background, so the first visit after a deploy showed the old
version. Its name was also bumped by hand (`scramble-v2`), and had been
forgotten for several builds. Now:

- **The page is network-first.** Online, you always get the newest build.
  The cached copy is only the fallback when offline. The manifest and icon
  stay cache-first.
- **The cache name stamps itself.** The build fingerprints the game (a
  hash of `dist/index.html`) into the service worker's cache name, so each
  build starts a fresh cache and the old one is deleted. `check-size`
  fails the build if the stamp is missing.

## The fight around you: squadron, escort and bomber crews

Playtest: "Am I alone? I don't see others in my flight. The escort ignores
me when I attack the bombers, and the bombers plough on regardless." All
three were true in the code.

- **The squadron goes in with you.** The wingmen were there all along,
  flying behind you in formation, but they hold fire until tally-ho. When
  you lead (Scramble, and in the campaign from Flight Lieutenant), nobody
  called it unless you pressed T. They now go in by themselves when it's
  obvious:
  - you open fire with the enemy within 9 km;
  - an enemy comes within 2.5 km;
  - one of the formation is hit.
  Flying as a wingman, the leader calls it. In a 4-minute headless probe
  of four arcade raids, the squadron engaged in 1 of 4 before and 4 of 4
  now. In one run before, it lost 5 aircraft while still holding fire.
- **The squadron talks.** Section callsigns (Red, Yellow, Blue, Green;
  you're the Leader) on the R/T:
  - a wingman calls "Bandits! eleven o'clock, below!" when he sees them
    first;
  - "Gannet Leader, break left!" when something is on your tail;
  - their kills, being hit and baling out.
  The R/T panel now queues messages so each stays up long enough to
  read. Before, a burst of calls replaced one another a tick apart. Urgent
  messages still drop time compression the moment they're sent.
- **The escort answers the bombers.** A bomber being hit calls it in. The
  close escort and top cover learn who is shooting after a reaction delay
  (experte 2 s, average 3.5 s, green 6 s) if they're within 5 km, and
  go for that fighter first. Before, an escort only reacted to fighters it
  happened to spot itself, so an attack from below and behind went
  unanswered.
- **Bomber crews have nerve.** Each crew starts with nerve by skill (green
  0.75, average 1, experte 1.3). It is worn down by:
  - bursts of fire (0.1, at most once every 2 s);
  - a fighter coming head-on, guns going or passing within 200 m (0.3,
    once per pass however many come through);
  - a bomber within 800 m going down (0.25).
  On the bomb run the losses are halved: the crews are committed. Left
  alone for 15 s it slowly comes back. At zero the crew jettisons and
  dives away for France in a sound aircraft, which counts towards turning
  the raid back. Green crews break first. The Hurricane's head-on attack
  now does what it did in 1940.
- **The raid's plot is the bombers still in formation**, not the centroid
  of every bomber. Otherwise a few heading home dragged the plot away from
  the target and the raid never started its bomb run.

Two older bugs turned up while testing this:

- **A belly slide went on for kilometres.** Sliding friction was 0.55 ×
  the surface's *rolling* friction (about 0.04 on grass): about 2.9 km
  from 47 m/s. The landing model's roll-out estimate assumed 0.5. Sliding
  now uses 0.45 plus the surface's rolling friction, so it stops in a few
  hundred metres.
- **A dead-stick landing could leave the sortie running.** Coming to rest
  only counted with the throttle closed or the engine switched off. A
  dead engine with the throttle left open never ended the landing. Any
  engine that isn't running now counts. Also, on the 109 side, being back
  over France only ended the sortie safely if you had crossed the English
  coast. A raid broken up over the Channel now counts too.

## Enemy difficulty

Playtest: "an option to set enemy difficulty? From flight school level to
normal to Spanish Civil War vet."

A setting, **ENEMY**, with three levels. Every enemy pilot already has a
grade (green, average, experte), and everything they do comes from it:
spotting, aim, fire range, energy discipline, G, reaction time, an escort's
response to the bombers' call, a bomber crew's nerve and its gunners' aim.
So the setting moves the grade and scales on top:

| Level | Grade | Aim | Aim wander | Eyes | Thinking | G |
|---|---|---|---|---|---|---|
| Flight school | one greener | ×0.7 | ×3.5 | ×0.8 | ×1.4 slower | −0.5 |
| Normal | as in 1940 | — | — | — | — | — |
| Spain veterans | one sharper | ×1.12 (max 0.95) | ×0.6 | ×1.15 | ×0.8 | +0.3 |

- It applies to whoever is the player's enemy: the Luftwaffe normally, the
  RAF when you fly the 109.
- It's applied to each enemy pilot once, on their first step. Raids spawn
  mid-sortie, so this catches everyone, however they were made.
- It's kept with the world, so a replay matches.
- Arcade's own grade softer still applies on top. Arcade on Normal plays as
  before; Arcade on Flight School is all greens, sloppier still.
- **Aim wander is a new knob**, used only by this setting. A grade's aim
  alone barely mattered: a few metres of wander against a 10 m wingspan.
  In a probe, a green 109 hosing from 520 m killed a Spitfire flying
  straight as fast as an average one did. With ×3.5 wander, Flight School
  leaves a Spitfire flying straight alive in 5 of 12 runs (Normal: 0), and
  fires 3.5 times the ammunition doing it.
- Veterans hold fire until 240 m. Against a target flying straight they
  are a few seconds slower to make the kill than Normal. Against a pilot
  who manoeuvres, they spot sooner, don't overshoot, and bunt away.
- Settings only, not the pause menu. Changing it mid-sortie would leave
  pilots already rated at the old level.

## A living sky

Playtest: "There's only one group of enemies and allies in the sky... it
should be more organic: other allies coming in (maybe even 12 Group's big
wing), and multiple raids at the same time, at least on occasion... if you
stumbled across one while vectored elsewhere you should see it, or better,
be jumped out of the blue by roving enemy. It was chaotic in those skies
AND intensely calm."

- **Several raids.** A sortie now gets one to three raids, weighted by phase:
  - July: mostly one.
  - September: two or three more often than not.
  - 15 September: always at least three.

  Each goes for a different target. Each later one starts 2½ to 7 minutes
  after the one before, so they can be miles apart. Quick Combat still
  gives exactly what you chose.
- **Free hunts.** In 25–50% of sorties, depending on phase, a *Freie Jagd*
  of four to eight 109s roves over Kent or the estuary. They fly at
  6,500–8,000 m, mostly experten, with no bombers to guard. They attack
  whatever they see.
- **Other squadrons.** Each raid carrying bombs draws none, one or two
  squadrons from other sectors, mostly one. They have their own callsigns,
  bases, Spitfires or Hurricanes, and scramble times.
  - **Out of sight**, a squadron is a plot. It climbs at 11 m/s, flies an
    intercept, and fights the raid in 20-second rounds. Each round there's
    a 35% chance a bomber goes down, 6% that the raid is broken up and
    turns back, and 8% that the squadron loses one. Below 40% of its
    bombers, a raid always turns back. After 12 rounds the squadron is out
    of ammunition and goes home.
  - **In sight**, the plot becomes real aircraft that fly and fight like
    everyone else. That's within 15 km of you, or within 8 km of a raid
    that's already real. Each real aircraft has its own home base.
  - **Back home**, once more than 30 km from you, they're put down at their
    airfield.
- **12 Group's big wing.** In the London phase, half the time, three
  squadrons come down from Duxford. They circle for six minutes to form
  up, come in 1,500 m above the raid, and go for the biggest one. The
  controller tells you when they set off.
- **What you hear.**
  - The controller tells you when another squadron is after your raid, and
    when it engages ("Kestrel squadron is engaging your raid near
    Canterbury").
  - Other squadrons' tally-hos come through in grey.
  - Out of sight, a tally-ho comes through broken up.
- **The controller keeps you on one raid.** Before, the target was simply
  the nearest raid each moment, so with several up the box would hop
  between them. Now the controller keeps the raid it gave you while it's
  still coming. It prefers raids carrying bombs over fighter sweeps, and
  a new raid gets a fresh vector in full. `assign()` is ready for the R/T
  menu's "new target".
- **Markers: what you were sent after, and what you could really see.**
  - Only the raid you're vectored on gets the yellow radar box. It is
    marked out to the usual range once it's in sight.
  - Any other formation is marked only within 9 km, with clear air between
    you, and not when it's within 14° of the sun. A free hunt diving out
    of the sun stays unmarked until it's on you; your wingmen's break call
    is the warning.
  - With no controller (flying the 109) nothing changes.
- **The action report** has a line for each raid. It names the squadrons
  that also engaged a raid and how many of its bombers were lost. Free
  hunts get "109s were hunting over...", and the heading becomes "THE
  RAIDS" when there's more than one.
- **A raid keeps its own copy of the plan.** Losses out of sight come off
  that copy, so a replay of the sortie starts from the original raid.

**Performance.** The worst case found was 133 aircraft at once: two London
raids, the big wing, our squadron and a free hunt. That doubled the
simulation's cost, so two hot paths were made cheaper without changing
behaviour:
- **Bullets** first reject any aircraft more than 180 m away on either
  horizontal axis. No hit radius, even with big targets, comes near that,
  so long shots still land.
- **Ground type** (what the ground is made of) is only looked up within
  30 m of it. Ground height is still checked every tick.

In that worst case, a tick fell from 3.1 ms to 1.55 ms mean on the
development machine.
