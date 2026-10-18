// The achievements ("Hotel Honours"): what you do in a match to earn an item that is never sold. Pure data (no DOM,
// no storage): the same list can run on a server later. Each one reads only the match summary of src/matchSummary.js
// (built from the rules' own events at the end of a match, never during one) and is counted by src/honours.js.
//
//   scope 'match'   earned when ONE match's progress reaches the goal (the best match is kept, for the Honours page)
//   scope 'total'   added up over matches until the goal
//
// The owner's rules (BUILD-BRIEF, 18 Oct 2026): checked and announced only on the end screen; a win counts only for
// the side you started on; leaving early, being idle and test links earn nothing; matches against bots count; the
// progress lives on this device until there is a server. Only these five exist in W1 (the item ids are
// src/data/wardrobe.js's: each item's `achievement` names its one here).
export const ACHIEVEMENTS = [
  { id: 'seenThrough', label: 'Seen through', desc: 'Your Hand Mirror shows you a Possession card.',
    item: 'glasses.monocle', scope: 'match', goal: 1, progress: s => (s.mirrorSawPossession ? 1 : 0) },
  { id: 'savedByTheLight', label: 'Saved by the light', desc: 'A Lantern you hand over stops a possession.',
    item: 'extra.lantern', scope: 'match', goal: 1, progress: s => Math.min(1, s.lanternBlocks) },
  { id: 'lamplighter', label: 'Lamplighter', desc: 'Find 3 Lanterns yourself in one match.',
    item: 'hairStyle.lamplighter', scope: 'match', goal: 3, progress: s => s.lanternsFound },
  { id: 'goodCompany', label: 'Good company', desc: 'Win 5 matches as a clean guest.',
    item: 'extra.eveningGloves', scope: 'total', goal: 5, progress: s => (s.cleanWin ? 1 : 0) },
  { id: 'darkHorse', label: 'Dark horse', desc: 'Win 5 matches as the guest who started possessed.',
    item: 'extra.blackOrchid', scope: 'total', goal: 5, progress: s => (s.possessedWin ? 1 : 0) },
];

export const achievement = id => ACHIEVEMENTS.find(a => a.id === id) || null;

// The quiet line under the record on the end screen (src/ui/honoursEnd.js): "Achievement earned: Seen through ·
// Monocle". `earned`: [{ label, itemLabel }].
export function honoursLine(earned) {
  if (!earned?.length) return '';
  const each = earned.map(a => (a.itemLabel ? `${a.label} · ${a.itemLabel}` : a.label));
  return `${earned.length === 1 ? 'Achievement' : 'Achievements'} earned: ${each.join('; ')}`;
}
