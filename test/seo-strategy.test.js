import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assessStrategy, normalizeStrategy, SEO_CRITERIA, SEO_FIELDS, draftHash, strategyPanel } from '../scripts/content-dashboard/seo-strategy.js';
import { ContentDashboardActions } from '../scripts/content-dashboard/actions.js';
import { getDashboardConfig } from '../scripts/content-dashboard/config.js';

const complete = () => ({ cluster: 'music-rights', ...Object.fromEntries(SEO_FIELDS.map(([key]) => [key, 'Specific editorial evidence'])), scores: Object.fromEntries(SEO_CRITERIA.map(([key,,max]) => [key,max])), notes: Object.fromEntries(SEO_CRITERIA.map(([key]) => [key,'Reviewed against sources'])) });

test('advisory scores obey exact decision boundaries and missing evidence earns no points', () => {
  const full = complete();
  assert.equal(assessStrategy({}, full).score, 100);
  for (const [score, decision] of [[80,'Indexed article recommended'],[79,'Revise before indexing'],[60,'Revise before indexing'],[59,'Consider social/distribution post instead'],[40,'Consider social/distribution post instead'],[39,'Off-strategy for indexed article']]) {
    const plan = complete(); let remaining = score;
    for (const [key,,max] of SEO_CRITERIA) { plan.scores[key] = Math.min(max, remaining); remaining -= plan.scores[key]; }
    assert.equal(assessStrategy({},plan).decision, decision);
  }
  const missing = complete(); delete missing.audience;
  assert.equal(assessStrategy({}, missing).score,80);
  assert.equal(assessStrategy({}, {scores: full.scores}).score,0);
  assert.equal(normalizeStrategy({score_accuracy:999}).scores.accuracy,10);
  assert.equal(normalizeStrategy({score_accuracy:'NaN'}).scores.accuracy,0);
});

test('duplication, stale instructions, claims and changed drafts raise visible advisory warnings', () => {
  const run = { articleMarkdown: 'Install Core beta 20', claimLedger: {claims:[{status:'UNSUPPORTED'}]} };
  const result = assessStrategy(run,{...complete(),draftHash:draftHash('previous')},{currentRelease:'v0.1.0-beta.27',closest:[{similarity:1}]});
  assert.equal(result.warnings.length,4);
  assert.equal(result.score,100);
  assert.equal(result.advisoryOnly,true);
  const html = strategyPanel(result,'run-001','csrf',true);
  assert.match(html,/Review warning/);
  assert.doesNotMatch(html,/<(?:input|select|textarea|button)\b[^>]*\s(?:disabled|required)(?:\s|>)/);
  const escaped = strategyPanel(assessStrategy({}, {...complete(), audience:'<script>alert(1)</script>'}),'run-001','csrf',false);
  assert.doesNotMatch(escaped,/<script>/);
  assert.match(escaped,/&lt;script&gt;/);
  assert.doesNotMatch(escaped,/<form/);
});

test('saving a zero-score assessment writes only strategy/audit data and preserves founder approval', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'certifyd-seo-advisory-'));
  try {
    const config = getDashboardConfig({CONTENT_AGENT_ROOT:root,CONTENT_AGENT_OUTPUT_DIR:path.join(root,'outputs')});
    const actions = new ContentDashboardActions(config);
    const runId = 'seo-advisory-001'; const base = path.join(root,'outputs',runId);
    await fs.mkdir(path.join(base,'reviews'),{recursive:true});
    const manifest = JSON.stringify({currentStatus:'FOUNDER_APPROVED'});
    const review = JSON.stringify({reviewStatus:'FOUNDER_APPROVED'});
    await fs.writeFile(path.join(base,'publication-manifest.json'),manifest);
    await fs.writeFile(path.join(base,'reviews/founder-review.json'),review);
    await actions.saveSeoStrategy({actor:{id:'test',email:'editor@example.test',role:'editor'},runId,input:{}});
    assert.equal(await fs.readFile(path.join(base,'publication-manifest.json'),'utf8'),manifest);
    assert.equal(await fs.readFile(path.join(base,'reviews/founder-review.json'),'utf8'),review);
    const run = await actions.runs.readRun(runId);
    assert.equal(run.seoStrategy.advisoryOnly,true);
    assert.equal(assessStrategy(run,run.seoStrategy).score,0);
    assert.equal(run.summary.status,'FOUNDER_APPROVED');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
