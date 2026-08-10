import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultOllamaConfig, normalizeProviderName } from './generation-provider.js';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultAgentRoot = path.resolve(siteRoot, 'content-agent');

export const CONTENT_PERMISSIONS = {
  founder: [
    'content.dashboard.view',
    'content.article.view',
    'content.article.create',
    'content.article.edit',
    'content.article.review',
    'content.article.approve',
    'content.article.publish.prepare',
    'content.article.archive',
    'content.article.delete',
    'brain.read',
    'brain.write',
    'content.distribution.manage',
    'content.distribution.view',
    'content.analytics.view',
    'content.publishing.view',
    'content.settings.manage',
  ],
  editor: [
    'content.dashboard.view',
    'content.article.view',
    'content.article.edit',
    'content.article.review',
    'content.article.archive',
    'content.article.delete',
    'brain.read',
    'content.distribution.manage',
    'content.distribution.view',
    'content.analytics.view',
    'content.publishing.view',
  ],
  writer: [
    'content.dashboard.view',
    'content.article.view',
    'content.article.create',
    'content.article.edit',
    'brain.read',
    'content.analytics.view',
  ],
  marketing: [
    'content.dashboard.view',
    'content.article.view',
    'content.distribution.manage',
    'content.distribution.view',
    'content.analytics.view',
  ],
  developer: [
    'content.dashboard.view',
    'content.article.view',
    'brain.read',
    'content.distribution.view',
    'content.analytics.view',
    'content.publishing.view',
    'content.settings.manage',
  ],
  viewer: [
    'content.dashboard.view',
    'content.article.view',
    'content.distribution.view',
    'content.analytics.view',
    'content.publishing.view',
  ],
};

