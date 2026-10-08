import {
  STORAGE_KEY, RELEASE, RELEASE_SHA, PRIVATE_PORT, PUBLIC_PORT,
  cleanDomain, validDomain, validSubdomain, validTunnelIdentity,
  validPublicURL, route, stageFor, emptyState, sanitizeState
} from './model.js';

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let storageOK = true;
let state;
try { state = sanitizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { state = emptyState(); }
let requirements = [];
let toastTimer;

const sources = {
  quick: 'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/',
  named: 'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/',
  dns: 'https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/',
  scan: 'https://developers.cloudflare.com/dns/zone-setups/reference/dns-quick-scan/',
  email: 'https://developers.cloudflare.com/dns/manage-dns-records/how-to/email-records/',
  troubleshooting: 'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshooting/',
  release: 'https://github.com/BEATiFYAUDIO/contentbox/commit/' + RELEASE_SHA
};

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2500);
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { storageOK = false; }
  $('#saved-label').innerHTML = storageOK
    ? 'Progress stays on this device<small>You can leave and come back.</small>'
    : 'Progress is temporary<small>Browser storage is unavailable.</small>';
}
function hostname() {
  return (state.answers.hostname || 'certifyd') + '.' + (state.answers.domain || 'example.com');
}
function origin() { return 'https://' + hostname(); }
function link(url, label) {
  return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + label + ' <span aria-hidden="true">↗</span></a>';
}
function note(text, warning) {
  return '<div class="callout ' + (warning ? 'warning' : '') + '">' + text + '</div>';
}
function details(title, body) {
  return '<details class="details"><summary>' + title + '</summary>' + body + '</details>';
}
function command(text, label) {
  return '<div class="command"><div class="command-top"><span>' + (label || 'COPYABLE COMMAND') +
    '</span><button class="copy" data-copy="' + esc(text) + '" type="button">Copy command</button></div><pre><code>' +
    esc(text) + '</code></pre></div>';
}
function check(id, text) {
  const key = state.current + ':' + id;
  return '<label class="check"><input type="checkbox" data-check="' + id + '" ' + (state.checks[key] ? 'checked' : '') +
    '><span>' + text + '</span></label>';
}
function field(key, label, placeholder, hint) {
  return '<div class="field"><label for="field-' + key + '">' + label + '</label><input id="field-' + key +
    '" data-field="' + key + '" type="text" value="' + esc(state.answers[key] || '') + '" placeholder="' +
    esc(placeholder) + '" autocomplete="off" autocapitalize="none" spellcheck="false">' +
    (hint ? '<small>' + hint + '</small>' : '') + '<div class="error" id="error-' + key + '" aria-live="polite"></div></div>';
}
function choices(key, items) {
  return '<div class="choices" role="group" aria-label="' + esc(key) + '">' + items.map((item) => {
    const selected = state.answers[key] === item[0];
    return '<button class="choice ' + (selected ? 'selected' : '') + '" data-choice="' + esc(key) +
      '" data-value="' + esc(item[0]) + '" aria-pressed="' + selected + '"><span class="choice-icon" aria-hidden="true">' +
      (item[3] || '◈') + '</span><span><strong>' + item[1] + (item[4] ? '<span class="recommended">RECOMMENDED</span>' : '') +
      '</strong><small>' + item[2] + '</small></span><span class="radio" aria-hidden="true"></span></button>';
  }).join('') + '</div>';
}
function ordered(items) {
  return '<ol class="instruction-list">' + items.map((item) => '<li>' + item + '</li>').join('') + '</ol>';
}
function need() { requirements = Array.from(arguments); }
function view(title, lead, body, contextTitle, contextBody, button) {
  return {title, lead, body, contextTitle, contextBody, button: button || 'Continue'};
}

function goalForAnswers(a) {
  if (a.goal !== 'unsure') return a.goal;
  if (a.inspectResult === 'service') return 'service';
  if (a.inspectResult === 'existing') return 'existing';
  return a.nextGoal;
}
function situationForAnswers(a) {
  const goal = goalForAnswers(a);
  if (goal === 'existing') return 'existing';
  if (goal === 'service') return 'service';
  return a.namedSituation;
}

