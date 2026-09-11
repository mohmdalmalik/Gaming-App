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
    // Non-colliding decoration.
    decor: [
      // A large rug under the seating group (deep warm red-brown, not the kit's coral).
      { model: 'furniture/rugRounded.glb', pos: [-2.25, 2.7], yaw: 0,
        overrides: { carpet: '#7c4a39', carpetDarker: '#5a3327' } },
      // Cushions on the sofa.
      { model: 'furniture/pillow.glb', pos: [-3.32, 2.35], yaw: 90, y: 0.35, overrides: { carpet: '#d8c39a' } },
      { model: 'furniture/pillowLong.glb', pos: [-3.32, 3.0], yaw: 90, y: 0.35, overrides: { carpet: '#b8996a' } },
      // A coat rack by the lift, near the entrance.
      { model: 'furniture/coatRackStanding.glb', pos: [-3.55, -3.5], yaw: 0 },
    ],
    // Lamp lights: which of the room's mood-light indices (from mood.lights in floor1.js) sit
    // low by a lamp rather than up at the ceiling, and how warm/bright each is. Index 0 is the
    // ceiling fill and is left alone.
    lampLights: { indices: [1, 2, 3], height: 1.0, color: '#ffd9a0', intensityScale: 0.85 },
  },
};
