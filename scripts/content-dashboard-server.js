#!/usr/bin/env node
import { createContentDashboardServer } from './content-dashboard/server.js';
import { getDashboardConfig } from './content-dashboard/config.js';

const config = getDashboardConfig();
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || '127.0.0.1';
const server = createContentDashboardServer({ config });
server.listen(port, host, () => {
  console.log(`Certifyd site and Content Dashboard running at http://${host}:${port}`);
  console.log(`Dashboard enabled: ${config.enabled ? 'yes' : 'no'}`);
  console.log(`Auth mode: ${config.authMode}`);
  if (config.allowTemporaryTunnelTesting) {
    console.warn('WARNING: ALLOW_TEMPORARY_TUNNEL_TESTING=true is enabled. Cloudflare Access is bypassed only for authenticated local-login sessions. Disable this before production use.');
  }
});
