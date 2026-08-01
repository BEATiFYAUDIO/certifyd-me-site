#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDashboardConfig } from './content-dashboard/config.js';
import { scanTrendOpportunities } from './content-dashboard/trends.js';

loadLocalEnv();
const config = getDashboardConfig();
try {
  const result = await scanTrendOpportunities(config);
  console.log(JSON.stringify({ ok: true, provider: result.provider, summary: result.summary, unavailable: (result.providerStatus || []).filter((source) => source.status === 'unavailable').map((source) => ({ publisher: source.publisher, error: source.latestError || source.error })) }, null, 2));
  process.exitCode = result.summary?.opportunitiesCreated ? 0 : 2;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exitCode = 1;
}

function loadLocalEnv() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of [path.join(root, '.env.blog-engine.local'), path.join(root, 'deploy/admin/local.env')]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.replace(/\r$/, '').trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}
