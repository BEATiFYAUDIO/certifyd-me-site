import fs from 'node:fs/promises';
import path from 'node:path';
import { validateRunId } from './security.js';

export const DISTRIBUTION_COPY_STATUSES = ['not_generated', 'ready', 'copied', 'sent', 'failed'];
export const DISTRIBUTION_COPY_DESTINATIONS = ['linkedin', 'x', 'facebook', 'instagram', 'generic'];
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
  next.status = normalizeCopyStatus(fields.status || current.status || 'ready');
  if (destination === 'x') next.characterCount = countXCharacters(next.text);
  return { ...pkg, [destination]: next, updatedAt: new Date().toISOString() };
}

export function markDistributionPackageStatus(pkg = {}, destinationId = '', status = 'ready') {
  const destination = normalizeDestination(destinationId);
  if (!destination) throw Object.assign(new Error('Unknown distribution package destination.'), { statusCode: 404 });
  const current = pkg[destination] || {};
  const normalized = normalizeCopyStatus(status);
  return {
    ...pkg,
    [destination]: {
      ...current,
      status: normalized,
      ...(normalized === 'sent' ? { sentAt: new Date().toISOString() } : {}),
      ...(normalized === 'copied' ? { copiedAt: new Date().toISOString() } : {}),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function distributionPackageOverallStatus(pkg = {}) {
  const statuses = ['linkedin', 'x', 'facebook', 'instagram'].map((id) => pkg[id]?.status || 'not_generated');
  if (statuses.every((status) => status === 'sent')) return 'distributed';
  if (statuses.some((status) => status === 'sent')) return 'partially-distributed';
  if (statuses.some((status) => ['ready', 'copied', 'failed'].includes(status))) return 'distribution-ready';
  return 'not_generated';
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
  return { text: paragraphs.join('\n\n'), status: 'ready' };
}

function xCopy(article) {
  const base = `${article.hook || article.title} ${article.canonicalUrl}`.replace(/\s+/g, ' ').trim();
  const text = fitForX(base, article.canonicalUrl);
  return { text, characterCount: countXCharacters(text), status: 'ready' };
}

function facebookCopy(article) {
  return {
    text: [
      article.hook || article.title,
      article.implications[0] || article.excerpt,
      article.canonicalUrl,
    ].filter(Boolean).join('\n\n'),
    status: 'ready',
  };
}

function instagramCopy(article, previousAsset = {}) {
  return {
    caption: [
      article.hook || article.title,
      article.implications[0] || article.excerpt,
    ].filter(Boolean).join('\n\n'),
    status: 'ready',
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
  return DISTRIBUTION_COPY_STATUSES.includes(status) ? status : 'ready';
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
