// Explicit allowlist: no admin, private app or account pages.
export const IMPORTANT_PUBLIC_PAGES = [
  { path: '/', file: 'index.html', priority: '1.0' },
  { path: '/profile/', file: 'profile/index.html', priority: '0.8' },
  { path: '/join/', file: 'join/index.html', priority: '0.8' },
  { path: '/downloads/', file: 'downloads/index.html', priority: '0.8' },
  { path: '/core/guide/', file: 'core/guide/index.html', priority: '0.8' },
  { path: '/network.html', file: 'network.html', priority: '0.7' },
  { path: '/retail-partners/', file: 'retail-partners/index.html', priority: '0.8' },
  { path: '/media-promotion/', file: 'media-promotion/index.html', priority: '0.8' },
  { path: '/services/', file: 'services/index.html', priority: '0.8' },
  { path: '/blog/', file: 'blog/index.html', priority: '0.8' },
];
