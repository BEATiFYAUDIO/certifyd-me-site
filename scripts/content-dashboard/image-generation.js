import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import OpenAI from 'openai';
import { cleanArticlePromptText, isSafeImagePath } from './article-utils.js';
import { validateRunId } from './security.js';

const IMAGE_STATE_PATH = 'blog/image-generation.json';
const DEFAULT_SIZE = '1536x1024';
const MAX_BRIEF_CHARS = 5000;
const MAX_PROMPT_CHARS = 12000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PROMPT_VERSION = 'blog-image-openai-v1';
const VALID_LOGO_POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

export function defaultImageGenerationState() {
  return {
    imageStatus: 'not_generated',
    imageBrief: '',
    provider: '',
    model: '',
    generatedAt: '',
    imageRevision: 0,
    generatedImagePath: '',
    brandedImagePath: '',
    approvedImagePath: '',
    approvedAt: '',
    logoEnabled: false,
    logoPosition: 'bottom-right',
    error: '',
    promptVersion: PROMPT_VERSION,
  };
}

export async function readImageGenerationState(config, runId) {
  validateRunId(runId);
  const file = path.join(config.outputDir, runId, IMAGE_STATE_PATH);
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  if (!text) return defaultImageGenerationState();
  try {
    return { ...defaultImageGenerationState(), ...JSON.parse(text) };
  } catch {
    return defaultImageGenerationState();
  }
}

