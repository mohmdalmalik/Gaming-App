// The hotel floor: 18 logical rooms around a central landing, laid out for the six-player
// balance baseline (3 rooms per player — see src/data/rules.js).
//
// Every room carries a ROLE, which is what the rules read:
//   lobby     — the safe starting landing (never searchable)
//   item      — searching it once yields one item card (12 of them)
//   objective — searching it once yields one objective (3 of them)
//   utility   — searchable but holds nothing; searching says so plainly (1)
//   exit      — the way out; hidden and sealed until every objective is found (1)
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
//                      LOUNGE* ── LIBRARY*
//                         |            |
//                     corridorN   backCorridor
//                         |            |
//   suite412 ─ corridorW ─ HALL ─ corridorE ─ serviceCorridor ─ stairs ─ EXIT
//       |         |          |        kitchen ──┘        |          |
//   suite414 ─────┘        dining                     storage   housekeeping†
//                            |  \__ cloakroom ──────────┘
//                         BALLROOM*
//
//   * objective room   † utility room (searchable, empty)   EXIT is sealed until 3/3

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
      role: 'lobby',
      safe: true,             // safe zone: no forced encounters, no attacks; voluntary trades only
      center: [0, 0],
      size: [8, 8],
      // Warm, cosy landing: several soft lamp points (index 0 is the ceiling fill, the rest sit
      // by the lamp models — see dressing.js). Bright ambient so the entry feels welcoming.
      mood: { color: '#ffe0b0', intensity: 1.55, ambient: 1.05, lights: [[0, 0], [3.5, -1.9], [3.4, 3.4], [-3.3, 1.4]] },
      // This room is DRESSED with real glTF furniture (see src/data/dressing.js). Each piece's
      // `size` is its collision footprint AND drives the walkable grid, so the models you see
      // match what you can walk around. `model` names the glTF; `yaw` rotates it (degrees);
      // `props` are decorative items placed on top (no collision). Doorway lanes (the 1.2 m gap
      // in the middle of each wall) and the five start spots are kept clear.
      doorways: [
        { wall: 'west', at: 0, width: 1.2, to: 'corridorW' },
        { wall: 'north', at: 0, width: 1.2, to: 'corridorN' },
        { wall: 'east', at: 0, width: 1.2, to: 'corridorE' },
        { wall: 'south', at: 0, width: 1.2, to: 'dining' },
      ],
      // Furniture is scaled up (`scale`) to read at a believable, cosy size next to the ~1.8 m
      // characters — bookcases stand clearly taller than a person, the sofa is generously sized.
      // Each `size` is the (scaled) collision footprint, so the walkable grid matches the models.
      // Pieces are grouped into composed clusters hugging the walls and corners; the centre and
      // the four doorway lanes are kept clear so movement and pathfinding are unaffected.
      // A hotel landing, kept uncluttered: one seating group, a console and two plants, plus
      // the lift. Furniture FACES INTO the room (yaw follows the wall it sits against: south
      // wall -> 180, west -> 90, east -> -90, north -> 0), the centre and the four doorway lanes
      // stay clear. `scale` enlarges the model; `size` is its collision footprint.
      furniture: [
        // The lift, on the north wall.
        { kind: 'lift', pos: [-2.6, -3.72], size: [1.8, 2.1, 0.36] },
        // South-west — the seating group: a sofa (against the south wall, facing the room) and a
        // lounge chair (against the west wall, facing the coffee table) around a glass table on a rug.
        { kind: 'sofa', model: 'furniture/loungeSofa.glb', yaw: 180, scale: 2.5, pos: [-2.4, 3.35], size: [2.45, 1.15, 1.02] },
        { kind: 'chair', model: 'furniture/loungeChair.glb', yaw: 90, scale: 2.5, pos: [-3.35, 2.0], size: [1.02, 1.15, 1.23] },
        { kind: 'coffeeTable', model: 'furniture/tableCoffeeGlass.glb', yaw: 0, scale: 2.2, pos: [-2.1, 2.35], size: [1.45, 0.51, 0.88] },
        // East wall — a console with a table lamp, facing into the room; plants in two corners.
        { kind: 'console', model: 'furniture/sideTableDrawers.glb', yaw: -90, scale: 2.4, pos: [3.53, 2.0], size: [0.9, 0.92, 1.28],
          props: [{ model: 'furniture/lampSquareTable.glb', scale: 2.2, pos: [0, 0.92, 0] }] },
        { kind: 'plant', model: 'furniture/pottedPlant.glb', scale: 2.5, pos: [3.5, 3.5], size: [0.64, 1.34, 0.73] },
        { kind: 'plant', model: 'furniture/pottedPlant.glb', scale: 2.5, pos: [3.4, -3.4], size: [0.64, 1.34, 0.73] },
      ],
    },

    // West route: a corridor to a guest suite (dead end).
    {
      id: 'corridorW',
      name: 'West Corridor',
      role: 'item',
      searchable: true,
      searchPoint: 'the console table',
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
      role: 'item',
      searchable: true,
      searchPoint: 'the wardrobe',
      // Deepened south so it reaches the Ballroom. That door is what stops the Dining Room being
      // the only way into an objective room.
      center: [-15, 0.25],
      size: [6, 7.5],
      mood: { color: '#ffd2a0', intensity: 1.2, ambient: 0.9 },
      doorways: [{ wall: 'south', at: 2.0, width: 1.2, to: 'ballroom' }],
      furniture: [
        // The east wall carries the corridorW doorway and the south wall the Ballroom doorway,
        // so furniture is kept off both.
        { kind: 'bed', pos: [-1.7, -0.9], size: [2.0, 0.6, 1.8] },
        { kind: 'wardrobe', pos: [2.4, 1.6], size: [0.6, 2.2, 1.4] },
        { kind: 'desk', pos: [-1.6, 2.6], size: [1.4, 0.75, 0.6] },
        { kind: 'armchair', pos: [-2.2, 1.6], size: [0.8, 0.9, 0.8] },
      ],
    },

    // North route: lounge and library, with a back way round to the kitchen.
    {
      id: 'corridorN',
      name: 'North Corridor',
      role: 'item',
      searchable: true,
      searchPoint: 'the hall console',
      center: [0, -8],
      size: [2.4, 8],
      mood: { color: '#ffd8b0', intensity: 0.9, ambient: 0.75 },
      doorways: [{ wall: 'north', at: 0, width: 1.2, to: 'lounge' }],
      furniture: [
        { kind: 'plant', pos: [0.85, -2.5], size: [0.3, 0.9, 0.3] },
        { kind: 'consoleTable', pos: [0.85, -0.5], size: [0.35, 0.8, 1.0] },
        { kind: 'chair', pos: [-0.8, 2.0], size: [0.5, 0.9, 0.5] },
      ],
    },
    {
      id: 'lounge',
      name: 'Lounge',
      role: 'objective',
      searchable: true,
      searchPoint: 'the writing bureau',
      center: [0, -15.5],
      size: [8, 7],
      mood: { color: '#ffe2b4', intensity: 1.3, ambient: 1.0, lights: [[-2, -1.5], [2, 1.5]] },
      doorways: [{ wall: 'east', at: 0, width: 1.2, to: 'library' }],
      // Themed lounge: two sofas in an L around a glass coffee table (on a rug) in the north-west,
      // a lounge chair, a floor lamp and a plant. The south and east doorways are kept clear.
      furniture: [
        { kind: 'sofa', model: 'furniture/loungeSofa.glb', yaw: 0, scale: 2.5, pos: [-1.2, -2.9], size: [2.45, 1.15, 1.02] },
        { kind: 'sofa', model: 'furniture/loungeSofa.glb', yaw: 90, scale: 2.5, pos: [-3.3, -0.6], size: [1.02, 1.15, 2.45] },
        { kind: 'coffeeTable', model: 'furniture/tableCoffeeGlass.glb', yaw: 0, scale: 2.3, pos: [-1.6, -1.0], size: [1.52, 0.53, 0.92] },
        { kind: 'chair', model: 'furniture/loungeChair.glb', yaw: -90, scale: 2.4, pos: [0.3, -0.9], size: [0.98, 1.1, 1.18] },
        { kind: 'floorLamp', model: 'furniture/lampRoundFloor.glb', scale: 2.4, pos: [-3.5, -3.3], size: [0.36, 2.06, 0.42] },
        { kind: 'plant', model: 'furniture/pottedPlant.glb', scale: 2.4, pos: [3.4, -3.05], size: [0.61, 1.29, 0.7] },
      ],
    },
    {
      id: 'library',
      name: 'Library',
      role: 'objective',
      searchable: true,
      searchPoint: 'the bookcases',
      center: [7, -15.5],
      size: [6, 5],
      mood: { color: '#e8d8b8', intensity: 0.7, ambient: 0.55 },
      doorways: [{ wall: 'south', at: 0, width: 1.2, to: 'backCorridor' }],
      // Themed: bookcases (this is where they belong) along the north wall facing the room, a
      // reading chair + side-table lamp, a plant. Doorway (south) and a walking path kept clear.
      furniture: [
        { kind: 'bookcase', model: 'furniture/bookcaseClosedWide.glb', yaw: 0, scale: 2.5, pos: [0, -2.15], size: [2.0, 1.98, 0.63] },
        { kind: 'bookcase', model: 'furniture/bookcaseOpen.glb', yaw: 0, scale: 2.5, pos: [-2.0, -2.15], size: [1.0, 2.2, 0.63] },
        { kind: 'bookcase', model: 'furniture/bookcaseOpen.glb', yaw: 0, scale: 2.5, pos: [2.0, -2.15], size: [1.0, 2.2, 0.63] },
        { kind: 'chair', model: 'furniture/loungeChair.glb', yaw: 180, scale: 2.3, pos: [-1.7, 1.2], size: [1.13, 1.06, 0.94] },
        { kind: 'sideTable', model: 'furniture/sideTable.glb', yaw: -90, scale: 2.3, pos: [-2.7, 1.3], size: [0.51, 0.88, 1.23],
          props: [{ model: 'furniture/lampRoundTable.glb', scale: 2.0, pos: [0, 0.88, 0] }] },
        { kind: 'plant', model: 'furniture/pottedPlant.glb', scale: 2.3, pos: [2.6, 1.9], size: [0.59, 1.23, 0.67] },
      ],
    },
    {
      id: 'backCorridor',
      name: 'Back Stairs Passage',
      role: 'item',
      searchable: true,
      searchPoint: 'the stacked crates',
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
      role: 'item',
      searchable: true,
      searchPoint: 'the kitchen counter',
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
      role: 'item',
      searchable: true,
      searchPoint: 'the room-service trolley',
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
      role: 'item',
      searchable: true,
      searchPoint: 'the laundry cart',
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
      role: 'item',
      searchable: true,
      searchPoint: 'the storage shelves',
      // Widened east so it runs beneath the Service Stairs and meets the Fire Exit. This is the
      // route that stops the Service Corridor and the Service Stairs being the only way out.
      center: [15.5, 5],
      size: [11, 4],
      dark: true,
      mood: { color: '#a9b9d2', intensity: 0.45, ambient: 0.3, lights: [[-3, 0], [3, 0]] },
      doorways: [{ wall: 'north', at: 4.5, width: 1.2, to: 'exit' }],
      furniture: [
        { kind: 'shelves', pos: [0.3, -1.5], size: [3.0, 2.2, 0.5] },
        { kind: 'crates', pos: [-4.0, 1.2], size: [0.8, 0.8, 0.8] },
        { kind: 'box', pos: [2.9, 1.2], size: [1.0, 1.0, 1.0] },
        { kind: 'box', pos: [4.6, 1.1], size: [0.9, 0.7, 0.9] },
      ],
    },
    {
      id: 'stairs',
      name: 'Service Stairs',
      role: 'item',
      searchable: true,
      searchPoint: 'the stairwell bench',
      // Deepened south so the Storage Room runs beneath it.
      center: [17, 0.5],
      size: [4, 5],
      mood: { color: '#a7b6d6', intensity: 0.55, ambient: 0.38 },
      doorways: [{ wall: 'east', at: 0, width: 1.2, to: 'exit' }],
      // The steps hug the east side and the bench the west, leaving the north wall clear for
      // the Housekeeping doorway and the west wall clear for the service corridor.
      furniture: [
        { kind: 'stairStep', pos: [1.2, -1.2], size: [1.4, 0.25, 0.5] },
        { kind: 'stairStep', pos: [1.2, -1.7], size: [1.4, 0.5, 0.5] },
        { kind: 'bench', pos: [-1.0, 1.4], size: [1.4, 0.5, 0.5] },
      ],
    },
    {
      id: 'exit',
      name: 'Fire Exit',
      role: 'exit',
      isExit: true,
      // A SAFE end-zone: entering it can never trigger a meeting or a challenge. Three doorways,
      // so no single room controls the way out.
      safe: true,
      center: [21, 0.5],
      size: [4, 5],
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
      role: 'item',
      searchable: true,
      searchPoint: 'the sideboard',
      center: [0, 7],
      size: [8, 6],
      mood: { color: '#ffd8a0', intensity: 1.1, ambient: 0.85 },
      doorways: [],
      // Themed dining room: a round table with four chairs (each facing the table), a sideboard
      // against the east wall, and a plant. The north doorway (to the landing) is kept clear.
      furniture: [
        { kind: 'table', model: 'furniture/tableRound.glb', yaw: 0, scale: 2.4, pos: [0, 0.6], size: [1.66, 0.88, 1.92] },
        { kind: 'chair', model: 'furniture/chairCushion.glb', yaw: 0, scale: 2.6, pos: [0, -0.8], size: [0.52, 1.2, 0.52] },
        { kind: 'chair', model: 'furniture/chairCushion.glb', yaw: 180, scale: 2.6, pos: [0, 2.0], size: [0.52, 1.2, 0.52] },
        { kind: 'chair', model: 'furniture/chairCushion.glb', yaw: -90, scale: 2.6, pos: [1.5, 0.6], size: [0.52, 1.2, 0.52] },
        { kind: 'chair', model: 'furniture/chairCushion.glb', yaw: 90, scale: 2.6, pos: [-1.5, 0.6], size: [0.52, 1.2, 0.52] },
        // Moved to the south wall: the east wall now carries the Cloakroom doorway.
        { kind: 'sideboard', model: 'furniture/bookcaseClosedWide.glb', yaw: 180, scale: 2.3, pos: [2.2, 2.6], size: [1.84, 1.82, 0.57] },
        { kind: 'plant', model: 'furniture/pottedPlant.glb', scale: 2.4, pos: [-3.4, 2.4], size: [0.61, 1.29, 0.7] },
      ],
    },

    // ---- Rooms added for the 18-room six-player layout ------------------------------------

    // The ballroom: an OBJECTIVE room off the dining room, and one of the two dead ends.
    {
      id: 'ballroom',
      name: 'Ballroom',
      role: 'objective',
      searchable: true,
      searchPoint: 'the band stand',
      center: [-9, 7],
      size: [10, 6],
      mood: { color: '#ffd9a8', intensity: 1.15, ambient: 0.8, lights: [[-3, 0], [3, 0]] },
      doorways: [{ wall: 'east', at: 0, width: 1.2, to: 'dining' }],
      // Cleared for dancing: seating and plants round the edges, the middle left open. The east
      // doorway lane (z 6.4..7.6 in world space) is kept clear.
      furniture: [
        { kind: 'table', model: 'furniture/tableRound.glb', yaw: 0, scale: 2.2, pos: [-2.8, -1.6], size: [1.52, 0.81, 1.76] },
        { kind: 'chair', model: 'furniture/chairCushion.glb', yaw: 0, scale: 2.4, pos: [-2.8, -2.7], size: [0.48, 1.11, 0.48] },
        { kind: 'chair', model: 'furniture/chairCushion.glb', yaw: 180, scale: 2.4, pos: [-2.8, -0.5], size: [0.48, 1.11, 0.48] },
        { kind: 'sofa', model: 'furniture/loungeSofa.glb', yaw: 180, scale: 2.5, pos: [-0.5, 2.3], size: [2.45, 1.15, 1.02] },
        { kind: 'floorLamp', model: 'furniture/lampRoundFloor.glb', scale: 2.4, pos: [-4.2, 2.0], size: [0.36, 2.06, 0.42] },
        // Moved clear of the north-west doorway that now leads up to Suite 412.
        { kind: 'floorLamp', model: 'furniture/lampRoundFloor.glb', scale: 2.4, pos: [-4.2, 0.6], size: [0.36, 2.06, 0.42] },
        { kind: 'plant', model: 'furniture/pottedPlant.glb', scale: 2.5, pos: [4.2, -2.2], size: [0.64, 1.34, 0.73] },
        { kind: 'plant', model: 'furniture/pottedPlant.glb', scale: 2.5, pos: [4.2, 2.2], size: [0.64, 1.34, 0.73] },
      ],
    },

    // The cloakroom: an ITEM room that also closes a loop between the dining room and storage.
    {
      id: 'cloakroom',
      name: 'Cloakroom',
      role: 'item',
      searchable: true,
      searchPoint: 'the coat rail',
      center: [7, 6.5],
      size: [6, 5],
      mood: { color: '#e8cfa8', intensity: 0.8, ambient: 0.6 },
      doorways: [
        { wall: 'west', at: 0, width: 1.2, to: 'dining' },
        { wall: 'east', at: -1.0, width: 1.2, to: 'storage' },
      ],
      furniture: [
        { kind: 'wardrobe', model: 'furniture/bookcaseClosedWide.glb', yaw: 180, scale: 2.3, pos: [0, -1.9], size: [1.84, 1.82, 0.57] },
        { kind: 'bench', pos: [0, 1.75], size: [1.6, 0.5, 0.5] },
        { kind: 'sideTable', model: 'furniture/sideTable.glb', yaw: 0, scale: 2.2, pos: [-2.0, 1.8], size: [1.18, 0.84, 0.49] },
        { kind: 'plant', model: 'furniture/pottedPlant.glb', scale: 2.2, pos: [2.2, 1.8], size: [0.56, 1.18, 0.64] },
      ],
    },

    // Guest Suite 414: an ITEM room that links the west corridor back to Suite 412 (a loop, so
    // the west wing is not a single dead-end chain).
    {
      id: 'suite414',
      name: 'Guest Suite 414',
      role: 'item',
      searchable: true,
      searchPoint: 'the writing desk',
      center: [-8.5, -3.7],
      size: [7, 5],
      mood: { color: '#ffd2a0', intensity: 1.1, ambient: 0.85 },
      // A deliberate DEAD END off the west corridor. It is safe to leave one here because the
      // west wing's loop now runs Suite 412 -> Ballroom -> Dining -> the lobby, so no route to an
      // objective or to the exit depends on this room.
      doorways: [{ wall: 'south', at: 0, width: 1.2, to: 'corridorW' }],
      furniture: [
        { kind: 'bed', pos: [-1.6, -1.4], size: [2.0, 0.6, 1.8] },
        { kind: 'wardrobe', pos: [2.2, -1.6], size: [0.6, 2.2, 1.4] },
        { kind: 'desk', pos: [2.2, 1.4], size: [1.4, 0.75, 0.6] },
        { kind: 'armchair', pos: [0.5, -1.8], size: [0.8, 0.9, 0.8] },
      ],
    },

    // Housekeeping: the UTILITY room. Searchable, but there is nothing in it — searching says so.
    // The second dead end.
    {
      id: 'housekeeping',
      name: 'Housekeeping Store',
      role: 'utility',
      searchable: true,
      searchPoint: 'the linen shelves',
      dark: true,
      center: [18.25, -4.5],
      size: [6.5, 5],
      mood: { color: '#b8c2d0', intensity: 0.45, ambient: 0.32 },
      // The second deliberate DEAD END. The Fire Exit still has two independent routes from the
      // lobby without it (through the Service Stairs, and through the Storage Room), so nothing
      // depends on this cupboard.
      doorways: [{ wall: 'south', at: -1.7, width: 1.2, to: 'stairs' }],
      // Everything hugs the north and east walls so the doorway on the south-west has a clear
      // run into the room.
      furniture: [
        { kind: 'shelves', pos: [-0.4, -2.1], size: [4.0, 2.2, 0.5] },
        { kind: 'crates', pos: [2.2, -1.0], size: [0.8, 0.8, 0.8] },
        { kind: 'laundryCart', pos: [1.6, 0.6], size: [0.7, 1.0, 1.1] },
        { kind: 'bucket', pos: [2.6, -2.0], size: [0.3, 0.4, 0.3] },
      ],
    },
  ],
};

export default floor1;
