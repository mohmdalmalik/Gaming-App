# Game Concept — Gaming-App (working title)

## Core idea
Players are trapped in an elegant hotel and explore connected rooms to find an exit. The long-term goal is an online social game for teenagers and adults. Detailed rules, multiplayer, and hidden-role mechanics will be decided later.

## Established (owner's decisions)
- Setting: prestigious grand hotel, late 1980s / early 1990s, subtle Art Deco. Walnut and mahogany, polished brass, rich carpets, marble, chandeliers, warm lighting.
- Atmosphere: the lobby is welcoming and alive. Deeper rooms grow mysterious and slightly spooky through lighting, sound, shadow, and odd details. Elegance is kept throughout; restrained suspense, never graphic horror.
- View: elevated, angled top-down 3D "dollhouse" view. Roofs and obstructing walls cut away. Rooms, furniture, doorways, and characters clearly readable.
- Movement: natural walking with smooth animation, navigating around furniture.
- Discovery: start in one revealed room; adjacent rooms are discovered through doorways; discovered rooms stay visible and accessible. Branching routes, varied room types, dead ends requiring backtracking, always a reachable exit.
- Action points govern movement and exploration (values and replenishment still open).
- Interface: character portrait, three health bars, action points, cards in hand. A map icon bottom-right opens a 2D map of explored rooms and the player's position.
- Main menu: animated 3D lobby background (guests, waiters, ambient activity). Options: Play and Character.
- Characters: male and female avatars, 2–3 styles each. Men in period suits or tuxedos; women in elegant modest dresses. The chosen look carries into gameplay.
- Intro: after Play, a receptionist escorts the player to the starting room, then the player takes control.
- Some rooms contain searchable objects giving an action card, extra points, or a hint (initial ideas to evaluate).

## Current defaults (proposed, may change)
- Camera: fixed angle with 90° snap rotation, not free rotation, so cutaway walls stay readable.
- Touch: tap to walk (pathfinding), pinch to zoom, two-finger drag to pan, buttons to rotate.
- Action points: moving inside a discovered room is free; entering a new room costs 1; searching costs 1; "End turn" restores points (placeholder).
- Visual target: stylised, warm, mid-detail rather than photoreal, for fast loading on iPad.
- Menu lobby starts light (a few idle figures, ambient light and sound) and grows later.

## Open decisions
- Narrative reason the player cannot return through the lobby.
- Final action point values and replenishment.
- Health and card mechanics.
- Asset strategy and budget (packs, AI-generated, commissioned).
- Sound and music.

## Development plan
1. Greybox prototype (placeholder shapes): camera, touch controls, walking, room discovery, dead ends, mood shift, exit, basic interface, map. Purpose: test feel, not looks.
2. Add menu, character selection, receptionist intro, health and cards, searchable objects.
3. Replace placeholders with real art, lighting, and sound.
4. Multiplayer and full rules.

## Success criteria for the greybox
- Loads quickly and runs smoothly on iPad Safari.
- Movement feels responsive and natural; the player never gets stuck.
- Connected rooms and unexplored doorways are easy to understand.
- The shift from warm to uneasy is noticeable even with placeholder shapes.
- Dead ends, backtracking, and the exit work as intended.
