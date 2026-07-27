import crypto from 'node:crypto';
import { validateRunId } from './security.js';

export class GitHubPullRequestPublisher {
  constructor(config, runs) {
    this.config = config.githubPublishing;
    this.runs = runs;
  }

  isConfigured() {
    return Boolean(
      this.config.enabled &&
      this.config.owner &&
      this.config.repo &&
      this.config.appId &&
      this.config.installationId &&
      this.config.privateKey,
    );
  }

  async createPullRequest({ actor, runId }) {
    validateRunId(runId);
    if (!this.isConfigured()) {
      throw Object.assign(new Error('GitHub App publishing is not configured.'), { statusCode: 503 });
    }
    const run = await this.runs.readRun(runId);
    if (run.summary.publishability !== 'READY_TO_PUBLISH') {
      throw Object.assign(new Error('Run is not ready for publishing.'), { statusCode: 409 });
    }
    const pkg = run.blogPackage || {};
    const slug = safeSlug(pkg.slug || run.summary.slug || runId);
    const markdown = buildBlogMarkdown(pkg, run);
    const installationToken = await this.createInstallationToken();
    const branchName = `${this.config.branchPrefix}/${slug}-${Date.now()}`;
    const baseRef = await githubJson(this.config, installationToken, `/repos/${this.config.owner}/${this.config.repo}/git/ref/heads/${this.config.baseBranch}`);
    await githubJson(this.config, installationToken, `/repos/${this.config.owner}/${this.config.repo}/git/refs`, {
      method: 'POST',
      body: {
        ref: `refs/heads/${branchName}`,
        sha: baseRef.object.sha,
      },
    });
    await githubJson(this.config, installationToken, `/repos/${this.config.owner}/${this.config.repo}/contents/content/blog/${slug}.md`, {
      method: 'PUT',
      body: {
        message: `Add blog draft: ${pkg.title || run.summary.title}`,
        content: Buffer.from(markdown).toString('base64'),
        branch: branchName,
        committer: {
          name: 'Certifyd Content Dashboard',
          email: 'content-dashboard@certifyd.me',
        },
      },
    });
    const pull = await githubJson(this.config, installationToken, `/repos/${this.config.owner}/${this.config.repo}/pulls`, {
      method: 'POST',
      body: {
        title: `Content review: ${pkg.title || run.summary.title}`,
        head: branchName,
        base: this.config.baseBranch,
        draft: true,
        body: [
          `Prepared by ${actor.email} from Content Engine run \`${runId}\`.`,
          '',
          'This PR is draft-only. Review content, metadata, and generated pages before merging.',
        ].join('\n'),
      },
    });
    return { ok: true, output: `Draft PR created: ${pull.html_url}` };
  }

  async createInstallationToken() {
    const appJwt = createGitHubAppJwt(this.config);
    const response = await fetch(`https://api.github.com/app/installations/${this.config.installationId}/access_tokens`, {
      method: 'POST',
      headers: githubHeaders(appJwt),
    });
    if (!response.ok) throw new Error(`GitHub installation token failed: ${response.status}`);
    const json = await response.json();
    return json.token;
  }
}

export class DisabledPublisher {
  isConfigured() {
    return false;
  }

  async createPullRequest() {
    throw Object.assign(new Error('Publishing adapter is disabled.'), { statusCode: 503 });
  }
}

export function createPublisher(config, runs) {
  if (config.githubPublishing?.enabled) return new GitHubPullRequestPublisher(config, runs);
  return new DisabledPublisher();
}

function buildBlogMarkdown(pkg, run) {
  const today = new Date().toISOString().slice(0, 10);
  const tags = Array.isArray(pkg.tags)
    ? pkg.tags
    : Array.isArray(pkg.keywords)
      ? pkg.keywords
      : [];
  const frontmatter = {
    title: pkg.title || run.summary.title,
    slug: safeSlug(pkg.slug || run.summary.slug || run.summary.runId),
    author: pkg.author || 'Certifyd',
    date: pkg.date || today,
    updated: pkg.updated || today,
    excerpt: pkg.excerpt || pkg.description || run.summary.summary || '',
    coverImage: pkg.coverImage || pkg.image || '/images/certifyd-main-image-independent-scene-20260613.png',
    tags,
    status: 'published',
    seoTitle: pkg.seoTitle || '',
    seoDescription: pkg.seoDescription || pkg.description || '',
  };
  const yaml = Object.entries(frontmatter).map(([key, value]) => `${key}: ${yamlValue(value)}`).join('\n');
  return `---\n${yaml}\n---\n\n${run.articleMarkdown || pkg.body || ''}\n`;
}

function yamlValue(value) {
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(String(item))).join(', ')}]`;
  if (typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

function safeSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'untitled';
}

async function githubJson(config, token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || 'GET',
    headers: githubHeaders(token),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub API failed ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'certifyd-content-dashboard',
  };
}

function createGitHubAppJwt(config) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.appId }));
  const privateKey = normalizePrivateKey(config.privateKey);
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

function normalizePrivateKey(value) {
  const clean = String(value);
  if (clean.includes('BEGIN')) return clean.replace(/\\n/g, '\n');
  return Buffer.from(clean, 'base64').toString('utf8');
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}
