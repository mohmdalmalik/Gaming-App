// Per-room "dressing" — how a room's greybox shell (floor + walls) is replaced with real
// glTF pieces, plus decoration that has no collision (rugs, pillows) and where the lamp lights
// sit. Keyed by room id, so dressing another room later is just another entry here; only rooms
// listed are dressed, everything else stays greybox and untouched. With the random hotel every
// room is an 8 m tile; only the lobby is dressed for now (room art comes later), and the generic
// Kenney shell dressing in src/render/roomDressing.js is kept for when it does.
//
// The furniture MODELS themselves live in the room data (`furniture`, with a `model`), so
// collision and visuals come from one place. This file is only the shell + non-colliding extras.

export const roomDressings = {
  // The starting room is one baked model (tools/lobby-pipeline/, loaded by
  // src/render/bakedRoom.js): walnut panelling cut at a consistent height, cream stone floor,
  // burgundy rugs, red velvet seating, brass lamps and sconces, with soft shadows and lamp light
  // baked in. The collision footprints are the lobby furniture in src/data/hotel.js.
  hall: {
    style: 'baked',
    model: 'lobby/lobby.glb',
    light: 'lobby/lobby-light.jpg',
    floorLight: 'lobby/lobby-floor-light.jpg',
    exposure: 0.62,
    // Lamp lights: which of the room's mood-light indices (from mood.lights in hotel.js) sit
    // low by a lamp rather than up at the ceiling, and how warm/bright each is. Index 0 is the
    // ceiling fill and is left alone.
    lampLights: { indices: [1, 2, 3], height: 1.0, color: '#ffe6c0', intensityScale: 0.9 },
  },

};
