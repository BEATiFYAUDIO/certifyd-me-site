import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { validateRunId } from './security.js';
import { normalizeArticleTitle, selectArticleCoverImage } from './article-utils.js';

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
    const directRepublish = this.config.mode === 'direct' && ['PUBLISHING', 'PUBLISHED'].includes(run.summary.status);
    if (run.summary.publishability !== 'READY_TO_PUBLISH' && !directRepublish) {
      throw Object.assign(new Error('Run is not ready for publishing.'), { statusCode: 409 });
    }
    const pkg = run.blogPackage || {};
    const slug = safeSlug(pkg.slug || run.summary.slug || runId);
    const title = normalizeArticleTitle(pkg.title || run.summary.title);
    const markdown = buildBlogMarkdown(pkg, run);
    const installationToken = await this.createInstallationToken();
    const generatedFiles = await this.buildGeneratedSiteFiles(slug, markdown, {
      repositoryConfig: this.config,
      token: installationToken,
      branchName: this.config.baseBranch,
    });
    if (this.config.mode === 'direct') {
      const commits = await putGeneratedFiles({
        config: this.config,
        token: installationToken,
        branchName: this.config.baseBranch,
        files: generatedFiles,
        message: `Publish blog article: ${title}`,
      });
      const mirrors = await this.publishMirrors({ files: generatedFiles, message: `Publish blog article: ${title}`, action: 'publish' });
      return {
        ok: true,
        output: [
          `Published directly to ${this.config.baseBranch}: ${pkg.canonicalUrl || run.summary.canonicalUrl || `https://certifyd.me/blog/${slug}/`}`,
          ...mirrorOutputLines(mirrors, 'Mirrored to', 'Preview mirror failed'),
        ].join('\n'),
        publishMode: 'direct',
        commitUrls: commitUrls(commits),
        mirrors,
        branchName: this.config.baseBranch,
        repositoryPath: `content/blog/${slug}.md`,
        canonicalUrl: pkg.canonicalUrl || run.summary.canonicalUrl || `https://certifyd.me/blog/${slug}/`,
      };
    }
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
        message: `Publish blog article: ${title}`,
      });
    }
    const pull = await githubJson(this.config, installationToken, `/repos/${this.config.owner}/${this.config.repo}/pulls`, {
      method: 'POST',
      body: {
        title: `Content review: ${title}`,
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

  async createUnpublishPullRequest({ actor, runId }) {
    validateRunId(runId);
    if (!this.isConfigured()) {
      throw Object.assign(new Error('GitHub publishing is not configured. Provide either GitHub App credentials or CONTENT_DASHBOARD_GITHUB_TOKEN.'), { statusCode: 503 });
    }
    const run = await this.runs.readRun(runId);
    const pkg = run.blogPackage || {};
    const slug = safeSlug(pkg.slug || run.summary.slug || runId);
    const title = normalizeArticleTitle(pkg.title || run.summary.title);
    const markdown = buildBlogMarkdown(pkg, run, { status: 'archived' });
    const installationToken = await this.createInstallationToken();
    const generatedFiles = await this.buildGeneratedSiteFiles(slug, markdown, {
      includeArticlePage: false,
      repositoryConfig: this.config,
      token: installationToken,
      branchName: this.config.baseBranch,
    });
    if (this.config.mode === 'direct') {
      const commits = await putGeneratedFiles({
        config: this.config,
        token: installationToken,
        branchName: this.config.baseBranch,
        files: generatedFiles,
        message: `Unpublish blog article: ${title}`,
      });
      const deleted = await deleteRepositoryFileIfExists({
        config: this.config,
        token: installationToken,
        branchName: this.config.baseBranch,
        filePath: `blog/${slug}/index.html`,
        message: `Remove generated blog article page: ${title}`,
      });
      const mirrors = await this.publishMirrors({ files: generatedFiles, message: `Unpublish blog article: ${title}`, action: 'unpublish', removedPath: `blog/${slug}/index.html` });
      return {
        ok: true,
        output: [
          `Unpublished directly from ${this.config.baseBranch}: ${pkg.canonicalUrl || run.summary.canonicalUrl || `https://certifyd.me/blog/${slug}/`}`,
          ...mirrorOutputLines(mirrors, 'Mirrored unpublish to', 'Preview unpublish mirror failed'),
        ].join('\n'),
        publishMode: 'direct',
        commitUrls: commitUrls([...commits, deleted]),
        mirrors,
        branchName: this.config.baseBranch,
        repositoryPath: `content/blog/${slug}.md`,
        removedPath: `blog/${slug}/index.html`,
        canonicalUrl: pkg.canonicalUrl || run.summary.canonicalUrl || `https://certifyd.me/blog/${slug}/`,
      };
    }
    const branchName = `${this.config.branchPrefix}/unpublish-${slug}-${Date.now()}`;
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
        message: `Unpublish blog article: ${title}`,
      });
    }
    await deleteRepositoryFileIfExists({
      config: this.config,
      token: installationToken,
      branchName,
      filePath: `blog/${slug}/index.html`,
      message: `Remove generated blog article page: ${title}`,
    });
    const pull = await githubJson(this.config, installationToken, `/repos/${this.config.owner}/${this.config.repo}/pulls`, {
      method: 'POST',
      body: {
        title: `Unpublish content: ${title}`,
        head: branchName,
        base: this.config.baseBranch,
        draft: true,
        body: [
          `Prepared by ${actor.email} from Content Engine run \`${runId}\`.`,
          '',
          'This PR archives the canonical Markdown, regenerates public blog listings, and removes the generated article route. Review before merging.',
        ].join('\n'),
      },
    }, 'GitHub draft PR creation failed');
    return {
      ok: true,
      output: `Draft unpublish PR created: ${pull.html_url}`,
      pullRequestUrl: pull.html_url,
      branchName,
      repositoryPath: `content/blog/${slug}.md`,
      removedPath: `blog/${slug}/index.html`,
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

  async publishMirrors({ files, message, action, removedPath = '' }) {
    const mirrors = Array.isArray(this.config.mirrors) ? this.config.mirrors.filter((mirror) => mirror?.enabled) : [];
    if (!mirrors.length) return [];
    const results = [];
    for (const mirror of mirrors) {
      try {
        const mirrorToken = mirror.token || await this.createInstallationToken();
        const mirrorBranch = mirror.baseBranch || this.config.baseBranch;
        const mirrorFiles = await filesForMirror({ files, mirror, token: mirrorToken, branchName: mirrorBranch });
        const commits = await putGeneratedFiles({
          config: mirror,
          token: mirrorToken,
          branchName: mirrorBranch,
          files: mirrorFiles,
          message,
        });
        let deleted;
        if (action === 'unpublish' && removedPath) {
          deleted = await deleteRepositoryFileIfExists({
            config: mirror,
            token: mirrorToken,
            branchName: mirrorBranch,
            filePath: removedPath,
            message: `Remove generated blog article page from mirror`,
          });
        }
        results.push({
          ok: true,
          owner: mirror.owner,
          repo: mirror.repo,
          branchName: mirrorBranch,
          publicUrl: mirror.publicUrl || '',
          commitUrls: commitUrls([...commits, deleted]),
        });
      } catch (error) {
        results.push({
          ok: false,
          owner: mirror.owner,
          repo: mirror.repo,
          branchName: mirror.baseBranch || this.config.baseBranch,
          publicUrl: mirror.publicUrl || '',
          error: error.message,
        });
      }
    }
    return results;
  }

  async buildGeneratedSiteFiles(slug, markdown, options = {}) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-blog-publish-'));
    try {
      await fs.mkdir(path.join(tempRoot, 'content'), { recursive: true });
      await fs.cp(path.join(this.siteRoot, 'content', 'blog'), path.join(tempRoot, 'content', 'blog'), { recursive: true });
      if (options.repositoryConfig && options.token && options.branchName) {
        await hydrateBlogSourcesFromRepository({
          config: options.repositoryConfig,
          token: options.token,
          branchName: options.branchName,
          targetDir: path.join(tempRoot, 'content', 'blog'),
        });
      }
      await fs.cp(path.join(this.siteRoot, 'templates'), path.join(tempRoot, 'templates'), { recursive: true });
      await fs.copyFile(path.join(this.siteRoot, 'index.html'), path.join(tempRoot, 'index.html'));
      await fs.writeFile(path.join(tempRoot, 'content', 'blog', `${slug}.md`), markdown);
      await runBuildBlog(this.siteRoot, tempRoot);
      const paths = [
        `content/blog/${slug}.md`,
        'blog/index.html',
        'feed.xml',
        'robots.txt',
        'sitemap.xml',
        'index.html',
      ];
      const indexNowFile = indexNowKeyFileName();
      if (indexNowFile) paths.push(indexNowFile);
      if (options.includeArticlePage !== false) paths.splice(2, 0, `blog/${slug}/index.html`);
      const files = [];
      for (const filePath of paths) {
        const fullPath = path.join(tempRoot, filePath);
        try {
          files.push({ path: filePath, content: await fs.readFile(fullPath, 'utf8') });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      const coverImagePath = coverImagePathFromMarkdown(markdown);
      if (coverImagePath) {
        const imagePath = coverImagePath.replace(/^\//, '');
        const fullImagePath = path.join(this.siteRoot, imagePath);
        if (fullImagePath.startsWith(this.siteRoot)) {
          const stat = await fs.stat(fullImagePath).catch(() => null);
          if (stat?.isFile()) files.push({ path: imagePath, content: await fs.readFile(fullImagePath) });
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

  async createUnpublishPullRequest() {
    throw Object.assign(new Error('Publishing adapter is disabled.'), { statusCode: 503 });
  }
}

export function createPublisher(config, runs) {
  if (config.githubPublishing?.enabled) return new GitHubPullRequestPublisher(config, runs);
  return new DisabledPublisher();
}

function buildBlogMarkdown(pkg, run, options = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const tags = Array.isArray(pkg.tags)
    ? pkg.tags
    : Array.isArray(pkg.keywords)
      ? pkg.keywords
      : [];
  const frontmatter = {
    title: normalizeArticleTitle(pkg.title || run.summary.title),
    slug: safeSlug(pkg.slug || run.summary.slug || run.summary.runId),
    author: pkg.author || 'Certifyd',
    date: pkg.date || today,
    updated: pkg.updated || today,
    excerpt: pkg.excerpt || pkg.description || run.summary.summary || '',
    coverImage: selectArticleCoverImage({
      requestedCoverImage: pkg.coverImage || pkg.image,
      title: pkg.title || run.summary.title,
      tags,
      excerpt: pkg.excerpt || pkg.description || run.summary.summary || '',
      body: run.articleMarkdown || pkg.body || '',
    }),
    coverImageAlt: pkg.coverImageAlt || '',
    coverImageCredit: pkg.coverImageCredit || '',
    coverImageCreditUrl: pkg.coverImageCreditUrl || '',
    coverImageProvider: pkg.coverImageProvider || '',
    tags,
    status: options.status || 'published',
    seoTitle: normalizeArticleTitle(pkg.seoTitle || '', ''),
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
  return githubJson(config, token, `/repos/${config.owner}/${config.repo}/contents/${encodedPath}`, {
    method: 'PUT',
    body: {
      message,
      content: Buffer.isBuffer(content) ? content.toString('base64') : Buffer.from(content).toString('base64'),
      branch: branchName,
      ...(sha ? { sha } : {}),
      committer: {
        name: 'Certifyd Content Dashboard',
        email: 'content-dashboard@certifyd.me',
      },
    },
  }, `GitHub file write failed for ${filePath}`);
}

async function putGeneratedFiles({ config, token, branchName, files, message }) {
  const normalizedFiles = (Array.isArray(files) ? files : []).filter((file) => file?.path);
  if (!normalizedFiles.length) return [];

  const ref = await githubJson(
    config,
    token,
    `/repos/${config.owner}/${config.repo}/git/ref/heads/${encodeURIComponent(branchName)}`,
    {},
    `GitHub branch lookup failed for ${branchName}`,
  );
  const baseCommitSha = ref?.object?.sha;
  if (!baseCommitSha) {
    throw Object.assign(new Error(`GitHub branch lookup failed for ${branchName}: missing commit SHA.`), { statusCode: 502 });
  }

  const baseCommit = await githubJson(
    config,
    token,
    `/repos/${config.owner}/${config.repo}/git/commits/${encodeURIComponent(baseCommitSha)}`,
    {},
    `GitHub base commit lookup failed for ${baseCommitSha}`,
  );
  const baseTreeSha = baseCommit?.tree?.sha;
  if (!baseTreeSha) {
    throw Object.assign(new Error(`GitHub base commit lookup failed for ${baseCommitSha}: missing tree SHA.`), { statusCode: 502 });
  }

  const tree = [];
  for (const file of normalizedFiles) {
    const blob = await githubJson(
      config,
      token,
      `/repos/${config.owner}/${config.repo}/git/blobs`,
      {
        method: 'POST',
        body: {
          content: Buffer.isBuffer(file.content) ? file.content.toString('base64') : Buffer.from(String(file.content)).toString('base64'),
          encoding: 'base64',
        },
      },
      `GitHub blob creation failed for ${file.path}`,
    );
    tree.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }
  const nextTree = await githubJson(
    config,
    token,
    `/repos/${config.owner}/${config.repo}/git/trees`,
    {
      method: 'POST',
      body: {
        base_tree: baseTreeSha,
        tree,
      },
    },
    'GitHub tree creation failed',
  );
  if (nextTree?.sha && nextTree.sha === baseTreeSha) {
    return [];
  }
  const nextCommit = await githubJson(
    config,
    token,
    `/repos/${config.owner}/${config.repo}/git/commits`,
    {
      method: 'POST',
      body: {
        message,
        tree: nextTree.sha,
        parents: [baseCommitSha],
        author: {
          name: 'Certifyd Content Dashboard',
          email: 'content-dashboard@certifyd.me',
        },
        committer: {
          name: 'Certifyd Content Dashboard',
          email: 'content-dashboard@certifyd.me',
        },
      },
    },
    'GitHub commit creation failed',
  );
  const updatedRef = await githubJson(
    config,
    token,
    `/repos/${config.owner}/${config.repo}/git/refs/heads/${encodeURIComponent(branchName)}`,
    {
      method: 'PATCH',
      body: {
        sha: nextCommit.sha,
        force: false,
      },
    },
    `GitHub branch update failed for ${branchName}`,
  );
  return [{ commit: nextCommit, content: { html_url: nextCommit.html_url || updatedRef?.object?.url || '' } }];
}

async function hydrateBlogSourcesFromRepository({ config, token, branchName, targetDir }) {
  const entries = await getRepositoryDirectoryEntries({
    config,
    token,
    branchName,
    dirPath: 'content/blog',
  });
  if (!entries.length) return;
  await fs.mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    const name = String(entry.name || '').trim();
    if (!/^[a-z0-9][a-z0-9-]*\.md$/i.test(name)) continue;
    const filePath = `content/blog/${name}`;
    const content = await getRepositoryFileContent({ config, token, branchName, filePath });
    await fs.writeFile(path.join(targetDir, name), content, 'utf8');
  }
}

async function getRepositoryDirectoryEntries({ config, token, branchName, dirPath }) {
  const encodedPath = dirPath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`, {
    headers: githubHeaders(token),
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`GitHub directory lookup failed for ${dirPath}: HTTP ${response.status}. ${text.slice(0, 300)}`), { statusCode: response.status === 401 || response.status === 403 ? 403 : 502 });
  }
  const json = await response.json();
  return Array.isArray(json) ? json : [];
}

async function filesForMirror({ files, mirror = {}, token, branchName }) {
  const sourceOrigin = mirror.sourceOrigin || 'https://certifyd.me';
  const targetOrigin = mirror.publicUrl || '';
  const exclude = new Set(['index.html', ...(mirror.excludePaths || [])]);
  const mirrorFiles = files
    .filter((file) => !exclude.has(file.path))
    .map((file) => ({
      path: file.path,
      content: rewriteMirrorContent(file.content, sourceOrigin, targetOrigin),
    }));
  if (mirror.preserveIndexBlogSection !== false) {
    const sourceIndex = files.find((file) => file.path === 'index.html' && !Buffer.isBuffer(file.content));
    const blogSection = extractBlogRecentSection(sourceIndex?.content || '');
    if (blogSection) {
      const currentIndex = await getRepositoryFileContent({ config: mirror, token, branchName, filePath: 'index.html' });
      const patchedIndex = replaceBlogRecentSection(currentIndex, rewriteMirrorContent(blogSection, sourceOrigin, targetOrigin));
      if (patchedIndex) mirrorFiles.push({ path: 'index.html', content: patchedIndex });
    }
  }
  return mirrorFiles;
}

function rewriteMirrorContent(content, sourceOrigin, targetOrigin) {
  if (!targetOrigin || Buffer.isBuffer(content)) return content;
  return String(content).replaceAll(sourceOrigin, targetOrigin);
}

function commitUrls(commits) {
  return commits.map((commit) => commit?.content?.html_url || commit?.commit?.html_url || '').filter(Boolean);
}

function mirrorOutputLines(mirrors, successPrefix, failurePrefix) {
  return mirrors.map((mirror) => mirror.ok
    ? `${successPrefix} ${mirror.owner}/${mirror.repo}@${mirror.branchName}: ${mirror.publicUrl}`
    : `${failurePrefix} for ${mirror.owner}/${mirror.repo}@${mirror.branchName}: ${mirror.error}`);
}

async function getRepositoryFileContent({ config, token, branchName, filePath }) {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`, {
    headers: githubHeaders(token),
  });
  if (response.status === 404) return '';
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`GitHub mirror file lookup failed for ${filePath}: HTTP ${response.status}. ${text.slice(0, 300)}`), { statusCode: response.status === 401 || response.status === 403 ? 403 : 502 });
  }
  const json = await response.json();
  return Buffer.from(String(json.content || ''), 'base64').toString('utf8');
}

function extractBlogRecentSection(indexHtml) {
  const value = String(indexHtml || '');
  const markerStart = '<!-- BLOG_RECENT_START -->';
  const markerEnd = '<!-- BLOG_RECENT_END -->';
  const start = value.indexOf(markerStart);
  const end = value.indexOf(markerEnd, start);
  if (start !== -1 && end !== -1) return value.slice(start, end + markerEnd.length);
  const sectionStart = value.indexOf('<section class="wrap blog-home-section"');
  if (sectionStart === -1) return '';
  const sectionEnd = value.indexOf('\n  </main>', sectionStart);
  if (sectionEnd === -1) return '';
  return value.slice(sectionStart, sectionEnd).trim();
}

function replaceBlogRecentSection(indexHtml, blogSection) {
  const value = String(indexHtml || '');
  if (!value || !blogSection) return '';
  const markerStart = '<!-- BLOG_RECENT_START -->';
  const markerEnd = '<!-- BLOG_RECENT_END -->';
  const markedStart = value.indexOf(markerStart);
  const markedEnd = value.indexOf(markerEnd, markedStart);
  if (markedStart !== -1 && markedEnd !== -1) {
    return `${value.slice(0, markedStart)}${blogSection}${value.slice(markedEnd + markerEnd.length)}`;
  }
  const sectionStart = value.indexOf('<section class="wrap blog-home-section"');
  const mainEnd = value.indexOf('\n  </main>', sectionStart);
  if (sectionStart !== -1 && mainEnd !== -1) {
    return `${value.slice(0, sectionStart)}${blogSection}${value.slice(mainEnd)}`;
  }
  const fallbackMainEnd = value.indexOf('\n  </main>');
  if (fallbackMainEnd !== -1) return `${value.slice(0, fallbackMainEnd)}\n\n${blogSection}${value.slice(fallbackMainEnd)}`;
  return '';
}

async function deleteRepositoryFileIfExists({ config, token, branchName, filePath, message }) {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const lookup = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`, {
    headers: githubHeaders(token),
  });
  if (lookup.status === 404) return;
  if (!lookup.ok) {
    const text = await lookup.text();
    throw Object.assign(new Error(`GitHub file lookup failed for ${filePath}: HTTP ${lookup.status}. ${text.slice(0, 300)}`), { statusCode: lookup.status === 401 || lookup.status === 403 ? 403 : 502 });
  }
  const existing = await lookup.json();
  return githubJson(config, token, `/repos/${config.owner}/${config.repo}/contents/${encodedPath}`, {
    method: 'DELETE',
    body: {
      message,
      sha: existing.sha,
      branch: branchName,
      committer: {
        name: 'Certifyd Content Dashboard',
        email: 'content-dashboard@certifyd.me',
      },
    },
  }, `GitHub file delete failed for ${filePath}`);
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

function coverImagePathFromMarkdown(markdown) {
  const match = String(markdown || '').match(/^coverImage:\s*["']?(\/images\/[^"'\n]+)["']?\s*$/m);
  if (!match?.[1]) return '';
  if (match[1].includes('\\') || match[1].includes('..') || /%2f|%5c/i.test(match[1])) return '';
  return match[1];
}

function indexNowKeyFileName() {
  const key = String(process.env.CONTENT_DASHBOARD_INDEXNOW_KEY || process.env.INDEXNOW_KEY || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) return '';
  return `${key}.txt`;
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
