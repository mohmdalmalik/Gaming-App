// Test floor for the greybox prototype: 14 rooms around a central landing.
//
// Coordinates: x runs east (right), z runs south (down on the map), y is up.
// A room is placed by its centre and size (width along x, depth along z).
// Furniture positions are relative to the room's centre; sizes are [width, height, depth].
//
// Doorways are declared ONCE, on either of the two rooms they connect:
//   { wall: 'north' | 'south' | 'east' | 'west', at: offsetAlongWall, width, to: otherRoomId }
// `at` is measured from the middle of that wall (positive = east for north/south walls,
// positive = south for east/west walls). The loader creates the matching opening on the
// other room automatically and complains if the two rooms don't actually share that wall.
//
// Mood: light colour, intensity (relative, tuned via config.render.pointLightScale),
// ambient (0..1, overall brightness while a player is in the room) and an optional
// flicker — a light only flickers where `flicker` is set. `lights` optionally places
// several lights (relative positions) instead of one.
//
// Layout (north is up):
//
//              lounge ── library
//                |          |
//            corridorN   backCorridor
//                |          |
//   suite ─ corridorW ─ HALL ─ corridorE ─ serviceCorridor ─ stairs ─ EXIT
//                        |        kitchen ──┘      |
//                      dining                   storage

