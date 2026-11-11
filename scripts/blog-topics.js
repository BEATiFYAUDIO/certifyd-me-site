export const FEATURED_SLUGS = [
  'i-asked-100-companies-for-my-data-i-got-deletion-notices-instead',
  'universal-has-sold-a-chunk-of-spotify-stock-for-around-467m-artists-will-likely-be-paid-ov',
  'vassal-benford-career-ownership-technology-hip-hop',
  'certifyd-architecture-creator-operated-infrastructure',
  'creator-owned-lie-account-someone-elses-server',
  'digital-music-news-metadata-royalties-mistaken-identity',
];
export const BLOG_TOPICS = [
  {
    id: 'creator-ownership',
    title: 'Creator Ownership & Infrastructure',
    description: 'Explore what it takes for creators to control their identity, work and audience relationships beyond a platform account.',
    slugs: [
      'can-it-run-core-your-computer-your-network',
      'certifyd-architecture-creator-operated-infrastructure',
      'creator-owned-lie-account-someone-elses-server',
      'i-asked-100-companies-for-my-data-i-got-deletion-notices-instead',
      'what-if-your-next-creator-platform-was-a-computer-you-owned',
      'vassal-benford-career-ownership-technology-hip-hop',
    ],
  },
  {
    id: 'music-rights',
    guideSlugs: ['music-metadata-checklist'],
    title: 'Music Rights, Royalties & Metadata',
    description: 'Follow the records, permissions and payment rules that determine how music is identified, licensed and paid for.',
    slugs: [
      'digital-music-news-metadata-royalties-mistaken-identity',
      'mlc-2027-black-box-royalty-distribution-market-share',
      'musixmatch-music-reports-rights-data-operating-layer',
      'qwantumrights-music-data-royalties-creator-control',
      'spotify-bundling-ruling-royalty-product-design',
      'universal-has-sold-a-chunk-of-spotify-stock-for-around-467m-artists-will-likely-be-paid-ov',
    ],
  },
  {
    id: 'ai-identity',
    title: 'AI, Identity & Provenance',
    description: 'Read how AI music raises questions about artist identity, consent, attribution and proof of origin.',
    slugs: [
      'jason-isbell-suno-ai-artist-identity',
      'suno-pulls-mary-j-blige-ad-unauthorized-representative',
      'voice-swap-ddex-ai-voice-rights-metadata',
      'sony-music-260000-ai-deepfake-takedown-requests',
      'reservoir-suno-lawsuit-ai-music-training-rights',
    ],
  },
  {
    id: 'direct-commerce',
    guideSlugs: ['sell-music-directly-to-fans'],
    title: 'Direct Fan Relationships & Commerce',
    description: 'See how artists and creator businesses reach fans, make sales and keep a direct relationship with their audience.',
    slugs: [
      'even-josh-remsberg-direct-to-fan-operating-layer',
      'soundcloud-paid-downloads-artists-keep-100-one-platform-problem',
      'fanfare-independent-music-charts-sales-not-streams',
      'spotify-paid-podcast-memberships-creator-infrastructure',
      'patreon-says-internet-failed-creators-is-another-platform-the-answer',
    ],
  },
];

// Deliberately limited to the 12 editorially selected supporting articles.
export const RELATED_READING = {
  "digital-music-news-metadata-royalties-mistaken-identity": {
    "topicId": "music-rights",
    "slugs": [
      "qwantumrights-music-data-royalties-creator-control",
      "digital-music-news-metadata-royalties-mistaken-identity"
    ]
  },
  "qwantumrights-music-data-royalties-creator-control": {
    "topicId": "music-rights",
    "slugs": [
      "qwantumrights-music-data-royalties-creator-control",
      "digital-music-news-metadata-royalties-mistaken-identity"
    ]
  },
  "musixmatch-music-reports-rights-data-operating-layer": {
    "topicId": "music-rights",
    "slugs": [
      "qwantumrights-music-data-royalties-creator-control",
      "digital-music-news-metadata-royalties-mistaken-identity"
    ]
  },
  "voice-swap-ddex-ai-voice-rights-metadata": {
    "topicId": "music-rights",
    "slugs": [
      "qwantumrights-music-data-royalties-creator-control",
      "digital-music-news-metadata-royalties-mistaken-identity"
    ]
  },
  "notes-fm-5m-raise-royalty-data-creator-stack": {
    "topicId": "music-rights",
    "slugs": [
      "qwantumrights-music-data-royalties-creator-control",
      "digital-music-news-metadata-royalties-mistaken-identity"
    ]
  },
  "prs-for-music-soundtrack-playback-data-royalties": {
    "topicId": "music-rights",
    "slugs": [
      "qwantumrights-music-data-royalties-creator-control",
      "digital-music-news-metadata-royalties-mistaken-identity"
    ]
  },
  "soundcloud-paid-downloads-artists-keep-100-one-platform-problem": {
    "topicId": "direct-commerce",
    "slugs": [
      "even-josh-remsberg-direct-to-fan-operating-layer",
      "soundcloud-paid-downloads-artists-keep-100-one-platform-problem"
    ]
  },
  "even-josh-remsberg-direct-to-fan-operating-layer": {
    "topicId": "direct-commerce",
    "slugs": [
      "even-josh-remsberg-direct-to-fan-operating-layer",
      "soundcloud-paid-downloads-artists-keep-100-one-platform-problem"
    ]
  },
  "fanfare-independent-music-charts-sales-not-streams": {
    "topicId": "direct-commerce",
    "slugs": [
      "even-josh-remsberg-direct-to-fan-operating-layer",
      "soundcloud-paid-downloads-artists-keep-100-one-platform-problem"
    ]
  },
  "patreon-says-internet-failed-creators-is-another-platform-the-answer": {
    "topicId": "direct-commerce",
    "slugs": [
      "even-josh-remsberg-direct-to-fan-operating-layer",
      "soundcloud-paid-downloads-artists-keep-100-one-platform-problem"
    ]
  },
  "spotify-paid-podcast-memberships-creator-infrastructure": {
    "topicId": "direct-commerce",
    "slugs": [
      "even-josh-remsberg-direct-to-fan-operating-layer",
      "soundcloud-paid-downloads-artists-keep-100-one-platform-problem"
    ]
  },
  "digiday-creator-economy-payments-direct-commerce": {
    "topicId": "direct-commerce",
    "slugs": [
      "even-josh-remsberg-direct-to-fan-operating-layer",
      "soundcloud-paid-downloads-artists-keep-100-one-platform-problem"
    ]
  }
};
