#!/usr/bin/env node
/** Task 7 evidence-side package verifier. Does not alter candidate semantics. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONCEPT_IDS } from '../core/concepts.js';
import { buildIdentity, checkCandidateIsolation } from '../core/build-identity.js';
import { INPUT_MAP } from '../core/input.js';
import { validateSession } from '../core/telemetry.js';

const REQUIRED = ['session_started','core_action_completed','signature_reveal_seen','choice_committed','scenario_completed','next_hook_shown','session_ended'];

function args(argv) {
  const out = { root: null, seed: null, order: null, verifyOnly: false };
  for (let i=2;i<argv.length;i++) {
    if (argv[i] === '--root') out.root = argv[++i];
    else if (argv[i] === '--seed') out.seed = Number(argv[++i]);
    else if (argv[i] === '--order') out.order = argv[++i]?.split(',');
    else if (argv[i] === '--verify-only') out.verifyOnly = true;
    else if (argv[i] === '--help') {
      process.stdout.write('usage: node tools/package-verify.js --root DIR --seed N --order id,id,id,id,id [--verify-only]\n');
      process.exit(0);
    } else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!out.root) throw new Error('--root is required');
  if (!Number.isFinite(out.seed)) throw new Error('--seed must be a number');
  if (!out.order || out.order.length !== 5 || new Set(out.order).size !== 5 || out.order.some((x)=>!CONCEPT_IDS.includes(x))) {
    throw new Error('--order must contain each of the five concept IDs exactly once');
  }
  return out;
}
const json = (p,v) => writeFileSync(p, `${JSON.stringify(v,null,2)}\n`);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

async function replay(id, seed) {
  if (id === 'fake_it_till_you_clean_it') {
    const m = await import('../candidates/fake_it_till_you_clean_it/replay.js');
    return m.replay({ seed });
  }
  if (id === 'return_to_sender') {
    const m = await import('../candidates/return_to_sender/replay.js');
    const d = (await import('../candidates/return_to_sender/scenario.js')).default;
    return m.runReplay(d, { label: `task7-${seed}`, script: m.validScript(d) });
  }
  if (id === 'theme_park_liquidation') {
    const m = await import('../candidates/theme_park_liquidation/replay.js');
    return m.runReplay({ seed, mode: 'valid' });
  }
  if (id === 'cursed_secondhand') {
    const m = await import('../candidates/cursed_secondhand/replay.js');
    return m.runReplay({ seed });
  }
  const m = await import('../candidates/panic_at_the_pawnshop/replay.js');
  return m.runReplay({ seed, mode: 'evidence_supported' });
}

function verifyCandidate(root, id) {
  const dir = join(root, 'candidates', id);
  const errors = [];
  const requiredFiles = ['package-manifest.json','telemetry.session.json','before.png','after.png','end-state.png','clean-profile-receipt.json','reset-relaunch.json'];
  for (const f of requiredFiles) if (!existsSync(join(dir,f))) errors.push(`missing ${f}`);
  let manifest, session, receipt, reset;
  for (const [name,set] of [['package-manifest.json',(v)=>manifest=v],['telemetry.session.json',(v)=>session=v],['clean-profile-receipt.json',(v)=>receipt=v],['reset-relaunch.json',(v)=>reset=v]]) {
    try { set(JSON.parse(readFileSync(join(dir,name),'utf8'))); } catch (e) { errors.push(`${name}: unreadable or invalid JSON`); }
  }
  const ident = buildIdentity(id);
  if (manifest && (manifest.concept_id !== id || manifest.build_id !== ident.build_id || manifest.build_hash !== ident.build_hash)) errors.push('manifest identity mismatch');
  if (manifest && JSON.stringify(manifest.controls) !== JSON.stringify(INPUT_MAP)) errors.push('controls differ from shared mapping');
  if (session) {
    const v = validateSession(session.events ?? []);
    if (!v.ok) errors.push(...v.errors.map((e)=>`telemetry: ${e}`));
    const names = (session.events ?? []).map((e)=>e.event);
    for (const e of REQUIRED) if (!names.includes(e)) errors.push(`missing required event ${e}`);
    const active = Number(session.active_ms ?? session.events?.find((e)=>e.event==='scenario_completed')?.payload?.active_ms);
    if (!(active >= 600000 && active <= 900000)) errors.push(`active_ms outside 10-15 minutes: ${active}`);
    if (session.build_id !== ident.build_id || session.build_hash !== ident.build_hash) errors.push('telemetry export identity mismatch');
  }
  if (receipt && !(receipt.clean_profile && receipt.chrome_cdp && receipt.launch_ok && receipt.invalid_outcome_visible)) errors.push('clean-profile receipt incomplete');
  if (reset && !(reset.reset_ok && reset.relaunch_ok && reset.fresh_after_reset)) errors.push('reset/relaunch failed');
  return { concept_id:id, ok:errors.length===0, errors, build_id:ident.build_id, build_hash:ident.build_hash, active_minutes:session ? Number(((session.active_ms ?? session.events?.find((e)=>e.event==='scenario_completed')?.payload?.active_ms)/60000).toFixed(2)) : null };
}

async function main() {
  let a; try { a=args(process.argv); } catch(e) { process.stderr.write(`${e.message}\n`); process.exit(2); }
  const root=resolve(a.root); mkdirSync(root,{recursive:true});
  if (!a.verifyOnly) {
    mkdirSync(join(root,'candidates'),{recursive:true});
    const identities=[];
    for (const id of a.order) {
      const dir=join(root,'candidates',id); mkdirSync(dir,{recursive:true});
      const ident=buildIdentity(id); identities.push(ident);
      const run=await replay(id,a.seed);
      const active=run.active_ms ?? run.events?.find((e)=>e.event==='scenario_completed')?.payload?.active_ms;
      const session={...run, concept_id:id, build_id:ident.build_id, build_hash:ident.build_hash, core_hash:ident.core_hash, active_ms:active};
      json(join(dir,'telemetry.session.json'),session);
      json(join(dir,'package-manifest.json'),{
        package_version:1, concept_id:id, internal_build:true, public_demo:false,
        launch_command:`node tools/launch.js --concept ${id}`,
        reset_path:'R / Reset profile button', telemetry_export_path:'Export session JSON', scorecard_path:'shared owner scorecard export (Task 8)',
        controls:INPUT_MAP, build_id:ident.build_id, build_hash:ident.build_hash, core_hash:ident.core_hash,
        known_limitations:['internal browser validation shell; not release art or performance evidence','scripted authored scenario; no public Steam integration','owner ratings intentionally deferred to Task 8']
      });
    }
    json(join(root,'package-identities.json'),identities);
  }
  const results=a.order.map((id)=>verifyCandidate(root,id));
  const hashes=results.filter((r)=>r.build_hash).map((r)=>r.build_hash);
  const isolation=checkCandidateIsolation();
  const complete=results.every((r)=>r.ok) && new Set(hashes).size===5 && isolation.ok;
  const summary={schema_version:1,seed:a.seed,order:a.order,generated_at:new Date().toISOString(),candidate_count:results.length,complete,comparison_complete:complete,unique_build_hashes:new Set(hashes).size===5,candidate_isolation:isolation,results};
  json(join(root,'verification-summary.json'),summary);
  writeFileSync(join(root,'comparison-table.csv'),['concept_id,build_id,build_hash,active_minutes,required_events,known_limitations,test_result',...results.map((r)=>`${r.concept_id},${r.build_id},${r.build_hash},${r.active_minutes},${r.ok?'complete':'incomplete'},see package-manifest.json,${r.ok?'PASS':'FAIL'}`)].join('\n')+'\n');
  process.stdout.write(`${JSON.stringify(summary,null,2)}\n`);
  process.exit(complete?0:1);
}
main();
