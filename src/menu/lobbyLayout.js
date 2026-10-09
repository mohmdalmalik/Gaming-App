// The main-menu lobby, as data: where everything stands, who is in it, the paths people walk and
// the camera. src/menu/lobbySet.js builds the room from this; src/menu/lobbyScene.js animates it.
// Units: metres, degrees for headings (0 = facing +Z, toward the camera side; 90 = facing +X).
// Floor y = 0. The back wall is at z = -5.5 (lift, reception, archway, stairs), the right wall at
// x = 9.5 (tall night windows). The camera looks in from the front-left.

export const lobbyLayout = {
  room: {
    x0: -13, x1: 9.5,          // floor extent
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
    slots: [[3.2, -6.95], [2.82, -6.9], [3.6, -6.9], [3.25, -6.4]],
    managerSlot: [2.85, -6.3],
    front: [3.2, -4.75],         // just outside the doors
    doorSide: [2.15, -4.95],     // where the manager waits, ushering the guests in
    floors: 6,                   // dial: L, 1 … 6
    destination: 4,              // the Fourth Floor Landing (the game's starting room)
  },
  archway: { x: -5.0, width: 1.7, height: 3.1 },

  reception: {
    x0: -3.0, x1: 0.8, front: -3.35, depth: 0.62, height: 1.08,
    keys: { x0: -2.6, x1: 0.4, y0: 1.3, y1: 2.85 },
    clock: { x: -1.1, y: 3.75, r: 0.48 },
  },

  stairs: { x: -6.9, steps: 15, tread: 0.32, rise: 0.175, z0: -5.5, z1: -3.6 },

  pilasters: [-8.4, -6.15, -3.75, 1.75, 4.65, 9.2],
  sconces: [[-6.15, 2.3], [-3.75, 2.3], [1.75, 2.3], [4.65, 2.3]],          // on the back-wall pilasters (x, y)
  windows: [{ z: -2.6 }, { z: 1.7 }, { z: 6.0 }],                           // on the right wall
  painting: { x: 7.05, y: 2.15, w: 1.9, h: 1.3 },

  // Furniture. Seats: `seat` = the cushion top; seated people are placed by their pelvis point.
  sofas: [
    { id: 'sofa', x: 5.15, z: -1.55, heading: -32, seats: 2, kind: 'sofa' },
    { id: 'armchairR', x: 3.05, z: -0.35, heading: 58, seats: 1, kind: 'armchair' },
    { id: 'armchairL', x: -4.1, z: -1.15, heading: 38, seats: 1, kind: 'armchair', color: '#2c4a3c' },
    { id: 'armchairL2', x: -2.55, z: 0.15, heading: -62, seats: 1, kind: 'armchair', color: '#2c4a3c' },
  ],
  seatHeight: 0.3,
  tables: [
    { x: 4.35, z: -0.25, r: 0.42, h: 0.34, tea: true },
    { x: -3.35, z: -0.75, r: 0.32, h: 0.4 },
  ],
  rugs: [
    { x: 4.45, z: -0.85, w: 4.4, d: 3.3, heading: -32 },
    { x: -3.3, z: -0.6, w: 3.2, d: 2.6, heading: 20 },
    { x: -1.1, z: -2.45, w: 3.6, d: 1.3, heading: 0 },
  ],
  floorLamps: [{ x: 6.55, z: -2.45 }, { x: -4.95, z: -2.0 }],
  palms: [{ x: 8.3, z: -4.55, s: 1.2 }, { x: -6.25, z: -4.7, s: 1.0 }, { x: 1.75, z: -4.85, s: 0.75 }, { x: 8.6, z: 4.2, s: 1.1 }],
  columns: [{ x: -3.9, z: 3.4 }, { x: 7.4, z: 3.0 }],
  chandeliers: [{ x: -0.9, z: -1.2, y: 4.05 }, { x: 4.6, z: -0.6, y: 4.15 }, { x: 1.8, z: 4.6, y: 4.4 }],
  trolley: { x: 1.15, z: -4.3, heading: 15 },

  // Real lights (fixed count: changing how many there are would rebuild shaders mid-menu).
  lights: [
    { id: 'chandA', pos: [-0.9, 3.7, -1.2], color: '#ffc98a', intensity: 15, distance: 16, decay: 1.6 },
    { id: 'chandB', pos: [4.6, 3.8, -0.6], color: '#ffc98a', intensity: 15, distance: 16, decay: 1.6 },
    { id: 'desk', pos: [0.35, 1.5, -3.7], color: '#ffb766', intensity: 3.2, distance: 6, decay: 1.6 },
    { id: 'lampR', pos: [6.55, 1.45, -2.45], color: '#ffb766', intensity: 5, distance: 7, decay: 1.6 },
    { id: 'lampL', pos: [-4.95, 1.45, -2.0], color: '#ffb766', intensity: 4, distance: 7, decay: 1.6 },
    { id: 'lift', pos: [3.2, 2.0, -5.9], color: '#ffd9a0', intensity: 0, distance: 8, decay: 1.4, open: 9 },
  ],
  hemisphere: { sky: '#ffdcb0', ground: '#2a1a12', intensity: 0.42 },

  // The people. `model` = a guest GLB in assets/characters; `dress` re-colours parts by material
  // name. `seat` = [sofa id, seat index]; `at` = standing spot [x, z, heading].
  cast: [
    // the guests who board the lift on Play (first `guests` of them, in this order)
    { name: 'victor', model: 'victor', seat: ['sofa', 0], boards: 1, splay: 0.14 },
    { name: 'clara', model: 'clara', seat: ['sofa', 1], boards: 2, splay: 0.02, recline: 0.08 },
    { name: 'henry', model: 'henry', seat: ['armchairR', 0], boards: 3, splay: 0.12 },
    // seated in the left lounge
    { name: 'marcus', model: 'marcus', seat: ['armchairL', 0], splay: 0.16, recline: 0.16 },
    // at the desk, talking with the concierge
    { name: 'eleanor', model: 'eleanor', at: [-0.15, -2.78, 196], talk: 0.6, talkHand: 'L' },
    // strolling
    { name: 'beatrice', model: 'beatrice', stroll: 'beatrice', speed: 0.85 },
    // staff, in the house uniform: deep burgundy, black and brass
    { name: 'manager', model: 'victor', staff: true, speed: 0.95,
      dress: { Hair: '#bdb8b0', Stache: '#cfcac2', Brow: '#8d8780', Jacket: '#43101a', Lapel: '#0f0b0c', Trouser: '#151215', Tie: '#0f0b0c', Button: '#d6aa55', Shade: '#2a0a10' } },
    { name: 'concierge', model: 'marcus', staff: true, at: [-1.05, -4.55, 0],
      dress: { Jacket: '#4d121c', Trouser: '#161216', Tie: '#c9a052', Button: '#d6aa55', Shade: '#2e0a12', Hair: '#2a2420' } },
    // two background guests by the stairs (re-dressed so they do not read as copies)
    { name: 'extraM', model: 'henry', at: [-6.05, -2.35, 118], talk: 0.5, talkHand: 'R',
      dress: { Hair: '#2c2119', Jacket: '#3a3a3f', Trouser: '#2a2a2e', Tie: '#6a5a2a', Shade: '#26262a' } },
    { name: 'extraF', model: 'clara', at: [-5.2, -2.7, -70],
      dress: { Hair: '#c8a46a', Dress: '#9c7d4c', Sash: '#5a4426', Gold: '#e0c070' } },
  ],

  // Idle walks (looping): [x, z, pause seconds, heading to face while paused (deg) or null, glance (deg)]
  strolls: {
    manager: [
      [1.95, -3.05, 3.0, 160, -40],
      [5.9, -3.35, 0.0, null, 0],
      [8.15, -2.65, 4.0, 90, 0],      // at the window, looking out into the night
      [6.2, -3.6, 0.0, null, 0],
      [3.2, -4.2, 2.0, 200, 35],      // glancing over the lounge
    ],
    beatrice: [
      [-2.6, 2.1, 0.0, null, 0],
      [0.3, 0.9, 0.0, null, 0],
      [0.9, -1.35, 3.2, 200, -25],    // looking up at the clock over reception
      [-0.6, 0.3, 0.0, null, 0],
      [-1.6, 2.9, 2.0, 80, 30],
    ],
  },

  // Boarding: each guest walks from where they stood up to the lift, around the furniture.
  boardingPaths: {
    victor: [[4.35, -2.55], [3.45, -3.6]],
    clara: [[5.45, -2.75], [4.0, -3.75]],
    henry: [[3.0, -1.55], [2.95, -3.5]],
  },

  camera: {
    fov: 36,                    // vertical, at 16:9; narrower screens widen it to keep the sides
    minHFov: 54,                // horizontal field of view never below this (4:3 iPads)
    pos: [-2.25, 1.55, 6.9],
    target: [2.35, 1.35, -3.2],
    drift: { x: 0.35, y: 0.06, z: 0.2, period: 46 },
    // the push toward the lift during the boarding sequence
    enterPos: [1.55, 1.6, 1.4],
    enterTarget: [3.2, 1.45, -5.6],
    enterFov: 33,
  },
};
