// The version of the game on the live link: shown quietly at the top of Settings (on the right of "Settings"),
// at the bottom of the in-match Menu panel and in the small print of the "Something went wrong" card, so a
// screenshot or a bug report says which build it came from. (Not on the main menu itself.)
// The lead sets both lines at each publish, together with the git tag (README > Publishing and rolling back).
export const VERSION = 'v0.11';
export const VERSION_DATE = '23 Oct 2026';
export const versionLine = () => `Version ${VERSION} · ${VERSION_DATE}`;
