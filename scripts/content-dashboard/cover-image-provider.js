import fs from 'node:fs/promises';
import path from 'node:path';
import { selectArticleCoverImage } from './article-utils.js';

const PEXELS_SEARCH_URL = 'https://api.pexels.com/v1/search';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const GLOBAL_HISTORY_LIMIT = 250;

export async function selectAutomatedCoverImage(config, run) {
  const localCover = selectArticleCoverImage({ ...coverSignals(run), requestedCoverImage: '' });
  if (config.coverImages?.provider !== 'pexels' || !config.coverImages?.pexelsApiKey) {
    return { coverImage: localCover, coverImageMode: 'auto', coverImageProvider: 'local' };
  }
  try {
    const pexelsCover = await fetchPexelsCoverImage(config, run);
    return pexelsCover || { coverImage: localCover, coverImageMode: 'auto', coverImageProvider: 'local' };
  } catch {
    return { coverImage: localCover, coverImageMode: 'auto', coverImageProvider: 'local' };
  }
}

export async function fetchPexelsCoverImage(config, run) {
  const apiKey = config.coverImages?.pexelsApiKey || '';
  if (!apiKey) return null;
  const fetchImpl = config.coverImages?.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;
  const query = buildPexelsCoverQuery(run);
  const excludedIds = await pexelsExclusionSet(config, run);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.coverImages?.timeoutMs || 12000);
  try {
    const searchUrl = new URL(PEXELS_SEARCH_URL);
    searchUrl.searchParams.set('query', query);
    searchUrl.searchParams.set('orientation', 'landscape');
    searchUrl.searchParams.set('size', 'large');
    searchUrl.searchParams.set('per_page', '20');
    searchUrl.searchParams.set('locale', config.coverImages?.pexelsLocale || 'en-US');
    const searchResponse = await fetchImpl(searchUrl, {
      headers: { Authorization: apiKey },
      signal: controller.signal,
    });
    if (!searchResponse.ok) return null;
    const searchJson = await searchResponse.json();
    const photo = pickPexelsPhoto(searchJson?.photos, excludedIds);
    const sourceUrl = photo?.src?.large2x || photo?.src?.landscape || photo?.src?.large || photo?.src?.original;
    if (!photo || !isAllowedPexelsImageUrl(sourceUrl)) return null;
    const imageResponse = await fetchImpl(sourceUrl, { signal: controller.signal });
    if (!imageResponse.ok) return null;
    const contentType = String(imageResponse.headers?.get?.('content-type') || '').toLowerCase();
    const extension = imageExtension(contentType);
    if (!extension) return null;
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    if (!imageBuffer.length || imageBuffer.length > MAX_IMAGE_BYTES) return null;
    const slug = safeSlug(run.blogPackage?.slug || run.summary?.slug || run.summary?.title || run.summary?.runId || 'article');
    const fileName = `${slug}-pexels-${photo.id}${extension}`;
    const relativePath = path.join('images', 'blog', fileName).replace(/\\/g, '/');
    const imageRoot = path.join(config.siteRoot, 'images', 'blog');
    const outputPath = path.join(config.siteRoot, relativePath);
    if (!outputPath.startsWith(`${imageRoot}${path.sep}`)) return null;
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, imageBuffer);
    return {
      coverImage: `/${relativePath}`,
      coverImageMode: 'auto',
      coverImageProvider: 'pexels',
      coverImageAlt: String(photo.alt || '').trim(),
      coverImageCredit: photo.photographer ? `Photo by ${photo.photographer} on Pexels` : 'Photo provided by Pexels',
      coverImageCreditUrl: String(photo.url || 'https://www.pexels.com').trim(),
      coverImagePhotographer: String(photo.photographer || '').trim(),
      coverImagePhotographerUrl: String(photo.photographer_url || '').trim(),
      coverImagePexelsId: String(photo.id || '').trim(),
      coverImageQuery: query,
      coverImageFetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildPexelsCoverQuery(run) {
  const signals = coverSignals(run);
  const haystack = [signals.title, Array.isArray(signals.tags) ? signals.tags.join(' ') : signals.tags, signals.excerpt, signals.body].join(' ').toLowerCase();
  if (/\b(ai|artist|deezer|licensing|music|royalty|song|streaming|suno)\b/.test(haystack)) return 'music technology studio';
  if (/\b(commerce|customer|ecommerce|membership|ownership|payment|revenue)\b/.test(haystack)) return 'creator business ecommerce';
  if (/\b(bot|cybersecurity|fake|fraud|trust|verification)\b/.test(haystack)) return 'cybersecurity verification technology';
  const words = String(signals.title || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  return [...new Set(words.filter((word) => !STOP_WORDS.has(word)).slice(0, 5)), 'technology'].join(' ') || 'creative technology';
}

function coverSignals(run) {
  return {
    requestedCoverImage: run.blogPackage?.coverImage || run.blogPackage?.image || '',
    title: run.blogPackage?.title || run.summary?.title || '',
    tags: run.blogPackage?.tags || run.blogPackage?.keywords || [],
    excerpt: run.blogPackage?.excerpt || run.blogPackage?.description || run.summary?.summary || '',
    body: run.articleMarkdown || run.draftMarkdown || run.blogPackage?.body || '',
  };
}

function pickPexelsPhoto(photos, excludedIds = new Set()) {
  if (!Array.isArray(photos)) return null;
  const candidates = photos.filter((photo) => !excludedIds.has(String(photo?.id || '').trim()));
  const pool = candidates.length ? candidates : photos.filter((photo) => String(photo?.id || '').trim() !== [...excludedIds][0]);
  return pool.find((photo) => Number(photo?.width || 0) >= Number(photo?.height || 0) && photo?.src?.large2x) || pool[0] || null;
}

function isAllowedPexelsImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'images.pexels.com';
  } catch {
    return false;
  }
}

