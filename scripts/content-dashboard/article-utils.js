export function normalizeArticleTitle(value, fallback = 'Untitled article') {
  const title = String(value || '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .trim()
    .replace(/^title:\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title || fallback;
}

export function cleanArticlePromptText(value, fallback = '') {
  let text = normalizeArticleTitle(value, fallback);
  text = text
    .replace(/^write\s+(?:a\s+)?certifyd\s+article\s+about:\s*/i, '')
    .replace(/^write\s+(?:a\s+)?(?:blog|article)\s+(?:about|on|explaining?)?:?\s*/i, '')
    .replace(/^draft\s+(?:a\s+)?(?:blog|article)\s+(?:about|on)?:?\s*/i, '')
    .trim();
  text = text
    .replace(/\s+(?:use\s+this\s+angle|angle)\s*:\s*[\s\S]*$/i, '')
    .replace(/\s+this\s+connects\s+to\s+[\s\S]*$/i, '')
    .trim();
  return normalizeArticleTitle(text, fallback);
}

export function titleFromPrompt(value, fallback = 'Untitled article') {
  return cleanArticlePromptText(value, fallback);
}

export const DEFAULT_BLOG_COVER_IMAGE = '/images/certifyd-main-image-independent-scene-20260613.png';

const COVER_RULES = [
  {
    image: '/images/ip-publishing-creators-20260605.jpeg',
    keywords: [
      'ai',
      'artist',
      'deezer',
      'gema',
      'licensing',
      'music',
      'plai',
      'royalty',
      'sampling',
      'song',
      'streaming',
      'suno',
    ],
  },
  {
    image: '/images/creator-commerce-raw-20260601-edgefix.jpeg',
    keywords: [
      'commerce',
      'creator commerce',
      'creator ownership',
      'customer',
      'direct',
      'membership',
      'ownership',
      'payment',
      'price',
      'revenue',
    ],
  },
  {
    image: '/images/certifyd-creators-powered-blue-lofi-20260602.jpeg',
    keywords: [
      'bot',
      'fake',
      'fraud',
      'trust',
      'verification',
    ],
  },
];

export function selectArticleCoverImage({ requestedCoverImage = '', title = '', tags = [], excerpt = '', body = '' } = {}) {
  if (isSafeImagePath(requestedCoverImage) && requestedCoverImage !== DEFAULT_BLOG_COVER_IMAGE) {
    return requestedCoverImage;
  }
  const haystack = [
    title,
    Array.isArray(tags) ? tags.join(' ') : tags,
    excerpt,
    body,
  ].join(' ').toLowerCase();
  const match = COVER_RULES.find((rule) => rule.keywords.some((keyword) => keywordMatches(haystack, keyword)));
  return match?.image || DEFAULT_BLOG_COVER_IMAGE;
}

export function isSafeImagePath(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/images/')) return false;
  if (raw.includes('\\') || raw.includes('..') || /%2f|%5c/i.test(raw)) return false;
  return true;
}

function keywordMatches(haystack, keyword) {
  const escaped = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (String(keyword).includes(' ')) return haystack.includes(String(keyword));
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}
