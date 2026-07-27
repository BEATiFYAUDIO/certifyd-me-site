#!/usr/bin/env node
import { getDashboardConfig } from './content-dashboard/config.js';
import { scanTrendOpportunities } from './content-dashboard/trends.js';

const config = getDashboardConfig();
try {
  const result = await scanTrendOpportunities(config);
  console.log(JSON.stringify({ ok: true, provider: result.provider, summary: result.summary, unavailable: (result.providerStatus || []).filter((source) => source.status === 'unavailable').map((source) => ({ publisher: source.publisher, error: source.latestError || source.error })) }, null, 2));
  process.exitCode = result.summary?.opportunitiesCreated ? 0 : 2;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exitCode = 1;
}
