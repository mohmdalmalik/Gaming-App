// THE HOTEL: the start tile (the lobby) and the ROOM DECK the random hotel is built from.
// Implements "Rooms" in docs/GAME_RULES.md — the owner's design; see CLAUDE.md before changing the
// mix. The tile rules themselves (placement, rotation, fit, the Fire Exit in the last five, never
// closing the hotel off) live in src/game/hotel.js; this file is only WHAT is in the deck.
//
// Every room is a square tile of `tileSize` metres with doorways centred on its sides, so any room
// can join any other. A tile's doorways are given for its DEFAULT orientation; the game turns the
// tile to whichever orientation fits when it is placed, and turns its furniture with it.
//
// Door patterns (default orientation, north is up the map / -z):
//   DEAD      1 doorway   south
//   STRAIGHT  2 doorways  north, south
//   CORNER    2 doorways  south, east
//   TEE       3 doorways  west, south, east
//   CROSS     4 doorways  every side
//
// Furniture: `pos` is relative to the tile centre, `size` is [width, height, depth] and is also the
// collision footprint. Pieces sit in the corners or against walls that have no doorway, so the
// centre and every doorway lane stay clear in any orientation (tests/logic-check.mjs checks all
// tiles in all four orientations).
//
// Mood: light colour, intensity (× config.render.pointLightScale), ambient (overall brightness while
// a guest is there) and an optional flicker.
//
// Rooms with jobs (`job`): 'linenStore' (its card draw gives 2 cards), 'infirmary' (1 AP: restore 2
// health) and 'switchboard' (1 AP, once per player per turn: everyone learns how many guests are
// possessed). What each job does, and its numbers, live in src/data/rules.js and src/game/actions.js.

const DEAD = ['south'];
const STRAIGHT = ['north', 'south'];
const CORNER = ['south', 'east'];
const TEE = ['west', 'south', 'east'];
const CROSS = ['north', 'east', 'south', 'west'];

// --- layout helpers (pure data builders) ----------------------------------------------------------
const INNER = 3.85;            // tile half-size (4) minus the wall thickness (0.15)
const CORNER_AT = 3.1;         // centre of a corner piece
const corner = (where, kind, w = 0.9, h = 0.9, d = 0.9) => {
  const sx = where.includes('e') ? 1 : -1, sz = where.includes('s') ? 1 : -1;
  return { kind, pos: [sx * CORNER_AT, sz * CORNER_AT], size: [w, h, d] };
};
// A piece against the middle of a wall with NO doorway (in the default orientation).
const wall = (side, kind, len = 2.2, h = 0.9, depth = 0.7) => {
  const off = INNER - depth / 2 - 0.05;
  if (side === 'north') return { kind, pos: [0, -off], size: [len, h, depth] };
  if (side === 'south') return { kind, pos: [0, off], size: [len, h, depth] };
  if (side === 'east') return { kind, pos: [off, 0], size: [depth, h, len] };
  return { kind, pos: [-off, 0], size: [depth, h, len] };
};

// --- moods ---------------------------------------------------------------------------------------
const WARM = { color: '#ffd8a8', intensity: 1.1, ambient: 0.85 };
const CORRIDOR = { color: '#ffd8b0', intensity: 0.9, ambient: 0.75 };
const QUIET = { color: '#e8d8b8', intensity: 0.8, ambient: 0.6 };
const COOL = { color: '#c0ccd8', intensity: 0.7, ambient: 0.45 };
const DARK = { color: '#b8c2d0', intensity: 0.45, ambient: 0.32 };
const CLINIC = { color: '#e6eeff', intensity: 1.0, ambient: 0.8 };
const FLICKER = { color: '#c4c8d4', intensity: 0.55, ambient: 0.38, flicker: { min: 0.3, max: 1.0, speed: 10 } };

