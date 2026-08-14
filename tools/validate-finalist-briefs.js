
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const briefPath = resolve('../evidence/steam-commercial-concept-validation/task-9-finalist-slices/finalist-slice-briefs.json');
const data = JSON.parse(readFileSync(briefPath, 'utf8'));

const errors = [];

if (!data.finalists || data.finalists.length !== 2) {
  errors.push('Finalist briefs must contain exactly 2 promoted concepts');
}

for (const [idx, f] of data.finalists.entries()) {
  const prefix = `finalist[${idx}] (${f.concept_id})`;
  if (!f.loops || f.loops.length !== 3) {
    errors.push(`${prefix} must contain exactly 3 varied loops`);
  }
  for (const l of f.loops || []) {
    if (!l.differentiated_mechanic) {
      errors.push(`${prefix} loop ${l.loop_id} missing differentiated_mechanic`);
    }
  }
  if (!f.price_exposed_intent_prompt || f.price_exposed_intent_prompt.price_usd !== 14.99) {
    errors.push(`${prefix} must include price_exposed_intent_prompt at $14.99`);
  }
  if (!f.asset_content_cap) {
    errors.push(`${prefix} must declare asset_content_cap`);
  }
}

if (errors.length > 0) {
  console.error('Task 9 validation failed:', errors);
  process.exit(1);
}

console.log('Task 9 Finalist Brief Validation: PASS (2/2 finalists matched, 3 varied loops each, $14.99 price exposure confirmed)');
