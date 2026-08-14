import test from 'node:test';
import assert from 'node:assert/strict';

import { blockedSteps, validateDescriptor } from '../../core/candidate.js';
import { validateSession } from '../../core/telemetry.js';
import descriptor from '../../candidates/fake_it_till_you_clean_it/scenario.js';
import { replay } from '../../candidates/fake_it_till_you_clean_it/replay.js';

const CONCEPT = 'fake_it_till_you_clean_it';

test('descriptor models the courtyard plus glamour vanity expansion with ordered cleanup, clues, disposition, and next hook', () => {
  assert.equal(validateDescriptor(descriptor, CONCEPT).ok, true);
  assert.equal(descriptor.set.id, 'gold_pool_courtyard');
  assert.match(descriptor.set.description, /two-area cleanup route/i);
  assert.deepEqual(descriptor.set.areas.map((area) => area.id), [
    'gold_pool_courtyard',
    'glamour_vanity',
  ]);
  assert.deepEqual(descriptor.replay, descriptor.steps.map((step) => step.id));

  const [objective, debris, ...rest] = descriptor.steps;
  assert.equal(objective.id, 'inspect_objective');
  assert.equal(objective.kind, 'inspect');
  assert.equal(debris.id, 'collect_debris');
  assert.equal(debris.debris_cleared, true);

  const cleaning = rest.filter((step) => Number.isInteger(step.cleaning_pass));
  assert.deepEqual(cleaning.map((step) => step.cleaning_pass), [1, 2, 3]);
  assert.deepEqual(cleaning.map((step) => step.id), [
    'drain_pool',
    'strip_basin',
    'strip_deck',
  ]);
  assert.deepEqual(cleaning.map((step) => step.requires), [
    ['collect_debris'],
    ['drain_pool'],
    ['strip_basin'],
  ]);

  const reveal = descriptor.steps.find((step) => step.kind === 'reveal');
  assert.equal(reveal.id, 'reveal_decayed_surface');
  assert.equal(reveal.requires[0], 'strip_deck');
  assert.match(reveal.description, /split running the length|black water staining|rebar/i);
  assert.match(reveal.staged_success_clue.proves, /camera framing|glamour vanity/i);

  const vanity = descriptor.steps.find((step) => step.id === 'restore_glamour_vanity');
  assert.equal(vanity.kind, 'core_action');
  assert.equal(vanity.area_id, 'glamour_vanity');
  assert.deepEqual(vanity.requires, ['reveal_decayed_surface']);
  assert.equal(vanity.cleaning_pass, undefined);
  assert.equal(vanity.restoration_extension, 1);
  assert.notEqual(vanity.transformation.before, vanity.transformation.after);
  assert.match(vanity.description, /safe seam|latch/i);

  const receipt = descriptor.steps.find((step) => step.id === 'safe_receipt_clue');
  assert.equal(receipt.kind, 'inspect');
  assert.equal(receipt.area_id, 'glamour_vanity');
  assert.deepEqual(receipt.requires, ['restore_glamour_vanity']);
  assert.notEqual(receipt.transformation.before, receipt.transformation.after);
  assert.equal(receipt.evidence_clue.id, 'safe_receipt_clue');
  assert.match(receipt.evidence_clue.proves, /rented|owning|permanent wealth/i);

  const choice = descriptor.steps.find((step) => step.kind === 'choice');
  assert.deepEqual(choice.options.map((option) => option.id), ['preserve', 'discard', 'archive']);
  assert.equal(choice.default_option, 'archive');
  assert.deepEqual(choice.requires, ['safe_receipt_clue']);
  assert.equal(choice.evidence_object, 'staging_evidence_bundle');

  assert.notEqual(descriptor.visible_proof.before, descriptor.visible_proof.after);
  assert.match(descriptor.next_hook.detail, /wardrobe studio|not reachable/i);
});

test('vanity, receipt, evidence, reveal, and completion paths stay incomplete with named prerequisites', () => {
  const choiceBlocked = blockedSteps(descriptor, [
    'inspect_objective',
    'collect_debris',
    'drain_pool',
    'strip_basin',
    'strip_deck',
    'reveal_decayed_surface',
    'restore_glamour_vanity',
  ]).find((step) => step.id === 'disposition');
  assert.deepEqual(choiceBlocked?.missing, ['safe_receipt_clue']);

  const receiptBlocked = blockedSteps(descriptor, [
    'inspect_objective',
    'collect_debris',
    'drain_pool',
    'strip_basin',
    'strip_deck',
    'reveal_decayed_surface',
  ]).find((step) => step.id === 'safe_receipt_clue');
  assert.deepEqual(receiptBlocked?.missing, ['restore_glamour_vanity']);

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

test('deterministic replay exports a valid 10-15 minute expanded session and recovers after an invalid first action', () => {
  const first = replay({ seed: 31 });
  const second = replay({ seed: 31 });
  assert.deepEqual(first.events, second.events);
  assert.equal(validateSession(first.events).ok, true);
  assert.ok(first.active_ms >= 10 * 60_000 && first.active_ms <= 15 * 60_000);
  assert.equal(first.events.filter((event) => event.event === 'core_action_completed').length, 5);
  assert.ok(first.events.some((event) => event.event === 'next_hook_shown'));
  assert.ok(first.events.some(
    (event) => event.event === 'inspect_performed' && event.payload.step_id === 'safe_receipt_clue',
  ));

  const recovery = replay({ seed: 31, order: ['disposition', ...descriptor.replay] });
  assert.equal(recovery.blocked[0].attempted, 'disposition');
  assert.deepEqual(recovery.blocked[0].missing, ['safe_receipt_clue']);
  assert.equal(validateSession(recovery.events).ok, true);
  assert.equal(recovery.outstanding_steps.length, 0);
});