export async function writeImageGenerationState(config, runId, state) {
  validateRunId(runId);
  const file = path.join(config.outputDir, runId, IMAGE_STATE_PATH);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const next = { ...defaultImageGenerationState(), ...state };
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export async function buildImageBrief(config, run, overrides = {}) {
  const title = cleanArticlePromptText(run.blogPackage?.title || run.summary?.title || 'Untitled article', 'Untitled article');
  const excerpt = cleanArticlePromptText(run.blogPackage?.excerpt || run.blogPackage?.description || run.blogPackage?.seoDescription || '', '');
  const body = stripFrontmatter(run.articleMarkdown || run.draftMarkdown || run.blogPackage?.body || '');
  const tags = Array.isArray(run.blogPackage?.tags) ? run.blogPackage.tags : [];
  const styleGuide = await readStyleGuide(config);
  const customBrief = cleanString(overrides.imageBrief || '', MAX_BRIEF_CHARS);
  const articleSignals = [title, excerpt, tags.join(', '), body.slice(0, 2500)].filter(Boolean).join('\n\n');
  const generatedBrief = customBrief || [
    `Story: ${title}`,
    excerpt ? `Editorial context: ${excerpt}` : '',
    tags.length ? `Topic tags: ${tags.join(', ')}` : '',
    'Visual direction: Create a polished editorial cover image for the Certifyd blog. Use a tangible metaphor from the article topic instead of generic technology imagery.',
    'Composition: Landscape editorial cover, strong central object, clean negative space for responsive cropping. No text baked into image.',
  ].filter(Boolean).join('\n');
  const prompt = [
    'Create one original landscape editorial blog cover image.',
    '',
    'STYLE GUIDE',
    styleGuide,
    '',
    'IMAGE BRIEF',
    generatedBrief,
    '',
    'ARTICLE SIGNALS',
    articleSignals,
    '',
    'Hard constraints: no text in the image, no invented logos, no UI dashboards, no corporate stock-photo people, no generic AI glow imagery.',
  ].join('\n').slice(0, MAX_PROMPT_CHARS);
  return {
    imageBrief: generatedBrief,
    prompt,
    promptVersion: PROMPT_VERSION,
    size: normalizeImageSize(config.blogImages?.size || DEFAULT_SIZE),
  };
}

export async function generateBlogImage({ config, runs, actor, runId, imageBrief = '', logoEnabled = false, logoPosition = '', provider = null }) {
  validateRunId(runId);
  if (!config.blogImages?.enabled) throw Object.assign(new Error('Blog image generation is disabled.'), { statusCode: 400 });
  const run = await runs.readRun(runId);
  const previous = await readImageGenerationState(config, runId);
  const base = runs.runPath(runId);
  const revision = Number(previous.imageRevision || 0) + 1;
  const normalizedLogoEnabled = logoEnabled === true || logoEnabled === 'true' || logoEnabled === 'on';
  const normalizedPosition = normalizeLogoPosition(logoPosition || previous.logoPosition || config.blogImages?.defaultLogoPosition || 'bottom-right');
  const brief = await buildImageBrief(config, run, { imageBrief });
  const timestamp = new Date().toISOString();
  const imageProvider = provider || config.blogImages?.providerImpl || createOpenAIImageProvider(config);
  try {
    const result = await imageProvider.generate({
      prompt: brief.prompt,
      model: config.blogImages?.model || 'gpt-image-1',
      size: brief.size,
      article: run.blogPackage,
    });
    const buffer = Buffer.isBuffer(result?.buffer) ? result.buffer : Buffer.from(result?.buffer || []);
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('Image provider returned an invalid image payload.');
    const extension = imageExtension(result?.contentType || result?.extension || 'image/png');
    const slug = safeSlug(run.blogPackage?.slug || run.summary?.slug || run.summary?.title || runId);
    const relativePath = generatedImageRelativePath(slug, revision, extension);
    const absolutePath = safeSiteImagePath(config, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);
    const generatedImagePath = `/${relativePath}`;
    const brandedImagePath = normalizedLogoEnabled
      ? await createLogoComposite(config, { generatedImagePath, slug, revision, logoPosition: normalizedPosition, size: brief.size })
      : '';
    const state = await writeImageGenerationState(config, runId, {
      ...previous,
      imageStatus: 'generated',
      imageBrief: brief.imageBrief,
      provider: result.provider || config.blogImages?.provider || 'openai',
      model: result.model || config.blogImages?.model || '',
      generatedAt: timestamp,
      imageRevision: revision,
      generatedImagePath,
      brandedImagePath,
      logoEnabled: normalizedLogoEnabled,
      logoPosition: normalizedPosition,
      error: '',
      promptVersion: brief.promptVersion,
      promptHash: sha256(brief.prompt),
      generatedBy: actor?.email || '',
    });
    return { ok: true, output: `Generated image revision ${revision}: ${brandedImagePath || generatedImagePath}`, state };
  } catch (error) {
    const state = await writeImageGenerationState(config, runId, {
      ...previous,
      imageStatus: 'failed',
      imageBrief: brief.imageBrief,
      provider: config.blogImages?.provider || 'openai',
      model: config.blogImages?.model || '',
      error: safeError(error),
      logoEnabled: normalizedLogoEnabled,
      logoPosition: normalizedPosition,
      promptVersion: brief.promptVersion,
      promptHash: sha256(brief.prompt),
    });
    return { ok: false, output: `Image generation failed: ${safeError(error)}`, state };
  }
}

export async function approveGeneratedBlogImage({ config, runs, actor, runId }) {
  validateRunId(runId);
  const run = await runs.readRun(runId);
  const state = await readImageGenerationState(config, runId);
  const approvedImagePath = state.brandedImagePath || state.generatedImagePath;
  if (!isSafeImagePath(approvedImagePath)) throw Object.assign(new Error('No generated image is ready for approval.'), { statusCode: 400 });
  const timestamp = new Date().toISOString();
  const base = runs.runPath(runId);
  const blogPackage = {
    ...run.blogPackage,
    title: cleanArticlePromptText(run.blogPackage?.title || run.summary?.title, 'Untitled article'),
    slug: run.blogPackage?.slug || run.summary?.slug || safeSlug(run.summary?.title || runId),
    coverImage: approvedImagePath,
    coverImageMode: 'generated',
    coverImageProvider: state.provider || config.blogImages?.provider || 'openai',
    coverImageGeneratedModel: state.model || config.blogImages?.model || '',
    coverImageGeneratedAt: state.generatedAt || '',
    coverImageApprovedAt: timestamp,
    coverImageApprovedBy: actor?.email || '',
    coverImageRevision: state.imageRevision || 0,
    coverImageLogoEnabled: Boolean(state.logoEnabled),
    coverImageLogoPosition: state.logoPosition || '',
  };
  await fs.writeFile(path.join(base, 'blog', 'blog-post.json'), `${JSON.stringify(blogPackage, null, 2)}\n`, 'utf8');
  await updateCoverImageFrontmatter(base, approvedImagePath);
  const next = await writeImageGenerationState(config, runId, {
    ...state,
    imageStatus: 'approved',
    approvedImagePath,
    approvedAt: timestamp,
    approvedBy: actor?.email || '',
    error: '',
  });
  return { ok: true, output: `Approved generated cover image ${approvedImagePath}.`, state: next };
}

export function createOpenAIImageProvider(config) {
  const apiKey = config.openai?.apiKey || config.env?.OPENAI_API_KEY || '';
  if (!apiKey) throw Object.assign(new Error('Missing OpenAI API key for blog image generation.'), { statusCode: 503 });
  const client = new OpenAI({ apiKey });
  return {
    async generate({ prompt, model, size }) {
      const response = await client.images.generate({ model, prompt, size });
      const item = response?.data?.[0] || {};
      const base64 = item.b64_json || item.b64Json;
      if (!base64) throw new Error('OpenAI image response did not include image data.');
      return {
        buffer: Buffer.from(base64, 'base64'),
        contentType: 'image/png',
        provider: 'openai',
        model,
      };
    },
  };
}

async function createLogoComposite(config, { generatedImagePath, slug, revision, logoPosition, size }) {
  const logoPath = config.blogImages?.canonicalLogoPath || path.join(config.siteRoot, 'images', 'certifyd_logo_transparent.svg');
  const logoSvg = await fs.readFile(logoPath, 'utf8');
  const logoViewBox = logoSvg.match(/viewBox="([^"]+)"/i)?.[1] || '0 0 428 138';
  const [canvasWidth, canvasHeight] = parseImageSize(size);
  const logoWidth = Math.round(canvasWidth * 0.18);
  const logoHeight = Math.round(logoWidth * (138 / 428));
  const margin = Math.round(canvasWidth * 0.04);
  const x = logoPosition.endsWith('right') ? canvasWidth - logoWidth - margin : margin;
  const y = logoPosition.startsWith('bottom') ? canvasHeight - logoHeight - margin : margin;
  const innerLogo = logoSvg.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<\/?svg[^>]*>/gi, '').trim();
  const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <image href="${escapeXml(generatedImagePath)}" width="${canvasWidth}" height="${canvasHeight}" preserveAspectRatio="xMidYMid slice"/>
  <g transform="translate(${x} ${y})">
    <svg width="${logoWidth}" height="${logoHeight}" viewBox="${escapeXml(logoViewBox)}">${innerLogo}</svg>
  </g>
