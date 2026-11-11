import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { escapeHtml } from './security.js';
import { BLOG_TOPICS } from '../blog-topics.js';

export const SEO_CRITERIA = [
  ['topicFit', 'Clear fit with a Certifyd topic cluster', 20],
  ['audienceProblem', 'Specific searcher/audience problem answered', 20],
  ['usefulness', 'Original evidence, expertise or practical usefulness', 20],
  ['linkPlan', 'Named cornerstone and internal-link plan', 15],
  ['distinctPurpose', 'Distinct purpose versus existing articles', 15],
  ['accuracy', 'Accurate claims, credible sources and useful next step', 10],
];
export const SEO_FIELDS = [
  ['audience', 'Intended audience'], ['intent', 'Search/audience intent and problem answered'],
  ['evidence', 'Original evidence, expertise or practical usefulness'],
  ['cornerstone', 'Cornerstone supported (name and URL)'], ['internalLinks', 'Proposed internal links (URLs and purpose)'],
  ['closestArticles', 'Closest existing articles (URLs and differences)'], ['duplicationRisk', 'Duplication risk and resolution'],
  ['indexReason', 'Why this deserves an indexed page rather than only social distribution'],
  ['accuracyNotes', 'Claim/source review and useful next action'],
];
const REQUIREMENTS = { topicFit: ['cluster'], audienceProblem: ['audience', 'intent'], usefulness: ['evidence'], linkPlan: ['cornerstone', 'internalLinks'], distinctPurpose: ['closestArticles', 'duplicationRisk', 'indexReason'], accuracy: ['accuracyNotes'] };
export const draftHash = markdown => crypto.createHash('sha256').update(String(markdown || '')).digest('hex');

export function normalizeStrategy(input = {}) {
  const result = { schemaVersion: 1, advisoryOnly: true, cluster: BLOG_TOPICS.some(t => t.id === input.cluster) ? input.cluster : '', scores: {}, notes: {} };
  for (const [key] of SEO_FIELDS) result[key] = String(input[key] || '').trim().slice(0, 3000);
  for (const [key, , max] of SEO_CRITERIA) {
    const number = Number(input[`score_${key}`] ?? input.scores?.[key] ?? 0);
    result.scores[key] = Number.isFinite(number) ? Math.min(max, Math.max(0, Math.round(number))) : 0;
    result.notes[key] = String(input[`note_${key}`] ?? input.notes?.[key] ?? '').trim().slice(0, 1500);
  }
  for (const key of ['substantialDuplication', 'staleInstructions', 'unsupportedClaims']) result[key] = input[key] === true || input[key] === 'true' || input[key] === 'on';
  return result;
}

export function assessStrategy(run = {}, saved = {}, { currentRelease = '', closest = [] } = {}) {
  const plan = normalizeStrategy(saved);
  const markdown = run.articleMarkdown || run.draftMarkdown || '';
  const missing = [...SEO_FIELDS.map(([key]) => key), 'cluster'].filter(key => !plan[key]);
  const breakdown = SEO_CRITERIA.map(([key, label, max]) => ({ key, label, max, score: plan.notes[key] && REQUIREMENTS[key].every(f => plan[f]) ? plan.scores[key] : 0 }));
  const score = breakdown.reduce((sum, item) => sum + item.score, 0);
  const decision = score >= 80 ? 'Indexed article recommended' : score >= 60 ? 'Revise before indexing' : score >= 40 ? 'Consider social/distribution post instead' : 'Off-strategy for indexed article';
  const warnings = [];
  if (plan.substantialDuplication || closest.some(item => item.similarity >= .8)) warnings.push('Unresolved substantial duplication: compare the closest articles and document the distinct purpose.');
  const mentioned = [...markdown.matchAll(/(?:v?0\.1\.0-beta\.|\bbeta\s+)(\d+)/gi)].map(m => m[1]);
  const currentBeta = currentRelease.match(/beta\.(\d+)/)?.[1];
  if (plan.staleInstructions || (currentBeta && mentioned.some(n => n !== currentBeta) && /install|download|setup|command/i.test(markdown))) warnings.push('Potential stale instructions: older release references need an explicit historical context or current-release validation.');
  const claims = run.claimLedger?.claims || [];
  if (plan.unsupportedClaims || claims.some(c => ['BLOCKED', 'PROHIBITED', 'UNRESOLVED', 'UNSUPPORTED'].includes(String(c.status || '').toUpperCase()))) warnings.push('Unsupported or unresolved claims: review the claim ledger and original sources.');
  if (saved.draftHash && saved.draftHash !== draftHash(markdown)) warnings.push('This draft changed after assessment; review the saved scores and evidence again.');
  return { plan, score, decision, breakdown, missing, warnings, closest, advisoryOnly: true, assessedAt: saved.assessedAt || '', reviewer: saved.reviewer || '' };
}

