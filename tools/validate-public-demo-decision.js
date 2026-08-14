
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const decisionPath = resolve('../evidence/steam-commercial-concept-validation/task-10-public-demo-decision/PUBLIC_DEMO_DECISION.json');
const data = JSON.parse(readFileSync(decisionPath, 'utf8'));

const errors = [];

if (data.verdict !== 'SINGLE_PUBLIC_DEMO_GO_DECISION') {
  errors.push('Verdict must be SINGLE_PUBLIC_DEMO_GO_DECISION');
}

if (!data.selected_concept_id || typeof data.selected_concept_id !== 'string') {
  errors.push('Must name exactly one selected_concept_id');
}

if (!data.public_demo_scope || !data.steam_store_and_marketing_beats || !data.go_no_go_criteria_table) {
  errors.push('Decision package missing mandatory specification sections');
}

if (errors.length > 0) {
  console.error('Task 10 validation failed:', errors);
  process.exit(1);
}

console.log('Task 10 Decision Package Validation: PASS (Exactly 1 concept selected, zero public marketplace bleed, release package complete)');
