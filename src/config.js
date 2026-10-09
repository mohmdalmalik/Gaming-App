// Tuning values for the greybox prototype. Everything that is likely to be
// tweaked by feel lives here so it can be changed in one place.
// Units are metres, seconds, radians unless noted.

export const config = {
  // The standard view is corner-on (diagonal), like the owner's room pictures
  // (tools/room-pipeline/ref/*.jpg): the whole room with a margin at the default zoom, its two
  // near walls cut down. `?camera=square` gives the previous square-on view, `?camera=classic`
  // the older, higher square-on one (both below).
  camera: {
    fov: 42,              // vertical field of view in degrees
    yawOffsetDeg: 45,     // a fixed turn of the whole view off the room's axes (0 = square on)
    pitchDeg: 44,         // angle above the horizon (90 = straight down)
    distance: 16,         // default distance from the focus (zoom)
    minDistance: 8,       // zoom-in limit
    maxDistance: 26,      // zoom-out limit for a small hotel; it grows (src/camera.js) so that zoomed
                          // right out, every revealed room is in view at once
    fitMargin: { x: 0.92, top: 0.62, bottom: 0.5 },   // how much of the screen that overview may fill,
                          // in screen units from the middle (-1..1): clear of the guest strip at the
                          // top and of the panel and the hand at the bottom
    lookAhead: 1.2,       // metres the view is aimed past the guest, toward the camera, so the guest's
                          // room sits a little above the middle of the screen (clear of the hand)
    rotateDuration: 0.4,  // seconds for a 90° snap rotation
    followLerp: 4,        // how quickly the focus point catches up with the player (per second)
    panMargin: 1.5,       // how far past the edge of a revealed room the middle of the screen can be
                          // dragged at the standard zoom (m; a little more when zoomed out), so the
                          // hotel never leaves the screen. The view stays where it is left; it comes back
                          // to the guest only on a new turn, a move, a meeting or the "centre on me" button
    returnLerp: 3.5,      // how quickly it eases back to the guest then (per second)
    showMargin: { x: 0.96, top: 0.84, bottom: 0.66 },   // the same for the guest's room + a room just
                          // opened, shown together after a door opens (looser: it may touch the interface)
    tagsFrom: 34,         // zoomed out past this distance, guests carry name tags (src/ui/guestTags.js)
    near: 0.5,
    far: 120,             // (raised automatically when zoomed far out over a big hotel)
  },

  // Earlier views, kept for comparison. ?camera=square: the square-on view used before the corner-on
  // one became standard. ?camera=classic: the older, higher square-on view. (?camera=diagonal is the
  // standard view, kept so old links still work.)
  cameraSquare: { yawOffsetDeg: 0, pitchDeg: 42, distance: 11.5, minDistance: 7, maxDistance: 22, lookAhead: 0 },
  cameraClassic: { yawOffsetDeg: 0, pitchDeg: 56, distance: 13, minDistance: 7, maxDistance: 22, lookAhead: 0 },
  cameraDiagonal: {},

  cutaway: {
    threshold: 0.3,       // how directly a wall must face the camera before it is lowered (0..1)
    stubHeight: 0.35,     // height of a lowered wall
    lerpSpeed: 8,         // how quickly walls lower/raise (per second)
  },

  player: {
    speed: 2.5,           // walking speed (m/s). Guests walk only from room to room now (no wandering
                          // inside a room), so a brisker pace keeps turns quick: 8 m between centres ≈ 3 s
    turnSpeed: 9,         // how quickly a character turns to face the walking direction (per second)
    clearance: 0.3,       // minimum distance a character's centre keeps from walls and furniture
    arriveDistance: 0.06, // how close counts as "reached the waypoint"
  },

  character: {
    strideFrequency: 1.85,    // walk cycles per second (one cycle = two steps) — the placeholder figure
                              // only; the real guests match their stride to the distance walked
    legSwing: 0.55,           // radians
    armSwing: 0.38,           // radians
    bobAmplitude: 0.03,       // vertical bob while walking
    ringRadius: 0.42,         // coloured floor ring under each character
    ringActiveOpacity: 0.95,
    ringInactiveOpacity: 0.35,
    markerHeight: 0.16,       // how far the active marker floats above the head
  },

  grid: {
    cell: 0.25,           // pathfinding cell size
    landingDepth: 1.0,    // how far inside an undiscovered room the player may step through a doorway
    tapSnapRadius: 1.5,   // taps within this distance of walkable floor are snapped to it
  },

  walls: {
    height: 2.8,
    thickness: 0.15,      // each room's walls sit inside its own footprint by this much
  },

  doorways: {
    defaultWidth: 1.2,
  },

  render: {
    maxPixelRatio: 1.5,   // iPads report 2; 1.5 keeps frames smooth (try 2 via __game.setPixelRatio)
    exposure: 1.0,        // overall brightness (tone mapping exposure)
    moodTint: 0.2,        // how much each room's greys lean toward its mood colour (0..1)
    background: '#141318',
    pointLightScale: 22,  // multiplies mood.intensity from the data file into Three.js light units
    lightPool: 8,         // point lights handed to the room lights nearest the camera (fixed count)
    hemisphere: { sky: '#ffffff', ground: '#3a3438', baseIntensity: 0.6 },
    ambientLerp: 1.5,     // how quickly the global light level follows the current room's mood (per second)
    revealDuration: 0.6,  // seconds for a newly discovered room to "rise" into view
  },

  palette: {
    floor: '#6a6a72',
    wall: '#a2a2a8',
    furniture: '#7c7e88',
    player: '#e9c98f',
    playerMarker: '#3a2a1a',
    doorStrip: '#57575f',
    frontier: '#ffcc66',
    usable: '#f4cf6a',   // the dotted path and the outline of a room you are about to walk to
    exit: '#8ff5b0',
  },


  // The fogged, unknown room shown beyond every closed door that can still be opened (src/render/fog.js):
  // a soft, slowly drifting mist the size of a room. Beyond the doors of the active guest's own room it
  // is brighter, with a gently pulsing gold edge and an "Explore · 1 AP" tag; elsewhere it is dimmer.
  fog: {
    size: 7.7,            // metres square (a tile is 8: a touch smaller, so it never covers a wall)
    layers: [             // stacked mist planes, low to high: height, opacity, size (share of `size`)
      { y: 0.03, alpha: 0.9, scale: 1.0 },
      { y: 0.6, alpha: 0.32, scale: 0.9 },
      { y: 1.15, alpha: 0.16, scale: 0.78 },
    ],
    mist: '#8a90a6',      // the wisps
    deep: '#2a2d3a',      // between them
    edge: '#ffcc66',      // the edge of a room you can explore now
    dim: 0.55,            // fog beyond other rooms' doors is this bright
    drift: 0.035,         // how fast the mist drifts
    fade: 0.6,            // seconds for a fog room to clear (its door opened) or to appear
  },

  exit: {
    overlayDelay: 0.7,    // seconds after entering the exit room before the overlay appears
  },

  ui: {
    toastDuration: 2.2,
  },

  attackCost: 1,   // mirror of rules.actionCost.attack for the encounter modal

};
