// Per-room "dressing" — how a room's greybox shell (floor + walls) is replaced with real
// glTF pieces, plus decoration that has no collision (rugs, pillows) and where the lamp lights
// sit. Keyed by room id, so dressing another room later is just another entry here; only rooms
// listed are dressed, everything else stays greybox and untouched.
//
// The furniture MODELS themselves live in the room data (src/data/floor1.js `furniture`), so
// collision and visuals come from one place. This file is only the shell + non-colliding extras.

export const roomDressings = {
  hall: {
    // Wooden floor, tiled from the 2 m Kenney floor piece so the texture stays crisp.
    floor: { model: 'building/floor.glb', tile: 2.0, top: 0.1 },
    // Wall panels built along each greybox wall segment (kept in the cutaway system so they
    // still lower when they face the camera). `natHeight` is the model's natural height.
    wall: { model: 'building/wall.glb', natHeight: 2.4 },
    // Non-colliding decoration (sized to sit under/on the scaled-up furniture).
    decor: [
      // A large rug under the south-west seating group (deep warm red-brown, not the kit's coral).
      { model: 'furniture/rugRounded.glb', pos: [-2.4, 2.5], yaw: 0, scale: 2.2,
        overrides: { carpet: '#7c4a39', carpetDarker: '#5a3327' } },
    ],
    // Lamp lights: which of the room's mood-light indices (from mood.lights in floor1.js) sit
    // low by a lamp rather than up at the ceiling, and how warm/bright each is. Index 0 is the
    // ceiling fill and is left alone.
    lampLights: { indices: [1, 2, 3], height: 1.0, color: '#ffd9a0', intensityScale: 0.85 },
  },

  // A few more rooms dressed by theme (same shell + a rug; the themed furniture is in floor1.js).
  library: {
    floor: { model: 'building/floor.glb', tile: 2.0, top: 0.1 },
    wall: { model: 'building/wall.glb', natHeight: 2.4 },
    decor: [
      { model: 'furniture/rugRounded.glb', pos: [0, 0.7], yaw: 0, scale: 2.2,
        overrides: { carpet: '#6d4636', carpetDarker: '#4a2f24' } },
    ],
  },
  lounge: {
    floor: { model: 'building/floor.glb', tile: 2.0, top: 0.1 },
    wall: { model: 'building/wall.glb', natHeight: 2.4 },
    decor: [
      { model: 'furniture/rugRounded.glb', pos: [-1.6, -1.2], yaw: 0, scale: 2.7,
        overrides: { carpet: '#7c4a39', carpetDarker: '#5a3327' } },
    ],
  },
  dining: {
    floor: { model: 'building/floor.glb', tile: 2.0, top: 0.1 },
    wall: { model: 'building/wall.glb', natHeight: 2.4 },
    decor: [
      { model: 'furniture/rugRounded.glb', pos: [0, 0.6], yaw: 0, scale: 2.9,
        overrides: { carpet: '#6d4636', carpetDarker: '#4a2f24' } },
    ],
  },
};
