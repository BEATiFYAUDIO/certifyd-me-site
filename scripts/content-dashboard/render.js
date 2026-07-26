import { marked } from 'marked';
import { escapeHtml } from './security.js';

export function layout({ title, user, permissions = [], active = 'Overview', body }) {
  const nav = [
    ['Overview', '/app/content', 'content.dashboard.view'],
    ['Articles', '/app/content/articles', 'content.article.view'],
    ['Review Queue', '/app/content/review/core-explainer-001', 'content.article.review'],
    ['Brain', '/app/content/brain', 'brain.read'],
    ['Topics', '/app/content/topics', 'content.article.view'],
    ['Publishing', '/app/content/publishing', 'content.publishing.view'],
    ['Distribution', '/app/content/distribution', 'content.distribution.view'],
    ['Analytics', '/app/content/analytics', 'content.analytics.view'],
    ['Settings', '/app/content/settings', 'content.settings.manage'],
  ].filter(([, , permission]) => permissions.includes(permission));

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} | Certifyd Content Dashboard</title>${styles()}</head><body><a class="skip-link" href="#main">Skip to content</a><header class="top"><a class="brand" href="/"><img src="/images/certifyd_logo_transparent.svg" alt="Certifyd"></a><div class="top-meta"><strong>Certifyd Content Dashboard</strong><span>${escapeHtml(user.email)} · ${escapeHtml(user.role)}</span></div><form method="post" action="/app/logout"><button class="ghost" type="submit">Logout</button></form></header><div class="shell"><aside><nav>${nav.map(([label, href]) => `<a class="${label === active ? 'active' : ''}" href="${href}">${escapeHtml(label)}</a>`).join('')}</nav></aside><main id="main">${body}</main></div></body></html>`;
}

export function loginPage({ returnTo = '/app/content', error = '', localLoginEnabled = true }) {
  const form = localLoginEnabled
    ? `<form method="post" action="/app/login"><input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}"><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Local access token<input name="token" type="password" required></label><button class="primary" type="submit">Sign in</button></form>`
    : '<p class="notice">Production access is handled by Cloudflare Access before this page loads. If you see this page, your Cloudflare Access session is missing or your email is not authorized for the dashboard.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Login | Certifyd Content Dashboard</title>${styles()}</head><body><main class="login"><section class="panel"><img class="login-logo" src="/images/certifyd_logo_transparent.svg" alt="Certifyd"><p class="eyebrow">Internal access</p><h1>Certifyd Content Dashboard</h1><p>Sign in with an environment-authorized dashboard account.</p>${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}${form}</section></main></body></html>`;
}

export function renderMarkdown(markdown) {
  marked.use({ async: false, mangle: false, headerIds: false });
  return marked.parse(escapeDangerousHtml(markdown || ''));
}

function escapeDangerousHtml(markdown) {
  return String(markdown).replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, (tag) => escapeHtml(tag));
}

export function statusPill(value) {
  const text = escapeHtml(value || 'UNKNOWN');
  const tone = String(value || '').includes('BLOCK') ? 'bad' : String(value || '').includes('APPROVED') || String(value || '').includes('READY') ? 'good' : 'warn';
  return `<span class="pill ${tone}">${text}</span>`;
}

export function card(title, content) {
  return `<section class="panel"><h2>${escapeHtml(title)}</h2>${content}</section>`;
}

export function styles() {
  return `<style>
:root{--bg:#050a12;--panel:#101721;--panel2:#151c28;--text:#f2f5fb;--muted:#aab3c2;--border:rgba(205,238,255,.16);--gold:#ff9f1a;--blue:#6ea2ff;--green:#75e0a7;--red:#ff7171;--radius:22px}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:radial-gradient(900px 520px at 70% -20%,rgba(95,159,255,.18),transparent),linear-gradient(180deg,#07111c,#05070c);color:var(--text);line-height:1.5}a{color:inherit}.skip-link{position:absolute;left:12px;top:12px;z-index:20;transform:translateY(-180%);background:#000;color:#fff;padding:10px 12px;border-radius:10px}.skip-link:focus{transform:none}:focus-visible{outline:3px solid var(--blue);outline-offset:3px;border-radius:10px}.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:18px;justify-content:space-between;padding:16px clamp(16px,4vw,44px);border-bottom:1px solid var(--border);background:rgba(5,10,18,.86);backdrop-filter:blur(18px)}.brand img{height:44px}.top-meta{display:flex;flex-direction:column;gap:2px;color:var(--muted)}.top-meta strong{color:var(--text)}.shell{display:grid;grid-template-columns:260px 1fr;min-height:calc(100vh - 78px)}aside{border-right:1px solid var(--border);padding:22px;background:rgba(255,255,255,.025)}nav{display:grid;gap:8px;position:sticky;top:100px}nav a{padding:11px 12px;border-radius:14px;text-decoration:none;color:var(--muted);font-weight:800}nav a.active,nav a:hover{background:rgba(255,159,26,.15);color:#fff}main{padding:clamp(18px,4vw,48px);max-width:1280px;width:100%}.hero{display:grid;gap:18px;margin-bottom:24px}.eyebrow{letter-spacing:.22em;text-transform:uppercase;color:var(--gold);font-weight:900;font-size:.76rem}h1{font-size:clamp(2.1rem,6vw,5rem);line-height:.92;letter-spacing:-.06em;margin:0 0 10px}h2{font-size:clamp(1.25rem,2vw,2rem);line-height:1;margin:0 0 12px}h3{margin:0 0 6px}.muted,p{color:var(--muted)}.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}.panel{border:1px solid var(--border);background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.025));border-radius:var(--radius);padding:clamp(18px,2.5vw,28px);box-shadow:0 24px 80px rgba(0,0,0,.26)}.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:left;padding:12px;border-bottom:1px solid var(--border);vertical-align:top}.pill{display:inline-flex;padding:6px 9px;border:1px solid var(--border);border-radius:999px;font-size:.72rem;font-weight:900;letter-spacing:.04em}.pill.good{color:var(--green)}.pill.warn{color:var(--gold)}.pill.bad{color:var(--red)}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.primary,.ghost,button{border:1px solid var(--border);border-radius:999px;padding:11px 16px;font-weight:900;background:rgba(255,255,255,.06);color:#fff;cursor:pointer}.primary{background:linear-gradient(135deg,#ffd66a,#ff8a00);color:#101010;border-color:transparent}.ghost:hover,button:hover{background:rgba(255,255,255,.1)}pre{white-space:pre-wrap;overflow:auto;background:#05080d;border:1px solid var(--border);border-radius:16px;padding:14px}.article{font-size:1.05rem}.article h1,.article h2{letter-spacing:-.03em}.login{min-height:100vh;display:grid;place-items:center;padding:20px}.login .panel{max-width:480px}.login-logo{height:54px;margin-bottom:18px}.login form{display:grid;gap:12px}.login label{display:grid;gap:6px;color:var(--muted);font-weight:800}.login input,select,textarea{width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:#05080d;color:#fff}.error{color:var(--red)}.notice{padding:12px 14px;border:1px solid rgba(255,159,26,.32);border-radius:16px;background:rgba(255,159,26,.08);color:#ffd89a}@media(max-width:780px){.shell{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid var(--border);overflow:auto}nav{display:flex;position:static;overflow:auto}.top{align-items:flex-start}.top-meta{font-size:.82rem}.table,.table tbody,.table tr,.table td,.table th{display:block}.table th{display:none}.table tr{border:1px solid var(--border);border-radius:16px;margin-bottom:12px;padding:8px}.table td{border:0}.actions>*{width:100%}}
</style>`;
}