function getView() {
  const a = state.answers;
  const id = state.current;
  requirements = [];

  switch (id) {
    case 'goal':
      return view(
        'What are you trying to do?',
        'Choose the outcome you need today. The guide will ask only what that path requires.',
        choices('goal', [
          ['quick', 'I just want a temporary public link', 'Fast test or share link. No DNS setup.', '↗', true],
          ['permanent', 'I want a permanent custom hostname', 'Stable address and durable public access.', '◎'],
          ['existing', 'I already have a Cloudflare tunnel', 'Reuse the exact tunnel already configured for Core.', '◉'],
          ['service', 'I already have a Cloudflare service running', 'Preserve the service-managed connector.', '▤'],
          ['unsure', 'I’m not sure', 'Inspect what exists before choosing a path.', '?']
        ]),
        'Fresh installs start private.',
        'In Beta 13, public mode is off, status is offline, posture is Basic, port 4010 is closed, and no Cloudflare tunnel starts until you explicitly choose public access.',
        'Find my path'
      );

    case 'inspect':
      return view(
        'What is already running on the Core computer?',
        'Choose the closest match. Multiple Cloudflare tunnels on one machine are valid.',
        choices('inspectResult', [
          ['service', 'A Cloudflare service', 'cloudflared starts through Windows Services, launchd, or systemd.', '▤'],
          ['existing', 'A named tunnel', 'I know there is a persistent tunnel identity.', '◉'],
          ['none', 'Nothing I recognize', 'I have not intentionally configured a named tunnel.', '○']
        ]),
        'Connected does not mean selected.',
        'Certifyd matches the configured tunnel by exact name or UUID. It does not adopt another tunnel merely because that tunnel is connected.'
      );

    case 'decide':
      return view(
        'Which result do you need?',
        'A temporary link is the shortest path. A named tunnel is a separate durable setup.',
        choices('nextGoal', [
          ['quick', 'Temporary public link', 'No DNS, Basic posture, stops when you stop it.', '↗', true],
          ['permanent', 'Permanent custom hostname', 'DNS, exact tunnel identity, Advanced posture when ready.', '◎']
        ]),
        'There is no automatic graduation.',
        'Beta 13 does not automatically turn a running Quick Tunnel into a named tunnel. You can return and begin the permanent path later.'
      );

    case 'quickPrivate':
      need('privateReady');
      return view(
        'Start from Core’s private state.',
        'Open Certifyd Core locally and confirm that Core itself is running.',
        note('<b>Expected before you start:</b> public mode <b>off</b>, public status <b>offline</b>, posture <b>Basic</b>, no listener on <b>127.0.0.1:' + PUBLIC_PORT + '</b>, and no Cloudflare tunnel started by Core.') +
        ordered([
          'Open the private operator interface at <b>http://127.0.0.1:' + PRIVATE_PORT + '</b> on the Core computer.',
          'Open <b>Configuration → Tunnel & routing</b>.',
          'Confirm Core is healthy before enabling any public access.'
        ]) +
        note('<b>Never expose port ' + PRIVATE_PORT + '.</b> It is the private operator API. Every public Cloudflare tunnel for Certifyd must target <b>http://127.0.0.1:' + PUBLIC_PORT + '</b>.', true) +
        check('privateReady', 'Core is running and I am ready to explicitly start temporary public access.'),
        'Two local listeners, two jobs.',
        'Port 4000 is private operator control. Port 4010 is the allowlisted public surface and exists only while public access needs it.'
      );

    case 'quickStart':
      need('started');
      return view(
        'Start the temporary link in Core.',
        'This is the entire Quick Tunnel setup in Beta 13.',
        note('Starting the link makes Core’s allowlisted public routes reachable on the internet. The temporary address is not a durable hostname.', true) +
        ordered([
          'In <b>Configuration → Tunnel & routing</b>, choose <b>Start temporary link</b>.',
          'Wait while Core opens <b>127.0.0.1:' + PUBLIC_PORT + '</b> and launches the Quick Tunnel process it owns.',
          'Copy the generated <b>https://…trycloudflare.com</b> address only after <b>Core reports it as the public URL</b>.'
        ]) +
        note('<b>Expected active state:</b> posture <b>Basic</b>; canonical origin is the temporary URL; canonical buyer origin is empty; durable status is not ready; reason <code>BASIC_TEMP_LINK_NON_DURABLE</code>.') +
        check('started', 'Core reports the generated temporary public URL.'),
        'Trust Core’s reported URL.',
        'An unrelated trycloudflare.com string in an error message does not prove a tunnel was created. Continue only when Core reports the actual generated public address.',
        'Verify my link'
      );

    case 'cfAccount':
      return view(
        'Do you have a Cloudflare account?',
        'Named tunnels use a Cloudflare account and a domain managed in that account.',
        choices('cfAccount', [
          ['yes', 'Yes', 'I can sign in to the account that should own this tunnel.', '✓'],
          ['no', 'No', 'I need to create an account first.', '+']
        ]),
        'Named means durable identity.',
        'A named tunnel has a persistent name and UUID. Its hostname can remain stable across connector restarts.'
      );

    case 'cfAccountSetup':
      need('accountReady');
      return view(
        'Create or access your Cloudflare account.',
        'Use an account that should remain responsible for the domain and tunnel.',
        ordered([
          'Create an account or recover access at ' + link('https://dash.cloudflare.com/sign-up', 'Cloudflare') + '.',
          'Sign in and leave the dashboard open.',
          'Return here when the account is ready.'
        ]) + check('accountReady', 'I can sign in to the correct Cloudflare account.'),
        'Keep ownership clear.',
        'The account controls the tunnel identity and DNS. Use an organization-owned account when this is a long-lived installation.'
      );

    case 'namedSituation':
      return view(
        'What is already set up on this computer?',
        'This prevents a new connector from colliding with an existing one.',
        choices('namedSituation', [
          ['service', 'A service-managed tunnel', 'cloudflared is already run by an operating-system service.', '▤'],
          ['existing', 'An existing named tunnel', 'The tunnel exists, but it is not an OS-managed service.', '◉'],
          ['none', 'No named tunnel for Core', 'Create a new persistent tunnel identity.', '+'],
          ['unknown', 'I need to check', 'Inspect first; do not stop anything yet.', '?']
        ]),
        'Existing services stay authoritative.',
        'When the exact configured Certifyd tunnel is managed externally, Core does not launch a duplicate connector or terminate that service.'
      );

    case 'domainStatus':
      return view(
        'Do you control a domain for the permanent address?',
        'For example, example.com could host certifyd.example.com.',
        choices('domainStatus', [
          ['yes', 'Yes', 'I can manage its DNS and registrar settings.', '✓'],
          ['no', 'No', 'I need to obtain a domain first.', '○'],
          ['managed', 'Someone else manages it', 'I need their help or approval.', '⌁']
        ]),
        'A hostname belongs under a domain.',
        'The domain owner controls DNS. This guide will stop before any nameserver or route change unless you explicitly confirm it.'
      );

    case 'domainWait':
      return view(
        'Pause before configuring a named tunnel.',
        a.domainStatus === 'managed'
          ? 'Ask the domain administrator to participate in the DNS steps.'
          : 'Obtain a domain and access to its DNS settings first.',
        note('You can use the temporary-link path while waiting. It is a separate setup and will not automatically graduate to a named tunnel.') +
        '<p class="inline-note">Return to the first step and choose the temporary link if you need public testing now.</p>',
        'No DNS change has been made.',
        'This guide only prepares instructions. It never changes DNS records or nameservers itself.',
        'Return to start'
      );

    case 'domain':
      return view(
        'Which domain will hold the hostname?',
        'Enter the root domain only.',
        field('domain', 'Root domain', 'example.com', 'Do not include https://, a path, or a subdomain.'),
        'Example',
        'For certifyd.example.com, the root domain is example.com.'
      );

    case 'cloudflare':
      return view(
        'Is this domain active on Cloudflare DNS?',
        'Check the domain’s status in the Cloudflare dashboard.',
        choices('cloudflare', [
          ['active', 'Yes, it is Active', 'Cloudflare already provides authoritative DNS.', '✓'],
          ['not', 'No', 'The domain must be added and nameservers migrated.', '→'],
          ['unsure', 'I’m not sure', 'Show me how to check.', '?']
        ]),
        'Active is a Cloudflare status.',
        'A domain can have a Cloudflare account without yet using Cloudflare’s authoritative nameservers.'
      );

    case 'cloudflareCheck':
      return view(
        'Check the domain status.',
        'In Cloudflare, open Websites and select ' + esc(a.domain || 'your domain') + '.',
        ordered([
          'Look for the status beside the domain.',
          'Choose the result below. Do not infer status from whether a website loads.'
        ]) + choices('cloudflareResult', [
          ['active', 'Status is Active', 'Continue without migrating nameservers.', '✓'],
          ['not', 'Not active or not present', 'Prepare a careful DNS migration.', '→']
        ]),
        'Website reachability is separate.',
        'A hostname can respond while the intended tunnel identity is wrong or offline. Check DNS and tunnel identity independently.'
      );

    case 'services':
      return view(
        'What services already use this domain?',
        'Select the best description so the migration checklist highlights what must be preserved.',
        choices('services', [
          ['web', 'Website only', 'The domain hosts web pages.', '◫'],
          ['email', 'Website and email', 'It also receives mail.', '✉'],
          ['many', 'Several services', 'Apps, APIs, verification records, or other hosts.', '▦'],
          ['unknown', 'I’m not sure', 'Treat every current record as important.', '?']
        ]),
        'DNS records are directions.',
        'They tell browsers, mail systems, and other services where to go. Missing records can interrupt those services.'
      );

    case 'backup':
      need('backup');
      return view(
        'Back up every current DNS record.',
        'Do this before adding the domain to Cloudflare or changing nameservers.',
        ordered([
          'Open the current DNS provider.',
          'Export the DNS zone if it offers an export. Otherwise capture every record’s type, name, value, priority, proxy state, and TTL.',
          'Pay special attention to MX, TXT, CAA, SRV, DKIM, DMARC, and verification records.'
        ]) +
        note('Cloudflare’s quick scan is a starting point, not a complete backup. Compare it with the authoritative source. ' + link(sources.scan, 'DNS scan guidance'), true) +
        (a.services === 'email' || a.services === 'many' || a.services === 'unknown'
          ? details('Email safety', '<p>Preserve all MX records and the TXT/CNAME records used for SPF, DKIM, and DMARC. See ' + link(sources.email, 'Cloudflare email DNS guidance') + '.</p>')
          : '') +
        check('backup', 'I saved and reviewed a complete copy of the current DNS records.'),
        'This is your rollback reference.',
        'If a service is missing after migration, the backup shows the exact record that existed before.'
      );

    case 'addDomain':
      need('added');
      return view(
        'Add the domain to Cloudflare.',
        'Import and compare records before changing nameservers.',
        ordered([
          'In Cloudflare, choose <b>Add a domain</b> and enter <b>' + esc(a.domain) + '</b>.',
          'Review every scanned record against your backup.',
          'Add any missing records. Keep mail-related records DNS-only.'
        ]) + check('added', 'The domain is added and every required record is present in Cloudflare.'),
        'Nothing moves yet.',
        'Adding the zone prepares Cloudflare. Traffic changes only after the registrar uses Cloudflare’s assigned nameservers.'
      );

    case 'records':
      need('records');
      return view(
        'Review the migration record by record.',
        'This is the final content check before nameserver changes.',
        ordered([
          'Confirm root and www web records.',
          'Confirm every email and verification record.',
          'Confirm application and API hostnames.',
          'Record the current registrar nameservers for rollback.'
        ]) + check('records', 'I compared Cloudflare DNS with the backup and recorded the old nameservers.'),
        'Preserve first, improve later.',
        'Keep the migration focused on matching existing behavior. Make unrelated DNS changes after the zone is stable.'
      );

    case 'dnssec':
      return view(
        'Is DNSSEC enabled at the registrar?',
        'Check the registrar’s DNSSEC or DS-record section.',
        choices('dnssec', [
          ['off', 'Off', 'No DS record is published.', '○'],
          ['on', 'On', 'A DS record is currently published.', '●'],
          ['unknown', 'I’m not sure', 'Show me what to look for.', '?']
        ]),
        'DNSSEC validates DNS answers.',
        'A stale DS record can make the whole domain unreachable after nameservers change.'
      );

    case 'dnssecHelp':
      return view(
        'Confirm the current DNSSEC state.',
        'Look for an enabled DNSSEC switch or a DS record at the registrar.',
        choices('dnssecResult', [
          ['off', 'No DS record / disabled', 'Continue to the approval checkpoint.', '○'],
          ['on', 'DS record present / enabled', 'Disable it before nameserver migration, then re-enable through Cloudflare afterward.', '●']
        ]),
        'Treat uncertainty as a stop sign.',
        'Do not change nameservers until you know whether an old DS record exists.'
      );

    case 'dnsApproval':
      need('approved');
      return view(
        'Review the DNS change before doing it.',
        'The next step changes which DNS provider is authoritative for the entire domain.',
        note('<b>External change:</b> this can affect the website, email, apps, and verification records. Confirm the backup and rollback nameservers first.', true) +
        check('approved', 'I explicitly approve changing this domain’s nameservers after reviewing the impact.'),
        'The guide cannot make this change.',
        'You will perform it at the registrar. The guide records progress only in this browser.'
      );

    case 'nameservers':
      need('changed');
      return view(
        'Change nameservers at the registrar.',
        'Use only the two nameservers Cloudflare assigned to this exact zone.',
        ordered([
          a.dnssec === 'on' || a.dnssecResult === 'on' ? 'Disable DNSSEC or remove the old DS record at the registrar first.' : 'Confirm no old DS record is present.',
          'Replace the existing nameservers with the exact pair shown by Cloudflare.',
          'Save the change. Do not delete the old DNS account yet.'
        ]) +
        note('Keep the old nameservers and DNS backup until Cloudflare reports Active and all services are verified.', true) +
        check('changed', 'I changed the nameservers using Cloudflare’s exact assigned values.'),
        'Propagation takes time.',
        'Registries and recursive resolvers update on their own schedules. Avoid repeated changes while activation is pending.'
      );

    case 'activation':
      need('active');
      return view(
        'Wait for Cloudflare to report Active.',
        'Then verify the existing website, email, and other services before adding the Certifyd hostname.',
        ordered([
          'Check zone status in Cloudflare.',
          'Test existing web and application hostnames.',
          'Send and receive email if the domain uses mail.',
          'If DNSSEC was previously enabled, follow Cloudflare’s instructions to enable it again with the new DS record.'
        ]) +
        check('active', 'Cloudflare reports Active and existing services still work.'),
        'Finish the migration before the tunnel.',
        'This keeps DNS problems separate from tunnel configuration problems.'
      );

    case 'hostnameState':
      return view(
        'Is the Certifyd hostname already configured?',
        'Do not overwrite a hostname used by another service.',
        choices('hostnameState', [
          ['new', 'No, choose a new hostname', 'Create a dedicated label such as certifyd.', '+', true],
          ['existing', 'Yes, it already exists', 'Verify that it belongs to the exact Certifyd tunnel.', '✓'],
          ['unknown', 'I need to check', 'Inspect DNS and Cloudflare tunnel routes first.', '?']
        ]),
        'Hostname and tunnel identity are separate.',
        'A reachable hostname does not prove that the intended named tunnel is connected.'
      );

    case 'hostname':
      return view(
        'Choose the public hostname.',
        'This will be the durable public origin when the named setup is ready.',
        field('hostname', 'Hostname label', 'certifyd', 'Result: https://' + esc(hostname())),
        'Use a dedicated label.',
        'Avoid www, mail, and labels already used by websites, email, or applications.'
      );

    case 'os':
      return view(
        'Which operating system runs Core?',
        'Commands and service checks depend on the Core computer.',
        choices('os', [
          ['windows', 'Windows', 'Cloudflare may run through Windows Services.', '⊞'],
          ['mac', 'macOS', 'Cloudflare may run through launchd.', '⌘'],
          ['linux', 'Linux / Raspberry Pi', 'Cloudflare may run through systemd.', '▤']
        ]),
        'Check the Core computer itself.',
        'A browser on another device can follow the guide, but the connector and public listener run beside Core.'
      );

    case 'identity':
      return view(
        'Enter the exact configured tunnel name or UUID.',
        'Copy it from Certifyd’s named-tunnel configuration or the intended Cloudflare tunnel object.',
        field('identity', 'Exact tunnel name or UUID', 'certifyd-core or 00000000-0000-0000-0000-000000000000', 'Exact identity matters; a similar name is a different tunnel.'),
        'No best-match selection.',
        'Certifyd does not select the only connected tunnel, a similarly named tunnel, or a tunnel merely because its hostname responds.'
      );

    case 'management':
      return view(
        'Who manages this exact tunnel connector?',
        'Identify process ownership before starting or stopping anything.',
        choices('management', [
          ['external', 'An existing OS service', 'The service remains authoritative.', '▤'],
          ['app', 'Certifyd manages it', 'Core may own the connector child process.', '◉'],
          ['unknown', 'I’m not sure', 'Inspect the exact tunnel and service configuration.', '?']
        ]),
        'Ownership controls Stop behavior.',
        'Certifyd stops only a cloudflared child process it owns. It does not terminate an externally managed service.'
      );

    case 'existingCheck': {
      need('identityChecked');
      const inspect = a.os === 'windows'
        ? 'sc query cloudflared'
        : a.os === 'mac'
          ? 'launchctl list | grep -i cloudflared'
          : 'systemctl status cloudflared --no-pager';
      return view(
        'Verify the exact tunnel and its owner.',
        'Inspect before changing processes. Preserve every unrelated tunnel.',
        ordered([
          'In Cloudflare, find the tunnel whose <b>exact name or UUID</b> is <b>' + esc(a.identity || 'the configured identity') + '</b>.',
          'Confirm its public hostname is <b>' + esc(hostname()) + '</b> and its service target is <b>http://127.0.0.1:' + PUBLIC_PORT + '</b>.',
          'Check whether the connector is externally service-managed or app-managed.'
        ]) +
        command(inspect, 'READ-ONLY SERVICE CHECK') +
        note('<b>Do not run broad kill commands.</b> Never use <code>pkill cloudflared</code> or <code>pkill -f "cloudflared tunnel run"</code>. Those commands can stop unrelated tunnels.', true) +
        check('identityChecked', 'I verified the exact configured tunnel identity and who manages it.'),
        'Multiple tunnels are legitimate.',
        'Do not delete, stop, rename, or replace other Cloudflare tunnels just because Certifyd can see them.'
      );
    }

    case 'createTunnel':
      need('created');
      return view(
        'Create one named tunnel for Certifyd.',
        'Use a distinct name and record both the exact name and UUID.',
        ordered([
          'In Cloudflare Zero Trust, open <b>Networks → Connectors → Cloudflare Tunnels</b>.',
          'Create a Cloudflared tunnel with a unique, recognizable name.',
          'Save the exact name and UUID shown by Cloudflare.'
        ]) +
        note('This creates a durable tunnel identity. It does not automatically convert a Quick Tunnel or reuse its temporary URL.') +
        check('created', 'The named tunnel exists and I recorded its exact name and UUID.'),
        'The UUID is the strongest identifier.',
        'Names can look similar. The UUID uniquely identifies the tunnel object.'
      );

    case 'connector':
      need('connectorReady');
      return view(
        'Install or run the named connector.',
        'Follow Cloudflare’s command for this exact tunnel and choose one process owner.',
        ordered([
          'Use ' + link(sources.named, 'Cloudflare’s named tunnel setup') + ' for the Core computer’s operating system.',
          'If installing as an OS service, let that service remain authoritative.',
          'Do not also ask Certifyd to launch a duplicate connector for the same tunnel.'
        ]) +
        check('connectorReady', 'The exact named tunnel connector is installed with one clear owner.'),
        'One tunnel, one active owner.',
        'A service-managed connector can coexist with Certifyd. Core detects that ownership and avoids starting a duplicate process.'
      );

    case 'routeApproval':
      need('routeApproved');
      return view(
        'Review the public route before creating it.',
        'The next step maps the hostname to Core’s public-safe listener.',
        note('<b>External change:</b> publishing this hostname makes Core’s allowlisted public surface reachable through Cloudflare.', true) +
        '<div class="summary-card"><span>Public hostname</span><strong>' + esc(origin()) + '</strong><span>Service target</span><strong>http://127.0.0.1:' + PUBLIC_PORT + '</strong></div>' +
        note('<b>Port ' + PRIVATE_PORT + ' is never a tunnel target.</b> It is the private operator API.', true) +
        check('routeApproved', 'I explicitly approve adding or updating this hostname route for the exact Certifyd tunnel.'),
        'This approval is specific.',
        'It applies only to this hostname and the exact configured tunnel identity. It does not authorize changing other DNS records or tunnel processes.'
      );

    case 'publicRoute':
      need('routed');
      return view(
        'Configure the public hostname route.',
        'Make the route on the exact named tunnel you verified or created.',
        ordered([
          'Open the exact Certifyd tunnel in Cloudflare.',
          'Add or verify public hostname <b>' + esc(hostname()) + '</b>.',
          'Set service type to <b>HTTP</b> and URL to <b>127.0.0.1:' + PUBLIC_PORT + '</b>.',
          'Save, then confirm the connector for this exact tunnel remains connected.'
        ]) +
        command('http://127.0.0.1:' + PUBLIC_PORT, 'REQUIRED SERVICE TARGET') +
        check('routed', 'The exact tunnel routes ' + esc(hostname()) + ' to port ' + PUBLIC_PORT + '.'),
        'Route identity and reachability are both required.',
        'A hostname response checks reachability. Certifyd separately requires exact configured tunnel identity evidence.'
      );

    case 'coreConfirm':
      need('coreConfigured');
      return view(
        'Confirm the named setup in Certifyd Core.',
        'Use the existing named-tunnel controls; do not invent or infer another identity.',
        ordered([
          'Open Core’s private operator interface at <b>http://127.0.0.1:' + PRIVATE_PORT + '</b>.',
          'Configure the exact tunnel name or UUID and durable hostname <b>' + esc(hostname()) + '</b>.',
          a.management === 'external' || situationForAnswers(a) === 'service'
            ? 'Confirm Core recognizes the connector as externally managed and does not launch a duplicate process.'
            : 'Confirm Core reports the intended app-managed ownership.',
          'Wait for Advanced posture and durable-ready state.'
        ]) +
        note('<b>Expected durable result:</b> posture <b>Advanced</b>; canonical origin and canonical buyer origin are <b>' + esc(origin()) + '</b>; canonical is true; durable ready is true.') +
        check('coreConfigured', 'Core identifies the exact tunnel and reports the durable named setup ready.'),
        'Stop respects ownership.',
        'Stopping Certifyd-managed public access does not terminate an external Cloudflare service.'
      );

    case 'verify': {
      const goal = goalForAnswers(a);
      const expectedHost = goal === 'quick' ? '' : hostname();
      return view(
        goal === 'quick' ? 'Verify the link Core reported.' : 'Verify the durable hostname.',
        goal === 'quick'
          ? 'Paste the public URL exactly as shown by Core after tunnel creation.'
          : 'Open the expected hostname and confirm Core’s public health route responds.',
        field(
          'publicURL',
          goal === 'quick' ? 'Core-reported public URL' : 'Public URL',
          goal === 'quick' ? 'https://words-words.trycloudflare.com' : origin(),
          goal === 'quick'
            ? 'Do not copy a URL from raw error output.'
            : 'Expected host: ' + esc(expectedHost)
        ) +
        ordered([
          'Open the URL in a private browser window or on a different network.',
          'Check <b>/health</b> and expect HTTP 200.',
          goal === 'quick'
            ? 'Confirm Core still shows Basic posture and the same temporary canonical origin.'
            : 'Confirm Core shows Advanced posture, exact tunnel identity, canonical origin, canonical buyer origin, and durable-ready state.'
        ]) +
        details(
          goal === 'quick' ? 'Quick Tunnel troubleshooting' : 'Named tunnel troubleshooting',
          goal === 'quick'
            ? '<ol><li>Confirm Core itself is running.</li><li>Confirm you explicitly started the temporary link.</li><li>Confirm the public listener on port 4010 is available.</li><li>Confirm cloudflared targets 127.0.0.1:4010.</li><li>Trust only the URL Core reports after actual tunnel creation.</li><li>If cloudflared cannot reach Cloudflare, check the OS CA certificates and TLS environment.</li><li>Never switch the target to port 4000.</li></ol><p>' + link(sources.troubleshooting, 'Cloudflare troubleshooting') + '</p>'
            : '<ol><li>Confirm the exact configured tunnel name or UUID.</li><li>Do not select a different connected tunnel.</li><li>Determine whether the connector is app-managed or service-managed.</li><li>Check hostname reachability separately from tunnel-object identity.</li><li>Preserve unrelated Cloudflare processes.</li><li>Do not use broad process termination.</li></ol><p>' + link(sources.troubleshooting, 'Cloudflare troubleshooting') + '</p>'
        ),
        'Verification closes the loop.',
        goal === 'quick'
          ? 'The valid temporary origin is the URL Core reports. api.trycloudflare.com or another URL seen in an error does not count.'
          : 'A successful page load alone does not prove exact tunnel identity. Check both Core’s status and the public response.',
        'Finish setup'
      );
    }

    case 'done': {
      const goal = goalForAnswers(a);
      if (goal === 'quick') {
        return view(
          'Your temporary link is ready.',
          'Use it for testing or short-lived sharing. It is not a durable hostname.',
          '<div class="success-mark">✓</div><div class="summary-card"><span>Public origin</span><strong>' + esc(a.publicURL) +
          '</strong><span>Posture</span><strong>Basic</strong><span>Durable</span><strong>No · BASIC_TEMP_LINK_NON_DURABLE</strong></div>' +
          note('<b>When you press Stop:</b> Certifyd terminates only the Quick Tunnel child it owns, closes port 4010, leaves Quick autostart disabled, preserves consent state, and leaves unrelated Cloudflare tunnels and services running. Restarting Core remains private/off until you explicitly start public access again.') +
          '<p>When you want a permanent hostname, start a new setup and choose the named-tunnel path. Beta 13 does not perform an automatic Quick-to-named handoff.</p>',
          'Temporary means temporary.',
          'The trycloudflare.com address can change the next time you start. Do not use it as a permanent commerce or buyer origin.',
          'Start another setup'
        );
      }
      return view(
        'Your durable hostname is ready.',
        'The exact named tunnel now provides the canonical public and buyer origin.',
        '<div class="success-mark">✓</div><div class="summary-card"><span>Canonical origin</span><strong>' + esc(origin()) +
        '</strong><span>Canonical buyer origin</span><strong>' + esc(origin()) +
        '</strong><span>Posture</span><strong>Advanced</strong><span>Durable ready</span><strong>Yes</strong></div>' +
        note('Keep the tunnel name/UUID and process owner documented. Preserve unrelated Cloudflare tunnels and DNS records during future troubleshooting.'),
        'Durability comes from exact configuration.',
        'The stable result depends on the intended tunnel identity, the public hostname route, the port 4010 target, and a clearly owned connector process.',
        'Start another setup'
      );
    }
  }

  return view('Return to the start.', 'This saved path is no longer valid.', '', 'Nothing external changed.', 'Resetting this guide affects only browser progress.', 'Start over');
}

