import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assessStrategy, normalizeStrategy, SEO_CRITERIA, SEO_FIELDS, draftHash, strategyPanel, SEO_PROPOSAL_SCHEMA, readSeoCorpus, buildSeoProposalContext, validateSeoProposal, fallbackSeoProposal, seoProposalPanel } from '../scripts/content-dashboard/seo-strategy.js';
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

// The model response fixture is deliberately separate from the deterministic
// fallback: transport and validation can be tested without contacting an API.

const sampleCorpus = [
  {url:'https://certifyd.me/guides/music-metadata-checklist/',kind:'cornerstone',title:'Music metadata checklist',description:'Release identifiers and credits',headings:['ISRC'],body:'metadata recording songwriter ISRC identifiers credits music release'},
  {url:'https://certifyd.me/blog/rights-records/',kind:'article',title:'Rights records and credits',description:'Metadata records',headings:['Metadata'],body:'metadata recording songwriter credits release'},
];
const sampleRun = () => ({summary:{title:'Keep music metadata consistent',slug:'metadata-practice'},intake:{targetAudience:'Independent artists'},articleMarkdown:'# Keep music metadata consistent\n\nRecording identifiers, songwriter credits, metadata and ISRC records.',claimLedger:{claims:[]}});
const modelRaw = (packet, run) => {
  const fallback = fallbackSeoProposal(packet,run);
  const raw = Object.fromEntries(Object.keys(SEO_PROPOSAL_SCHEMA.properties).map(key=>[key,structuredClone(fallback[key])]));
  raw.plan = {...Object.fromEntries(Object.keys(SEO_PROPOSAL_SCHEMA.properties.plan.properties).map(key=>[key,raw.plan[key]])),...complete(),cluster:'music-rights'};
  raw.recommendations.cluster.clusterId='music-rights';
  for(const rec of Object.values(raw.recommendations))rec.confidence='high';
  raw.recommendations.duplication.confidence='medium';
  raw.recommendations.hubPromotion.confidence='low';
  return raw;
};

test('strict proposal schema requires separate confidence and structured links; decisions use the existing rubric', () => {
  const run=sampleRun(),packet=buildSeoProposalContext(run,sampleCorpus);
  const raw=modelRaw(packet,run);
  const result=validateSeoProposal(raw,packet,run);
  assert.equal(result.score,100);assert.equal(result.decision,'Indexed article recommended');
  assert.equal(result.recommendations.cluster.confidence,'high');
  assert.equal(result.recommendations.duplication.confidence,'medium');
  assert.equal(result.recommendations.hubPromotion.confidence,'low');
  assert.match(result.evidenceBasis,/Search Console evidence not supplied/);
  const bogusText=structuredClone(raw);bogusText.plan.cornerstone='Invented Creator Identity Guide';bogusText.plan.internalLinks='https://evil.example';
  const grounded=validateSeoProposal(bogusText,packet,run);assert.doesNotMatch(grounded.plan.cornerstone,/Invented/);assert.doesNotMatch(grounded.plan.internalLinks,/evil/);
  const unresolved=validateSeoProposal(raw,packet,{...run,claimLedger:{claims:[{text:'Unresolved',status:'NEEDS_REVIEW'}]}});assert.equal(unresolved.plan.unsupportedClaims,true);assert.equal(unresolved.recommendations.indexing.confidence,'low');
  const missing=structuredClone(raw);delete missing.recommendations.indexing.confidence;
  assert.throws(()=>validateSeoProposal(missing,packet,run),/missing confidence/);
  const invented=structuredClone(raw);invented.recommendations.cornerstone.url='https://certifyd.me/guides/creator-identity/';
  assert.throws(()=>validateSeoProposal(invented,packet,run),/Unknown cornerstone/);
  const noEvidence=structuredClone(raw);noEvidence.recommendations.cluster.evidenceRefs=[];
  assert.equal(validateSeoProposal(noEvidence,packet,run).recommendations.cluster.confidence,'low');
  const missingNotes=structuredClone(raw);missingNotes.plan.notes=Object.fromEntries(SEO_CRITERIA.map(([k])=>[k,'']));
  assert.equal(validateSeoProposal(missingNotes,packet,run).score,0);
  const fakeGsc=structuredClone(raw);fakeGsc.gscImpressions=500;
  assert.throws(()=>validateSeoProposal(fakeGsc,packet,run),/unknown gscImpressions/);
});

