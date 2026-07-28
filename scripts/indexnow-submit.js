#!/usr/bin/env node
import { getDashboardConfig } from './content-dashboard/config.js';
import { submitIndexNow } from './content-dashboard/indexnow.js';

const url = process.argv[2] || '';
if (!url) {
  console.error('Usage: npm run indexnow:test -- https://certifyd.me/blog/article-slug/');
  process.exit(2);
}

const result = await submitIndexNow(getDashboardConfig(process.env), { url, action: 'manual-test' });
if (!result.submitted) {
  console.error(`IndexNow not submitted: ${result.reason || result.error || 'unknown reason'}`);
  process.exit(1);
}
if (!result.ok) {
  console.error(`IndexNow submission failed${result.status ? `: HTTP ${result.status}` : ''}`);
  process.exit(1);
}
console.log('IndexNow submission accepted.');