function isSatisfied() {
  const a = state.answers;
  const id = state.current;
  if (requirements.some((key) => !state.checks[id + ':' + key])) return false;
  const answerRequired = {
    goal: 'goal', inspect: 'inspectResult', decide: 'nextGoal', cfAccount: 'cfAccount',
    namedSituation: 'namedSituation', domainStatus: 'domainStatus', cloudflare: 'cloudflare',
    cloudflareCheck: 'cloudflareResult', services: 'services', dnssec: 'dnssec',
    dnssecHelp: 'dnssecResult', hostnameState: 'hostnameState', os: 'os',
    management: 'management'
  };
  if (answerRequired[id] && !a[answerRequired[id]]) return false;
  if (id === 'domain' && !validDomain(a.domain)) return false;
  if (id === 'hostname' && !validSubdomain(a.hostname)) return false;
  if (id === 'identity' && !validTunnelIdentity(a.identity)) return false;
  if (id === 'verify' && !validPublicURL(a.publicURL, goalForAnswers(a), hostname())) return false;
  return true;
}

function updateErrors() {
  const a = state.answers;
  const messages = {
    domain: a.domain && !validDomain(a.domain) ? 'Enter a root domain such as example.com.' : '',
    hostname: a.hostname && !validSubdomain(a.hostname) ? 'Use one DNS label such as certifyd. Avoid reserved service labels.' : '',
    identity: a.identity && !validTunnelIdentity(a.identity) ? 'Enter the exact tunnel name or UUID.' : ''
  };
  Object.entries(messages).forEach(([key, message]) => {
    const element = $('#error-' + key);
    if (element) element.textContent = message;
  });
  const publicError = $('#error-publicURL');
  if (publicError) {
    publicError.textContent = a.publicURL && !validPublicURL(a.publicURL, goalForAnswers(a), hostname())
      ? (goalForAnswers(a) === 'quick'
        ? 'Paste the exact HTTPS trycloudflare.com URL reported by Core. Error-service URLs do not count.'
        : 'Enter exactly ' + origin() + '.')
      : '';
  }
}

