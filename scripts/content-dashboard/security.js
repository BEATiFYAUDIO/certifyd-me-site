import crypto from 'node:crypto';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function isSafeReturnPath(value) {
  if (!value || typeof value !== 'string') return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  try {
    const parsed = new URL(value, 'http://local.invalid');
    return parsed.origin === 'http://local.invalid' && parsed.pathname.startsWith('/app/');
  } catch {
    return false;
  }
}

export function safeReturnPath(value) {
  return isSafeReturnPath(value) ? value : '/app/content';
}

export function validateRunId(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/.test(String(value || ''))) {
    throw Object.assign(new Error('Invalid run ID.'), { statusCode: 400 });
  }
  return String(value);
}

export function validateVersion(value) {
  if (!/^v[0-9]{1,5}$/.test(String(value || ''))) {
    throw Object.assign(new Error('Invalid version.'), { statusCode: 400 });
  }
  return String(value);
}

export function validateSlug(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(String(value || ''))) {
    throw Object.assign(new Error('Invalid slug.'), { statusCode: 400 });
  }
  return String(value);
}

export function signSession(payload, secret) {
  if (!secret) throw new Error('Dashboard session secret is required.');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifySession(token, secret) {
  if (!token || !secret || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

export function parseCookies(cookieHeader = '') {
  const cookies = new Map();
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return cookies;
}

export function createCsrfToken(secret, sessionId) {
  return crypto.createHmac('sha256', secret).update(`csrf:${sessionId}`).digest('base64url');
}

export function verifyCsrf(secret, sessionId, token) {
  if (!secret || !sessionId || !token) return false;
  return createCsrfToken(secret, sessionId) === token;
}

export function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}