// This is a title-similarity aid, not a semantic plagiarism or claim detector.
export async function closestExistingArticles(siteRoot, run) {
  const tokens = value => new Set(String(value).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const title = tokens(run.summary?.title || '');
  if (title.size < 3) return [];
  const entries = [];
  for (const group of ['blog', 'guides']) {
    const dir = path.join(siteRoot, 'content', group);
    for (const file of (await fs.readdir(dir).catch(() => [])).filter(f => f.endsWith('.md'))) {
      const { data } = matter(await fs.readFile(path.join(dir, file), 'utf8'));
      if (data.status !== 'published' || data.noindex === true || (group === 'blog' && data.slug === run.summary?.slug)) continue;
      const other = tokens(data.title || '');
      const intersection = [...title].filter(t => other.has(t)).length;
      const similarity = intersection / new Set([...title, ...other]).size;
      if (similarity > 0) entries.push({ title: data.title, url: `/${group}/${data.slug}/`, similarity });
    }
  }
  return entries.sort((a, b) => b.similarity - a.similarity || a.url.localeCompare(b.url)).slice(0, 3);
}

export function strategyPanel(assessment, runId, csrf, canEdit) {
  const { plan, score, decision, breakdown, warnings, missing, closest } = assessment;
  const field = (key, label) => `<label>${escapeHtml(label)}<textarea name="${key}" rows="2" maxlength="3000">${escapeHtml(plan[key])}</textarea></label>`;
  const report = `<p><strong>${score}/100 — ${escapeHtml(decision)}</strong></p><p class="muted">Advisory only. Scores do not block founder approval, change indexing or bypass existing claim checks. Editors award points with evidence; this is not an automated quality verdict.</p>${assessment.assessedAt ? `<p>Last assessment: ${escapeHtml(assessment.assessedAt)} · ${escapeHtml(assessment.reviewer)}</p>` : '<p>Not yet assessed.</p>'}${warnings.map(w => `<p class="notice danger"><strong>Review warning:</strong> ${escapeHtml(w)}</p>`).join('')}${missing.length ? `<p class="notice">Missing assessment fields: ${escapeHtml(missing.join(', '))}.</p>` : ''}<ul>${breakdown.map(b => `<li>${escapeHtml(b.label)}: ${b.score}/${b.max}</li>`).join('')}</ul><p>Closest title matches (review aid; not a full duplication check):</p><ul>${closest.map(c => `<li><a href="${escapeHtml(c.url)}">${escapeHtml(c.title)}</a></li>`).join('') || '<li>No title matches found.</li>'}</ul>`;
  const fields = `<label>Topic cluster<select name="cluster"><option value="">Select a cluster</option>${BLOG_TOPICS.map(t => `<option value="${t.id}"${plan.cluster === t.id ? ' selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}</select></label>${SEO_FIELDS.map(([k, l]) => field(k, l)).join('')}<h3>Editorial scoring</h3><p>Use 0 for absent, roughly half points for partial, full points for a supported answer. Points count only when the required planning fields and a rationale are present.</p>${SEO_CRITERIA.map(([key, label, max]) => `<label>${escapeHtml(label)} (0–${max})<input type="number" name="score_${key}" min="0" max="${max}" value="${plan.scores[key]}"></label><label>Evidence/rationale<textarea name="note_${key}" rows="2" maxlength="1500">${escapeHtml(plan.notes[key])}</textarea></label>`).join('')}${[['substantialDuplication', 'Unresolved substantial duplication'], ['staleInstructions', 'Stale instructions'], ['unsupportedClaims', 'Unsupported claims']].map(([key, label]) => `<label><input type="checkbox" name="${key}" value="true"${plan[key] ? ' checked' : ''}> ${label}</label>`).join('')}`;
  const details = canEdit ? `<form method="post" action="/app/content/actions/seo/strategy"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="runId" value="${escapeHtml(runId)}">${fields}<button type="submit">Save advisory assessment</button></form>` : `<dl>${[['cluster','Topic cluster'], ...SEO_FIELDS].map(([k,l]) => `<dt>${escapeHtml(l)}</dt><dd>${escapeHtml(plan[k] || 'Not supplied')}</dd>`).join('')}</dl>`;
  return `${report}<details><summary>Assessment evidence and planning</summary>${details}</details>`;
}
