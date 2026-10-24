import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const BLOGGER_REDIRECT_URI = 'https://admin.certifyd.me/app/content/oauth/blogger/callback';
const BLOGGER_SCOPE = 'https://www.googleapis.com/auth/blogger';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const BLOGGER_API = 'https://www.googleapis.com/blogger/v3';

export class BloggerOAuth {
  constructor(config) {
    this.config = config;
    this.file = path.join(config.agentRoot || path.resolve('content-agent'), 'dashboard', 'blogger-oauth.enc.json');
    this.pending = new Map();
    this.access = null;
  }

  configured() {
    const env = this.config.env || process.env;
    return Boolean(env.CONTENT_DISTRIBUTION_BLOGGER_CLIENT_ID && env.CONTENT_DISTRIBUTION_BLOGGER_CLIENT_SECRET && env.CONTENT_DISTRIBUTION_BLOGGER_BLOG_ID);
  }

  blogId() { return String(this.config.env.CONTENT_DISTRIBUTION_BLOGGER_BLOG_ID || '').trim(); }

  async connected() { return Boolean(await this.readRefreshToken()); }

  start({ actor, sessionId }) {
    if (!this.configured()) throw publicError(409, 'Configure the Blogger OAuth client ID, client secret, and blog ID on the server first.');
    if (this.config.publicAdminUrl !== new URL(BLOGGER_REDIRECT_URI).origin) throw publicError(409, 'Blogger OAuth requires the dashboard public URL to be https://admin.certifyd.me.');
    if (!this.config.sessionSecret) throw publicError(503, 'Dashboard session secret is required for Blogger OAuth.');
    const state = crypto.randomBytes(32).toString('base64url');
    this.pending.set(state, { actorId: actor.id, sessionId, expiresAt: Date.now() + 10 * 60_000 });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: this.config.env.CONTENT_DISTRIBUTION_BLOGGER_CLIENT_ID, redirect_uri: BLOGGER_REDIRECT_URI, response_type: 'code', scope: BLOGGER_SCOPE, access_type: 'offline', prompt: 'consent', state }).toString();
    return url.toString();
  }

  async complete({ actor, sessionId, state, code, error }) {
    const pending = this.pending.get(String(state || ''));
    if (!pending || pending.expiresAt < Date.now() || pending.actorId !== actor.id || pending.sessionId !== sessionId) throw publicError(403, 'Blogger OAuth state validation failed. Start the connection again.');
    this.pending.delete(state);
    if (error) throw publicError(409, 'Google did not authorize the Blogger connection.');
    if (!code || typeof code !== 'string' || code.length > 4096) throw publicError(400, 'Blogger OAuth authorization code is missing or invalid.');
    const tokens = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: BLOGGER_REDIRECT_URI });
    if (!tokens.refresh_token) throw publicError(409, 'Google did not return a refresh token. Disconnect the app in Google Account permissions and retry Connect Blogger.');
    if (!tokens.access_token) throw publicError(502, 'Google did not return an access token.');
    const blog = await this.verifyBlog(tokens.access_token);
    await this.writeRefreshToken(tokens.refresh_token);
    this.cacheAccess(tokens);
    return blog;
  }

  async testConnection() {
    if (!this.configured()) return { status: 'not_connected', label: 'Not connected', message: 'Blogger OAuth credentials are not configured.' };
    if (!await this.connected()) return { status: 'not_connected', label: 'Not connected', message: 'Connect Blogger with the founder Google account first.' };
    const blog = await this.verifyBlog(await this.accessToken());
    return { status: 'connected', label: 'Connected', message: `Blogger blog ${blog.name || blog.id} verified.`, accountId: String(blog.id) };
  }

  async accessToken() {
    if (this.access && this.access.expiresAt > Date.now() + 60_000) return this.access.token;
    const refreshToken = await this.readRefreshToken();
    if (!refreshToken) throw publicError(409, 'Blogger is not connected. Connect Blogger first.');
    const tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (!tokens.access_token) throw new Error('Google token refresh returned no access token.');
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) await this.writeRefreshToken(tokens.refresh_token);
    this.cacheAccess(tokens);
    return this.access.token;
  }

  async disconnect() {
    this.pending.clear();
    this.access = null;
    await fs.unlink(this.file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }

  async verifyBlog(accessToken) {
    const response = await fetch(`${BLOGGER_API}/users/self/blogs?fetchUserInfo=true`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Blogger account verification failed: HTTP ${response.status}. Response body withheld.`);
    const data = await response.json();
    const blog = (Array.isArray(data.items) ? data.items : []).find((item) => String(item.id) === this.blogId())
      || (Array.isArray(data.blogUserInfos) ? data.blogUserInfos : []).map((item) => item.blog).find((item) => String(item?.id) === this.blogId());
    if (!blog) throw publicError(409, 'The authorized Google account cannot access the configured Blogger blog.');
    return blog;
  }

  async tokenRequest(fields) {
    const response = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.config.env.CONTENT_DISTRIBUTION_BLOGGER_CLIENT_ID, client_secret: this.config.env.CONTENT_DISTRIBUTION_BLOGGER_CLIENT_SECRET, ...fields }), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Google Blogger OAuth token exchange failed: HTTP ${response.status}. Response body withheld.`);
    const tokens = await response.json();
    if (!tokens || typeof tokens !== 'object') throw new Error('Google Blogger OAuth returned invalid token data.');
    return tokens;
  }

  cacheAccess(tokens) {
    this.access = { token: tokens.access_token, expiresAt: Date.now() + Math.max(0, Number(tokens.expires_in) || 0) * 1000 };
  }

  key() {
    if (!this.config.sessionSecret) throw new Error('Dashboard session secret is required for Blogger token encryption.');
    return crypto.createHash('sha256').update(`certifyd-blogger-oauth-v1:${this.config.sessionSecret}`).digest();
  }

  async readRefreshToken() {
    let data;
    try { data = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('Blogger token storage is unreadable.'); }
    try {
      if (data.version !== 1 || !data.iv || !data.tag || !data.value) throw new Error('Invalid token envelope');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), Buffer.from(data.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data.value, 'base64')), decipher.final()]).toString('utf8');
    } catch { throw new Error('Blogger token storage cannot be decrypted. Check the dashboard session secret.'); }
  }

  async writeRefreshToken(token) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const value = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const envelope = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), value: value.toString('base64') });
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, envelope, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.file);
      await fs.chmod(this.file, 0o600);
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
}

function publicError(statusCode, message) { return Object.assign(new Error(message), { statusCode }); }