test('link validation permits all three grounded directions and rejects invented URLs, missing anchors and wrong directions', () => {
  const run=sampleRun(),packet=buildSeoProposalContext(run,sampleCorpus),raw=modelRaw(packet,run);
  raw.recommendedLinks=[
    {sourceUrl:packet.draftUrl,destinationUrl:sampleCorpus[0].url,anchorText:'release checklist',reason:'Practical next step for release records',linkType:'article → cornerstone'},
    {sourceUrl:packet.draftUrl,destinationUrl:sampleCorpus[1].url,anchorText:'rights records',reason:'Supporting context',linkType:'article → article'},
    {sourceUrl:sampleCorpus[0].url,destinationUrl:packet.draftUrl,anchorText:'metadata consistency example',reason:'Supporting example after this draft is published',linkType:'cornerstone → article'},
    {sourceUrl:sampleCorpus[1].url,destinationUrl:packet.draftUrl,anchorText:'a release-sheet example',reason:'Incoming contextual link after this draft is published',linkType:'article → article'},
  ];
  assert.equal(validateSeoProposal(raw,packet,run).recommendedLinks.length,4);
  for(const change of [l=>l.destinationUrl='https://evil.example/',l=>l.anchorText='',l=>l.linkType='article → article',l=>l.destinationUrl='javascript:alert(1)']) {
    const invalid=structuredClone(raw);change(invalid.recommendedLinks[0]);assert.throws(()=>validateSeoProposal(invalid,packet,run));
  }
  const fabricated=structuredClone(raw);fabricated.recommendations.indexing.evidenceRefs=['gsc:500-impressions'];
  assert.throws(()=>validateSeoProposal(fabricated,packet,run),/Invented evidence/);
});

test('body retrieval scans the complete published corpus, includes guides and excludes drafts/noindex', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'certifyd-seo-corpus-'));
  try {
    await fs.mkdir(path.join(root,'content/blog'),{recursive:true});await fs.mkdir(path.join(root,'content/guides'),{recursive:true});
    for(let i=0;i<16;i++)await fs.writeFile(path.join(root,`content/blog/article-${String(i).padStart(2,'0')}.md`),`---\ntitle: "Story ${i}"\nslug: "story-${i}"\nstatus: "published"\n---\n\n${i===15?'metadata recording songwriter credits ISRC music release':'unrelated football stadium'}`);
    await fs.writeFile(path.join(root,'content/blog/noindex.md'),'---\ntitle: "Noindex"\nslug: "noindex"\nstatus: "published"\nnoindex: true\n---\nmetadata');
    await fs.writeFile(path.join(root,'content/blog/draft.md'),'---\ntitle: "Draft"\nslug: "draft"\nstatus: "draft"\n---\nmetadata');
    await fs.writeFile(path.join(root,'content/guides/guide.md'),'---\ntitle: "Guide"\nslug: "guide"\nstatus: "published"\n---\nrecording credits');
    const corpus=await readSeoCorpus(root);assert.equal(corpus.length,17);
    const packet=buildSeoProposalContext(sampleRun(),corpus);
    assert.ok(packet.context.closestArticles.some(p=>p.url.endsWith('/story-15/')));
    assert.equal(packet.context.corpusCoverage.publishedPagesScanned,17);
    assert.ok(JSON.stringify(packet.context).length<=18000);
    assert.ok(packet.context.guides.some(g=>g.url.endsWith('/guide/')));
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

async function seoActionsFixture() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'certifyd-seo-actions-'));
  const config=getDashboardConfig({CONTENT_AGENT_ROOT:root,CONTENT_AGENT_OUTPUT_DIR:path.join(root,'outputs'),CONTENT_MODEL_PROVIDER:'deterministic'});
  const actions=new ContentDashboardActions(config);const actor={id:'editor',email:'editor@example.test',role:'editor'};
  const created=await actions.createManualDraft({actor,form:new URLSearchParams({title:'Music metadata consistency',articleMarkdown:'# Music metadata consistency\n\nMetadata recording credits songwriter ISRC release.'})});
  return {root,actions,actor,runId:created.runId,base:path.join(root,'outputs',created.runId)};
}

