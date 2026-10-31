# How we build: spec-driven, one feature at a time

Every feature in [FEATURES.md](../FEATURES.md) follows this workflow.

| Step | What happens | Who approves |
|---|---|---|
| 1. Spec | `spec.md`: goal, out of scope, requirements, acceptance criteria, open questions | **Owner, before any code** |
| 2. Tasks | `tasks.md`: small slices, each linked to its requirements, plus a short design section if the feature needs one | Proceeds unless something changes the spec |
| 3. Build | One slice at a time. Tests are written from the acceptance criteria first, then the code | Automated tests must pass |
| 4. Verify | `verification.md`: each acceptance criterion with its real command, output or screenshot | **Owner tests it and signs off** |
| 5. Commit | Commit and mark the feature done in `FEATURES.md` | |

## Rules

- Only one feature is in progress at a time.
- A failing check means the feature is not done.
- Code that isn't traceable to a requirement doesn't get written.
- A scope change updates the spec first and needs owner approval.

## Folder layout

```
docs/specs/F04-build-engine/
  spec.md
  tasks.md
  verification.md
```

## Template: `spec.md`

```markdown
# F00 Feature name

Status: draft | approved

## Goal
What this feature delivers and why, in a few sentences.

## Out of scope
- What this feature deliberately leaves out, and which feature covers it.

## Requirements
- R1: The system must ...

## Acceptance criteria
- AC1 (R1): Given ..., when ..., then ...

## Open questions
- Q1: The question, with a proposed answer.
```

## Template: `tasks.md`

```markdown
# F00 Tasks

## Design
Only if the feature needs one: key decisions, data shapes, interfaces.

## Slices
- [ ] T1: What gets built (R1, R2)
  - Tests first: AC1, AC2
```

## Template: `verification.md`

```markdown
# F00 Verification

| Criterion | Command or action | Real output or screenshot | Result |
|---|---|---|---|
| AC1 | `the command that was run` | What actually came back | pass or fail |

Sign-off: name, date
```
