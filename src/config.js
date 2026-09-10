// Tuning values for the greybox prototype. Everything that is likely to be
// tweaked by feel lives here so it can be changed in one place.
// Units are metres, seconds, radians unless noted.

export const config = {
  camera: {
    fov: 42,              // vertical field of view in degrees
    pitchDeg: 56,         // angle above the horizon (90 = straight down)
    distance: 13,         // default distance from the focus point (zoom)
    minDistance: 7,       // zoom-in limit
    maxDistance: 22,      // zoom-out limit
    rotateDuration: 0.4,  // seconds for a 90° snap rotation
    followLerp: 4,        // how quickly the focus point catches up with the player (per second)
    panReturnDelay: 1.2,  // seconds after a pan gesture before the camera drifts back
    panReturnLerp: 2.5,   // how quickly the pan offset eases back to the player (per second)
    maxPanDistance: 10,   // how far the camera can be dragged away from the player
    near: 0.5,
    far: 120,
  },

  cutaway: {
    threshold: 0.3,       // how directly a wall must face the camera before it is lowered (0..1)
    stubHeight: 0.35,     // height of a lowered wall
    lerpSpeed: 8,         // how quickly walls lower/raise (per second)
  },

  player: {
    speed: 2.2,           // walking speed
    turnSpeed: 9,         // how quickly the player turns to face the walking direction (per second)
    clearance: 0.3,       // minimum distance the player's centre keeps from walls and furniture
    radius: 0.3,          // visual capsule radius
    height: 1.65,         // visual capsule height (total)
    bobAmplitude: 0.035,  // vertical bob while walking
    bobFrequency: 7,      // bob cycles per second at full speed
    arriveDistance: 0.06, // how close counts as "reached the waypoint"
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
    hemisphere: { sky: '#ffffff', ground: '#3a3438', baseIntensity: 0.6 },
    ambientLerp: 1.5,     // how quickly the global light level follows the current room's mood (per second)
    revealDuration: 0.6,  // seconds for a newly discovered room to "rise" into view
    frontierPulseSpeed: 2.2,
  },

  palette: {
    floor: '#6a6a72',
    wall: '#a2a2a8',
    furniture: '#7c7e88',
    player: '#e9c98f',
    playerMarker: '#3a2a1a',
    doorStrip: '#57575f',
    frontier: '#ffcc66',
    exit: '#8ff5b0',
  },

  exit: {
    overlayDelay: 0.7,    // seconds after entering the exit room before the overlay appears
  },

  ui: {
    toastDuration: 2.2,
  },
};
