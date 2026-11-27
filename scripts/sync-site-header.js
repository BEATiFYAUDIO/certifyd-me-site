// Maintenance command: node scripts/sync-site-header.js [--check]
// Public HTML and blog templates use one static, crawlable header. No runtime injection.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const header = (await fs.readFile(path.join(root, 'templates/site-header.html'), 'utf8')).trim();
const dirs = ['blog','guides','core','profile','downloads','join','retail-partners','media-promotion','services','policies','ar','browser','content-distribution'];
const files = ['index.html', 'network.html', 'templates/blog-article.html', 'templates/blog-index.html'];
async function collect(dir) {
  for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name === 'archive' || entry.isSymbolicLink()) continue;
    const name = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) await collect(name);
    else if (entry.isFile() && name.endsWith('.html')) files.push(name);
  }
}
for (const dir of dirs) await collect(dir);
const check = process.argv.includes('--check');
let count = 0, stale = [];
for (const name of files) {
  const full = path.join(root, name);
  const before = await fs.readFile(full, 'utf8');
  if (!/<header\b[\s\S]*?<\/header>/.test(before)) continue; // Leave redirects alone.
  let after = before;
  if (name === 'core/tunnel-setup/index.html' && !after.includes('class="guide-page-tools"')) {
    const tools = after.match(/<div class="top-actions">[\s\S]*?<\/div>/)?.[0];
    if (!tools) throw new Error('Missing tunnel guide controls; refusing to drop them.');
    after = after.replace('<main>', `<div class="guide-page-tools">${tools}</div>\n  <main>`);
  }
  after = after.replace(/<header\b[\s\S]*?<\/header>/, header);
  if (!after.includes('href="/styles/public-layout.css?v=public-header-colour-20261127a"')) {
    after = after.replace('</head>', '<link rel="stylesheet" href="/styles/public-layout.css?v=public-header-colour-20261127a">\n</head>');
  }
  after = after.replace(/[ \t]*<script\b[^>]*src="\/scripts\/grouped-navigation\.js(?:\?[^"\s]*)?"[^>]*><\/script>\n?/g, '');
  after = after.replace('</head>', '<script src="/scripts/grouped-navigation.js?v=public-header-20261126a" defer></script>\n</head>');
  // Preserve header links and document text styles independently.
  if (['core/guide/index.html','core/tunnel-setup/index.html','ar/guide/index.html','ar/privacy/index.html','policies/index.html','browser/privacy/index.html','browser/delete-data/index.html','content-distribution/index.html','content-distribution/privacy/index.html','content-distribution/terms/index.html'].includes(name)) {
    if (!/<body[^>]*class=/.test(after)) {
      const classes = ['public-document', ...((name.startsWith('core/') || name === 'ar/guide/index.html') ? ['public-walkthrough'] : [])];
      after = after.replace(/<body(\s[^>]*)?>/, (tag) => tag.slice(0,-1) + ` class="${classes.join(' ')}">`);
    }
  }
  after = after.replace(/<head\b[\s\S]*?<\/head>/, (head) => head.replace(/^[ \t]+$/gm, ''));
  count++;
  const normalizedBefore = before.replace(/<head\b[\s\S]*?<\/head>/, (head) => head.replace(/^[ \t]+$/gm, ''));
  if (after !== (check ? normalizedBefore : before)) { stale.push(name); if (!check) await fs.writeFile(full, after); }
}
if (check && stale.length) { console.error('Out-of-sync headers:\n' + stale.join('\n')); process.exitCode=1; }
else console.log(`${check?'Verified':'Synchronized'} ${count} public pages/templates; historical archive and redirects preserved.`);