test('new manual drafts get a pending proposal; accept, reject, edit and reassess preserve human control and publication state', async () => {
  const f=await seoActionsFixture();
  try {
    let run=await f.actions.runs.readRun(f.runId);assert.equal(run.seoProposal.mode,'lexical-fallback');assert.deepEqual(run.seoStrategy,{});
    for(const rec of Object.values(run.seoProposal.recommendations))assert.equal(rec.confidence,'low');
    const state=await fs.readFile(path.join(f.base,'publication-manifest.json'),'utf8');const founder=await fs.readFile(path.join(f.base,'reviews/founder-review.json'),'utf8');
    await f.actions.reviewSeoProposal({...f,proposalId:run.seoProposal.proposalId,decision:'accept'});
    const accepted=await fs.readFile(path.join(f.base,'seo/strategy.json'),'utf8');
    await assert.rejects(f.actions.reviewSeoProposal({...f,proposalId:run.seoProposal.proposalId,decision:'accept'}),/missing, replaced or rejected/);
    await f.actions.queueSeoAssessment(f);
    assert.equal(await fs.readFile(path.join(f.base,'seo/strategy.json'),'utf8'),accepted);
    run=await f.actions.runs.readRun(f.runId);
    await f.actions.reviewSeoProposal({...f,proposalId:run.seoProposal.proposalId,decision:'reject'});
    assert.equal(await fs.readFile(path.join(f.base,'seo/strategy.json'),'utf8'),accepted);
    await f.actions.queueSeoAssessment(f);run=await f.actions.runs.readRun(f.runId);
    await f.actions.saveSeoStrategy({...f,input:{...complete(),proposalId:run.seoProposal.proposalId,cluster:'creator-ownership'}});
    run=await f.actions.runs.readRun(f.runId);assert.equal(run.seoStrategy.cluster,'creator-ownership');assert.equal(run.seoStrategy.editedFromProposal,true);
    assert.equal(run.seoStrategy.recommendations,undefined);assert.equal(run.seoProposalReview.decision,'edited');
    assert.match(seoProposalPanel(run,assessStrategy(run,run.seoStrategy),f.runId,'csrf',true),/Accepted assessment/);
    assert.equal(await fs.readFile(path.join(f.base,'publication-manifest.json'),'utf8'),state);
    assert.equal(await fs.readFile(path.join(f.base,'reviews/founder-review.json'),'utf8'),founder);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('draft changes retain accepted hash warnings, trigger a new proposal, and reject a stale form', async () => {
  const f=await seoActionsFixture();
  try{
    let run=await f.actions.runs.readRun(f.runId);const oldProposal=run.seoProposal;
    await f.actions.reviewSeoProposal({...f,proposalId:oldProposal.proposalId,decision:'accept'});
    const accepted=await fs.readFile(path.join(f.base,'seo/strategy.json'),'utf8');
    await f.actions.saveArticleMarkdown({...f,articleMarkdown:run.articleMarkdown+'\nAdditional useful release advice.\n'});
    run=await f.actions.runs.readRun(f.runId);
    assert.notEqual(run.seoProposal.proposalId,oldProposal.proposalId);
    assert.equal(run.seoProposal.draftHash,draftHash(run.articleMarkdown));
    assert.equal(await fs.readFile(path.join(f.base,'seo/strategy.json'),'utf8'),accepted);
    assert.ok(assessStrategy(run,run.seoStrategy).warnings.some(w=>w.includes('draft changed')));
    await assert.rejects(f.actions.reviewSeoProposal({...f,proposalId:oldProposal.proposalId,decision:'accept'}),/missing, replaced or rejected/);
    await fs.appendFile(path.join(f.base,'final/article.md'),'\nChanged again.');
    await assert.rejects(f.actions.reviewSeoProposal({...f,proposalId:run.seoProposal.proposalId,decision:'accept'}),/stale/);
    assert.match(seoProposalPanel(await f.actions.runs.readRun(f.runId),assessStrategy(run,run.seoStrategy),f.runId,'csrf',true),/different draft hash/);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('a draft edited while the model is running never receives the old result', async () => {
  const f=await seoActionsFixture();
  try{
    let release,started;const start=new Promise(resolve=>started=resolve);
    const provider={providerName:'test-model',modelName:'test',proposeSeoStrategy:async(input,packet)=>{started();await new Promise(resolve=>release=resolve);return modelRaw(packet,sampleRun());}};
    const old=(await f.actions.runs.readRun(f.runId)).seoProposal.proposalId;
    const pending=f.actions.queueSeoAssessment({...f,provider});await start;
    await fs.appendFile(path.join(f.base,'final/article.md'),'\nNew body while assessment runs.');release();await pending;
    const run=await f.actions.runs.readRun(f.runId);
    assert.equal(run.seoProposal.proposalId,old);assert.equal(run.seoProposalStatus.state,'stale');
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('same-hash requests deduplicate and a superseded model result cannot overwrite a newer proposal', async () => {
  const f=await seoActionsFixture();
  try{
    let release,started,calls=0;const start=new Promise(resolve=>started=resolve);
    const provider={providerName:'fixture-model',modelName:'fixture',proposeSeoStrategy:async(input,packet)=>{
      calls++;if(calls===1){started();await new Promise(resolve=>release=resolve);}return modelRaw(packet,sampleRun());
    }};
    const pending=f.actions.queueSeoAssessment({...f,provider});await start;
    const duplicate=await f.actions.queueSeoAssessment({...f,provider});assert.match(duplicate.output,/already running/);assert.equal(calls,1);
    await fs.appendFile(path.join(f.base,'final/article.md'),'\nA distinct newer draft.');
    await f.actions.queueSeoAssessment({...f,provider});
    const latest=await f.actions.runs.readRun(f.runId);const newest=latest.seoProposal.proposalId;assert.equal(latest.seoProposal.mode,'brain-model');
    release();await pending;
    const after=await f.actions.runs.readRun(f.runId);assert.equal(after.seoProposal.proposalId,newest);assert.equal(after.seoProposalStatus.requestId,newest);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('invalid model output falls back explicitly without inventing acceptance or high confidence', async () => {
  const f=await seoActionsFixture();
  try{
    await f.actions.queueSeoAssessment({...f,provider:{providerName:'fixture',modelName:'fixture',proposeSeoStrategy:async()=>({garbage:true})}});
    const run=await f.actions.runs.readRun(f.runId);assert.equal(run.seoProposal.mode,'lexical-fallback');assert.deepEqual(run.seoStrategy,{});
    assert.ok(run.seoProposal.limitations.length);for(const rec of Object.values(run.seoProposal.recommendations))assert.equal(rec.confidence,'low');
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
