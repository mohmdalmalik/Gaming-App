# tests/old: historical, not part of the test suites

These are the one-off QA scripts and reports from the early playtest rounds (September and early October 2026): the
`qa-*.mjs` scripts drove the game through screens that have since changed (they open the old `?mode=hotseat` links or the
old "Tap to begin" flow) and take screenshots for a person to look at. **They have no assertions and always exit 0;
nothing runs them, nothing imports them, and the current suites in `tests/` do not depend on them.** They are kept as a
record of how the game was looked at then. The two `*-report.md` files are the playtest reports they belong to
(`autoplay-report.md` names `tests/autoplay.mjs`, which no longer exists).

Do not extend them. A new check belongs in a real suite in `tests/` (see "Running the tests" in the main README).
