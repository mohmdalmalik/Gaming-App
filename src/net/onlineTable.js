// PENDING STUB: built in P2B (multiplayer build plan). It will be openCoop(): the waiting-room calls plus the Table
// interface over src/net/connection.js (DESIGN §4.1, §11). Until then it is SAFE to import on the live site: openCoop
// never connects anywhere and always answers "coming soon".
export const openCoop = () => Promise.reject({ code: 'comingSoon' });
