import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LinkedInOAuth, LINKEDIN_REDIRECT_URI } from '../scripts/content-dashboard/linkedin-oauth.js';
import { buildDistributionAdapters } from '../scripts/content-dashboard/distribution-adapters.js';

test('LinkedIn OAuth binds state, checks page access, encrypts tokens and expires authorization', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-linkedin-'));
  const config = { agentRoot: root, publicAdminUrl: 'https://admin.certifyd.me', sessionSecret: 'test-session-secret', env: { CONTENT_DISTRIBUTION_LINKEDIN_CLIENT_ID: 'client', CONTENT_DISTRIBUTION_LINKEDIN_CLIENT_SECRET: 'secret', CONTENT_DISTRIBUTION_LINKEDIN_ORGANIZATION_ID: '123' } };
  const oauth = new LinkedInOAuth(config);
  const actor = { id: 'founder' };
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url: String(url), options});
    if (String(url).endsWith('/accessToken')) return Response.json({ access_token: 'private-token', expires_in: 3600, scope: 'w_organization_social,rw_organization_admin' });
    if (String(url).includes('/organizationAcls')) return Response.json({ elements: [{ organization: 'urn:li:organization:123', role: 'CONTENT_ADMINISTRATOR', state: 'APPROVED' }] });
    if (String(url).endsWith('/posts')) return new Response(null, {status: 201, headers: {'x-restli-id': 'urn:li:share:456'}});
    throw new Error('Unexpected request');
  };
  try {
    const url = new URL(oauth.start({actor, sessionId: 'session'}));
    assert.equal(url.searchParams.get('redirect_uri'), LINKEDIN_REDIRECT_URI);
    const state = url.searchParams.get('state');
    await assert.rejects(oauth.complete({actor, sessionId: 'other', state, code: 'code'}), /does not match/);
    assert.equal(calls.length, 0);
    assert.equal((await oauth.complete({actor, sessionId: 'session', state, code: 'code'})).id, '123');
    await assert.rejects(oauth.complete({actor, sessionId: 'session', state, code: 'code'}), /expired/);
    assert.doesNotMatch(await fs.readFile(oauth.file, 'utf8'), /private-token/);
    assert.equal((await fs.stat(oauth.file)).mode & 0o777, 0o600);
    assert.equal(await oauth.connected(), true);
    assert.equal(calls.some(call => call.url.endsWith('/posts')), false);
    const adapter = buildDistributionAdapters(config).find(item => item.id === 'linkedin');
    const article = {title: 'Article', excerpt: 'Summary', canonicalUrl: 'https://certifyd.me/blog/article/', linkedinApproved: true, linkedinText: 'Read https://certifyd.me/blog/article/'};
    const published = await adapter.publishArticle(article);
    assert.equal(published.externalUrl, 'https://www.linkedin.com/feed/update/urn:li:share:456/');
    const payload = JSON.parse(calls.at(-1).options.body);
    assert.equal(payload.author, 'urn:li:organization:123');
    assert.equal(payload.content.article.source, article.canonicalUrl);
    await assert.rejects(adapter.publishArticle({...article, linkedinApproved: false}), /Approved/);
    config.env.CONTENT_DISTRIBUTION_LINKEDIN_ORGANIZATION_ID = '999';
    assert.equal(await oauth.connected(), false);
    config.env.CONTENT_DISTRIBUTION_LINKEDIN_ORGANIZATION_ID = '123';
    const credentials = await oauth.credentials();
    await oauth.writeEncryptedCredentials(JSON.stringify({...credentials, expiresAt: 0}));
    await assert.rejects(oauth.accessToken(), /expired/);
    await oauth.disconnect();
    assert.equal(await oauth.connected(), false);
  } finally { globalThis.fetch = original; await fs.rm(root, {recursive: true, force: true}); }
});

test('LinkedIn uploads the cover, reuses its checkpoint, and attaches it to the article post', async () => {
  const adapter = buildDistributionAdapters({ env: { CONTENT_DISTRIBUTION_LINKEDIN_ORGANIZATION_ID: '123' } }).find(item => item.id === 'linkedin');
  adapter.oauth.accessToken = async () => 'private-token';
  const original = globalThis.fetch;
  const calls = [];
  let checkpoint = {};
  const article = {title: 'Article', excerpt: 'Summary', canonicalUrl: 'https://certifyd.me/blog/article/', featuredImage: '/images/blog/cover.png', linkedinApproved: true, linkedinText: 'Read https://certifyd.me/blog/article/'};
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url); calls.push({target, options});
    if (target === 'https://certifyd.me/images/blog/cover.png') {
      assert.equal(options.headers?.Authorization, undefined);
      return new Response(Buffer.from('cover-bytes'), {headers: {'content-type': 'image/png'}});
    }
    if (target.endsWith('action=initializeUpload')) return Response.json({value: {image: 'urn:li:image:cover123', uploadUrl: 'https://www.linkedin.com/dms-uploads/cover123/uploaded-image/0'}});
    if (target.includes('/dms-uploads/')) {
      assert.equal(options.method, 'PUT'); assert.equal(options.body.toString(), 'cover-bytes');
      return new Response(null, {status: 201});
    }
    if (target.includes('/rest/images/')) return Response.json({status: 'AVAILABLE', owner: 'urn:li:organization:123'});
    if (target.endsWith('/posts')) return new Response(null, {status: 201, headers: {'x-restli-id': 'urn:li:share:456'}});
    throw new Error('Unexpected request');
  };
  try {
    const prepared = await adapter.prepareArticle(article, {}, {checkpoint: async value => { checkpoint = value; }});
    assert.equal(prepared.linkedinImageUrn, 'urn:li:image:cover123');
    assert.equal(checkpoint.mediaSourceUrl, 'https://certifyd.me/images/blog/cover.png');
    assert.equal(calls.some(call => call.target.endsWith('/posts')), false);
    await adapter.prepareArticle(article, checkpoint);
    assert.equal(calls.filter(call => call.target.includes('/dms-uploads/')).length, 1);
    await adapter.publishArticle(prepared);
    assert.equal(JSON.parse(calls.at(-1).options.body).content.article.thumbnail, 'urn:li:image:cover123');
    await assert.rejects(adapter.publishArticle(article), /finish uploading/);
    globalThis.fetch = async () => new Response('missing', {status:404});
    await assert.rejects(adapter.prepareArticle(article), /readable/);
  } finally { globalThis.fetch = original; }
});

test('LinkedIn rejects untrusted upload destinations before sending credentials or bytes', async () => {
  const adapter = buildDistributionAdapters({env: {CONTENT_DISTRIBUTION_LINKEDIN_ORGANIZATION_ID: '123'}}).find(item => item.id === 'linkedin');
  adapter.oauth.accessToken = async () => 'private-token';
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    if (String(url).startsWith('https://certifyd.me/images/')) return new Response('cover', {headers: {'content-type':'image/png'}});
    return Response.json({value: {image:'urn:li:image:cover123', uploadUrl:'https://evil.example/upload'}});
  };
  try {
    await assert.rejects(adapter.prepareArticle({featuredImage:'/images/cover.png'}), /invalid image upload/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