export function getDashboardConfig(env = process.env) {
  const roles = parseRoleConfig(env.CONTENT_DASHBOARD_ALLOWED_ROLES || '');
  const modelProvider = normalizeProviderName(env.CONTENT_MODEL_PROVIDER || env.CONTENT_DASHBOARD_GENERATION_PROVIDER || 'deterministic');
  const ollama = getDefaultOllamaConfig(env);
  return {
    env,
    siteRoot,
    enabled: env.CONTENT_DASHBOARD_ENABLED === 'true',
    environmentName: env.CONTENT_DASHBOARD_ENV || env.NODE_ENV || 'local',
    authMode: normalizeAuthMode(env.CONTENT_DASHBOARD_AUTH_MODE || 'local'),
    allowTemporaryTunnelTesting: env.ALLOW_TEMPORARY_TUNNEL_TESTING === 'true',
    sessionSecret: env.CONTENT_DASHBOARD_SESSION_SECRET || '',
    localLoginToken: env.CONTENT_DASHBOARD_LOCAL_LOGIN_TOKEN || '',
    publicAdminUrl: env.CONTENT_DASHBOARD_PUBLIC_URL || 'http://localhost:8000',
    databasePath: env.CONTENT_DASHBOARD_DB_PATH || path.join(env.CONTENT_AGENT_ROOT || defaultAgentRoot, 'dashboard', 'content-dashboard.sqlite'),
    cloudflareAccess: {
      teamDomain: normalizeTeamDomain(env.CLOUDFLARE_ACCESS_TEAM_DOMAIN || ''),
      audience: env.CLOUDFLARE_ACCESS_AUD || '',
      jwksJson: env.CLOUDFLARE_ACCESS_JWKS_JSON || '',
    },
    githubPublishing: {
      enabled: env.CONTENT_DASHBOARD_GITHUB_PUBLISHING_ENABLED === 'true',
      owner: env.CONTENT_DASHBOARD_GITHUB_OWNER || '',
      repo: env.CONTENT_DASHBOARD_GITHUB_REPO || '',
      baseBranch: env.CONTENT_DASHBOARD_GITHUB_BASE_BRANCH || 'main',
      branchPrefix: env.CONTENT_DASHBOARD_GITHUB_BRANCH_PREFIX || 'content-dashboard',
      mode: env.CONTENT_DASHBOARD_GITHUB_PUBLISH_MODE === 'draft-pr' ? 'draft-pr' : 'direct',
      appId: env.GITHUB_APP_ID || '',
      installationId: env.GITHUB_APP_INSTALLATION_ID || '',
      privateKey: env.GITHUB_APP_PRIVATE_KEY || '',
      token: env.CONTENT_DASHBOARD_GITHUB_TOKEN || env.GITHUB_TOKEN || '',
      mirrors: buildGithubPublishingMirrors(env),
    },
    indexNow: buildIndexNowConfig(env),
    coverImages: {
      provider: normalizeCoverImageProvider(env.CONTENT_DASHBOARD_COVER_IMAGE_PROVIDER || (env.CONTENT_DASHBOARD_PEXELS_API_KEY || env.PEXELS_API_KEY ? 'pexels' : 'local')),
      pexelsApiKey: env.CONTENT_DASHBOARD_PEXELS_API_KEY || env.PEXELS_API_KEY || '',
      pexelsLocale: env.CONTENT_DASHBOARD_PEXELS_LOCALE || 'en-US',
      timeoutMs: positiveInt(env.CONTENT_DASHBOARD_COVER_IMAGE_TIMEOUT_MS, 12000, 1000),
    },
    agentRoot: path.resolve(env.CONTENT_AGENT_ROOT || defaultAgentRoot),
    outputDir: path.resolve(env.CONTENT_AGENT_OUTPUT_DIR || path.join(env.CONTENT_AGENT_ROOT || defaultAgentRoot, 'engine/outputs')),
    modelProvider,
    modelConfigured: modelProvider === 'deterministic' || (modelProvider === 'ollama' && ollama.enabled),
    ollama,
    externalResearchProvider: env.CONTENT_RESEARCH_PROVIDER || 'fixture',
    trendResearch: {
      provider: env.CONTENT_TREND_PROVIDER || env.CONTENT_TREND_RESEARCH_PROVIDER || 'composite',
      sourceUrls: parseListPreserveCase(env.CONTENT_TREND_SOURCE_URLS || env.CONTENT_TREND_RSS_URLS || ''),
      timeoutMs: positiveInt(env.CONTENT_TREND_SCAN_TIMEOUT_MS || env.CONTENT_TREND_REQUEST_TIMEOUT_MS, 20000, 1000),
      maxItemsPerSource: positiveInt(env.CONTENT_TREND_SCAN_MAX_ITEMS_PER_SOURCE, 30, 1),
      maxItemAgeDays: positiveInt(env.CONTENT_TREND_MAX_ITEM_AGE_DAYS, 7, 1),
      maxConcurrentFetches: positiveInt(env.CONTENT_TREND_MAX_CONCURRENT_FETCHES, 3, 1),
      defaultLocale: env.CONTENT_TREND_DEFAULT_LOCALE || 'en-CA',
      dailyScanEnabled: env.CONTENT_TREND_DAILY_SCAN_ENABLED === 'true',
      scanHour: positiveInt(env.CONTENT_TREND_SCAN_HOUR, 7, 0),
      qwenEvaluationEnabled: env.CONTENT_TREND_QWEN_EVALUATION_ENABLED === 'true',
      recommendationTotalLimit: positiveInt(env.CONTENT_TREND_RECOMMENDATION_TOTAL_LIMIT, 20, 1),
      recommendationCategoryLimit: positiveInt(env.CONTENT_TREND_RECOMMENDATION_CATEGORY_LIMIT, 5, 1),
      recommendationCandidateLimit: positiveInt(env.CONTENT_TREND_RECOMMENDATION_CANDIDATE_LIMIT, 80, 1),
    },
    trendResearchProvider: env.CONTENT_TREND_PROVIDER || env.CONTENT_TREND_RESEARCH_PROVIDER || 'composite',
    founderEmails: parseList(env.CONTENT_DASHBOARD_FOUNDER_EMAILS),
    founderUserIds: parseList(env.CONTENT_DASHBOARD_FOUNDER_USER_IDS),
    bootstrapRoleEmails: roles,
  };
}

