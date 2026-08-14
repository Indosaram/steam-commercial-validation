import test from 'node:test';
import assert from 'node:assert/strict';

import { blockedSteps, validateDescriptor } from '../../core/candidate.js';
import { validateSession } from '../../core/telemetry.js';
import descriptor from '../../candidates/fake_it_till_you_clean_it/scenario.js';
import { replay } from '../../candidates/fake_it_till_you_clean_it/replay.js';

const CONCEPT = 'fake_it_till_you_clean_it';

test('descriptor models one gold courtyard, objective, debris, three ordered cleaning passes, reveal, disposition, and next hook', () => {
  assert.equal(validateDescriptor(descriptor, CONCEPT).ok, true);
  assert.equal(descriptor.set.id, 'gold_pool_courtyard');
  assert.match(descriptor.set.description, /single enclosed courtyard/i);
  assert.deepEqual(descriptor.replay, descriptor.steps.map((step) => step.id));

  const [objective, debris, ...rest] = descriptor.steps;
  assert.equal(objective.id, 'inspect_objective');
  assert.equal(objective.kind, 'inspect');
  assert.equal(debris.id, 'collect_debris');
  assert.equal(debris.debris_cleared, true);

  const cleaning = rest.filter((step) => Number.isInteger(step.cleaning_pass));
  assert.deepEqual(cleaning.map((step) => step.cleaning_pass), [1, 2, 3]);
  assert.deepEqual(cleaning.map((step) => step.id), ['drain_pool', 'strip_basin', 'strip_deck']);
  assert.deepEqual(cleaning.map((step) => step.requires), [
    ['collect_debris'], ['drain_pool'], ['strip_basin'],
  ]);

  const reveal = descriptor.steps.find((step) => step.kind === 'reveal');
  assert.equal(reveal.id, 'reveal_decayed_surface');
  assert.equal(reveal.requires[0], 'strip_deck');
  assert.match(reveal.description, /split running the length|black water staining|rebar showing/i);
  assert.match(reveal.staged_success_clue.proves, /camera framing|staged/i);
  assert.notEqual(descriptor.visible_proof.before, descriptor.visible_proof.after);

  const choice = descriptor.steps.find((step) => step.kind === 'choice');
  assert.deepEqual(choice.options.map((option) => option.id), ['preserve', 'discard', 'archive']);
  assert.equal(choice.default_option, 'archive');
  assert.equal(choice.requires[0], reveal.id);
  assert.match(descriptor.next_hook.detail, /guest wing|not reachable/i);
});

test('invalid evidence, reveal, and completion paths stay incomplete with named prerequisites', () => {
  const choiceBlocked = blockedSteps(descriptor, [
    'inspect_objective', 'collect_debris', 'drain_pool', 'strip_basin', 'strip_deck',
  ]).find((step) => step.id === 'disposition');
  assert.deepEqual(choiceBlocked?.missing, ['reveal_decayed_surface']);

  const revealBlocked = blockedSteps(descriptor, ['inspect_objective'])
    .find((step) => step.id === 'reveal_decayed_surface');
  assert.deepEqual(revealBlocked?.missing, ['strip_deck']);

  for (const invalid of descriptor.invalid_paths) {
    const run = replay({ seed: 23, order: [...invalid.completed, invalid.attempt] });
    const denial = run.events.find(
      (event) => event.event === 'invalid_action_blocked' && event.payload.attempted === invalid.attempt,
    );
    assert.deepEqual(denial?.payload.missing, invalid.expect_missing);
    assert.equal(run.events.some((event) => event.event === 'scenario_completed'), false);
    assert.ok(run.outstanding_steps.length > 0);
  }
});

test('deterministic replay exports a valid 10-15 minute completed session and recovers after an invalid first action', () => {
  const first = replay({ seed: 31 });
  const second = replay({ seed: 31 });
  assert.deepEqual(first.events, second.events);
  assert.equal(validateSession(first.events).ok, true);
  assert.ok(first.active_ms >= 10 * 60_000 && first.active_ms <= 15 * 60_000);
  assert.equal(first.events.filter((event) => event.event === 'core_action_completed').length, 4);
  assert.ok(first.events.some((event) => event.event === 'next_hook_shown'));

  const recovery = replay({ seed: 31, order: ['disposition', ...descriptor.replay] });
  assert.equal(recovery.blocked[0].attempted, 'disposition');
  assert.deepEqual(recovery.blocked[0].missing, ['reveal_decayed_surface']);
  assert.equal(validateSession(recovery.events).ok, true);
  assert.equal(recovery.outstanding_steps.length, 0);
});
