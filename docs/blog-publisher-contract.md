# Certifyd Blog Publisher Contract

The public Certifyd site is a static GitHub Pages site. The private admin dashboard must publish blog changes by opening draft pull requests against this repository. The dashboard does not run inside the public site.

## Article destination

- Repository: `certifyd-me-site`
- Article directory: `content/blog/`
- Filename format: `<slug>.md`
- Public URL: `https://certifyd.me/blog/<slug>/`
- Build command: `npm run build`

## Required front matter

```yaml
title: "Article title"
slug: "article-slug"
date: "2026-07-26"
author: "Certifyd"
excerpt: "Short public summary."
status: "published"
```

Published articles missing `title`, `slug`, `date` or `excerpt` fail the build.

## Optional front matter

```yaml
updated: "2026-07-26"
coverImage: "/images/blog/example.jpg"
tags:
  - creators
  - ownership
seoTitle: "Optional SEO title"
seoDescription: "Optional SEO description"
```

If `updated` is omitted, the build uses `date`. If `coverImage` is omitted, the build uses the default Certifyd homepage hero image.

## Drafts

Drafts must use:

```yaml
status: "draft"
```

Drafts are excluded from `/blog/`, article generation, the homepage recent-articles section, `sitemap.xml` and `feed.xml`.

## Images

- Public image destination: `images/blog/`
- Front matter value: `/images/blog/<filename>`
- Images should be committed in the same pull request as the article when the article depends on them.
- `coverImage` must be a root-relative `/images/` path.
- Path traversal, encoded separators and non-image-root paths fail validation.

## Generated outputs

`npm run build` generates:

- `blog/index.html`
- `blog/<slug>/index.html`
- homepage recent article block in `index.html`
- `sitemap.xml`
- `robots.txt`
- `feed.xml`

## Admin dashboard publisher requirements

The dashboard GitHub publisher should:

1. write Markdown to `content/blog/<slug>.md`;
2. write images to `images/blog/` when needed;
3. open a draft pull request only;
4. keep `status: "draft"` until founder review approves publication;
5. run or request `npm run build` validation before merge;
6. never commit directly to the GitHub Pages publishing branch.
