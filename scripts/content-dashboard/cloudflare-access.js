import crypto from 'node:crypto';

const JWKS_CACHE = new Map();

export async function verifyCloudflareAccessRequest(req, config) {
  const token = req.headers['cf-access-jwt-assertion'];
  if (!token || Array.isArray(token)) return null;
  const claims = await verifyAccessJwt(token, config.cloudflareAccess);
  if (!claims?.email) return null;
  return {
    id: String(claims.sub || claims.email).toLowerCase(),
    email: String(claims.email).toLowerCase(),
    name: claims.name || claims.email,
  };
}

export async function verifyAccessJwt(token, accessConfig) {
  if (!accessConfig?.audience) throw authError('Cloudflare Access audience is not configured.');
  const parts = String(token).split('.');
  if (parts.length !== 3) throw authError('Invalid Cloudflare Access token.');
  const header = parseJwtJson(parts[0]);
  const payload = parseJwtJson(parts[1]);
  if (header.alg !== 'RS256') throw authError('Unsupported Cloudflare Access token algorithm.');
  const key = await getJwk(header.kid, accessConfig);
  const publicKey = crypto.createPublicKey({ key, format: 'jwk' });
  const verified = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, base64urlDecode(parts[2]));
  if (!verified) throw authError('Invalid Cloudflare Access token signature.');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw authError('Cloudflare Access token is expired.');
  if (typeof payload.nbf === 'number' && payload.nbf > now + 30) throw authError('Cloudflare Access token is not active yet.');
  const expectedIssuer = accessConfig.teamDomain ? `https://${accessConfig.teamDomain}` : '';
  if (expectedIssuer && payload.iss !== expectedIssuer) throw authError('Cloudflare Access issuer mismatch.');
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(accessConfig.audience)) throw authError('Cloudflare Access audience mismatch.');
  return payload;
}

async function getJwk(kid, accessConfig) {
  if (!kid) throw authError('Cloudflare Access token is missing a key ID.');
  const jwks = await getJwks(accessConfig);
  const key = jwks.keys?.find((item) => item.kid === kid);
  if (!key) throw authError('Cloudflare Access key ID is not trusted.');
  return key;
}

async function getJwks(accessConfig) {
  if (accessConfig.jwksJson) return JSON.parse(accessConfig.jwksJson);
  if (!accessConfig.teamDomain) throw authError('Cloudflare Access team domain is not configured.');
  const cached = JWKS_CACHE.get(accessConfig.teamDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await fetch(`https://${accessConfig.teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw authError('Unable to load Cloudflare Access public keys.');
  const value = await response.json();
  JWKS_CACHE.set(accessConfig.teamDomain, { value, expiresAt: Date.now() + 10 * 60 * 1000 });
  return value;
}

function parseJwtJson(part) {
  try {
    return JSON.parse(base64urlDecode(part).toString('utf8'));
  } catch {
    throw authError('Invalid Cloudflare Access token JSON.');
  }
}

function base64urlDecode(value) {
  return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function authError(message) {
  return Object.assign(new Error(message), { statusCode: 401 });
}
