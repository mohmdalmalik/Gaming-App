# CLAUDE.md — Working rules for this project

## Who you're working with
The project owner is not a developer. They work from an iPad, giving natural-language instructions, reviewing results visually, testing in the browser, and giving feedback. You handle all technical implementation.

## Workflow
Build → Run → Test → Fix → Approve → Continue.
- Work incrementally: small working improvements over large speculative ones.
- Inspect the existing project before changing it. Preserve unrelated working functionality. No broad rewrites or refactors unless necessary.
- "Change X but keep everything else the same" is a strict constraint.
- Never claim something works if you have not reasonably validated it.
- Don't ask the owner which files to edit; determine that from the project.

## Decisions
- Product decisions (what the game does) belong to the owner. Read docs/GAME_CONCEPT.md before product-related work and ask before making a product decision it doesn't cover.
- Technical decisions (how it's built) are yours. If a request is technically risky, explain the concern in simple terms and suggest a better approach.

## Communication
- Plain language, no unnecessary jargon. When a technical term is needed, explain what it means, why it matters, and what decision (if any) the owner must make.
- End every implementation task with: what changed, whether it was tested, exactly what the owner should test on iPad, and any decision needing attention.
- Don't ask the owner to edit code by hand unless there is no alternative; then give exact steps.

## Technical setup (decided)
- Browser game. Target: iPad Safari, landscape, touch. Must also work with a mouse on desktop.
- Three.js as ES modules via a CDN import map. No build step or bundler for now.
- Hosted on GitHub Pages from main at a sub-path (https://<user>.github.io/Gaming-App/): always use relative paths; keep the .nojekyll file.
- GitHub is the source of truth. Commit directly to main so the preview updates.
- Proper multi-file project (src/ modules), not one giant HTML file. Simplest architecture that works: no extra frameworks, services, databases, or infrastructure unless the project really requires it.
- Rooms, layout, and rules live in data files, not in game code.
- Greybox (placeholder) visuals now. Structure everything so real glTF models, materials, and lighting can be swapped in later without rewriting game logic.
- Keep performance smooth on iPad: few draw calls, simple materials, no heavy post-processing.
- Multiplayer comes later: keep game rules separate from rendering so a server can reuse them.

## Security
Proportional to the project stage. No secrets or API keys in client code or the repo. Never trust client data for important server operations once a server exists.

## Documentation
Keep README.md (what it is, how to preview and run, structure) and docs/DECISIONS.md (key technical choices and why) current, so another coding agent could continue the work. No excessive docs for trivial changes.

## Device escalation
Default to the iPad/cloud workflow. Only if something truly needs a Mac or Windows PC: explain why, which device, exactly what to do, and whether work returns to the iPad afterward.