function renderHelp() {
  $('#help-content').innerHTML =
    '<div class="glossary">' +
    '<div><strong>Private/operator API</strong><p>Local control surface at 127.0.0.1:4000. Never expose it through a public tunnel.</p></div>' +
    '<div><strong>Public allowlisted listener</strong><p>The public-safe surface at 127.0.0.1:4010. Every Certifyd Cloudflare tunnel targets this listener.</p></div>' +
    '<div><strong>Quick Tunnel</strong><p>A temporary trycloudflare.com link explicitly started and stopped in Core. It remains Basic and is not durable.</p></div>' +
    '<div><strong>Named tunnel</strong><p>A persistent Cloudflare tunnel with an exact name and UUID, custom hostname, and durable configuration.</p></div>' +
    '<div><strong>Canonical origin</strong><p>The public base URL Core currently treats as authoritative.</p></div>' +
    '<div><strong>Canonical buyer origin</strong><p>The durable buyer and commerce base URL. Quick mode does not provide one.</p></div>' +
    '<div><strong>Process owner</strong><p>The application or OS service responsible for starting and stopping a connector.</p></div>' +
    '<div><strong>DNS</strong><p>The records that direct domain names to websites, mail, applications, and tunnel hostnames.</p></div>' +
    '</div><p class="source-note"><b>Guide source of truth:</b> Certifyd Core ' + esc(RELEASE) + ' · <code>' +
    esc(RELEASE_SHA) + '</code> · Phase 1 and Phase 2A shipped; automatic Quick-to-named graduation is not included. ' +
    link(sources.release, 'Release source') + '</p>';
}