export const hotel = {
  id: 'hotel',
  name: 'Fourth Floor',
  tileSize: 8,
  doorWidth: 1.2,
  // The lobby starts with this many open doorways, chosen at random each match (3 or 4). A
  // closed-off side is a plain wall.
  lobbyDoorways: [3, 4],
  // The Fire Exit is shuffled into the last this-many tiles of the room deck.
  exitInLast: 5,

  // The start tile: the dressed lobby (src/data/dressing.js), kept exactly as it was.
  lobby: {
    id: 'hall',
    name: 'Fourth Floor Landing',
    role: 'lobby',
    safe: true,             // safe zone: no forced meetings, no attacks; voluntary trades only
    // Warm, cosy landing: index 0 is the ceiling fill, the rest sit by the lamps (dressing.js).
    mood: { color: '#ffe0b0', intensity: 1.55, ambient: 1.05, lights: [[0, 0], [3.4, 2.3], [-3.3, 3.2], [0, -3.2]] },
    // Where the guests stand at the start (relative to the lobby centre): six spots.
    startPositions: [[0, 0], [-1.6, -1.2], [1.6, -1.2], [-1.6, 1.4], [1.6, 1.4], [0, 2.2]],
    // Collision footprints of the lobby's furniture (the baked model sits on exactly these).
    furniture: [
      { kind: 'lift', pos: [-2.6, -3.72], size: [1.8, 2.1, 0.36] },
      { kind: 'sofa', pos: [-2.4, 3.35], size: [2.45, 1.15, 1.02] },
      { kind: 'chair', pos: [-3.35, 2.0], size: [1.02, 1.15, 1.23] },
      { kind: 'coffeeTable', pos: [-2.1, 2.35], size: [1.45, 0.51, 0.88] },
      { kind: 'console', pos: [3.53, 2.0], size: [0.9, 0.92, 1.28] },
      { kind: 'plant', pos: [3.5, 3.5], size: [0.64, 1.34, 0.73] },
      { kind: 'plant', pos: [3.4, -3.4], size: [0.64, 1.34, 0.73] },
    ],
  },

  // THE ROOM DECK: 24 tiles. 1 Fire Exit, 2 locked rooms, 5 dark rooms, 5 rooms with jobs
  // (2 Linen Stores, 2 Infirmaries, 1 Switchboard), the rest ordinary rooms and corridors.
  // Doorways: 4 crossings, 7 T-junctions, 4 straight, 4 corners, 4 dead ends + the exit (a dead end).
  tiles: [
    // --- four-way ------------------------------------------------------------------------------
    { id: 'lounge', name: 'Lounge', doors: CROSS, searchPoint: 'the writing bureau', mood: WARM,
      furniture: [corner('nw', 'sofa', 1.3, 0.9, 0.9), corner('ne', 'armchair'), corner('sw', 'table', 1.0, 0.75, 1.0), corner('se', 'plant', 0.6, 1.3, 0.6)] },
    { id: 'ballroom', name: 'Ballroom', doors: CROSS, searchPoint: 'the band stand', mood: WARM,
      furniture: [corner('nw', 'bandstand', 1.3, 0.5, 1.3), corner('ne', 'table'), corner('sw', 'table'), corner('se', 'table')] },
    { id: 'grandCorridor', name: 'Grand Corridor', doors: CROSS, searchPoint: 'the umbrella stand', mood: CORRIDOR,
      furniture: [corner('nw', 'plant', 0.6, 1.3, 0.6), corner('se', 'plant', 0.6, 1.3, 0.6), corner('ne', 'bench', 1.2, 0.5, 0.5)] },
    // Room with a job: 1 AP, once per player per turn — everyone learns how many guests are possessed.
    { id: 'switchboard', name: 'Switchboard', doors: CROSS, job: 'switchboard', searchPoint: "the operator's desk", mood: WARM,
      furniture: [corner('nw', 'switchboard', 1.3, 1.5, 0.9), corner('ne', 'switchboard', 1.3, 1.5, 0.9), corner('sw', 'chair', 0.7, 0.9, 0.7), corner('se', 'filingCabinet', 0.7, 1.3, 0.7)],
      colors: { switchboard: { color: '#4a3424', emissive: '#3a2208' } } },

    // --- T-junctions (the north side is a wall) -------------------------------------------------
    { id: 'dining', name: 'Dining Room', doors: TEE, searchPoint: 'the sideboard', mood: WARM,
      furniture: [wall('north', 'sideboard', 2.4, 0.9, 0.6), corner('sw', 'table', 1.2, 0.75, 1.2), corner('se', 'table', 1.2, 0.75, 1.2), corner('nw', 'chair', 0.6, 0.9, 0.6)] },
    { id: 'library', name: 'Library', doors: TEE, searchPoint: 'the bookcases', mood: QUIET,
      furniture: [wall('north', 'bookcase', 3.0, 2.0, 0.5), corner('nw', 'bookcase', 1.3, 2.0, 0.5), corner('ne', 'bookcase', 1.3, 2.0, 0.5), corner('se', 'armchair')] },
    { id: 'kitchen', name: 'Kitchen', doors: TEE, searchPoint: 'the kitchen counter', mood: COOL,
      furniture: [wall('north', 'counter', 3.2, 0.95, 0.7), corner('nw', 'counter', 1.3, 0.95, 0.7), corner('sw', 'shelf', 1.0, 1.8, 0.5)] },
    { id: 'serviceCorridor', name: 'Service Corridor', doors: TEE, searchPoint: 'the laundry cart', dark: true, mood: FLICKER,
      furniture: [wall('north', 'cart', 1.2, 1.0, 0.8), corner('se', 'crate')] },
    { id: 'storage', name: 'Storage Room', doors: TEE, searchPoint: 'the storage shelves', dark: true, mood: DARK,
      furniture: [wall('north', 'shelf', 3.0, 1.8, 0.5), corner('nw', 'crate'), corner('ne', 'crate'), corner('sw', 'crate', 0.8, 0.6, 0.8)] },
    { id: 'corridorE', name: 'East Corridor', doors: TEE, searchPoint: 'the room-service trolley', mood: CORRIDOR,
      furniture: [wall('north', 'console', 1.4, 0.8, 0.4), corner('sw', 'trolley', 0.8, 1.0, 1.1)] },
    { id: 'corridorW', name: 'West Corridor', doors: TEE, searchPoint: 'the console table', mood: CORRIDOR,
      furniture: [wall('north', 'console', 1.4, 0.8, 0.4), corner('se', 'plant', 0.6, 1.3, 0.6)] },

    // --- straight (east and west are walls) -----------------------------------------------------
    { id: 'corridorN', name: 'North Corridor', doors: STRAIGHT, searchPoint: 'the hall console', mood: CORRIDOR,
      furniture: [wall('east', 'console', 1.4, 0.8, 0.4), corner('sw', 'plant', 0.6, 1.3, 0.6)] },
    { id: 'corridorS', name: 'South Corridor', doors: STRAIGHT, searchPoint: 'the luggage trolley', mood: CORRIDOR,
      furniture: [wall('west', 'trolley', 1.2, 1.0, 0.8), corner('ne', 'bench', 0.5, 0.5, 1.2)] },
    { id: 'stairs', name: 'Service Stairs', doors: STRAIGHT, searchPoint: 'the stairwell bench', dark: true, mood: DARK,
      furniture: [wall('east', 'stairs', 3.0, 0.9, 1.6), wall('west', 'bench', 1.4, 0.5, 0.5)] },
    // Room with a job: 1 AP to restore 2 health (maximum 3).
    { id: 'infirmary2', name: 'Infirmary', doors: STRAIGHT, job: 'infirmary', searchPoint: 'the medicine cabinet', mood: CLINIC,
      furniture: [wall('west', 'infirmaryBed', 2.0, 0.6, 1.8), wall('east', 'medicineCabinet', 1.4, 1.9, 0.5), corner('ne', 'stool', 0.7, 0.9, 0.7)],
      colors: { infirmaryBed: { color: '#e4e2dc' }, medicineCabinet: { color: '#d8e2e4', emissive: '#3a0c0c' } } },

    // --- corners (north and west are walls) ------------------------------------------------------
    { id: 'backCorridor', name: 'Back Stairs Passage', doors: CORNER, searchPoint: 'the stacked crates', dark: true, mood: FLICKER,
      furniture: [corner('nw', 'crate'), wall('north', 'crate', 1.0, 0.8, 0.9)] },
    { id: 'cloakroom', name: 'Cloakroom', doors: CORNER, searchPoint: 'the coat rail', locked: true, mood: QUIET,
      furniture: [wall('north', 'rail', 3.0, 1.7, 0.6), wall('west', 'rail', 3.0, 1.7, 0.6), corner('se', 'bench', 1.2, 0.5, 0.5)] },
    { id: 'cornerCorridor', name: 'Corner Corridor', doors: CORNER, searchPoint: 'the window seat', mood: CORRIDOR,
      furniture: [corner('nw', 'windowSeat', 1.3, 0.5, 1.3), corner('sw', 'plant', 0.6, 1.3, 0.6)] },
    // Room with a job: 1 AP to restore 2 health (maximum 3).
    { id: 'infirmary1', name: 'Infirmary', doors: CORNER, job: 'infirmary', searchPoint: 'the medicine cabinet', mood: CLINIC,
      furniture: [wall('north', 'infirmaryBed', 2.0, 0.6, 1.8), wall('west', 'medicineCabinet', 1.4, 1.9, 0.5), corner('se', 'stool', 0.7, 0.9, 0.7)],
      colors: { infirmaryBed: { color: '#e4e2dc' }, medicineCabinet: { color: '#d8e2e4', emissive: '#3a0c0c' } } },

    // --- dead ends (only the south side opens) ------------------------------------------------------
    // Rooms with a job: the first search here draws 2 cards instead of 1.
    { id: 'linenStore1', name: 'Linen Store', doors: DEAD, job: 'linenStore', searchPoint: 'the linen shelves', mood: QUIET,
      furniture: [wall('north', 'linenShelf', 3.0, 1.8, 0.5), wall('west', 'linenShelf', 3.0, 1.8, 0.5), corner('se', 'laundryBasket', 0.7, 0.7, 0.7)],
      colors: { linenShelf: { color: '#e8e0cc' } } },
    { id: 'linenStore2', name: 'Linen Store', doors: DEAD, job: 'linenStore', searchPoint: 'the linen press', mood: QUIET,
      furniture: [wall('north', 'linenPress', 2.4, 1.6, 0.6), wall('east', 'linenShelf', 3.0, 1.8, 0.5), corner('sw', 'foldingTable', 0.9, 0.8, 1.0)],
      colors: { linenShelf: { color: '#e8e0cc' }, linenPress: { color: '#e8e0cc' } } },
    { id: 'suite416', name: 'Guest Suite 416', doors: DEAD, searchPoint: 'the bedside table', locked: true, mood: WARM,
      furniture: [wall('north', 'bed', 2.0, 0.6, 1.8), wall('east', 'wardrobe', 1.4, 2.1, 0.6), corner('sw', 'chair', 0.7, 0.9, 0.7)] },
    { id: 'housekeeping', name: 'Housekeeping Store', doors: DEAD, searchPoint: 'the linen shelves', dark: true, mood: DARK,
      furniture: [wall('north', 'shelf', 3.0, 1.8, 0.5), wall('east', 'shelf', 3.0, 1.8, 0.5), corner('sw', 'cart', 0.8, 1.0, 1.1)] },

    // --- the way out ----------------------------------------------------------------------------------
    // A SAFE end-zone: entering it never forces a meeting. The glowing exit door is on the far wall.
    { id: 'exit', name: 'Fire Exit', doors: DEAD, isExit: true, safe: true, role: 'exit', searchable: false,
      mood: { color: '#d7ebff', intensity: 1.2, ambient: 0.7 },
      furniture: [wall('north', 'exitDoor', 1.6, 2.4, 0.3), corner('nw', 'crate', 0.8, 0.8, 0.8)],
      colors: { exitDoor: { color: '#8ff5b0', emissive: '#2a8f5a' } } },
  ],
};
