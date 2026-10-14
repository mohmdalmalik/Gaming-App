// The one word for the action budget wherever the player reads it: "1 action", "3 actions" — never "AP"
// or "action points" (the panel says Actions, the tips say actions; the tags, the Move button and the
// toasts now say the same). The rules call it actionPoints inside the engine; that name stays.
export const actionsWord = n => `${n} action${n === 1 ? '' : 's'}`;
