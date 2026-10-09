// The main-menu lobby, as data: where everything stands, who is in it, the paths people walk and
// the camera. src/menu/lobbySet.js builds the room from this; src/menu/lobbyScene.js animates it.
// Units: metres, degrees for headings (0 = facing +Z, toward the camera side; 90 = facing +X).
// Floor y = 0. The back wall is at z = -5.5 (lift, reception, archway, stairs), the right wall at
// x = 8.4 (tall night windows). The camera looks in from the front-left. The menu buttons cover the
// left ~40% of the screen, so the stairs and the left lounge sit there (soft background) and the
// reception, the lift and the seated guests who board it are centre-right.

export const lobbyLayout = {
  room: {
    x0: -12, x1: 8.4,          // floor extent
    z0: -5.5, z1: 12,
    height: 5.6,               // ceiling
    panelTop: 3.2,             // walnut panelling up to here, warm plaster above
    background: '#0c0908',
    fog: { color: '#120c09', near: 11, far: 30 },
  },

  // Openings in the back wall (x range, height): the lift and the dark archway to a corridor.
  lift: {
    x: 3.2, width: 1.3, height: 2.35, depth: 1.55,
    // where people stand inside the car, facing out (heading 0): back row first
    // where the boarding guests stand inside the car (by how many board), facing out
    slots: {
      1: [[3.3, -6.9]],
      2: [[2.9, -6.95], [3.55, -6.95]],
      3: [[2.88, -6.95], [3.55, -6.98], [3.55, -6.38]],
    },
    managerSlot: [2.85, -6.35],
    front: [3.2, -4.75],         // just outside the doors
    doorSide: [2.15, -4.95],     // where the manager waits, ushering the guests in
    floors: 6,                   // dial: L, 1 … 6
    destination: 4,              // the Fourth Floor Landing (the game's starting room)
  },
  archway: { x: -2.95, width: 1.6, height: 3.0 },

  reception: {
    x0: -0.95, x1: 1.55, front: -3.35, depth: 0.62, height: 0.98,
    keys: { x0: -0.75, x1: 1.35, y0: 1.3, y1: 2.75 },
    clock: { x: 0.3, y: 3.65, r: 0.46 },
  },

  stairs: { x: -4.75, steps: 15, tread: 0.32, rise: 0.175, z0: -5.5, z1: -3.6 },

  pilasters: [-9.6, -4.2, -1.65, 2.0, 4.6, 8.15],
  sconces: [[-4.2, 2.3], [-1.65, 2.3], [2.0, 2.3], [4.6, 2.3]],             // on the back-wall pilasters (x, y)
  flickerSconce: 1,                                                          // index: the one that falters
  rightPilasters: [-4.4, -0.85, 3.35, 7.6],
  rightSconces: [-0.85, 3.35],
  windows: [{ z: -2.65 }, { z: 1.25 }, { z: 5.5 }],                         // on the right wall
  painting: { x: 6.4, y: 2.15, w: 1.8, h: 1.25 },

  // Furniture. Seats: `seat` = the cushion top; seated people are placed by their pelvis point.
  sofas: [
    { id: 'sofa', x: 4.85, z: -1.95, heading: -30, seats: 2, kind: 'sofa' },
    { id: 'armchairR', x: 2.8, z: -0.8, heading: 60, seats: 1, kind: 'armchair' },
    { id: 'armchairL', x: -2.75, z: -1.55, heading: 40, seats: 1, kind: 'armchair', color: '#2c4a3c' },
  ],
  seatHeight: 0.25,
  tables: [
    { x: 3.75, z: -0.95, r: 0.36, h: 0.3, tea: true },
    { x: -2.15, z: -1.05, r: 0.3, h: 0.38 },
  ],
  rugs: [
    { x: 4.15, z: -1.3, w: 4.3, d: 3.2, heading: -30 },
    { x: -2.2, z: -0.8, w: 3.0, d: 2.5, heading: 22 },
    { x: 0.3, z: -2.45, w: 3.0, d: 1.25, heading: 0 },
  ],
  runner: { x: 1.75, z: 1.4, w: 1.5, d: 9.0, heading: -20 },
  floorLamps: [{ x: 6.15, z: -2.85 }, { x: -3.55, z: -2.4 }],
  palms: [{ x: 7.55, z: -4.75, s: 1.2 }, { x: -1.15, z: -4.95, s: 0.8 }, { x: 1.62, z: -4.95, s: 0.7 }, { x: 7.6, z: 3.6, s: 1.15 }, { x: -5.4, z: -2.9, s: 0.9 }],
  columns: [{ x: -2.9, z: 3.7 }, { x: 6.5, z: 3.6 }],
  chandeliers: [{ x: 1.55, z: -0.9, y: 4.4 }, { x: 5.3, z: -0.2, y: 4.45 }, { x: -1.6, z: 0.6, y: 4.4 }],
  trolley: { x: 6.35, z: -4.8, heading: 0 },

  // Real lights (fixed count: changing how many there are would rebuild shaders mid-menu).
  lights: [
    { id: 'chandA', pos: [1.55, 4.0, -0.9], color: '#ffc98a', intensity: 15, distance: 16, decay: 1.6 },
    { id: 'chandB', pos: [5.3, 4.05, -0.2], color: '#ffc98a', intensity: 14, distance: 16, decay: 1.6 },
    { id: 'desk', pos: [1.1, 1.5, -3.7], color: '#ffb766', intensity: 3.2, distance: 6, decay: 1.6 },
    { id: 'lampR', pos: [6.15, 1.45, -2.85], color: '#ffb766', intensity: 5, distance: 7, decay: 1.6 },
    { id: 'lampL', pos: [-3.55, 1.45, -2.4], color: '#ffb766', intensity: 4, distance: 7, decay: 1.6 },
    { id: 'lift', pos: [3.2, 2.0, -5.9], color: '#ffd9a0', intensity: 0, distance: 8, decay: 1.4, open: 9 },
  ],
  hemisphere: { sky: '#ffdcb0', ground: '#2a1a12', intensity: 0.34 },

  // The people. `model` = a guest GLB in assets/characters; `dress` re-colours parts by material
  // name. `seat` = [sofa id, seat index]; `at` = standing spot [x, z, heading].
  cast: [
    // the guests who board the lift on Play (first `guests` of them, in this order)
    // (recline: how far the trunk leans back into the cushions; feetForward: shin angle, radians)
    { name: 'victor', model: 'victor', seat: ['sofa', 0], boards: 1, splay: 0.16, recline: 0.24, feetForward: 0.4 },
    { name: 'clara', model: 'clara', seat: ['sofa', 1], boards: 2, splay: 0.02, recline: 0.12, feetForward: 0.22 },
    { name: 'henry', model: 'henry', seat: ['armchairR', 0], boards: 3, splay: 0.14, recline: 0.2, feetForward: 0.35 },
    // seated in the left lounge
    { name: 'marcus', model: 'marcus', seat: ['armchairL', 0], splay: 0.2, recline: 0.28, feetForward: 0.45 },
    // at the desk, talking with the concierge
    { name: 'eleanor', model: 'eleanor', at: [0.95, -2.8, 200], talk: 0.6, talkHand: 'L' },
    // strolling
    { name: 'beatrice', model: 'beatrice', stroll: 'beatrice', speed: 0.85 },
    // staff, in the house uniform: deep burgundy, black and brass
    { name: 'manager', model: 'victor', staff: true, speed: 0.95,
      dress: { Hair: '#bdb8b0', Stache: '#cfcac2', Brow: '#8d8780', Jacket: '#43101a', Lapel: '#0f0b0c', Trouser: '#151215', Tie: '#0f0b0c', Button: '#d6aa55', Shade: '#2a0a10' } },
    { name: 'concierge', model: 'marcus', staff: true, at: [0.35, -4.5, 8], y: 0.1,
      dress: { Jacket: '#4d121c', Trouser: '#161216', Tie: '#c9a052', Button: '#d6aa55', Shade: '#2e0a12', Hair: '#2a2420' } },
    // two background guests by the stairs (re-dressed so they do not read as copies)
    { name: 'extraM', model: 'henry', at: [-4.65, -2.45, 118], talk: 0.5, talkHand: 'R',
      dress: { Hair: '#2c2119', Jacket: '#3a3a3f', Trouser: '#2a2a2e', Tie: '#6a5a2a', Shade: '#26262a' } },
    { name: 'extraF', model: 'clara', at: [-3.85, -2.8, -70],
      dress: { Hair: '#c8a46a', Dress: '#9c7d4c', Sash: '#5a4426', Gold: '#e0c070' } },
  ],

  // Idle walks (looping): [x, z, pause seconds, heading to face while paused (deg) or null, glance (deg)]
  strolls: {
    manager: [
      [2.35, -3.15, 3.0, 150, -40],
      [5.4, -3.55, 0.0, null, 0],
      [7.05, -2.75, 4.0, 90, 0],      // at the window, looking out into the night
      [5.6, -3.85, 0.0, null, 0],
      [3.25, -4.2, 2.0, 200, 35],     // glancing over the lounge
    ],
    beatrice: [
      [-1.9, 2.4, 0.0, null, 0],
      [0.9, 1.7, 0.0, null, 0],
      [1.95, 0.75, 3.5, 125, -20],    // stopping to look over at the guests on the sofa
      [0.5, 2.3, 0.0, null, 0],
      [-1.3, 3.3, 2.5, 200, 25],      // and back toward the reception
    ],
  },

  // Boarding: each guest walks from where they stood up to the lift, around the furniture.
  boardingPaths: {
    victor: [[3.65, -2.25], [3.35, -3.6]],
    clara: [[4.2, -1.45], [3.6, -2.4], [3.5, -3.7]],
    henry: [[2.75, -1.7], [2.95, -3.5]],
  },

  camera: {
    fov: 36,                    // vertical, at 16:9; narrower screens widen it to keep the sides
    minHFov: 54,                // horizontal field of view never below this (4:3 iPads)
    pos: [-1.6, 1.25, 7.9],
    target: [1.5, 1.5, -3.2],
    drift: { x: 0.35, y: 0.06, z: 0.2, period: 46 },
    // the push toward the lift during the boarding sequence
    enterPos: [1.55, 1.6, 1.4],
    enterTarget: [3.2, 1.45, -5.6],
    enterFov: 33,
  },
};
