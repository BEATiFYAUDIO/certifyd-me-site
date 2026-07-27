import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { validateRunId } from './security.js';

export class GitHubPullRequestPublisher {
  constructor(config, runs) {
    this.siteRoot = config.siteRoot || process.cwd();
    this.config = config.githubPublishing;
    this.runs = runs;
  }

  isConfigured() {
    if (this.config.enabled && this.config.owner && this.config.repo && this.config.token) return true;
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
      throw Object.assign(new Error('GitHub publishing is not configured. Provide either GitHub App credentials or CONTENT_DASHBOARD_GITHUB_TOKEN.'), { statusCode: 503 });
    }
    const run = await this.runs.readRun(runId);
    if (run.summary.publishability !== 'READY_TO_PUBLISH') {
      throw Object.assign(new Error('Run is not ready for publishing.'), { statusCode: 409 });
    }
    const pkg = run.blogPackage || {};
    const slug = safeSlug(pkg.slug || run.summary.slug || runId);
    const markdown = buildBlogMarkdown(pkg, run);
    const generatedFiles = await this.buildGeneratedSiteFiles(slug, markdown);
    const installationToken = await this.createInstallationToken();
    const branchName = `${this.config.branchPrefix}/${slug}-${Date.now()}`;
    const baseRef = await githubJson(this.config, installationToken, `/repos/${this.config.owner}/${this.config.repo}/git/ref/heads/${this.config.baseBranch}`, {}, 'GitHub base branch lookup failed');
    await githubJson(this.config, installationToken, `/repos/${this.config.owner}/${this.config.repo}/git/refs`, {
      method: 'POST',
      body: {
        ref: `refs/heads/${branchName}`,
        sha: baseRef.object.sha,
      },
    }, 'GitHub branch creation failed');
    for (const file of generatedFiles) {
      await putRepositoryFile({
        config: this.config,
        token: installationToken,
        branchName,
        filePath: file.path,
        content: file.content,
        message: `Publish blog article: ${pkg.title || run.summary.title}`,
      });
    }
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
          'This PR includes canonical Markdown and generated static blog output. Review content and metadata before merging.',
        ].join('\n'),
      },
    }, 'GitHub draft PR creation failed');
    return {
      ok: true,
      output: `Draft PR created: ${pull.html_url}`,
      pullRequestUrl: pull.html_url,
      branchName,
      repositoryPath: `content/blog/${slug}.md`,
      canonicalUrl: pkg.canonicalUrl || run.summary.canonicalUrl || `https://certifyd.me/blog/${slug}/`,
    };
  }

  async createInstallationToken() {
    if (this.config.token) return this.config.token;
    const appJwt = createGitHubAppJwt(this.config);
    const response = await fetch(`https://api.github.com/app/installations/${this.config.installationId}/access_tokens`, {
      method: 'POST',
      headers: githubHeaders(appJwt),
    });
    if (!response.ok) throw Object.assign(new Error(`GitHub authentication failed: installation token returned HTTP ${response.status}.`), { statusCode: response.status === 401 || response.status === 403 ? 403 : 502 });
    const json = await response.json();
    return json.token;
  }

  async buildGeneratedSiteFiles(slug, markdown) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-blog-publish-'));
    try {
      await fs.mkdir(path.join(tempRoot, 'content'), { recursive: true });
      await fs.cp(path.join(this.siteRoot, 'content', 'blog'), path.join(tempRoot, 'content', 'blog'), { recursive: true });
      await fs.cp(path.join(this.siteRoot, 'templates'), path.join(tempRoot, 'templates'), { recursive: true });
      await fs.copyFile(path.join(this.siteRoot, 'index.html'), path.join(tempRoot, 'index.html'));
      await fs.writeFile(path.join(tempRoot, 'content', 'blog', `${slug}.md`), markdown);
      await runBuildBlog(this.siteRoot, tempRoot);
      const paths = [
        `content/blog/${slug}.md`,
        'blog/index.html',
        `blog/${slug}/index.html`,
        'feed.xml',
        'index.html',
        'robots.txt',
        'sitemap.xml',
      ];
      const files = [];
      for (const filePath of paths) {
        const fullPath = path.join(tempRoot, filePath);
        try {
          files.push({ path: filePath, content: await fs.readFile(fullPath, 'utf8') });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      return files;
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
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
  return `---\n${yaml}\n---\n\n${stripMarkdownFrontmatter(run.articleMarkdown || pkg.body || '')}\n`;
}

function stripMarkdownFrontmatter(markdown) {
  const value = String(markdown || '');
  if (!value.startsWith('---')) return value;
  const end = value.indexOf('\n---', 3);
  if (end === -1) return value;
  const after = value.indexOf('\n', end + 4);
  return after === -1 ? '' : value.slice(after + 1).trimStart();
}

function yamlValue(value) {
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(String(item))).join(', ')}]`;
  if (typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

function safeSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'untitled';
}

async function githubJson(config, token, path, options = {}, failureMessage = 'GitHub request failed') {
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || 'GET',
    headers: githubHeaders(token),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw Object.assign(new Error(`${failureMessage}: HTTP ${response.status}. ${text.slice(0, 300)}`), { statusCode: response.status === 401 || response.status === 403 ? 403 : response.status === 404 ? 404 : 502 });
  return text ? JSON.parse(text) : {};
}

async function putRepositoryFile({ config, token, branchName, filePath, content, message }) {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  let sha = '';
  const lookup = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`, {
    headers: githubHeaders(token),
  });
  if (lookup.ok) {
    const existing = await lookup.json();
    sha = existing.sha || '';
  } else if (lookup.status !== 404) {
    const text = await lookup.text();
    throw Object.assign(new Error(`GitHub file lookup failed for ${filePath}: HTTP ${lookup.status}. ${text.slice(0, 300)}`), { statusCode: lookup.status === 401 || lookup.status === 403 ? 403 : 502 });
  }
  await githubJson(config, token, `/repos/${config.owner}/${config.repo}/contents/${encodedPath}`, {
    method: 'PUT',
    body: {
      message,
      content: Buffer.from(content).toString('base64'),
      branch: branchName,
      ...(sha ? { sha } : {}),
      committer: {
        name: 'Certifyd Content Dashboard',
        email: 'content-dashboard@certifyd.me',
      },
    },
  }, `GitHub file write failed for ${filePath}`);
}

function runBuildBlog(siteRoot, tempRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(siteRoot, 'scripts', 'build-blog.js')], {
      cwd: tempRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`Blog static generation failed before PR creation: ${output.slice(0, 1000)}`), { statusCode: 502 }));
    });
  });
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
