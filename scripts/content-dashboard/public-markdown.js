const REVIEW_ONLY_PATTERNS = [
  /draft generated for founder review/i,
  /not approved for publishing/i,
  /founder review is required/i,
  /internal founder[- ]review/i,
  /internal workflow note/i,
  /internal qa\/review annotation/i,
  /template-generated draft/i,
];

export function stripMarkdownFrontmatter(markdown) {
  const value = String(markdown || '');
  if (!value.startsWith('---')) return value;
  const end = value.indexOf('\n---', 3);
  if (end === -1) return value;
  const after = value.indexOf('\n', end + 4);
  return after === -1 ? '' : value.slice(after + 1).trimStart();
}

export function sanitizePublicArticleMarkdown(markdown) {
  return String(markdown || '')
    .split(/\r?\n/)
    .filter((line) => !isReviewOnlyLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function publicArticleBodyMarkdown(...candidates) {
  for (const candidate of candidates) {
    const body = sanitizePublicArticleMarkdown(stripMarkdownFrontmatter(candidate || ''));
    if (body) return body;
  }
  return '';
}

function isReviewOnlyLine(line) {
  const clean = String(line || '').replace(/^[\s>_\-*`]+|[\s>_\-*`]+$/g, '').trim();
  if (!clean) return false;
  return REVIEW_ONLY_PATTERNS.some((pattern) => pattern.test(clean));
}