function parseList(value = '') {
  return value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function parseListPreserveCase(value = '') {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function buildGithubPublishingMirrors(env = {}) {
  if (env.CONTENT_DASHBOARD_GITHUB_MIRROR_ENABLED !== 'true') return [];
  const owner = env.CONTENT_DASHBOARD_GITHUB_MIRROR_OWNER || env.CONTENT_DASHBOARD_GITHUB_OWNER || '';
  const repo = env.CONTENT_DASHBOARD_GITHUB_MIRROR_REPO || '';
  if (!owner || !repo) return [];
  return [{
    enabled: true,
    owner,
    repo,
    baseBranch: env.CONTENT_DASHBOARD_GITHUB_MIRROR_BASE_BRANCH || env.CONTENT_DASHBOARD_GITHUB_BASE_BRANCH || 'main',
    publicUrl: normalizeOrigin(env.CONTENT_DASHBOARD_GITHUB_MIRROR_PUBLIC_URL || ''),
    sourceOrigin: normalizeOrigin(env.CONTENT_DASHBOARD_GITHUB_MIRROR_SOURCE_URL || 'https://certifyd.me'),
    token: env.CONTENT_DASHBOARD_GITHUB_MIRROR_TOKEN || env.CONTENT_DASHBOARD_GITHUB_TOKEN || env.GITHUB_TOKEN || '',
    excludePaths: parseListPreserveCase(env.CONTENT_DASHBOARD_GITHUB_MIRROR_EXCLUDE_PATHS || 'index.html'),
  }];
}

function normalizeOrigin(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildIndexNowConfig(env = {}) {
  const key = env.CONTENT_DASHBOARD_INDEXNOW_KEY || env.INDEXNOW_KEY || '';
  const enabled = env.CONTENT_DASHBOARD_INDEXNOW_ENABLED === 'true' || Boolean(key);
  const host = env.CONTENT_DASHBOARD_INDEXNOW_HOST || 'certifyd.me';
  const publicUrl = normalizeOrigin(env.CONTENT_DASHBOARD_INDEXNOW_PUBLIC_URL || `https://${host}`);
  return {
    enabled,
    key,
    host,
    publicUrl,
    keyLocation: key ? `${publicUrl}/${key}.txt` : '',
    endpoint: env.CONTENT_DASHBOARD_INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow',
  };
}

function positiveInt(value, fallback, min = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function normalizeAuthMode(value) {
  return ['local', 'cloudflare-access', 'hybrid'].includes(value) ? value : 'local';
}

function normalizeCoverImageProvider(value) {
  return ['local', 'pexels'].includes(value) ? value : 'local';
}

function normalizeTeamDomain(value) {
  return value.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function parseRoleConfig(value) {
  const result = { founder: [], editor: [], writer: [], marketing: [], developer: [], viewer: [] };
  for (const entry of value.split(';')) {
    const [role, emails] = entry.split(':');
    const cleanRole = role?.trim().toLowerCase();
    if (!cleanRole || !result[cleanRole]) continue;
    result[cleanRole] = parseList(emails || '');
  }
  return result;
}

export function resolveUserRole(user, config) {
  const email = user?.email?.toLowerCase() || '';
  const userId = user?.id?.toLowerCase() || '';
  if (config.founderEmails.includes(email) || config.founderUserIds.includes(userId)) return 'founder';
  for (const role of ['editor', 'writer', 'marketing', 'developer', 'viewer']) {
    if (config.bootstrapRoleEmails[role]?.includes(email)) return role;
  }
  return null;
}

export function permissionsForRole(role) {
  return CONTENT_PERMISSIONS[role] || [];
}
