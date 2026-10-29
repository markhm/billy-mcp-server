# FP Claude Instructions

This file is managed by `fp agent setup claude` and `fp init --agent claude`.

This project uses **fp** for issue tracking. Claude Code agents must follow these rules.

## Guides

Run `fp guide` for workflow primers and a snapshot of this project (registered statuses, properties, extensions).

```bash
fp guide plan
fp guide implement
fp guide brainstorm
fp guide extension
```

## Issue Workflow

- Before starting implementation work, load the relevant issue with `fp context <id>`.
- Mark claimed work in progress with `fp issue update --status in-progress <id>`.
- Add comments at meaningful checkpoints with `fp comment <id> "<update>"`.
- Use `fp tree` and `fp issue list` to inspect nearby work before creating duplicate issues.
- When work is complete and verified, mark the issue done with `fp issue update --status done <id>`.

## Commands Reference

```bash
fp tree [parent-id]        # View issue hierarchy
fp issue list --status X   # Filter by status
fp issue create --title "..." --parent X --property key=value
fp issue update --status X <id> --property key=value
fp comment <id> "message"
fp comment update <comment-id> "new message"  # Alias: edit
fp comment delete <comment-id>                # Soft-delete/hide a comment
fp context <id>            # Load full issue context
```

## Project Notes

- Treat this file as fp-managed. Put project-specific Claude Code preferences in `CLAUDE.md`.
- Keep user-authored content in `CLAUDE.md`; fp only ensures that file includes `@FP_CLAUDE.md`.
