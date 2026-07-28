# Certifyd Technical SEO and Indexing

## Canonical Strategy

- Public article URLs use one canonical format: `https://certifyd.me/blog/<slug>/`.
- Article canonical tags, Open Graph URLs, RSS links, sitemap entries and publishing metadata use the same trailing-slash URL.
- Draft, review, archived and `noindex` articles are excluded from the public sitemap.

## Google Search Console

Do not use Google’s Indexing API for ordinary blog posts.

Founder one-time steps:

1. Add `certifyd.me` in Google Search Console.
2. Verify domain ownership through DNS, or use a Google HTML verification file.
3. Submit `https://certifyd.me/sitemap.xml`.

Optional build-time verification support:

- `GOOGLE_SITE_VERIFICATION` adds a `google-site-verification` meta tag to generated blog pages.
- `GOOGLE_SITE_VERIFICATION_FILE` and `GOOGLE_SITE_VERIFICATION_FILE_CONTENT` write a static verification HTML file.
- Do not commit private verification credentials unless the verification file is intentionally public.

## Bing Webmaster Tools and IndexNow

Founder one-time steps:

1. Add or import `certifyd.me` in Bing Webmaster Tools.
2. Verify site ownership.
3. Submit or import `https://certifyd.me/sitemap.xml`.

IndexNow is supported for published, updated and removed canonical article URLs only.

Required environment:

- `CONTENT_DASHBOARD_INDEXNOW_KEY` or `INDEXNOW_KEY`
- Optional: `CONTENT_DASHBOARD_INDEXNOW_ENABLED=true`

Build behavior:

- `npm run build` writes `/<INDEXNOW_KEY>.txt` when an IndexNow key is configured.
- Publishing submits only canonical `https://certifyd.me/blog/<slug>/` URLs.
- IndexNow failures are logged and recorded, but they do not block publishing.

Manual test:

```bash
npm run indexnow:test -- https://certifyd.me/blog/article-slug/
```

## Validation

Run:

```bash
npm run build
npm run seo:validate
```

The validator reports missing titles, descriptions, canonicals, duplicate canonicals, malformed JSON-LD, unpublished sitemap entries and broken internal article links.
