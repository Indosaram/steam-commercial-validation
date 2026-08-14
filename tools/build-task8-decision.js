
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateOwnerSelectionInput, buildOwnerSelectionDecision } from '../core/owner-selection.js';
import { renderComparisonTable } from '../core/scorecard.js';
import { renderDecisionLog, buildDecisionRecord } from '../core/decision-log.js';

const inputPath = resolve('../evidence/steam-commercial-concept-validation/task-8-owner-selection/owner-selection-input.json');
const input = JSON.parse(readFileSync(inputPath, 'utf8'));

const identitiesPath = resolve('../evidence/steam-commercial-concept-validation/task-7-package-verify/candidate-package-identity-current.json');
const identities = JSON.parse(readFileSync(identitiesPath, 'utf8'));
const verifiedBuilds = Object.fromEntries(
  identities.map((item) => [
    item.concept_id,
    { build_id: item.current_build_id, build_hash: item.current_build_hash },
  ])
);

const validation = validateOwnerSelectionInput(input, { verifiedBuilds });
if (!validation.ok) {
  console.error('Validation failed:', validation.errors);
  process.exit(1);
}

const decision = buildOwnerSelectionDecision(input, { verifiedBuilds });
const outDir = resolve('../evidence/steam-commercial-concept-validation/task-8-owner-selection');

writeFileSync(resolve(outDir, 'FINALIST_SELECTION.json'), JSON.stringify(decision, null, 2) + '\n');
writeFileSync(resolve(outDir, 'scorecards.json'), JSON.stringify(input.scorecards, null, 2) + '\n');
writeFileSync(resolve(outDir, 'scorecards.md'), renderComparisonTable(input.scorecards) + '\n');

const decisionRecords = input.scorecards.map((card) => {
  const isFinalist = decision.finalists.some((f) => f.concept_id === card.concept_id);
  const finalistInfo = decision.finalists.find((f) => f.concept_id === card.concept_id);
  const nonPromoted = decision.non_promoted.find((np) => np.concept_id === card.concept_id);
  
  return buildDecisionRecord({
    session: {
      concept_id: card.concept_id,
      build_id: card.build_id,
      session_id: card.session_id,
    },
    decision: isFinalist ? 'promote' : 'revise',
    rationale: isFinalist ? finalistInfo.rationale : nonPromoted.reason,
    known_limitations: ['internal 10-15 minute slice only', 'commercial full game scoping required in Task 9'],
    recorded_at: input.generated_at,
  });
});

writeFileSync(resolve(outDir, 'decision-log.json'), JSON.stringify(decisionRecords, null, 2) + '\n');
writeFileSync(resolve(outDir, 'decision-log.md'), renderDecisionLog(decisionRecords, { title: 'Task 8 Owner Direct-Play Selection Decision Log' }) + '\n');

console.log('Task 8 Selection successfully validated and built:');
console.log('Finalists:', decision.finalists.map(f => f.concept_id));
console.log('Non-promoted:', decision.non_promoted.map(np => np.concept_id));
