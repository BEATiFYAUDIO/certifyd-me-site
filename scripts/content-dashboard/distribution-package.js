import fs from 'node:fs/promises';
import path from 'node:path';
import { validateRunId } from './security.js';

export const DISTRIBUTION_COPY_STATUSES = ['draft', 'ready_for_review', 'approved', 'sending', 'sent', 'failed'];
export const DISTRIBUTION_COPY_DESTINATIONS = ['linkedin', 'x', 'facebook', 'instagram', 'generic'];
const DESTINATION_LIMITS = { linkedin: 3000, x: 280, facebook: 63206, instagram: 2200 };
const LIMITED_EDIT_DESTINATIONS = new Set(['x', 'instagram', 'facebook', 'linkedin', 'hashnode']);
export const INSTAGRAM_FEED_ASSET_SPEC = {
  width: 1080,
  height: 1350,
  aspectRatio: '4:5',
  safeZone: {
    units: 'px',
    profileGridCrop: { x: 0, y: 135, width: 1080, height: 1080 },
    criticalContent: { x: 120, y: 255, width: 840, height: 840, padding: 120 },
    note: 'Keep logo, headline, names and essential subhead inside criticalContent. Full-bleed art may extend to the full canvas.',
  },
  position: { focusX: 50, focusY: 50, scale: 1 },
};
export const INSTAGRAM_GENERATION_GUIDANCE = [
  'Create a 1080x1350 Instagram editorial image.',
  'Background photography, textures and decorative elements may extend to all edges.',
  'ALL critical text, including the exact Certifyd logo/wordmark, headline, names and essential subhead, must remain inside the centered profile-grid-safe region with generous padding.',
  'The image must remain understandable when viewed as the profile-grid thumbnail.',
  'Do not place headline text against the left or right edge.',
  'Do not solve this by making all typography tiny.',
  'Use strong editorial hierarchy inside the safe region and let photography/art provide the full-bleed composition.',
  'Preserve Certifyd editorial visual language: music/content/lifestyle, tactile or analog elements when appropriate, bold typography, photography/collage, imperfect physicality and story-specific imagery.',
  'Avoid generic AI-tech slop, floating dashboards or network globes unless actually relevant.',
  'Use the exact Certifyd logo asset; never regenerate or approximate the logo.',
].join(' ');

export async function readDistributionPackage(runRepo, runId) {
  const base = runRepo.runPath(validateRunId(runId));
  return safeJson(await fs.readFile(path.join(base, 'distribution', 'package.json'), 'utf8').catch(() => '{}'), {});
}

