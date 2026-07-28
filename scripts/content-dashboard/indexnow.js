const CANONICAL_ARTICLE_URL = /^https:\/\/certifyd\.me\/blog\/[a-z0-9-]+\/$/;

export async function submitIndexNow(config, { url, action = 'publish' } = {}) {
  const indexNow = config.indexNow || {};
  if (!indexNow.enabled || !indexNow.key) return { submitted: false, ok: true, reason: 'not_configured' };
  const canonicalUrl = String(url || '').trim();
  if (!CANONICAL_ARTICLE_URL.test(canonicalUrl)) return { submitted: false, ok: true, reason: 'not_canonical_article_url' };
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(indexNow.key)) return { submitted: false, ok: false, error: 'IndexNow key is malformed.' };

  const fetchImpl = indexNow.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { submitted: false, ok: false, error: 'fetch unavailable' };

  const payload = {
    host: indexNow.host || 'certifyd.me',
    key: indexNow.key,
    keyLocation: indexNow.keyLocation || `https://certifyd.me/${indexNow.key}.txt`,
    urlList: [canonicalUrl],
  };

  try {
    const response = await fetchImpl(indexNow.endpoint || 'https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const ok = response.status >= 200 && response.status < 300;
    const result = { submitted: true, ok, status: response.status, action, url: canonicalUrl };
    logIndexNowResult(result);
    return result;
  } catch (error) {
    const result = { submitted: true, ok: false, action, url: canonicalUrl, error: error.message };
    logIndexNowResult(result);
    return result;
  }
}

function logIndexNowResult(result) {
  const status = result.ok ? 'success' : 'failure';
  const detail = result.status ? ` HTTP ${result.status}` : result.error ? ` ${result.error}` : '';
  console.log(`IndexNow ${status} for ${result.action || 'publish'} ${result.url || ''}${detail}`);
}
