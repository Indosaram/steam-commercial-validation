# Candidate Canvas game module contract

A candidate may add an optional browser module at:

```text
candidates/<concept_id>/game.js
```

`tools/launch.js` exposes only the active candidate directory under `/candidate/`.
When `game.js` exists, `/bootstrap.json` contains:

```json
{ "game_module": "/candidate/game.js" }
```

Otherwise `game_module` is `null` and the shell uses the neutral Canvas fallback.

## Lifecycle

`game.js` must default-export `createGame`:

```js
export default function createGame({
  canvas,
  ctx,
  overlay,
  concept,
  scenario,
  getState,
  actions,
  audio,
  toCanvasPoint,
  debug,
}) {
  return {
    handleVerb(verb, meta) { return false; },
    handlePlayerAction(action, meta) { return false; },
    destroy() {},
    getDebugState() { return {}; },
  };
}
```

A handler claims an input by returning `true` or `{ handled: true }`. Any other
return value falls through to the generic shared host behavior.

## Host actions

The module receives four state-changing actions:

- `actions.startSession()`
- `actions.attemptStep(stepId, payload)`
- `actions.completeScenario(payload)`
- `actions.resetProfile()`

`attemptStep` is the only supported way for candidate browser code to complete a
descriptor step. It reuses `blockedSteps()`, is idempotent, emits only shared
telemetry events, and returns `{ ok, missing, reason, ... }`.

`completeScenario` refuses to complete while descriptor steps remain unfinished.
The shared `Enter` binding therefore starts a session or completes an already
finished descriptor; it never advances a pending candidate step.

## Input

The host owns the shared keyboard/gamepad bindings through `resolveInput()` and
resolves descriptor-authored `player_actions` through `resolvePlayerAction()`.
The candidate module receives each action first; unhandled input uses the generic
fallback.

For pointer input, call `toCanvasPoint(event)` instead of using raw CSS pixels.
The host accounts for Canvas CSS scaling and establishes pointer capture for the
active pointer.

## Audio

`audio` is a lazy, muteable Web Audio helper with `tone()` and `noise()` methods.
It creates no audio context until used, uses synthesized oscillator/noise sources
only, and degrades to silence when Web Audio is unavailable or fails.

## Browser QA

`window.__scv.getState()` remains the shared host-state hook.
`window.__scv.getGameState()` returns the active candidate module debug state.
The host dispatches `scv:statechange` on `window` after state changes. Candidate
code can request the same event after internal-only changes with
`debug.stateChanged(reason, detail)`.