</svg>
`;
  const relativePath = generatedLogoRelativePath(slug, revision);
  const absolutePath = safeSiteImagePath(config, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, composite, 'utf8');
  return `/${relativePath}`;
}

async function updateCoverImageFrontmatter(base, coverImage) {
  for (const relative of ['final/article.md', 'final-article.md', 'draft.md', 'blog/blog-post.md']) {
    const file = path.join(base, relative);
    const markdown = await fs.readFile(file, 'utf8').catch(() => '');
    if (!markdown) continue;
    await fs.writeFile(file, setFrontmatterValue(markdown, 'coverImage', coverImage), 'utf8');
  }
}

export function setFrontmatterValue(markdown, key, value) {
  const text = String(markdown || '').replace(/\r\n/g, '\n');
  const line = `${key}: ${JSON.stringify(value)}`;
  if (!text.startsWith('---\n')) return `---\n${line}\n---\n\n${text}`;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return `---\n${line}\n---\n\n${text}`;
  const frontmatter = text.slice(4, end).trimEnd();
  const rest = text.slice(end + 1);
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, 'm');
  const nextFrontmatter = pattern.test(frontmatter)
    ? frontmatter.replace(pattern, line)
    : `${frontmatter}\n${line}`;
  return `---\n${nextFrontmatter}\n${rest}`;
}

function generatedImageRelativePath(slug, revision, extension) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = String(extension || '.png').startsWith('.') ? extension : `.${extension}`;
  return path.join('images', 'blog', year, month, `${slug}-r${revision}${ext}`).replace(/\\/g, '/');
}

function generatedLogoRelativePath(slug, revision) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return path.join('images', 'blog', year, month, `${slug}-r${revision}-logo.svg`).replace(/\\/g, '/');
}

function safeSiteImagePath(config, relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('images/blog/')) throw new Error('Generated image path must stay inside images/blog/.');
  const outputPath = path.join(config.siteRoot, normalized);
  const imageRoot = path.join(config.siteRoot, 'images', 'blog');
  if (!outputPath.startsWith(`${imageRoot}${path.sep}`)) throw new Error('Unsafe generated image path.');
  return outputPath;
}

async function readStyleGuide(config) {
  const file = config.blogImages?.styleGuidePath || path.join(config.agentRoot, 'image-generation', 'style-guide.md');
  return fs.readFile(file, 'utf8').catch(() => '');
}

function imageExtension(value) {
  const clean = String(value || '').toLowerCase();
  if (clean.includes('jpeg') || clean === '.jpg') return '.jpg';
  if (clean.includes('webp') || clean === '.webp') return '.webp';
  return '.png';
}

function normalizeImageSize(value) {
  return /^\d+x\d+$/.test(String(value || '')) ? String(value) : DEFAULT_SIZE;
}

function parseImageSize(value) {
  const [width, height] = normalizeImageSize(value).split('x').map((part) => Number(part));
  return [width || 1536, height || 1024];
}

function normalizeLogoPosition(value) {
  const clean = String(value || '').trim().toLowerCase();
  return VALID_LOGO_POSITIONS.has(clean) ? clean : 'bottom-right';
}

function stripFrontmatter(markdown) {
  return String(markdown || '').replace(/^\uFEFF?---\s*[\r\n][\s\S]*?[\r\n]---\s*[\r\n]?/, '').trimStart();
}

function cleanString(value, max = 1000) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function safeSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeError(error) {
  return String(error?.message || error || 'Unknown error').replace(/\s+/g, ' ').slice(0, 240);
}

function escapeXml(value) {
  return String(value || '').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char]));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
