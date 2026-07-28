export function brainRecordId(relative) {
  return `brain:${String(relative || '').replace(/\\/g, '/').replace(/\.md$/, '').replace(/[^a-zA-Z0-9/_-]+/g, '-').toLowerCase()}`;
}

export function brainReviewState(relative, text) {
  const body = String(text || '');
  const currentStatus = body.match(/## Current Status\s+`?([A-Z _-]+)`?/i)?.[1]?.trim().replace(/\s+/g, '_') || '';
  const confidence = body.match(/## Confidence\s+`?([A-Z _-]+)`?/i)?.[1]?.trim().replace(/\s+/g, '_') || '';
  if (currentStatus === 'UNCLEAR' || confidence === 'LOW' || /\bNo capability-specific public claim is currently approved\b/i.test(body)) return 'NEEDS_REVIEW';
  if (/\bAPPROVED\b/i.test(body) || /approved[- ]public[- ]claims/i.test(relative)) return 'APPROVED';
  return 'NEEDS_REVIEW';
}

export function isApprovedBrainRecord(record) {
  const reviewState = String(record?.reviewState || record?.staleStatus || record?.approvalStatus || '').toUpperCase();
  if (reviewState === 'APPROVED') return true;
  const id = String(record?.id || '');
  const recordPath = String(record?.path || '');
  const excerpt = String(record?.excerpt || record?.text || '');
  return /approved-public-claims/i.test(id)
    || /approved-public-claims/i.test(recordPath)
    || /\bAPPROVED\b/i.test(excerpt);
}