export async function writeDistributionPackage(runRepo, runId, pkg) {
  const base = runRepo.runPath(validateRunId(runId));
  await fs.mkdir(path.join(base, 'distribution'), { recursive: true });
  await fs.writeFile(path.join(base, 'distribution', 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

export function generateDistributionPackage(run = {}, previous = {}, destinationId = '') {
  const article = articleForDistribution(run);
  const base = {
    articleSlug: article.slug,
    articleTitle: article.title,
    canonicalUrl: article.canonicalUrl,
    excerpt: article.excerpt,
    coverImage: article.coverImage,
    publishedAt: article.publishedAt,
    channelAssets: channelAssets(article, previous.channelAssets || {}),
    updatedAt: new Date().toISOString(),
  };
  const generated = {
    ...base,
    linkedin: linkedinCopy(article),
    x: xCopy(article),
    facebook: facebookCopy(article),
    instagram: instagramCopy(article, previous.instagram?.asset),
    generic: genericCopy(article),
  };
  generated.channelAssets.instagram = generated.instagram.asset;
  if (!destinationId) return { ...previous, ...generated };
  const destination = normalizeDestination(destinationId);
  if (!destination) return { ...previous, ...base };
  return { ...previous, ...base, [destination]: generated[destination] };
}

export function applyDistributionPackageEdit(pkg = {}, destinationId = '', fields = {}) {
  const destination = normalizeDestination(destinationId);
  if (!destination) throw Object.assign(new Error('Unknown distribution package destination.'), { statusCode: 404 });
  const current = pkg[destination] || {};
  const next = { ...current };
  if (destination === 'instagram') {
    next.caption = cleanCopy(fields.caption ?? fields.text ?? current.caption);
    next.asset = instagramAssetFromFields(current.asset, fields);
  }
  else if (destination === 'generic') {
    next.shortCopy = cleanCopy(fields.shortCopy ?? current.shortCopy);
    next.longCopy = cleanCopy(fields.longCopy ?? current.longCopy);
  } else next.text = cleanCopy(fields.text ?? current.text);
  const explicitStatus = Object.prototype.hasOwnProperty.call(fields, 'status') && fields.status;
  next.status = normalizeCopyStatus(explicitStatus ? fields.status : 'draft');
  if (!explicitStatus) {
    delete next.preflight;
    delete next.approvedAt;
    delete next.approvedPayload;
    delete next.sentAt;
    delete next.sentPayload;
  }
  if (destination === 'x') next.characterCount = countXCharacters(next.text);
  return { ...pkg, [destination]: next, updatedAt: new Date().toISOString() };
}

export function markDistributionPackageStatus(pkg = {}, destinationId = '', status = 'draft') {
  const destination = normalizeDestination(destinationId);
  if (!destination) throw Object.assign(new Error('Unknown distribution package destination.'), { statusCode: 404 });
  const current = pkg[destination] || {};
  const normalized = normalizeCopyStatus(status);
  assertStatusTransition(current.status || 'draft', normalized);
  if (normalized === 'approved' && current.preflight?.ok !== true) {
    throw Object.assign(new Error('Run a successful distribution preflight before approval.'), { statusCode: 409 });
  }
  if (normalized === 'sent' && !current.approvedPayload) {
    throw Object.assign(new Error('Approve the exact final payload before marking sent.'), { statusCode: 409 });
  }
  const next = {
    ...current,
    status: normalized,
    ...(normalized === 'sent' ? { sentAt: new Date().toISOString(), sentPayload: current.approvedPayload || finalPayloadForDestination(pkg, destination) } : {}),
    ...(normalized === 'approved' ? { approvedAt: new Date().toISOString(), approvedPayload: finalPayloadForDestination(pkg, destination) } : {}),
  };
  return {
    ...pkg,
    [destination]: next,
    updatedAt: new Date().toISOString(),
  };
}

export function preflightDistributionDestination(pkg = {}, destinationId = '', previousState = {}, adapter = {}) {
  const destination = normalizeDestination(destinationId);
  if (!destination) throw Object.assign(new Error('Unknown distribution package destination.'), { statusCode: 404 });
  const item = pkg[destination] || {};
  const payload = finalPayloadForDestination(pkg, destination);
  const errors = [];
  const warnings = [];
  const copy = destination === 'instagram' ? item.caption : item.text;
  if (!cleanCopy(copy)) errors.push('Copy is empty.');
  if (/https?:\/\/\s|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(copy || '')) errors.push('Copy appears malformed.');
  const limit = DESTINATION_LIMITS[destination];
  if (limit && payload.characterCount > limit) errors.push(`${destinationLabel(destination)} copy exceeds ${limit} characters.`);
  if (destination !== 'instagram' && !validHttpUrl(pkg.canonicalUrl)) errors.push('Canonical URL is required.');
  if (destination === 'instagram') {
    const asset = item.asset || {};
    if (!asset.sourceImage && !asset.outputImage) errors.push('Instagram media is required.');
    if (asset.width !== 1080 || asset.height !== 1350 || asset.aspectRatio !== '4:5') errors.push('Instagram asset must be 1080x1350 / 4:5.');
    if (!safeZoneLooksValid(asset.safeZone, asset.width, asset.height)) errors.push('Instagram critical safe zone is missing or outside the profile-grid crop.');
  }
  if (previousState?.status === 'published' || previousState?.status === 'sent' || previousState?.externalPostId || item.status === 'sent') {
    errors.push('Duplicate posting risk: this destination already appears sent or published.');
  }
  if (LIMITED_EDIT_DESTINATIONS.has(destination) || adapter.supportsUpdate === false) {
    warnings.push(`${destinationLabel(destination)} has limited edit/repost capability. Review the exact final payload before sending.`);
  }
  return {
    ok: errors.length === 0,
    status: errors.length ? 'failed' : 'ready_for_review',
    errors,
    warnings,
    payload,
    checkedAt: new Date().toISOString(),
  };
}

export function applyDistributionPreflight(pkg = {}, destinationId = '', preflight = {}) {
  const destination = normalizeDestination(destinationId);
  const current = pkg[destination] || {};
  return {
    ...pkg,
    [destination]: {
      ...current,
      status: preflight.ok ? 'ready_for_review' : 'failed',
      preflight: {
        ok: Boolean(preflight.ok),
        errors: preflight.errors || [],
        warnings: preflight.warnings || [],
        checkedAt: preflight.checkedAt || new Date().toISOString(),
        payload: preflight.payload || finalPayloadForDestination(pkg, destination),
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

export function finalPayloadForDestination(pkg = {}, destinationId = '') {
  const destination = normalizeDestination(destinationId);
  const item = pkg[destination] || {};
  const base = {
    destination,
    articleSlug: pkg.articleSlug || '',
    articleTitle: pkg.articleTitle || '',
    canonicalUrl: pkg.canonicalUrl || '',
    coverImage: pkg.coverImage || '',
  };
  if (destination === 'instagram') {
    const caption = cleanCopy(item.caption || '');
    return { ...base, caption, asset: item.asset || null, characterCount: caption.length };
  }
  const text = cleanCopy(item.text || '');
  return { ...base, text, characterCount: destination === 'x' ? countXCharacters(text) : text.length };
}

export function distributionPackageOverallStatus(pkg = {}) {
  const statuses = ['linkedin', 'x', 'facebook', 'instagram'].map((id) => pkg[id]?.status || 'draft');
  if (statuses.every((status) => status === 'sent')) return 'distributed';
  if (statuses.some((status) => ['sent', 'sending'].includes(status))) return 'partially-distributed';
  if (statuses.some((status) => ['ready_for_review', 'approved'].includes(status))) return 'distribution-ready';
  if (statuses.some((status) => status === 'failed')) return 'needs-attention';
  return 'draft';
}

function articleForDistribution(run = {}) {
  const summary = run.summary || {};
  const blog = run.blogPackage || {};
  const manifest = run.manifest || {};
  const markdown = stripFrontmatter(run.articleMarkdown || run.draftMarkdown || blog.body || '');
  return {
    title: blog.title || summary.title || manifest.title || 'Untitled article',
    slug: blog.slug || summary.slug || manifest.slug || '',
    canonicalUrl: summary.canonicalUrl || blog.canonicalUrl || manifest.canonicalUrl || '',
    excerpt: blog.excerpt || blog.description || summary.topic || firstParagraph(markdown),
    coverImage: blog.coverImage || manifest.coverImage || '',
    publishedAt: manifest.publishedAt || blog.date || manifest.updatedAt || summary.lastUpdated || '',
    markdown,
    hook: strongestHook(markdown, blog.excerpt || blog.description || summary.topic || ''),
    implications: articleImplications(markdown),
  };
}

function linkedinCopy(article) {
  const paragraphs = [
    article.hook || article.title,
    article.implications.slice(0, 2).join(' '),
    `Read the full article: ${article.canonicalUrl}`,
  ].filter(Boolean);
  return { text: paragraphs.join('\n\n'), status: 'draft' };
}

function xCopy(article) {
  const base = `${article.hook || article.title} ${article.canonicalUrl}`.replace(/\s+/g, ' ').trim();
  const text = fitForX(base, article.canonicalUrl);
  return { text, characterCount: countXCharacters(text), status: 'draft' };
}

function facebookCopy(article) {
  return {
    text: [
      article.hook || article.title,
      article.implications[0] || article.excerpt,
      article.canonicalUrl,
    ].filter(Boolean).join('\n\n'),
    status: 'draft',
  };
}

function instagramCopy(article, previousAsset = {}) {
  return {
    caption: [
      article.hook || article.title,
      article.implications[0] || article.excerpt,
    ].filter(Boolean).join('\n\n'),
    status: 'draft',
    asset: instagramAsset(article, previousAsset),
  };
}

function genericCopy(article) {
  const shortCopy = `${article.hook || article.title} ${article.canonicalUrl}`.trim();
  const longCopy = [
    article.title,
    article.excerpt,
    article.implications.slice(0, 3).join('\n\n'),
    article.canonicalUrl,
  ].filter(Boolean).join('\n\n');
  return { shortCopy, longCopy };
}

function channelAssets(article, previous = {}) {
  return {
    ...previous,
    canonicalBlog: {
      kind: 'canonical-blog-hero',
      sourceImage: article.coverImage,
      outputImage: article.coverImage,
      aspectRatio: 'site-article-hero',
    },
    instagram: instagramAsset(article, previous.instagram),
    facebook: {
      ...(previous.facebook || {}),
      kind: 'social-landscape',
      aspectRatio: previous.facebook?.aspectRatio || '1.91:1',
      sourceImage: article.coverImage,
      outputImage: previous.facebook?.outputImage || '',
    },
    x: {
      ...(previous.x || {}),
      kind: 'social-landscape',
      aspectRatio: previous.x?.aspectRatio || '16:9',
      sourceImage: article.coverImage,
      outputImage: previous.x?.outputImage || '',
    },
  };
}

function instagramAsset(article = {}, previous = {}) {
  return {
    ...INSTAGRAM_FEED_ASSET_SPEC,
    safeZone: {
      ...INSTAGRAM_FEED_ASSET_SPEC.safeZone,
      ...(previous.safeZone || {}),
      profileGridCrop: { ...INSTAGRAM_FEED_ASSET_SPEC.safeZone.profileGridCrop, ...(previous.safeZone?.profileGridCrop || {}) },
      criticalContent: { ...INSTAGRAM_FEED_ASSET_SPEC.safeZone.criticalContent, ...(previous.safeZone?.criticalContent || {}) },
    },
    sourceImage: article.coverImage || previous.sourceImage || '',
    outputImage: previous.outputImage || '',
    position: {
      ...INSTAGRAM_FEED_ASSET_SPEC.position,
      ...(previous.position || {}),
    },
    generationGuidance: previous.generationGuidance || INSTAGRAM_GENERATION_GUIDANCE,
  };
}

function instagramAssetFromFields(current = {}, fields = {}) {
  const asset = instagramAsset({ coverImage: current.sourceImage || '' }, current);
  return {
    ...asset,
    position: {
      focusX: clampNumber(fields.assetFocusX ?? asset.position.focusX, 0, 100, 50),
      focusY: clampNumber(fields.assetFocusY ?? asset.position.focusY, 0, 100, 50),
      scale: clampNumber(fields.assetScale ?? asset.position.scale, 1, 2, 1),
    },
  };
}

function strongestHook(markdown = '', fallback = '') {
  const paragraphs = bodyParagraphs(markdown);
  const ranked = paragraphs
    .filter((item) => item.length >= 80 && item.length <= 360)
    .sort((a, b) => hookScore(b) - hookScore(a));
  return cleanSentence(ranked[0] || fallback || paragraphs[0] || '');
}

function articleImplications(markdown = '') {
  return bodyParagraphs(markdown)
    .filter((item) => item.length >= 70 && item.length <= 380)
    .filter((item) => !/^draft generated/i.test(item))
    .sort((a, b) => hookScore(b) - hookScore(a))
    .slice(1, 4)
    .map(cleanSentence);
}

function hookScore(value = '') {
  const text = value.toLowerCase();
  let score = 0;
  for (const term of ['because', 'rights', 'identity', 'permission', 'provenance', 'authority', 'creator', 'platform', 'infrastructure', 'commerce', 'legal', 'direct']) {
    if (text.includes(term)) score += 1;
  }
  if (/\b(is|are|was|were|will|can|need|needs|shows|means)\b/.test(text)) score += 1;
  return score;
}

function firstParagraph(markdown = '') {
  return bodyParagraphs(markdown)[0] || '';
}

function bodyParagraphs(markdown = '') {
  return stripFrontmatter(markdown)
    .replace(/^#+\s+.+$/gm, '')
    .split(/\n{2,}/)
    .map((item) => item
      .replace(/\[[^\]]+\]\([^)]+\)/g, (match) => match.replace(/^\[([^\]]+)\]\([^)]+\)$/, '$1'))
      .replace(/^[\s>*_`#-]+/, '')
      .replace(/[*_`>#]/g, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);
}

function fitForX(text = '', canonicalUrl = '') {
  const limit = 280;
  if (countXCharacters(text) <= limit) return text;
  const url = String(canonicalUrl || '').trim();
  const room = limit - countXCharacters(url) - 1;
  const words = text.replace(url, '').trim().split(/\s+/);
  let output = '';
  for (const word of words) {
    const candidate = `${output}${output ? ' ' : ''}${word}`;
    if (countXCharacters(`${candidate} ${url}`) > limit - 1) break;
    output = candidate;
  }
  return `${output.replace(/[,.:\s]+$/, '')} ${url}`.trim();
}

function countXCharacters(text = '') {
  return String(text || '').replace(/https?:\/\/\S+/g, 'xxxxxxxxxxxxxxxxxxxxxxx').length;
}

function cleanCopy(value = '') {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, 5000);
}

function cleanSentence(value = '') {
  return cleanCopy(value).replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').slice(0, 420);
}

function normalizeDestination(value = '') {
  const id = String(value || '').trim().toLowerCase();
  return DISTRIBUTION_COPY_DESTINATIONS.includes(id) ? id : '';
}

function normalizeCopyStatus(value = '') {
  const status = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  if (status === 'ready') return 'ready_for_review';
  if (status === 'copied') return 'ready_for_review';
  return DISTRIBUTION_COPY_STATUSES.includes(status) ? status : 'draft';
}

function assertStatusTransition(from, to) {
  const current = normalizeCopyStatus(from || 'draft');
  const next = normalizeCopyStatus(to || 'draft');
  const allowed = {
    draft: new Set(['draft', 'ready_for_review', 'failed']),
    ready_for_review: new Set(['draft', 'ready_for_review', 'approved', 'failed']),
    approved: new Set(['ready_for_review', 'approved', 'sending', 'sent', 'failed']),
    sending: new Set(['sent', 'failed']),
    sent: new Set(['sent', 'failed']),
    failed: new Set(['draft', 'ready_for_review', 'approved', 'failed']),
  };
  if (!allowed[current]?.has(next)) {
    throw Object.assign(new Error(`Invalid distribution status transition: ${current} to ${next}. Run preflight and approve before sending.`), { statusCode: 409 });
  }
}

function safeZoneLooksValid(safeZone = {}, width = 0, height = 0) {
  const crop = safeZone.profileGridCrop || {};
  const critical = safeZone.criticalContent || {};
  if (!positiveBox(crop) || !positiveBox(critical)) return false;
  if (crop.x < 0 || crop.y < 0 || crop.x + crop.width > width || crop.y + crop.height > height) return false;
  return critical.x >= crop.x
    && critical.y >= crop.y
    && critical.x + critical.width <= crop.x + crop.width
    && critical.y + critical.height <= crop.y + crop.height
    && Number(critical.padding || 0) >= 80;
}

function positiveBox(box = {}) {
  return [box.x, box.y, box.width, box.height].every((value) => Number.isFinite(Number(value))) && Number(box.width) > 0 && Number(box.height) > 0;
}

function validHttpUrl(value = '') {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function destinationLabel(destination = '') {
  return ({ linkedin: 'LinkedIn', x: 'X', facebook: 'Facebook', instagram: 'Instagram', generic: 'Generic' })[destination] || destination;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function stripFrontmatter(markdown = '') {
  return String(markdown || '').replace(/^\uFEFF?---\s*[\r\n][\s\S]*?[\r\n]---\s*[\r\n]?/, '').trimStart();
}

function safeJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}
