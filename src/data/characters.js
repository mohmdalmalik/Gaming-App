// Characters: body types, outfits and the five hot-seat players.
//
// Everything visual here is placeholder: outfits differ by silhouette and colour only.
// When real glTF models arrive, an outfit gets a `model` field pointing at the file and
// src/render/characterView.js loads it instead of building boxes; nothing in the game
// rules refers to these visuals.

export const bodyTypes = {
  male: {
    headRadius: 0.12, neck: 0.05, shoulderWidth: 0.46, chestDepth: 0.24, torsoHeight: 0.55,
    hipWidth: 0.34, hipHeight: 0.16, legLength: 0.80, legWidth: 0.13, armLength: 0.62, armWidth: 0.10,
    skin: '#d9b38c', hair: '#3a2a1e', hairStyle: 'short',
  },
  female: {
    headRadius: 0.115, neck: 0.05, shoulderWidth: 0.38, chestDepth: 0.20, torsoHeight: 0.50,
    hipWidth: 0.36, hipHeight: 0.15, legLength: 0.76, legWidth: 0.11, armLength: 0.56, armWidth: 0.085,
    skin: '#e3bf9b', hair: '#4a2a18', hairStyle: 'long',
  },
};

export const outfits = {
  // Men: period suits and evening wear.
  suit: { name: 'Suit with tie', body: 'male', jacket: '#2b3a55', trousers: '#2b3a55', shirt: '#e9e6dc', neckwear: 'tie', neckwearColor: '#8a1c2b', lapels: null },
  tuxedo: { name: 'Tuxedo with bow tie', body: 'male', jacket: '#15151a', trousers: '#15151a', shirt: '#f3f1ea', neckwear: 'bow', neckwearColor: '#15151a', lapels: '#3a3a44' },
  dinnerJacket: { name: 'White dinner jacket', body: 'male', jacket: '#ece5d4', trousers: '#15151a', shirt: '#f7f5ef', neckwear: 'bow', neckwearColor: '#15151a', lapels: '#d5ccb8' },
  // Women: elegant, modest period dresses (silhouette: aline / column / full).
  dressEmerald: { name: 'Emerald A-line gown', body: 'female', bodice: '#1f6b4a', skirt: '#1f6b4a', skirtStyle: 'aline', sleeves: 'long', sash: '#c9a86a' },
  dressBurgundy: { name: 'Burgundy column dress', body: 'female', bodice: '#6b1f30', skirt: '#6b1f30', skirtStyle: 'column', sleeves: 'short', sash: '#2a1418' },
  dressMidnight: { name: 'Midnight blue ballgown', body: 'female', bodice: '#1d2a5e', skirt: '#24357a', skirtStyle: 'full', sleeves: 'cap', sash: '#d9c27a' },
};

// The five players in turn order. `color` is the marker ring / interface colour.
export const roster = [
  { id: 'p1', name: 'Victor', outfit: 'tuxedo', color: '#e6b45a' },
  { id: 'p2', name: 'Eleanor', outfit: 'dressMidnight', color: '#5ac8e6' },
  { id: 'p3', name: 'Marcus', outfit: 'suit', color: '#a8e05a' },
  { id: 'p4', name: 'Beatrice', outfit: 'dressEmerald', color: '#e67ab8' },
  { id: 'p5', name: 'Henry', outfit: 'dinnerJacket', color: '#f0743c' },
];
