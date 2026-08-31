# AGENTS.md

Guidance for Claude Code, Cursor, Codex, Fable, Grok, and other coding agents
working in this repo.

Read `CLAUDE.md` first (layout, conventions, gotchas). `CALL-TRACKER-MEMORY.md`
is the full hand-off. `TODO.md` is the feature backlog. For scan / debug / feature
work, follow `docs/FEATURE-DEBUG-PROMPT.md`.

## Git commit messages (mandatory)

Keep commit messages pristine. They describe **only the work being done** — what
changed and why. Nothing else.

**Do not** add extra information, contribution credit, or tooling placeholders:

- `Co-Authored-By:` (any name or address, including Claude / Grok / Codex)
- `Claude-Session:`, session URLs, or other session metadata
- `Generated with …`, `Made with …`, `Made-with:`, or similar watermarks
- Empty trailer blocks, model names, or marketing fluff about the agent

Preferred shape (match existing history):

```text
type(scope): short imperative summary

Optional body: what changed and why it matters.
```

Good: `fix(photo-review): index close-up faces the dup check skipped`.
Not: a correct subject plus a `Co-Authored-By` trailer.
