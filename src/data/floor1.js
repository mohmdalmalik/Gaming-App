// Test floor for the greybox prototype.
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
// ambient (0..1, overall brightness while the player is in the room) and an optional
// flicker. `lights` optionally places several lights (relative positions) instead of one.

export const floor1 = {
  id: 'floor1',
  name: 'Fourth Floor',

  rules: {
    startActionPoints: 10,   // points at the start of the game and after "End turn"
    moveWithinRoomCost: 0,   // walking inside a room you have already discovered
    enterRoomCost: 1,        // passing through a doorway into another room
  },

  start: { room: 'suite', pos: [-0.5, 1.0] },

  rooms: [
    {
      id: 'suite',
      name: 'Guest Suite 412',
      center: [0, 0],
      size: [6, 5],
      mood: { color: '#ffd2a0', intensity: 1.3, ambient: 0.9 },
      doorways: [{ wall: 'east', at: 0, width: 1.2, to: 'corridorA' }],
      furniture: [
        { kind: 'bed', pos: [-1.7, -0.9], size: [2.0, 0.6, 1.8] },
        { kind: 'wardrobe', pos: [2.4, -1.6], size: [0.6, 2.2, 1.4] },
        { kind: 'desk', pos: [1.4, 2.0], size: [1.4, 0.75, 0.6] },
        { kind: 'armchair', pos: [-2.2, 1.6], size: [0.8, 0.9, 0.8] },
      ],
    },
    {
      id: 'corridorA',
      name: 'West Corridor',
      center: [8, 0],
      size: [10, 2.4],
      mood: { color: '#ffcf9a', intensity: 1.0, ambient: 0.75, lights: [[-2.5, 0], [2.5, 0]] },
      doorways: [{ wall: 'east', at: 0, width: 1.2, to: 'lounge' }],
      furniture: [
        { kind: 'consoleTable', pos: [-2.0, -0.9], size: [1.2, 0.8, 0.35] },
        { kind: 'plant', pos: [3.0, -0.9], size: [0.4, 1.0, 0.4] },
      ],
    },
    {
      id: 'lounge',
      name: 'Lounge',
      center: [17, 0],
      size: [8, 8],
      mood: { color: '#ffe2b4', intensity: 1.3, ambient: 1.0, lights: [[-2, -1.5], [2, 1.5]] },
      doorways: [
        { wall: 'north', at: 0, width: 1.2, to: 'servicePassage' },
        { wall: 'south', at: 0, width: 1.2, to: 'corridorB' },
      ],
      furniture: [
        { kind: 'sofa', pos: [-1.2, 1.9], size: [2.2, 0.8, 0.9] },
        { kind: 'sofa', pos: [-1.2, -1.9], size: [2.2, 0.8, 0.9] },
        { kind: 'coffeeTable', pos: [-1.2, 0], size: [1.0, 0.45, 0.6] },
        { kind: 'bar', pos: [2.6, -2.9], size: [2.6, 1.1, 0.6] },
        { kind: 'piano', pos: [2.6, 2.6], size: [1.6, 1.0, 1.4] },
        { kind: 'pillar', pos: [1.0, -1.0], size: [0.5, 2.8, 0.5] },
        { kind: 'pillar', pos: [1.0, 1.0], size: [0.5, 2.8, 0.5] },
      ],
    },
    {
      id: 'servicePassage',
      name: 'Service Passage',
      center: [17, -6.5],
      size: [4, 5],
      mood: { color: '#e9dcc0', intensity: 0.8, ambient: 0.5, flicker: { min: 0.25, max: 1.0, speed: 14 } },
      doorways: [
        { wall: 'west', at: -0.5, width: 1.2, to: 'storage' },
        { wall: 'east', at: -0.5, width: 1.2, to: 'serviceRoom' },
      ],
      furniture: [
        { kind: 'crates', pos: [1.2, 1.6], size: [0.8, 0.8, 0.8] },
        { kind: 'trolley', pos: [-1.2, 1.6], size: [0.9, 1.0, 0.5] },
      ],
    },
    {
      id: 'storage',
      name: 'Storage Room',
      center: [12, -7],
      size: [6, 4],
      mood: { color: '#a9b9d2', intensity: 0.5, ambient: 0.3 },
      doorways: [],
      furniture: [
        { kind: 'shelves', pos: [-2.5, 0], size: [0.5, 2.2, 3.0] },
        { kind: 'box', pos: [0.5, -1.2], size: [1.0, 1.0, 1.0] },
        { kind: 'box', pos: [1.6, 0.8], size: [0.9, 0.7, 0.9] },
      ],
    },
    {
      id: 'serviceRoom',
      name: 'Service Room',
      center: [21.5, -7],
      size: [5, 4],
      mood: { color: '#93a9c9', intensity: 0.45, ambient: 0.28 },
      doorways: [],
      furniture: [
        { kind: 'boiler', pos: [1.5, -1.0], size: [1.2, 2.0, 1.0] },
        { kind: 'workbench', pos: [-0.8, -1.3], size: [1.8, 0.9, 0.7] },
        { kind: 'bucket', pos: [1.5, 1.2], size: [0.4, 0.5, 0.4] },
      ],
    },
    {
      id: 'corridorB',
      name: 'South Corridor',
      center: [17, 9],
      size: [2.4, 10],
      mood: { color: '#c7cfe0', intensity: 0.75, ambient: 0.45 },
      doorways: [{ wall: 'south', at: 0, width: 1.2, to: 'landing' }],
      furniture: [
        { kind: 'laundryCart', pos: [0.6, -2.5], size: [0.7, 1.0, 1.1] },
        { kind: 'chair', pos: [-0.75, 3.0], size: [0.5, 0.9, 0.5] },
      ],
    },
    {
      id: 'landing',
      name: 'Lift Landing',
      center: [17, 16.5],
      size: [8, 5],
      mood: { color: '#a7b6d6', intensity: 0.6, ambient: 0.4 },
      doorways: [{ wall: 'east', at: 0, width: 1.2, to: 'exit' }],
      furniture: [
        { kind: 'liftDoors', pos: [-2.5, -2.2], size: [2.0, 2.6, 0.3] },
        { kind: 'stairStep', pos: [2.0, 0.9], size: [2.0, 0.25, 0.5] },
        { kind: 'stairStep', pos: [2.0, 1.4], size: [2.0, 0.5, 0.5] },
        { kind: 'stairStep', pos: [2.0, 1.9], size: [2.0, 0.75, 0.5] },
        { kind: 'bench', pos: [-2.5, 1.8], size: [1.6, 0.5, 0.5] },
      ],
    },
    {
      id: 'exit',
      name: 'Fire Exit',
      isExit: true,
      center: [23.5, 16.5],
      size: [5, 4],
      mood: { color: '#d7ebff', intensity: 1.2, ambient: 0.7 },
      doorways: [],
      furniture: [
        { kind: 'exitDoor', pos: [2.2, 0], size: [0.3, 2.4, 1.6], color: '#8ff5b0', emissive: '#2a8f5a' },
      ],
    },
  ],
};

export default floor1;
