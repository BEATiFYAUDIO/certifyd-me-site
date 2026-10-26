// GitHub release assets are the files served by both public download pages.
// These are file-download counts, not unique people or installed Cores.
(() => {
  const CACHE_KEY = 'certifyd-release-download-counts-v1';
  const CACHE_AGE_MS = 15 * 60 * 1000;
  const API_ROOT = 'https://api.github.com/repos/BEATiFYAUDIO/';
  const CORE_ASSET = /^Certifyd-Core-.*\.(?:exe|deb|dmg|tar\.gz)$/i;
  const ANDROID_ASSET = /^Certifyd-Browser-Android-.*\.apk$/i;

  function display(selector, count) {
    document.querySelectorAll(selector).forEach(element => {
      element.textContent = count.toLocaleString();
    });
  }

  function readCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return cached && Date.now() - cached.savedAt < CACHE_AGE_MS ? cached : null;
    } catch {
      return null;
    }
  }

  async function releases(repo) {
    const all = [];
    for (let page = 1; ; page += 1) {
      const url = `${API_ROOT}${repo}/releases?per_page=100&page=${page}`;
      const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error('Release counts unavailable');
      const batch = await response.json();
      if (!Array.isArray(batch)) throw new Error('Invalid release response');
      all.push(...batch);
      if (batch.length < 100) return all;
    }
  }

  function sumAssets(releaseList, pattern) {
    return releaseList.reduce((total, release) => total + (release.assets || []).reduce(
      (count, asset) => count + (pattern.test(asset.name) ? asset.download_count || 0 : 0), 0
    ), 0);
  }

  function render(counts) {
    display('[data-core-all-downloads]', counts.coreAll);
    display('[data-core-current-downloads]', counts.coreCurrent);
    display('[data-android-all-downloads]', counts.androidAll);
    display('[data-android-current-downloads]', counts.androidCurrent);
    document.querySelectorAll('[data-download-count-note]').forEach(element => {
      element.textContent = 'GitHub release-file downloads. Counts include downloads from any link to these files, not unique people or installations. Updated about every 15 minutes.';
    });
  }

  const cached = readCache();
  if (cached) {
    render(cached);
    return;
  }

  Promise.all([releases('contentbox'), releases('certifyd-me-site')]).then(([core, browser]) => {
    const currentCoreTag = CORE_DOWNLOADS[0]?.url.match(/\/releases\/download\/([^/]+)\//)?.[1];
    const currentAndroidTag = document.querySelector('#android-browser a[href*="/releases/download/"]')
      ?.href.match(/\/releases\/download\/([^/]+)\//)?.[1];
    const counts = {
      coreAll: sumAssets(core, CORE_ASSET),
      coreCurrent: sumAssets(core.filter(release => release.tag_name === currentCoreTag), CORE_ASSET),
      androidAll: sumAssets(browser, ANDROID_ASSET),
      androidCurrent: sumAssets(browser.filter(release => release.tag_name === currentAndroidTag), ANDROID_ASSET),
      savedAt: Date.now()
    };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(counts)); } catch {}
    render(counts);
  }).catch(() => {
    document.querySelectorAll('[data-download-count-note]').forEach(element => {
      element.textContent = 'Download counts are temporarily unavailable; downloads still work.';
    });
  });
})();
