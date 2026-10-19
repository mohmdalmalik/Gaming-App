// The version of the game on the live link: shown quietly at the bottom of Settings and in the small print
// of the "Something went wrong" card, so a screenshot or a bug report says which build it came from.
// The lead sets both lines at each publish, together with the git tag (README > Publishing and rolling back).
export const VERSION = 'v0.8';
export const VERSION_DATE = '19 Oct 2026';
export const versionLine = () => `Version ${VERSION} · ${VERSION_DATE}`;
