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
function screens(items) {
  return items.map(([file, caption, alt]) =>
    '<figure class="guide-shot"><a href="images/' + esc(file) + '" target="_blank" rel="noopener" aria-label="Open full-size screenshot: ' + esc(alt) + '">' +
    '<img src="images/' + esc(file) + '" alt="' + esc(alt) + '" loading="lazy"></a><figcaption>' + caption + ' <span>Open full size</span></figcaption></figure>'
  ).join('');
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
        'How do you want to share your page?',
        'Choose the address you want. Core will show what is actually running.',
        choices('goal', [
          ['quick', 'A temporary link', 'A quick way to share. The address may change.', '↗', true],
          ['permanent', 'My own domain', 'A lasting address you control.', '◎'],
          ['existing', 'I already have a Cloudflare tunnel', 'Keep the connection I already use.', '◉'],
          ['service', 'A Cloudflare service runs on my computer', 'Keep the existing service in charge.', '▤'],
          ['unsure', 'I’m not sure', 'Core can discover supported connections.', '?']
        ]),
        'Your page starts private.',
        'Finding an existing connection does not give Core permission to share your page. In Core, choose Enable sharing when you are ready.',
        'Find my path'
      );

    case 'inspect':
      return view(
        'What does Core show?',
        'Open Configuration → Public Connection. Core discovers supported connections; choose what it finds.',
        choices('inspectResult', [
          ['service', 'An existing service', 'A Cloudflare service runs separately from Core.', '▤'],
          ['existing', 'A permanent connection', 'A named connection is already configured.', '◉'],
          ['none', 'Nothing I recognize', 'Start with a temporary link or set up a domain.', '○']
        ]),
        'Unknown is okay.',
        'Core may find a service without proving which tunnel it serves. Check Advanced / Diagnostics if its identity is unclear.'
      );

    case 'decide':
      return view(
        'What do you want to use?',
        'You can choose a temporary link now and move to your own domain later.',
        choices('nextGoal', [
          ['quick', 'Temporary link', 'Start sharing without setting up a domain.', '↗', true],
          ['permanent', 'My own domain', 'Set up a lasting public address.', '◎']
        ]),
        'Changing tabs does not change sharing.',
        'Only the action you confirm in Core can enable or stop public sharing.'
      );

    case 'quickPrivate':
      need('privateReady');
      return view(
        'Open Core.',
        'Start Certifyd Core and sign in to your private dashboard.',
        ordered([
          'In Core, open <b>Configuration → Public Connection</b>.',
          'Check the current <b>Connection</b>, <b>Public address</b>, and <b>Sharing</b> status. If sharing is already online, use that address rather than starting another connection.'
        ]) + check('privateReady', 'Core is open and I have checked its current sharing status.'),
        'Your private dashboard stays private.',
        'A public creator page is separate from the dashboard. Advanced detail: dashboard/API uses port 4000; the public creator listener uses port 4010.'
      );

    case 'quickStart':
      need('started');
      return view(
        'Enable temporary sharing.',
        'One action in Core puts your creator page online.',
        ordered([
          'In <b>Configuration → Public Connection</b>, select <b>Temporary</b>.',
          'Choose <b>Enable sharing</b> and wait for Core to connect.',
          'Copy the <b>Public address</b> only after Core shows <b>Sharing: Online</b>.'
        ]) +
        note('Selecting Temporary alone does not publish your page. If Core says Connecting or Unverified, do not treat the link as ready.') +
        check('started', 'Core shows Sharing: Online and a temporary public address.'),
        'A temporary link can change.',
        'Core starts the temporary connection with your consent. Keep Core running while you want visitors to reach it.',
        'Check my page'
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
        ]) + screens([
          ['cloudflare-add-domain.png', 'Cloudflare’s Add a domain screen. Enter your own domain in this field.', 'Cloudflare domain name field']
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
        ]) + screens([
          ['cloudflare-dns-review.png', 'Cloudflare’s scan can flag missing web or email records. Compare the actual records with your backup; the domain in this example is generic.', 'Cloudflare DNS scan warnings and DNS management']
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
        ]) + screens([
          ['cloudflare-nameservers.png', 'Cloudflare shows the two nameservers assigned to your zone. The values and previous nameservers are hidden in this example; copy yours directly from Cloudflare.', 'Cloudflare nameserver instructions with values redacted']
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
        ]) + screens([
          ['cloudflare-next-steps.png', 'Cloudflare’s follow-up screen points back to DNS and SSL/TLS checks. The nameserver values are hidden in this example.', 'Cloudflare activation next steps with nameservers redacted']
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
          ['linux', 'Linux / Raspberry Pi', 'Cloudflare may run through systemd or a SysV service.', '▤']
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
          : 'systemctl status cloudflared --no-pager || service cloudflared status';
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
          'In Cloudflare, open <b>Networking → Tunnels</b> (the location may vary by dashboard layout), then choose <b>Create a tunnel</b>.',
          'Choose <b>Cloudflared</b> and give the tunnel a unique, recognizable name, then continue to connector setup.',
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
          a.os === 'windows' ? 'On Cloudflare’s connector setup screen choose <b>Windows</b> and <b>64-bit</b>, then download and run the <b>cloudflared MSI</b> installer.' : 'Use ' + link(sources.named, 'Cloudflare’s named tunnel setup') + ' for the Core computer’s operating system.',
          a.os === 'windows' ? 'On the Windows computer, open <b>Start</b>, search for <b>PowerShell</b>, right-click it, and choose <b>Run as administrator</b>.' : 'Follow Cloudflare’s installation instructions for your operating system.',
          a.os === 'windows' ? 'Copy the <b>service installation command provided by Cloudflare for this tunnel</b> and paste it into the elevated PowerShell window. The command includes a secret connector token: never publish or share it.' : 'Keep any connector credentials private.',
          a.os === 'windows' ? 'Return to Cloudflare and wait until it detects the connector as connected, then choose <b>Continue</b>.' : 'Wait for Cloudflare to confirm that the connector is connected.',
          'If installing as an OS service, let that service remain authoritative.',
          'Do not also ask Certifyd to launch a duplicate connector for the same tunnel.'
        ]) + (a.os === 'windows' ? screens([
          ['cloudflare-windows-connector.png', 'Choose Windows and 64-bit for a typical Windows PC. Cloudflare supplies the exact installer and service command for your tunnel.', 'Cloudflare connector setup with Windows and 64-bit selected']
        ]) : '') + screens([
          ['cloudflare-connector-healthy.png', 'A healthy connector means cloudflared is connected. Routes still need to be configured and checked.', 'Cloudflare tunnel overview showing a healthy connector and zero routes']
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
          'In Cloudflare, return to <b>Networking → Tunnels</b> and open the exact Certifyd tunnel.',
          'Open its <b>Routes</b> tab and choose <b>Add route → Published application</b>.',
          'Set the public hostname to <b>' + esc(hostname()) + '</b> using the chosen subdomain and domain.',
          'Set service type to <b>HTTP</b> and the service URL to <b>http://127.0.0.1:' + PUBLIC_PORT + '</b>. This is Core’s public-safe listener.',
          'Save the published application route, then confirm the connector for this exact tunnel remains connected.',
          'Do <b>not</b> add a public route to the private dashboard on port <b>4000</b> as part of normal onboarding. Remote dashboard access is optional and requires separate access protection.'
        ]) + screens([
          ['cloudflare-routes-empty.png', 'Open the Routes tab on the exact tunnel and choose Add route.', 'Cloudflare tunnel Routes tab with no routes configured'],
          ['cloudflare-add-route.png', 'Select Published application for the public Certifyd hostname.', 'Cloudflare Add a route dialog with Published application choice'],
          ['cloudflare-public-route.png', 'The resulting route targets port 4010. This example uses a generic hostname and only shows the public-safe route.', 'Cloudflare route to http://127.0.0.1:4010'],
          ['cloudflare-published-route.png', 'Another Cloudflare layout shows the same published route to port 4010.', 'Cloudflare published application route to port 4010']
        ]) +
        command('http://127.0.0.1:' + PUBLIC_PORT, 'REQUIRED SERVICE TARGET') +
        check('routed', 'The exact tunnel routes ' + esc(hostname()) + ' to port ' + PUBLIC_PORT + '.'),
        'Route identity and reachability are both required.',
        'A healthy connector does not prove the hostname reaches this Core. Use Core’s Named Tunnel verification to confirm the current Core instance answers through the public route.'
      );

    case 'coreConfirm':
      need('coreConfigured');
      return view(
        'Enable sharing on your domain.',
        'Core finds supported connections, but sharing still needs your permission.',
        ordered([
          'Open <b>Configuration → Public Connection</b> and select <b>Permanent</b>.',
          'Check that Core shows your intended address, <b>' + esc(hostname()) + '</b>. If Core cannot verify the connection, open <b>Advanced / Diagnostics</b> rather than guessing.',
          'Choose <b>Enable sharing</b>. Wait until Core shows <b>Connection: Permanent</b> and <b>Sharing: Online</b>.',
          'If you were using a temporary link and switching fails, follow Core’s message and check that your original connection is still available.'
        ]) +
        note('An externally managed Cloudflare service may keep running independently. Core controls its own public sharing and does not stop that service.') +
        check('coreConfigured', 'Core shows my permanent address and Sharing: Online.'),
        'Connection and sharing are different.',
        'A connected Cloudflare service does not by itself prove your creator page is reachable. Only trust Core’s verified online status.'
      );

    case 'verify': {
      const goal = goalForAnswers(a);
      return view(
        'Check your public page.',
        'Copy the public address from Core. This guide cannot check Core’s live status for you.',
        field(
          'publicURL',
          'Public address shown in Core',
          goal === 'quick' ? 'https://words-words.trycloudflare.com' : origin(),
          'Use the address shown in Configuration → Public Connection.'
        ) +
        ordered([
          'In Core, confirm <b>Sharing: Online</b> and choose <b>Open public profile</b>.',
          'Open the copied address on a phone or in a private browser window. Your creator page should load.',
          'If it does not load, check <b>Advanced / Diagnostics</b> in Core. A connected tunnel alone is not enough.'
        ]) +
        details('Advanced connection checks', '<p>The public creator route should target <code>127.0.0.1:4010</code>. Keep the private dashboard on <code>127.0.0.1:4000</code> off the public route. Check your exact tunnel identity and route before changing services.</p>'),
        'The visitor view is the test.',
        'This guide saves your answers only. Core and a real visit to your public page show whether sharing works.',
        'Finish setup'
      );
    }

    case 'done': {
      const goal = goalForAnswers(a);
      return view(
        'Your page is ready to share.',
        'Use the address Core reports while Sharing is Online.',
        '<div class="success-mark">✓</div><div class="summary-card"><span>Public address</span><strong>' + esc(a.publicURL) +
        '</strong><span>Connection type</span><strong>' + (goal === 'quick' ? 'Temporary' : 'Permanent') + '</strong></div>' +
        note('This guide cannot confirm live status. Check Core before sharing. Stop sharing in Core when you want the public page offline; it will not stop an externally managed Cloudflare service.'),
        'Come back whenever you need to.',
        goal === 'quick' ? 'A temporary address may change later. Core can remember an authorized sharing choice, so check its status on the next launch.' : 'Your domain stays the same, but a connected tunnel and a reachable creator page are separate checks.',
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
    esc(RELEASE_SHA) + '</code> · Core verifies public reachability; this guide records your answers only. ' +
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