export const floor1 = {
  id: 'floor1',
  name: 'Fourth Floor',

  rules: {
    actionPointsPerTurn: 5,  // points each player gets at the start of their turn
    moveWithinRoomCost: 0,   // walking inside the room you are in
    enterRoomCost: 1,        // passing through a doorway, also back into a known room
  },

  // Where the five players stand at the start (relative to the start room's centre).
  start: { room: 'hall', positions: [[0, 0], [-1.6, -1.2], [1.6, -1.2], [-1.6, 1.4], [1.6, 1.4]] },

  rooms: [
    {
      id: 'hall',
      name: 'Fourth Floor Landing',
      center: [0, 0],
      size: [8, 8],
      mood: { color: '#ffd9a8', intensity: 1.5, ambient: 1.0 },
      doorways: [
        { wall: 'west', at: 0, width: 1.2, to: 'corridorW' },
        { wall: 'north', at: 0, width: 1.2, to: 'corridorN' },
        { wall: 'east', at: 0, width: 1.2, to: 'corridorE' },
        { wall: 'south', at: 0, width: 1.2, to: 'dining' },
      ],
      furniture: [
        { kind: 'liftDoors', pos: [-2.5, -3.7], size: [1.8, 2.6, 0.3] },
        { kind: 'consoleTable', pos: [3.5, -1.8], size: [0.4, 0.8, 1.2] },
        { kind: 'plant', pos: [3.2, -3.2], size: [0.4, 1.1, 0.4] },
        { kind: 'plant', pos: [-3.2, 3.2], size: [0.4, 1.1, 0.4] },
        { kind: 'bench', pos: [2.6, 3.4], size: [1.6, 0.5, 0.5] },
      ],
    },

    // West route: a corridor to a guest suite (dead end).
    {
      id: 'corridorW',
      name: 'West Corridor',
      center: [-8, 0],
      size: [8, 2.4],
      mood: { color: '#ffd0a0', intensity: 0.9, ambient: 0.8 },
      doorways: [{ wall: 'west', at: 0, width: 1.2, to: 'suite412' }],
      furniture: [
        { kind: 'consoleTable', pos: [2.0, -0.9], size: [1.0, 0.8, 0.35] },
        { kind: 'plant', pos: [-2.5, -0.9], size: [0.4, 1.0, 0.4] },
      ],
    },
    {
      id: 'suite412',
      name: 'Guest Suite 412',
      searchable: true,
      center: [-15, 0],
      size: [6, 5],
      mood: { color: '#ffd2a0', intensity: 1.2, ambient: 0.9 },
      doorways: [],
      furniture: [
        { kind: 'bed', pos: [-1.7, -0.9], size: [2.0, 0.6, 1.8] },
        { kind: 'wardrobe', pos: [2.4, -1.6], size: [0.6, 2.2, 1.4] },
        { kind: 'desk', pos: [1.4, 2.0], size: [1.4, 0.75, 0.6] },
        { kind: 'armchair', pos: [-2.2, 1.6], size: [0.8, 0.9, 0.8] },
      ],
    },

    // North route: lounge and library, with a back way round to the kitchen.
    {
      id: 'corridorN',
      name: 'North Corridor',
      center: [0, -8],
      size: [2.4, 8],
      mood: { color: '#ffd8b0', intensity: 0.9, ambient: 0.75 },
      doorways: [{ wall: 'north', at: 0, width: 1.2, to: 'lounge' }],
      furniture: [
        { kind: 'plant', pos: [0.85, -2.5], size: [0.3, 0.9, 0.3] },
        { kind: 'chair', pos: [-0.8, 2.0], size: [0.5, 0.9, 0.5] },
      ],
    },
    {
      id: 'lounge',
      name: 'Lounge',
      searchable: true,
      center: [0, -15.5],
      size: [8, 7],
      mood: { color: '#ffe2b4', intensity: 1.3, ambient: 1.0, lights: [[-2, -1.5], [2, 1.5]] },
      doorways: [{ wall: 'east', at: 0, width: 1.2, to: 'library' }],
      furniture: [
        { kind: 'sofa', pos: [-1.2, 1.2], size: [2.2, 0.8, 0.9] },
        { kind: 'sofa', pos: [-1.2, -1.4], size: [2.2, 0.8, 0.9] },
        { kind: 'coffeeTable', pos: [-1.2, -0.1], size: [1.0, 0.45, 0.6] },
        { kind: 'bar', pos: [2.6, -2.7], size: [2.4, 1.1, 0.6] },
        { kind: 'piano', pos: [2.6, 2.2], size: [1.6, 1.0, 1.4] },
      ],
    },
    {
      id: 'library',
      name: 'Library',
      searchable: true,
      center: [7, -15.5],
      size: [6, 5],
      mood: { color: '#e8d8b8', intensity: 0.7, ambient: 0.55 },
      doorways: [{ wall: 'south', at: 0, width: 1.2, to: 'backCorridor' }],
      furniture: [
        { kind: 'shelves', pos: [0, -2.15], size: [4.0, 2.2, 0.4] },
        { kind: 'desk', pos: [1.5, 0.8], size: [1.4, 0.75, 0.7] },
        { kind: 'armchair', pos: [-1.8, 1.2], size: [0.8, 0.9, 0.8] },
      ],
    },
    {
      id: 'backCorridor',
      name: 'Back Stairs Passage',
      center: [7, -10.5],
      size: [2.4, 5],
      dark: true,
      mood: { color: '#c8ccd8', intensity: 0.5, ambient: 0.35, flicker: { min: 0.2, max: 1.0, speed: 12 } },
      doorways: [{ wall: 'south', at: 0, width: 1.2, to: 'kitchen' }],
      furniture: [
        { kind: 'crates', pos: [0.75, -1.5], size: [0.5, 0.6, 0.5] },
        { kind: 'bucket', pos: [-0.8, 1.2], size: [0.3, 0.4, 0.3] },
      ],
    },
    {
      id: 'kitchen',
      name: 'Kitchen',
      searchable: true,
      center: [8, -5.5],
      size: [6, 5],
      mood: { color: '#c0ccd8', intensity: 0.6, ambient: 0.4 },
      doorways: [{ wall: 'east', at: 0, width: 1.2, to: 'serviceCorridor' }],
      furniture: [
        { kind: 'counter', pos: [0, 2.1], size: [4.0, 0.9, 0.6] },
        { kind: 'island', pos: [0.5, -0.2], size: [1.6, 0.9, 0.9] },
        { kind: 'fridge', pos: [2.5, -1.8], size: [0.8, 2.0, 0.8] },
      ],
    },

    // East route: the service side of the hotel and the way out.
    {
      id: 'corridorE',
      name: 'East Corridor',
      center: [7.5, 0],
      size: [7, 2.4],
      mood: { color: '#f0dcc0', intensity: 0.8, ambient: 0.65 },
      doorways: [{ wall: 'east', at: 0, width: 1.2, to: 'serviceCorridor' }],
      furniture: [
        { kind: 'trolley', pos: [-1.5, -0.85], size: [0.9, 1.0, 0.5] },
        { kind: 'plant', pos: [2.0, -0.9], size: [0.4, 1.0, 0.4] },
      ],
    },
    {
      id: 'serviceCorridor',
      name: 'Service Corridor',
      center: [13, -2.5],
      size: [4, 11],
      dark: true,
      mood: { color: '#c4c8d4', intensity: 0.6, ambient: 0.4, lights: [[0, -3], [0, 2]], flicker: { min: 0.35, max: 1.0, speed: 9 } },
      doorways: [
        { wall: 'south', at: 0, width: 1.2, to: 'storage' },
        { wall: 'east', at: 2.5, width: 1.2, to: 'stairs' },
      ],
      furniture: [
        { kind: 'laundryCart', pos: [1.2, -4.2], size: [0.7, 1.0, 1.1] },
        { kind: 'crates', pos: [-1.3, 4.0], size: [0.8, 0.8, 0.8] },
      ],
    },
    {
      id: 'storage',
      name: 'Storage Room',
      searchable: true,
      center: [13, 5],
      size: [5, 4],
      dark: true,
      mood: { color: '#a9b9d2', intensity: 0.45, ambient: 0.3 },
      doorways: [],
      furniture: [
        { kind: 'shelves', pos: [-2.0, 0], size: [0.5, 2.2, 3.0] },
        { kind: 'box', pos: [1.3, -0.6], size: [1.0, 1.0, 1.0] },
        { kind: 'box', pos: [1.6, 1.2], size: [0.9, 0.7, 0.9] },
      ],
    },
    {
      id: 'stairs',
      name: 'Service Stairs',
      center: [17, 0],
      size: [4, 4],
      mood: { color: '#a7b6d6', intensity: 0.55, ambient: 0.38 },
      doorways: [{ wall: 'east', at: 0, width: 1.2, to: 'exit' }],
      furniture: [
        { kind: 'stairStep', pos: [0, -1.0], size: [2.0, 0.25, 0.5] },
        { kind: 'stairStep', pos: [0, -1.5], size: [2.0, 0.5, 0.5] },
        { kind: 'bench', pos: [0, 1.5], size: [1.6, 0.5, 0.5] },
      ],
    },
    {
      id: 'exit',
      name: 'Fire Exit',
      isExit: true,
      center: [21, 0],
      size: [4, 4],
      mood: { color: '#d7ebff', intensity: 1.2, ambient: 0.7 },
      doorways: [],
      furniture: [
        { kind: 'exitDoor', pos: [1.7, 0], size: [0.3, 2.4, 1.6], color: '#8ff5b0', emissive: '#2a8f5a' },
      ],
    },

    // South: the dining room (dead end).
    {
      id: 'dining',
      name: 'Dining Room',
      searchable: true,
      center: [0, 7],
      size: [8, 6],
      mood: { color: '#ffd8a0', intensity: 1.1, ambient: 0.85 },
      doorways: [],
      furniture: [
        { kind: 'table', pos: [0, 0.6], size: [3.6, 0.8, 1.2] },
        { kind: 'chair', pos: [-1.2, -0.4], size: [0.5, 0.9, 0.5] },
        { kind: 'chair', pos: [0, -0.4], size: [0.5, 0.9, 0.5] },
        { kind: 'chair', pos: [1.2, -0.4], size: [0.5, 0.9, 0.5] },
        { kind: 'chair', pos: [-1.2, 1.6], size: [0.5, 0.9, 0.5] },
        { kind: 'chair', pos: [0, 1.6], size: [0.5, 0.9, 0.5] },
        { kind: 'chair', pos: [1.2, 1.6], size: [0.5, 0.9, 0.5] },
        { kind: 'sideboard', pos: [3.4, 0], size: [0.5, 1.0, 2.0] },
      ],
    },
  ],
};

export default floor1;
