import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTrendingOpportunities, getTrendingOpportunities } from '../scripts/content-dashboard/trends.js';

function mockFeedResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async text() { return body; },
  };
}

test('trend opportunities default to clearly labeled seeded ideas', async () => {
  const trends = await getTrendingOpportunities({ trendResearch: { provider: 'fixture', sourceUrls: [] } });
  assert.equal(trends.provider, 'fixture');
  assert.ok(trends.items.length > 0);
  assert.match(trends.note, /Seeded editorial opportunities/);
  assert.equal(trends.items[0].sourceLabel, 'Seeded');
});

test('RSS trend provider scans approved source URLs and categorizes opportunities', async () => {
  const feed = `<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title>Music streaming bot farms are distorting creator payouts</title>
        <description>Artists are questioning fake engagement, bot farming and how paid customer activity should be measured.</description>
        <link>https://example.test/music-bot-farms</link>
        <pubDate>Sun, 26 Jul 2026 12:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;
  const trends = await getTrendingOpportunities({
    trendResearch: {
      provider: 'rss',
      sourceUrls: ['https://example.test/feed.xml'],
      timeoutMs: 1000,
    },
  }, {
    fetchImpl: async () => mockFeedResponse(feed),
  });

  assert.equal(trends.provider, 'rss');
  assert.equal(trends.sourceLabels[0], 'example.test');
  assert.equal(trends.items.length, 1);
  assert.equal(trends.items[0].category, 'Music');
  assert.equal(trends.items[0].sourceLabel, 'example.test');
  assert.match(trends.items[0].whyCertifyd, /paid customer activity|engagement metrics|creator commerce/i);
  assert.equal(filterTrendingOpportunities(trends, 'Music').length, 1);
  assert.equal(filterTrendingOpportunities(trends, 'Sports').length, 0);
});

test('RSS trend provider falls back safely when approved sources fail', async () => {
  const trends = await getTrendingOpportunities({
    trendResearch: {
      provider: 'rss',
      sourceUrls: ['https://bad.example/feed.xml'],
      timeoutMs: 1000,
    },
  }, {
    fetchImpl: async () => mockFeedResponse('', false, 503),
  });

  assert.equal(trends.provider, 'fixture');
  assert.ok(trends.items.length > 0);
  assert.match(trends.note, /no usable items|failed/i);
});
