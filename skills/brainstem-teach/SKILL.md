---
name: brainstem-teach
description: Teach my Brainstem a capability, improve an existing skill, or keep what we learned as portable native Copilot skill source. Brain Surgeon uses a visible learn, teach, keep loop without a RAPP server.
---

# Learn -> Teach -> Keep

Stay in the native Copilot session. Preserve its permissions, project
instructions, and ordinary file-edit approval flow.

1. Read `brainstem_context` when available and search relevant existing skills.
2. Solve one concrete example with the user. Show the important actions and
   actual result; distinguish observed evidence from assumptions.
3. Extract the repeatable capability: when to use it, required inputs,
   concrete steps, outputs, verification, limits, and failure handling.
4. Choose the smallest suitable artifact. Prefer a normal Copilot `SKILL.md`.
   Add scripts only when execution needs them; do not force native skills into
   a Python `perform()` wrapper.
5. Default to `.github/skills/<kebab-case-name>/SKILL.md` in the current
   project. Ask before making it user-wide in `~/.copilot/skills/`. Never
   overwrite an existing skill without reading and preserving its content.
6. Include YAML `name` and `description`, clear triggers, the procedure,
   boundaries, and a repeatable example. Exclude secrets, private examples,
   customer data, and generated transcripts.
7. Exercise another representative example using the saved instructions.
   Fix tightly related failures; do not claim unrun checks.
8. Use `brainstem_refresh` if available so the Canvas shows the actual source.
   Tell the user where the skill lives and what scope it has.

The kept artifact is an ordinary Copilot skill, not a Brainstem-only format.
The user can inspect, version, share, or use it without this plugin.
