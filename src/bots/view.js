// WHAT A COMPUTER GUEST MAY KNOW — the one place a bot's information is built. Pure (no DOM, no
// THREE, no Node APIs), so it runs in the browser and in Node alike.
//
// A bot plays as one guest in a real online game would: it sees the shared board and its own private
// screen, nothing else. botView() copies exactly that out of the engine's state, and the brain
// (src/bots/brain.js) reads ONLY this view plus its own memory. To audit what bots know, read this file.
//
//   PUBLIC (everyone sees it)
//     the round, whose turn it is, the dawn round; every revealed room with its doors, closed doors,
//     locks, barricades, whether its one card draw has been used and whether a dead guest's things lie
//     on its floor; where every guest stands, their health, alive / dead / escaped; which pairs have
//     already met in which room this round; the public event list (state.events: who walked where,
//     opened, searched, traded, attacked, rang the Switchboard and what it said, ...); how many room
//     tiles are still to come (the room deck's size, never its order).
//   PRIVATE (only this guest)
//     its own hand (Possession cards included), role, action points and health; its own private event
//     list (player.inbox: the trades it made and what it gave and got, a Lantern block it made or
//     suffered, being possessed and by whom, whom it possessed, a Hand Mirror it used or that was used
//     on it).
//   NEVER
//     another guest's hand, card count or role; the draw pile or the room deck; another guest's notes or
//     inbox; which seats are people and which are computer guests (the view has no names or ids:
//     a Hand Mirror target is a seat, turned into a player id by src/bots/index.js).
//
// `cursor` = { pub, inbox }: only events after these points are included (pub: the last public `seq`
// already read; inbox: how many own private events were already read), so a bot reads each event once.
import { rules } from '../data/rules.js';

export function botView(state, floor, seat, cursor = { pub: 0, inbox: 0 }) {
  const me = state.players[seat];
  const room = r => ({
    id: r.id,
    name: r.name,
    isExit: !!r.isExit,
    safe: !!r.safe,
    noTrade: !!r.noTrade,
    dark: !!r.dark,
    searchable: !!r.searchable,
    job: r.job || null,
    locked: !!state.lockedRooms?.has(r.id),               // its door is locked right now
    searched: !!state.searchedRooms?.has(r.id),            // its one card draw is used
    drops: (state.roomDrops?.get(r.id) || []).length > 0,  // a dead guest's things lie here (not what or how many)
    doors: (r.doorways || []).map(d => ({ id: d.id, to: d.otherRoom(r.id), barricaded: !!state.barricades?.has(d.id) })),
    closed: (r.frontier || []).filter(f => !f.jammed).map(f => f.id),   // closed doors that can be opened
  });
  return {
    seat,
    seats: state.players.length,
    round: state.round,
    turn: state.turn,
    activeSeat: state.activeIndex,
    finished: !!state.finished,
    practice: !!state.practice,
    // rule numbers every guest knows (from the rules everyone reads)
    roundLimit: rules.roundLimit,
    lanternsToEscape: rules.lanternsToEscape,
    maxHealth: rules.maxHealth,
    handLimit: rules.handLimit,
    apPerTurn: rules.actionPointsPerTurn,
    lobby: floor.start?.room ?? null,
    exitRoom: floor.exitRoom ?? null,          // set only once the Fire Exit has been revealed
    roomTilesLeft: floor.deck?.length ?? 0,    // how many room tiles are still to come (24 minus the rooms on the
                                               // board: public), never which ones or in what order
    me: {
      seat,
      room: me.currentRoom,
      ap: me.actionPoints,
      health: me.health,
      alive: !!me.alive,
      possessed: !!me.possessed,
      hand: me.hand.map(c => ({ id: c.id, type: c.type, ...(c.shots != null ? { shots: c.shots } : {}) })),
      rangSwitchboardThisTurn: state.switchboardCalls?.get(me.id) === state.turn,
    },
    // (no names or ids: a bot needs neither, and they could hint at who is a person)
    players: state.players.map(p => ({
      seat: p.index,
      room: p.currentRoom,
      health: p.health,
      alive: !!p.alive,
      escaped: !!state.escaped?.has(p.id),
    })),
    rooms: floor.roomList.map(room),
    met: [...(state.encounterLocks || [])].sort(),   // 'roomId:a-b': these two already met there this round
    events: (state.events || []).filter(e => e.seq > (cursor.pub || 0)),
    inbox: (me.inbox || []).slice(cursor.inbox || 0),
  };
}
