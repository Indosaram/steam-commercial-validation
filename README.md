# steam-commercial-validation

Internal validation workspace for the five-candidate Steam concept comparison.
This is **not** a Steam build, **not** a public demo, and must never be published.
It contains no store pages, no marketplace mechanics, and no Steam API usage.

## What this is

The shared foundation (Task 1) every candidate build (Tasks 2-6) inherits:

| Piece | Path | Purpose |
| --- | --- | --- |
| Concept registry | `core/concepts.js` | The five frozen concept IDs and their shared proof contract |
| Input mapping | `core/input.js` | Six shared verbs, identical bindings across all candidates |
| Telemetry schema | `core/telemetry.js` | One JSON event schema + session validator |
| Save / reset | `core/profile.js` | Per-concept profiles, corruption recovery, reset |
| Blank shell | `core/shell-core.js` | The common beat structure and deterministic scripted run |
| Build identity | `core/build-identity.js` | Per-candidate `build_id`/`build_hash` + isolation check |
| Candidate loader | `core/candidate.js` | The Wave 2 extension point (`candidates/<id>/scenario.js`) |
| Scorecard | `core/scorecard.js` | 1-5 owner scorecard export and comparison table |
| Decision log | `core/decision-log.js` | Per-candidate decision records |
| Browser shell | `shell/` | The genuinely launchable playable surface |
| Launcher | `tools/launch.js` | Local HTTP launcher, one concept per launch |
| Smoke driver | `tools/smoke-driver.js` | Deterministic all-concept gate |
| Export validator | `tools/validate-export.js` | Standalone artifact conformance check |

Runtime: Node >= 20, standard library only. No dependencies, no install step,
no network access required.

## Launch contract

Every candidate build must be launchable with exactly this shape:

```
node tools/launch.js --concept <concept_id> [--port <n>]
```

- `--concept` is **required**. A launch without it exits `2` with a named error.
- An unknown concept ID exits `2` with the list of valid IDs.
- The launcher serves `http://127.0.0.1:8177/` by default and prints the URL.
- `Ctrl-C` shuts down cleanly without leaving the port bound.

Valid concept IDs:

```
fake_it_till_you_clean_it
return_to_sender
theme_park_liquidation
cursed_secondhand
panic_at_the_pawnshop
```

## Shared success condition

A session proves the candidate only when all six hold:

1. The scenario is completed without developer guidance.
2. The repeated core action is performed **at least three times**.
3. The concept's signature reveal is triggered.
4. One meaningful choice/discovery is committed.
5. A next-scenario hook is shown.
6. Active play lands inside the **10-15 minute** target window.

`evaluateSuccessCondition()` in `core/shell-core.js` is the single definition.

## Shared controls

| Verb | Keyboard | Gamepad | Meaning |
| --- | --- | --- | --- |
| `interact` | `E` | A | Interact / pick up |
| `core_action` | `Space` | X | The repeated core action |
| `inspect` | `Q` | Y | Inspect / diagnose (triggers reveal in the blank shell) |
| `commit_choice` | `F` | B | Commit the meaningful choice |
| `advance` | `Enter` | Start | Start session / advance / complete |
| `reset_profile` | `R` | Select | Reset this concept's profile |

Candidate builds may relabel a verb in their own UI but must not rebind inputs.

## Telemetry

One schema, `schema_version: 1`. Every event carries `concept_id`, `build_id`,
`session_id`, `sequence`, and `t_ms`. Omitting any of them is rejected by name.
Unsupported event names are rejected.

Required events, in causal order:

```
session_started -> core_action_completed -> signature_reveal_seen
-> choice_committed -> scenario_completed -> session_ended
```

## Commands

```bash
npm test                                    # 30 foundation tests
node tools/smoke-driver.js                  # all five concepts, deterministic
node tools/smoke-driver.js --seed 7 --out runs/x
node tools/launch.js --concept return_to_sender
node tools/validate-export.js runs/<dir>    # validate exported artifacts
```

## Save / reset behavior

Profiles live at `<root>/<concept_id>.json` (browser: `localStorage`).

- Missing profile -> a clean profile is created.
- Corrupt JSON -> clean profile, `recovery_reason: corrupt_profile`.
- Older `version` -> clean profile, `recovery_reason: version_mismatch`.
- Wrong concept binding -> clean profile, `recovery_reason: concept_mismatch`.
- Partial field damage -> defaults restored, `recovery_reason: field_repair`.

A corrupted profile never blocks a launch; recovery is always surfaced honestly
rather than silently hidden.

## Extending this for Wave 2 (Tasks 2-6)

A candidate build **must not edit** `core/`, `shell/`, or `tools/`. Each worker
owns exactly one directory:

```
candidates/<concept_id>/scenario.js     # default-exports a scenario descriptor
```

The descriptor declares the ordered steps, their prerequisites (invalid-path
gating), and the visible before/after transformation:

```js
export default {
  concept_id: 'return_to_sender',
  steps: [
    { id: 'survey', kind: 'inspect', label: 'Survey the blocked lane' },
    { id: 'sort_1', kind: 'core_action', label: 'Sort parcel 1',
      requires: ['survey'],
      transformation: { before: 'blocked_lane', after: 'lane_partially_clear' } },
    { id: 'sort_2', kind: 'core_action', requires: ['sort_1'] },
    { id: 'sort_3', kind: 'core_action', requires: ['sort_2'] },
    { id: 'reveal', kind: 'reveal',     requires: ['sort_3'] },
    { id: 'decide', kind: 'choice',     requires: ['reveal'] },
  ],
  replay: ['survey', 'sort_1', 'sort_2', 'sort_3', 'reveal', 'decide'],
};
```

Step kinds map onto the shared required events: `core_action` ->
`core_action_completed`, `reveal` -> `signature_reveal_seen`, `choice` ->
`choice_committed`, `inspect` -> `inspect_performed`.

`validateDescriptor()` rejects a candidate that declares fewer than three core
actions, omits the reveal or the choice, references an unknown prerequisite, or
declares a forward prerequisite (a soft-lock). `blockedSteps()` gives candidates
invalid-path gating without reimplementing it.

### Build identity and isolation

`build_id` is `foundation-<version>+<concept_id>.<short-hash>`, hashed over the
shared core plus that candidate's own sources. Five candidates therefore share
one `core_hash` but never share a `build_id`. `checkCandidateIsolation()` fails
any candidate importing another candidate's modules.

## Known limitations (architecture findings)

- **D2 - workspace location.** This foundation lives under `.omo/`, an agent
  state directory, rather than a first-class sibling project. It was kept here
  because the executing task authorized only this path. Packaging for Task 7
  should relocate it; nothing in the code depends on its location (all paths
  resolve relative to the module).
- **D3 - no VCS boundary.** `/Users/indo/code/project` is not a git repository,
  so no commit SHA is available as build identity and no dirty-worktree check is
  possible. Build identity is content-hash based specifically to work without
  git; if this workspace is later placed under version control, `build_hash`
  remains valid and can be cross-referenced with a commit.
- **D4 - shared build_id.** RESOLVED in this task; see `core/build-identity.js`.

## Guardrails

- No Steam APIs, store pages, wishlists, or Next Fest registration.
- No real-money markets, tradeable items, gacha, gambling, or bots.
- No candidate-specific polish in this workspace beyond the common shell.