function imageExtension(contentType) {
  if (contentType.includes('image/jpeg')) return '.jpg';
  if (contentType.includes('image/png')) return '.png';
  if (contentType.includes('image/webp')) return '.webp';
  return '';
}

function safeSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'article';
}

async function pexelsExclusionSet(config, run) {
  const ids = new Set();
  const currentId = String(run.blogPackage?.coverImagePexelsId || '').trim();
  if (currentId) ids.add(currentId);
  for (const item of Array.isArray(run.blogPackage?.coverImageHistory) ? run.blogPackage.coverImageHistory : []) {
    const id = String(item?.pexelsId || item?.coverImagePexelsId || '').trim();
    if (id) ids.add(id);
  }
  for (const item of await readGlobalPexelsHistory(config)) {
    const id = String(item?.pexelsId || '').trim();
    if (id) ids.add(id);
  }
  return ids;
}

export async function readGlobalPexelsHistory(config) {
  const file = globalPexelsHistoryFile(config);
  if (!file) return [];
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(parsed.items) ? parsed.items.slice(0, GLOBAL_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export async function appendGlobalPexelsHistory(config, record) {
  const pexelsId = String(record?.pexelsId || '').trim();
  if (!pexelsId) return;
  const file = globalPexelsHistoryFile(config);
  if (!file) return;
  const previous = await readGlobalPexelsHistory(config);
  const next = [
    {
      pexelsId,
      coverImage: String(record.coverImage || ''),
      query: String(record.query || ''),
      runId: String(record.runId || ''),
      selectedAt: new Date().toISOString(),
    },
    ...previous.filter((item) => String(item?.pexelsId || '') !== pexelsId),
  ].slice(0, GLOBAL_HISTORY_LIMIT);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({ items: next }, null, 2)}\n`, 'utf8');
}

function globalPexelsHistoryFile(config) {
  const root = config.agentRoot ? path.resolve(config.agentRoot, 'dashboard') : '';
  return root ? path.join(root, 'cover-image-history.json') : '';
}

const STOP_WORDS = new Set(['about', 'after', 'and', 'are', 'but', 'for', 'from', 'how', 'into', 'its', 'that', 'the', 'this', 'with', 'your']);
