import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const LINKEDIN_REDIRECT_URI = 'https://admin.certifyd.me/app/content/oauth/linkedin/callback';
const SCOPES = ['w_organization_social', 'rw_organization_admin'];
const publicError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

export class LinkedInOAuth {
  constructor(config) {
    this.config = { ...config, env: config.env || process.env };
    this.file = path.join(config.agentRoot || path.resolve('content-agent'), 'dashboard', 'linkedin-oauth.enc.json');
    this.pending = new Map();
  }
  configured() { return ['CLIENT_ID', 'CLIENT_SECRET', 'ORGANIZATION_ID'].every(key => this.config.env[`CONTENT_DISTRIBUTION_LINKEDIN_${key}`]); }
  organizationId() {
    const id = String(this.config.env.CONTENT_DISTRIBUTION_LINKEDIN_ORGANIZATION_ID || '').trim();
    if (!/^\d+$/.test(id)) throw publicError(409, 'Configure the numeric LinkedIn company-page ID.');
    return id;
  }
  async connected() {
    const saved = await this.credentials();
    return Boolean(saved && saved.organizationId === this.organizationId() && saved.clientId === this.config.env.CONTENT_DISTRIBUTION_LINKEDIN_CLIENT_ID && saved.expiresAt > Date.now() + 60_000);
  }
  start({ actor, sessionId }) {
    if (!this.configured()) throw publicError(409, 'Configure the LinkedIn client ID, client secret, and company-page ID on the server first.');
    this.organizationId();
    if (this.config.publicAdminUrl !== new URL(LINKEDIN_REDIRECT_URI).origin || !this.config.sessionSecret) throw publicError(409, 'LinkedIn requires the secure admin.certifyd.me dashboard and its session secret.');
    for (const [state, pending] of this.pending) if (pending.expiresAt < Date.now()) this.pending.delete(state);
    const state = crypto.randomBytes(32).toString('base64url');
    this.pending.set(state, { actorId: actor.id, sessionId, expiresAt: Date.now() + 600_000 });
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.config.env.CONTENT_DISTRIBUTION_LINKEDIN_CLIENT_ID, redirect_uri: LINKEDIN_REDIRECT_URI, scope: SCOPES.join(' '), state }).toString();
    return url.href;
  }
  async complete({ actor, sessionId, state, code, error }) {
    const pending = this.pending.get(state);
    if (!pending || pending.expiresAt < Date.now() || pending.actorId !== actor.id || pending.sessionId !== sessionId) throw publicError(403, 'LinkedIn authorization expired or does not match this session. Connect again.');
    this.pending.delete(state);
    if (error) throw publicError(409, 'LinkedIn did not authorize the connection.');
    if (typeof code !== 'string' || !code || code.length > 4096) throw publicError(400, 'LinkedIn authorization code is missing or invalid.');
    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: LINKEDIN_REDIRECT_URI, client_id: this.config.env.CONTENT_DISTRIBUTION_LINKEDIN_CLIENT_ID, client_secret: this.config.env.CONTENT_DISTRIBUTION_LINKEDIN_CLIENT_SECRET }), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw publicError(502, `LinkedIn authorization failed (HTTP ${response.status}). Connect again.`);
    const tokens = await response.json();
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 60) throw publicError(502, 'LinkedIn returned an invalid or expired token.');
    if (tokens.scope && !SCOPES.every(scope => String(tokens.scope).split(/[ ,]+/).includes(scope))) throw publicError(409, 'LinkedIn did not grant the required company-page permissions.');
    const page = await this.verifyPage(tokens.access_token);
    await this.writeEncryptedCredentials(JSON.stringify({ accessToken: tokens.access_token, expiresAt: Date.now() + Number(tokens.expires_in) * 1000, organizationId: page.id, clientId: this.config.env.CONTENT_DISTRIBUTION_LINKEDIN_CLIENT_ID }));
    return page;
  }
  async credentials() {
    const raw = await this.readEncryptedCredentials();
    return raw ? JSON.parse(raw) : null;
  }
  async accessToken() {
    if (!await this.connected()) throw publicError(409, 'LinkedIn authorization is missing or expired. Reconnect LinkedIn.');
    return (await this.credentials()).accessToken;
  }
  async disconnect() { this.pending.clear(); await fs.unlink(this.file).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  headers(token) {
    const version = this.config.env.CONTENT_DISTRIBUTION_LINKEDIN_VERSION || '202610';
    if (!/^20\d{4}$/.test(version)) throw publicError(409, 'LinkedIn API version must use YYYYMM format.');
    return { Authorization: `Bearer ${token}`, 'Linkedin-Version': version, 'X-Restli-Protocol-Version': '2.0.0', Accept: 'application/json' };
  }
  async verifyPage(token) {
    const id = this.organizationId();
    for (let start = 0; start < 1000; start += 100) {
      const response = await fetch(`https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=100&start=${start}`, { headers: this.headers(token), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw publicError(409, `LinkedIn page verification failed (HTTP ${response.status}). Check app permissions and your page administrator access.`);
      const data = await response.json();
      const roles = Array.isArray(data.elements) ? data.elements : [];
      if (roles.some(item => (item.organizationTarget || item.organization) === `urn:li:organization:${id}` && item.state === 'APPROVED' && ['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR'].includes(item.role))) return { id };
      if (roles.length < 100) break;
    }
    throw publicError(409, 'The connected LinkedIn account cannot publish to the configured company page.');
  }
  async testConnection() {
    if (!this.configured() || !await this.connected()) return { status: 'not_connected', label: 'Not connected', message: 'Connect LinkedIn to authorize the configured company page.' };
    const page = await this.verifyPage(await this.accessToken());
    return { status: 'connected', label: 'Connected', message: `LinkedIn company page ${page.id} verified.`, accountId: `urn:li:organization:${page.id}` };
  }
  key() {
    if (!this.config.sessionSecret) throw new Error('Dashboard session secret is required for LinkedIn token encryption.');
    return crypto.createHash('sha256').update(`certifyd-linkedin-oauth-v1:${this.config.sessionSecret}`).digest();
  }

  async readEncryptedCredentials() {
    let data;
    try { data = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('LinkedIn token storage is unreadable.'); }
    try {
      if (data.version !== 1 || !data.iv || !data.tag || !data.value) throw new Error('Invalid token envelope');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), Buffer.from(data.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data.value, 'base64')), decipher.final()]).toString('utf8');
    } catch { throw new Error('LinkedIn token storage cannot be decrypted. Check the dashboard session secret.'); }
  }

  async writeEncryptedCredentials(token) {
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
