---
title: "How Certifyd Core Uses Cloudflare Tunnel to Publish From Your Own Computer"
slug: "certifyd-core-cloudflare-tunnel-publish-from-your-computer"
author: "Certifyd"
date: "2026-11-06"
updated: "2026-11-06"
excerpt: "Connect Certifyd Core Beta 27 to a permanent public address, enable sharing, and test your creator page without exposing the dashboard."
coverImage: "/images/blog/2026/11/certifyd-core-cloudflare-tunnel-publish-from-your-computer-r1-logo.svg"
coverImageAlt: ""
coverImageCredit: ""
coverImageCreditUrl: ""
coverImageProvider: "openai"
tags: ["Certifyd Core", "Cloudflare Tunnel", "cloudflared", "creator infrastructure", "music technology", "publishing"]
status: "archived"
seoTitle: "How to Connect Certifyd Core to Cloudflare Tunnel"
seoDescription: "Set up a permanent Cloudflare Tunnel for Certifyd Core Beta 27, enable sharing, and test your creator page while keeping the dashboard private."
---

Certifyd Core Beta 27 can serve your published work from your own computer through Cloudflare Tunnel. This tutorial connects a permanent address such as `https://music.example.com`, then checks that visitors can reach your creator page while your dashboard stays private.

## Before you begin

Install [Core Beta 27](https://certifyd.me/downloads/) for your computer, launch it and sign in as the owner. The local dashboard normally opens at `http://127.0.0.1:4000`. On a new installation, complete **Create owner (first-run setup)** and keep the recovery key Core shows you safely.

For a permanent address, you also need a Cloudflare account, a domain you control that is active in Cloudflare, and permission to install a service on the Core computer. Leave Core and that computer running while people use your public pages.

**Only testing?** In **Configuration → Public Connection**, choose **Temporary**, then **Enable sharing**. Core can find or download `cloudflared` and create a temporary `trycloudflare.com` address without your own domain or Cloudflare account. The address can change; use the permanent setup below for a link you intend to keep. A working tunnel does not configure payments or publish your whole library.

## Step 1: Create your named tunnel in Cloudflare

In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Networking → Tunnels → Create Tunnel**. If your account shows the older Zero Trust navigation, look under **Networks → Tunnels**.

For this example, name the tunnel **music** and plan to use **music.example.com**, replacing `example.com` with your domain. Record the tunnel's actual name and UUID. Its name identifies the connection; its hostname is the address visitors open.

An independently managed connector can already be running; saving Core's settings is not a prerequisite for starting it. This guide checks Core's form next because Beta 27 makes it read-only when it detects a running external connector.

## Step 2: Tell Core which address to use

In Core, open **Configuration → Public Connection** and check **Advanced / Diagnostics**. Enter:

| Field | Example value |
|---|---|
| Provider | `cloudflare` |
| Public domain (base) | `example.com` |
| Tunnel name | `music` |

Click **Save tunnel config**. This example gives Core the public address `https://music.example.com`. Saving settings does not turn sharing on.

If your tunnel has a different name from your chosen subdomain, keep its real name and enter the full address, such as `https://music.example.com`, in **Public domain (base)**. Check that Core's saved address matches Cloudflare's intended hostname exactly.

**Existing service:** If Beta 27 detects a running external connector or an active service-managed connection, these fields are read-only. If the saved Core address is correct, keep the service and continue; it does not need reinstalling because it started first. If required settings are missing or wrong, get help aligning Core's configuration without disturbing that service or other websites. This is a dashboard limitation, not a Cloudflare startup dependency.

## Step 3: Start the connector on the Core computer

If the intended connector is already running, reuse it and continue to Step 4. Otherwise, return to the tunnel in Cloudflare. Select the Core computer's operating system and architecture under **Setup Environment**, then follow **Install and Run** using Cloudflare's current instructions. For this tutorial, use its system-service installation option on the same computer that runs Core. Windows may require an administrator terminal; Linux and macOS may request administrator permission.

Cloudflare supplies the command for that specific tunnel. **Keep its connector token private.** Once the connector appears **Healthy**, continue to the hostname configuration.

This tutorial uses an operating-system-managed service. Core also includes a token-based **Save & start tunnel** option and executable preparation for connectors it manages; do not set up both process owners for the same connection. Core does not create the Cloudflare account, named tunnel or hostname route automatically. **Generate token** retrieves a token for an existing authorized tunnel; it is not a create-tunnel button.

## Step 4: Route your hostname to the public service

In that same tunnel, open **Routes → Add route → Published application**, or the equivalent published-hostname screen in your Cloudflare account. Set:

| Setting | Value |
|---|---|
| Subdomain | `music` |
| Domain | Your active domain, such as `example.com` |
| Service type | **HTTP** |
| Service URL | `http://127.0.0.1:4010` |

Save the route. The local service may be unavailable until you enable sharing in the next step.

**Use port 4010, not port 4000.** In Beta 27's default setup, 4010 is the public listener with a restricted set of visitor routes; 4000 is your private dashboard and operator API. You do not need to forward either port through your router. If you deliberately configured a different public port, use that listener's actual port.

`127.0.0.1` means the connector's own computer. A connector in a container or on another machine needs a different reachable target; do not reuse this address unchanged.

## Step 5: Enable sharing and verify the address

Once Core has the intended named configuration, return to **Configuration → Public Connection**, select **Permanent**, then click **Enable sharing**. Core first checks whether the existing route reaches this Core; a verified external connector does not need another connector started by Core. Selecting the tab alone does not start anything.

With **Advanced / Diagnostics** open, use **Refresh routing** if needed. Confirm:

- **Public address** matches your chosen hostname.
- **Connection: Permanent**.
- **Sharing: Online**.

**Connecting** means startup is still in progress. **Unverified** means Core has not established that the public route reaches this Core instance; a Healthy connector in Cloudflare is not enough. Viewing or refreshing settings does not replace your sharing consent.

## Step 6: Publish a work and test as a visitor

In **Works**, choose the intended work and use **Publish** when it is ready and that action is available. Turning on a tunnel does not automatically publish every local file or enable paid commerce.

Use **Open public profile** or **Copy public link** in Core's header. Open the copied link, and the intended work's public link, on another device or in a private browser window. A phone using mobile data is a useful check from outside your home network. You should reach the visitor page without needing your Core owner login.

## If the page is unavailable

Check these in order:

1. Core is running, and public sharing has not been stopped.
2. The intended connector is Healthy in Cloudflare.
3. The hostname matches Core's saved address and the route targets the correct computer and public port.
4. **Advanced / Diagnostics → Connection details** reports the connector and public listener status. **Advanced tunnel details** shows ownership and whether the durable route was verified to this Core.
5. After correcting a problem, use **Refresh routing** and retry **Enable sharing** when available. Keep the exact error if you need help.

**Stop sharing** turns off Core's public surface and stops a connector Core owns. It leaves an external operating-system service under that system's control. Do not delete unrelated tunnels, replace a shared service or terminate every `cloudflared` process to troubleshoot one connection.

This guide follows the [Beta 27 release](https://github.com/BEATiFYAUDIO/contentbox/releases/tag/v0.1.0-beta.27) and its shipped controls. Cloudflare's screen labels can change; its [current tunnel setup instructions](https://developers.cloudflare.com/tunnel/get-started/) remain the reference for provider-side installation.
