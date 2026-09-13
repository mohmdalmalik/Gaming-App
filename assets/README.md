# Artwork assets

Drop-in art for the interface. Images are referenced by relative path and registered in code,
so adding a file + one line makes it appear — no other change needed.

## Portraits — `assets/portraits/`
Keyed by **outfit** in `src/ui/portrait.js` → `PORTRAIT_ART`. An entry is either a single image
(used for the normal look) or `{ normal, possessed }` for both looks:

```js
tuxedo: { normal: 'assets/portraits/victor.jpg', possessed: 'assets/portraits/victor-possessed.jpg' },
```

- **normal** is the only image ever shown on the public top strip, so a guest's hidden role never
  leaks. The **possessed** image appears only on that guest's own active-player panel when they are
  possessed. If no `possessed` image is supplied, the normal one is reused with a cold "possessed"
  wash (CSS `.portrait-img.possessed`).
- Composition: head-and-shoulders, upright ~3:4. The interface crops to a square (top strip) and a
  ~3:4 box (panel) with `object-position: 50% 20%`, so keep the face in the upper-middle.
- Size for iPad: longest side ~768px, JPEG. (Originals can be larger; commit only the downscaled
  copy to keep the page light.)

Outfit → guest: `tuxedo` = Victor, `dressMidnight` = Eleanor, `suit` = Marcus,
`dressEmerald` = Beatrice, `dinnerJacket` = Henry.

## Cards — `assets/cards/`
Keyed by **card type** in `src/ui/cards.js` → `CARD_ART`:

```js
lantern: 'assets/cards/lantern.jpg',
```

- Square (~640px), JPEG or PNG. It fills the card's illustration area (`object-fit: cover`) inside
  the ivory/brass card frame, so a little edge cropping is fine; keep the subject centred.
- Card types: lantern, flashlight, knife, revolver, bandage, possession, masterKey, lockPick,
  barricade, trinket.

## Supplied so far
- `portraits/victor.jpg`, `portraits/victor-possessed.jpg` (Victor)
- `cards/lantern.jpg` (Lantern)

Everything else still uses the built-in placeholder (flat-vector busts / tinted glyph cards).
