export const STORAGE_KEY = 'certifyd.tunnel-guide.beta13';
export const RELEASE = 'v0.1.0-beta.13';
export const RELEASE_SHA = 'ae0b2b1a068bb201148e55658ef05d14093c0509';
export const PRIVATE_PORT = 4000;
export const PUBLIC_PORT = 4010;

export function cleanDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
}
export function validDomain(value) {
  const v = cleanDomain(value);
  return v.length <= 253 && v.includes('.') && !/^\d+(\.\d+){3}$/.test(v) && v.split('.').every(x => x.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x)) && /^[a-z]{2,}$|^xn--[a-z0-9-]+$/.test(v.split('.').at(-1));
}
export function validSubdomain(value) {
  const v=String(value || '').trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v) && !['www','mail','smtp','imap','pop','ftp'].includes(v);
}
export function validTunnelIdentity(value) {
  const v=String(value || '').trim();
  return v.length > 0 && v.length <= 128 && !/[\r\n]/.test(v);
}
export function validPublicURL(value, goal, hostname) {
  try {
    const u=new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) return false;
    if (goal === 'quick') return /^[a-z0-9-]+\.trycloudflare\.com$/.test(u.hostname) && u.hostname !== 'api.trycloudflare.com';
    return u.hostname === hostname;
  } catch { return false; }
}
function effectiveGoal(a) {
  if (a.goal !== 'unsure') return a.goal;
  if (a.inspectResult === 'service') return 'service';
  if (a.inspectResult === 'existing') return 'existing';
  return a.nextGoal || null;
}
export function route(a={}) {
  const ids=['goal'];
  if (a.goal === 'unsure') {
    ids.push('inspect');
    if (!a.inspectResult) return ids;
    if (a.inspectResult === 'none') {
      ids.push('decide');
      if (!a.nextGoal) return ids;
    }
  }
  const goal=effectiveGoal(a);
  if (goal === 'quick') return [...ids,'quickPrivate','quickStart','verify','done'];
  if (!goal) return ids;
  ids.push('cfAccount');
  if (a.cfAccount === 'no') ids.push('cfAccountSetup');
  if (!a.cfAccount) return ids;
  if (goal === 'permanent') ids.push('namedSituation');
  const situation=goal === 'existing' ? 'existing' : goal === 'service' ? 'service' : a.namedSituation;
  if (!situation) return ids;
  ids.push('domainStatus');
  if (a.domainStatus !== 'yes') return [...ids,'domainWait'];
  ids.push('domain','cloudflare');
  if (a.cloudflare === 'unsure') ids.push('cloudflareCheck');
  const cloudflare=a.cloudflare === 'unsure' ? a.cloudflareResult : a.cloudflare;
  if (a.cloudflare === 'unsure' && !cloudflare) return ids;
  if (cloudflare !== 'active') {
    ids.push('services','backup','addDomain','records','dnssec');
    if (!['off','on'].includes(a.dnssec)) ids.push('dnssecHelp');
    const dnssec=a.dnssec === 'unknown' ? a.dnssecResult : a.dnssec;
    if (!['off','on'].includes(dnssec)) return ids;
    ids.push('dnsApproval','nameservers','activation');
  }
  ids.push('hostnameState','hostname','os');
  if (situation === 'none') ids.push('createTunnel','connector','management');
  else ids.push('identity','management','existingCheck');
  return [...ids,'routeApproval','publicRoute','coreConfirm','verify','done'];
}
export function stageFor(id) {
  if (['goal','inspect','decide','quickPrivate','cfAccount','cfAccountSetup','namedSituation','domainStatus','domainWait','domain','cloudflare','cloudflareCheck'].includes(id)) return 0;
  if (['services','backup','addDomain','records','dnssec','dnssecHelp','dnsApproval','nameservers','activation'].includes(id)) return 1;
  if (['quickStart','hostnameState','hostname','os','identity','management','existingCheck','createTunnel','connector','routeApproval','publicRoute','coreConfirm'].includes(id)) return 2;
  return 3;
}
export function emptyState(){return {version:2,answers:{},checks:{},completed:[],current:'goal'};}
export function sanitizeState(raw) {
  if (!raw || raw.version !== 2 || typeof raw.answers !== 'object' || !raw.answers || Array.isArray(raw.answers)) return emptyState();
  const answers={};
  const allowed=['goal','inspectResult','nextGoal','cfAccount','namedSituation','domainStatus','domain','cloudflare','cloudflareResult','services','dnssec','dnssecResult','hostnameState','hostname','os','identity','management','publicURL'];
  for(const key of allowed) if(typeof raw.answers[key] === 'string') answers[key]=raw.answers[key].slice(0,300);
  const checks={};
  if(raw.checks && typeof raw.checks === 'object') for(const [key,value] of Object.entries(raw.checks)) if(/^[a-zA-Z]+:[a-zA-Z0-9]+$/.test(key)&&value===true) checks[key]=true;
  const ids=route(answers);
  const completed=Array.isArray(raw.completed)?raw.completed.filter(x=>ids.includes(x)):[];
  return {version:2,answers,checks,completed,current:ids.includes(raw.current)?raw.current:ids.find(x=>!completed.includes(x))||'goal'};
}
