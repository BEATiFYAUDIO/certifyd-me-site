import fs from 'node:fs/promises';
import path from 'node:path';
import { brainRecordId } from './brain-utils.js';

export const KNOWLEDGE_SUGGESTIONS = [
  {
    id: 'brain-update-core-responsibilities',
    operation: 'update',
    targetPath: 'facts/approved-public-claims.md',
    title: 'Clarify Certifyd Core responsibilities',
    category: 'Update existing Brain record',
    summary: 'Separate Core from Network in plain language: Core handles local creator/operator software, identity, publishing and commerce context; Network handles discovery, routing and distribution.',
    confidence: 'High',
    sources: ['approved-public-claims.md', 'founder-decisions.md'],
    body: 'Certifyd Core should be described as local creator/operator software for identity, publishing context, catalog records, access and commerce workflows. The Certifyd Network should be described as the discovery, routing and distribution layer that connects those verified participants.',
  },
  {
    id: 'brain-new-creator-ownership-guidance',
    operation: 'new',
    targetPath: 'facts/creator-ownership-writing-guidance.md',
    title: 'Add article guidance for creator ownership',
    category: 'New Brain record',
    summary: 'Create a reusable writing note that prefers “reduces platform dependency” over absolute ownership claims unless stronger evidence is available.',
    confidence: 'High',
    sources: ['approved-public-claims.md'],
    body: 'When writing about creator ownership, prefer grounded language such as “reduces platform dependency,” “keeps the creator relationship attached to the creator,” and “supports direct commerce.” Do not claim Certifyd gives creators complete legal ownership of every right unless an approved Brain record specifically supports that claim.',
  },
  {
    id: 'brain-stale-monetization-wording',
    operation: 'stale',
    targetPath: 'facts/monetization-ecosystem.md',
    title: 'Mark old monetization wording for review',
    category: 'Mark record as stale',
    summary: 'Older copy may overemphasize technical layers. Flag it for founder review before future investor or public articles reuse it.',
    confidence: 'Medium',
    sources: ['investor-site-audit.md', 'monetization-ecosystem.md'],
    body: 'Founder review required before reusing older monetization wording. Check whether the public claim describes live product behavior, planned infrastructure, or strategic positioning.',
  },
  {
    id: 'brain-merge-profile-language',
    operation: 'merge',
    targetPath: 'facts/approved-public-claims.md',
    title: 'Merge repeated profile language',
    category: 'Merge duplicate records',
    summary: 'Combine repeated profile descriptions into one source that distinguishes public profiles, creator identity and discovery surfaces.',
    confidence: 'Medium',
    sources: ['brand.md', 'vocabulary.md'],
    body: 'A Certifyd public profile should be described as an official source-of-truth page for creator identity, catalog context, credits, commerce links and verified work history. Discovery surfaces may point to that profile, but the profile remains the official home.',
  },
];

export async function listPendingKnowledgeSuggestions(config) {
  const state = await readSuggestionState(config);
  const closed = new Set([...(state.approved || []), ...(state.rejected || [])]);
  return KNOWLEDGE_SUGGESTIONS.filter((suggestion) => !closed.has(suggestion.id));
}

export async function applyKnowledgeSuggestion({ config, brainRepo, audit, actor, suggestionId, decision }) {
  const suggestion = KNOWLEDGE_SUGGESTIONS.find((item) => item.id === String(suggestionId || ''));
  if (!suggestion) throw Object.assign(new Error('Knowledge suggestion not found.'), { statusCode: 404 });
  const normalizedDecision = String(decision || '').toLowerCase();
  if (!['approve', 'reject'].includes(normalizedDecision)) throw Object.assign(new Error('Unsupported knowledge suggestion decision.'), { statusCode: 400 });

  const state = await readSuggestionState(config);
  const approved = new Set(state.approved || []);
  const rejected = new Set(state.rejected || []);
  approved.delete(suggestion.id);
  rejected.delete(suggestion.id);

  let changedRecord = null;
  if (normalizedDecision === 'approve') {
    changedRecord = await writeSuggestionToBrain(brainRepo, suggestion, actor);
    approved.add(suggestion.id);
  } else {
    rejected.add(suggestion.id);
  }

  const event = {
    id: `brain-suggestion-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    suggestionId: suggestion.id,
    decision: normalizedDecision,
    operation: suggestion.operation,
    targetPath: suggestion.targetPath,
    actor: actor?.email || actor?.id || 'unknown',
    changedRecordId: changedRecord?.id || '',
    changedRecordPath: changedRecord?.name || suggestion.targetPath,
    at: new Date().toISOString(),
  };
  const nextState = {
    approved: [...approved],
    rejected: [...rejected],
    history: [event, ...(state.history || [])].slice(0, 200),
  };
  await writeSuggestionState(config, nextState);
  await audit?.append?.({
    action: normalizedDecision === 'approve' ? 'brain_suggestion_approve' : 'brain_suggestion_reject',
    actorUserId: actor?.id,
    actorDisplayName: actor?.email,
    actorRole: actor?.role,
    result: 'SUCCESS',
    note: `${suggestion.id}:${suggestion.operation}:${suggestion.targetPath}`,
  });
  return {
    ok: true,
    suggestionId: suggestion.id,
    decision: normalizedDecision,
    changedRecord,
    output: normalizedDecision === 'approve'
      ? `Approved Brain suggestion and updated ${changedRecord.name}.`
      : 'Rejected Brain suggestion without changing approved Brain knowledge.',
  };
}

async function writeSuggestionToBrain(brainRepo, suggestion, actor) {
  const now = new Date().toISOString();
  const section = [
    '',
    `## Dashboard Knowledge Update — ${now}`,
    '',
    `Source suggestion: ${suggestion.title}`,
    `Approved by: ${actor?.email || actor?.id || 'unknown'}`,
    '',
    suggestion.body,
    '',
  ].join('\n');

  if (suggestion.operation === 'new') {
    const existing = await brainRepo.readRecord(suggestion.targetPath).catch(() => '');
    const text = existing || [
      `# ${suggestion.title}`,
      '',
      '## Current Status',
      'APPROVED',
      '',
      '## Confidence',
      suggestion.confidence.toUpperCase(),
      '',
      suggestion.body,
      '',
    ].join('\n');
    await brainRepo.writeRecord(suggestion.targetPath, text.endsWith('\n') ? text : `${text}\n`);
    return brainRepo.fileRecord(suggestion.targetPath);
  }

  if (suggestion.operation === 'stale') {
    await brainRepo.appendRecord(suggestion.targetPath, [
      '',
      `## Current Status`,
      'UNCLEAR',
      '',
      section,
    ].join('\n'));
    return brainRepo.fileRecord(suggestion.targetPath);
  }

  await brainRepo.appendRecord(suggestion.targetPath, section);
  return brainRepo.fileRecord(suggestion.targetPath);
}

async function readSuggestionState(config) {
  const file = suggestionStateFile(config);
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  if (!text) return { approved: [], rejected: [], history: [] };
  try {
    const parsed = JSON.parse(text);
    return {
      approved: Array.isArray(parsed.approved) ? parsed.approved : [],
      rejected: Array.isArray(parsed.rejected) ? parsed.rejected : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { approved: [], rejected: [], history: [] };
  }
}

async function writeSuggestionState(config, state) {
  const file = suggestionStateFile(config);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function suggestionStateFile(config) {
  return path.join(config.agentRoot, 'dashboard', 'brain-suggestions.json');
}

export function suggestedBrainRecordId(relative) {
  return brainRecordId(relative);
}