function render() {
  const ids = route(state.answers);
  if (!ids.includes(state.current)) state.current = ids.find((step) => !state.completed.includes(step)) || ids[0];
  const currentIndex = Math.max(0, ids.indexOf(state.current));
  const percent = ids.length <= 1 ? 0 : Math.round((currentIndex / (ids.length - 1)) * 100);
  const stage = stageFor(state.current);
  const stageNames = ['Choose path', 'Protect DNS', 'Connect safely', 'Verify'];
  const item = getView();

  $('#percent').textContent = percent + '%';
  $('#progress-bar').style.width = percent + '%';
  $('#stages').innerHTML = stageNames.map((name, index) =>
    '<div class="stage ' + (index < stage ? 'complete' : index === stage ? 'active' : '') +
    '"><span class="stage-dot">' + (index < stage ? '✓' : index + 1) + '</span><div><strong>' + name + '</strong><small>' +
    ['Goal and current state', 'Preserve existing services', 'Tunnel and hostname', 'Confirm the result'][index] +
    '</small></div></div>'
  ).join('');

  $('#step-label').textContent = stage === 0 ? 'LET’S FIND YOUR PATH' : stage === 1 ? 'DNS SAFETY' : stage === 2 ? 'TUNNEL SETUP' : 'FINAL CHECK';
  $('#path-chip').textContent = goalForAnswers(state.answers) === 'quick' ? 'Quick Tunnel' : goalForAnswers(state.answers) ? 'Named tunnel' : RELEASE;
  $('#step-content').innerHTML = '<h2>' + item.title + '</h2><p class="lead">' + item.lead + '</p>' + item.body;
  $('#context-title').textContent = item.contextTitle;
  $('#context-body').textContent = item.contextBody;

  const back = currentIndex > 0 ? '<button class="secondary" id="back-button">Back</button>' : '<span></span>';
  $('#step-footer').innerHTML = back + '<button class="primary" id="continue-button" ' + (isSatisfied() ? '' : 'disabled') + '>' + item.button + ' <span aria-hidden="true">→</span></button>';

  $('#back-button')?.addEventListener('click', () => {
    const previous = ids[currentIndex - 1];
    state.completed = state.completed.filter((step) => step !== previous && ids.indexOf(step) < currentIndex - 1);
    state.current = previous;
    save();
    render();
  });
  $('#continue-button')?.addEventListener('click', () => {
    if (!isSatisfied()) return;
    if (state.current === 'domainWait' || state.current === 'done' || !ids[currentIndex + 1]) {
      state = emptyState();
      save();
      render();
      window.scrollTo({top: 0, behavior: 'smooth'});
      return;
    }
    if (!state.completed.includes(state.current)) state.completed.push(state.current);
    state.current = ids[currentIndex + 1];
    save();
    render();
    document.querySelector('.guide-panel')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  });

  document.querySelectorAll('[data-choice]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.choice;
    state.answers[key] = button.dataset.value;
    const freshRoute = route(state.answers);
    state.completed = state.completed.filter((step) => freshRoute.includes(step));
    save();
    render();
  }));
  document.querySelectorAll('[data-check]').forEach((input) => input.addEventListener('change', () => {
    const key = state.current + ':' + input.dataset.check;
    if (input.checked) state.checks[key] = true; else delete state.checks[key];
    save();
    render();
  }));
  document.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.field;
      state.answers[key] = key === 'domain' ? cleanDomain(input.value) : input.value.trim();
      save();
      updateErrors();
      const continueButton = $('#continue-button');
      if (continueButton) continueButton.disabled = !isSatisfied();
    });
  });
  document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      toast('Copied');
    } catch {
      toast('Select the command and copy it manually');
    }
  }));
  updateErrors();
  save();
}

$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#context-help').addEventListener('click', () => $('#help-dialog').showModal());
$('#reset-button').addEventListener('click', () => $('#reset-dialog').showModal());
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$('#confirm-reset').addEventListener('click', () => {
  state = emptyState();
  save();
  $('#reset-dialog').close();
  render();
  toast('Progress cleared');
});
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
}));

renderHelp();
render();
