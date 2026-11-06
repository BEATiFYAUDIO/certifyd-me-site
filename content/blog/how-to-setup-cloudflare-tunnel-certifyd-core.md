---
title: "How to Set Up Cloudflare Tunnel for Certifyd Core"
slug: "how-to-setup-cloudflare-tunnel-certifyd-core"
author: "Certifyd"
date: "2026-11-06"
updated: "2026-11-06"
excerpt: "A step-by-step guide to connecting Certifyd Core Beta 27 to the internet using Cloudflare Tunnel, from domain nameservers and DNS to public sharing."
coverImage: "/images/blog/2026/11/certifyd-core-cloudflare-tunnel-own-computer-r1-logo.svg"
coverImageAlt: ""
coverImageCredit: ""
coverImageCreditUrl: ""
coverImageProvider: "openai"
tags: ["Certifyd Core", "Cloudflare Tunnel", "creator infrastructure", "music technology", "creator tools", "self-hosting"]
status: "published"
seoTitle: "How to Set Up Cloudflare Tunnel for Certifyd Core"
seoDescription: "Set up Cloudflare Tunnel for Certifyd Core. Learn how to change nameservers, configure DNS, install cloudflared and publish content from your computer."
---

Certifyd Core lets you publish and share your creative work directly from your own computer. But to make that content available to fans over the internet, you'll need a public connection.

One way to accomplish this is with **Cloudflare Tunnel**, which connects your computer to a public web address without requiring you to open ports on your home router.

For permanent sharing, we recommend using a named Cloudflare Tunnel with `cloudflared` running independently as an operating-system service. This keeps your internet connection separate from Certifyd Core while allowing Core to manage what you publish.

Here's how to set everything up, starting with your domain.

## Before you begin

You'll need:

- Certifyd Core Beta 27 installed and running.
- A free Cloudflare account.
- A domain name you own, such as `yourdomain.com`.
- Access to the company where your domain is registered.
- Administrator access to the computer running Core.

If you don't own a domain yet, you can register one through a domain registrar. You don't need to transfer ownership of your domain to Cloudflare to use its DNS and tunnel services.

If you only want to test public sharing, Certifyd Core also supports temporary Cloudflare connections using a `trycloudflare.com` address. The steps below are for a permanent connection using your own domain.

## Step 1: Add your domain to Cloudflare

Start by visiting [Cloudflare](https://dash.cloudflare.com/) and signing in or creating an account.

Choose the option to add a domain, sometimes labelled **Add a domain** or **Add a website**, and enter your existing domain name.

For example:

`yourdomain.com`

Cloudflare will scan for existing DNS records and offer a plan. Its Free plan is generally sufficient for a basic tunnel setup.

Before continuing, review the imported DNS records carefully.

If you already have a website, email hosting or other services attached to your domain, make sure their records are present. Pay particular attention to existing A, AAAA, CNAME, MX, TXT, SPF, DKIM and DMARC records, as applicable.

**Do not delete existing DNS records simply because you are setting up Certifyd Core.** Your existing website and email should continue working.

## Step 2: Change your domain's nameservers

This is the step many people find confusing, but it usually only takes a few minutes to configure.

Your domain registrar is the company where you registered your domain. Your nameservers tell the internet which DNS provider is responsible for answering requests about that domain.

Cloudflare will provide two authoritative nameservers for your domain, similar to:

`example-one.ns.cloudflare.com`

`example-two.ns.cloudflare.com`

These are examples only. **Use the exact nameservers Cloudflare assigns to your domain.**

Now:

1. Sign in to your domain registrar, such as GoDaddy, Namecheap or another provider.
2. Find your domain's **Nameservers**, **DNS**, or **Custom Nameservers** settings.
3. If DNSSEC is enabled, follow Cloudflare's instructions to disable the existing registrar-side DNSSEC configuration before switching nameservers.
4. Replace the existing authoritative nameservers with the two assigned by Cloudflare.
5. Save your changes.

You are not transferring ownership of the domain. You're changing which provider manages its authoritative DNS.

Return to Cloudflare and wait for it to confirm that your domain is active. Nameserver updates can take time to propagate, sometimes up to 24 hours.

Once Cloudflare confirms activation, you can manage your domain's DNS records through its dashboard. You can also configure DNSSEC again using Cloudflare's instructions.

**Important:** Changing nameservers affects the entire domain, not just Certifyd. Confirm that your existing website, email and other DNS records are correct before and after the switch.

Cloudflare provides a detailed [nameserver setup guide](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/) if your registrar's interface looks different.

## Step 3: Create a named Cloudflare Tunnel

With your domain active in Cloudflare, open the Cloudflare dashboard and navigate to:

**Networking → Tunnels**

Select **Create a tunnel**.

Give your tunnel a recognizable name, such as:

`certifyd-core`

Cloudflare will create the tunnel and provide installation instructions for connecting your computer.

A named tunnel is designed for persistent use. Unlike a temporary Quick Tunnel, it can serve content through a stable address on your own domain.

You can also reuse an existing named tunnel if you already operate Cloudflare services, provided you configure the correct route and avoid disrupting existing applications.

## Step 4: Install cloudflared on your computer

Cloudflare uses a small application called `cloudflared` to connect your computer to its network.

After creating your tunnel, choose the operating system of the computer running Certifyd Core.

Cloudflare will provide an installation command specific to your tunnel. Follow those instructions to install `cloudflared` as an operating-system service.

We recommend this approach because the service can start automatically when your computer boots and continue operating independently of Certifyd Core.

Keep the installation token private. Anyone with a valid tunnel token may be able to run a connector for that tunnel.

If you already have `cloudflared` installed, inspect the existing service before making changes. There's no reason to replace a working connector simply to add Certifyd Core.

Cloudflare's [official tunnel setup guide](https://developers.cloudflare.com/tunnel/get-started/) provides the installation commands for supported operating systems.

## Step 5: Connect your domain to Certifyd Core

Now tell Cloudflare where to send visitors.

Open your named tunnel in Cloudflare and select:

**Routes → Add route → Published application**

Choose the public hostname you want visitors to use.

For example:

`music.yourdomain.com`

Set the service type to **HTTP**.

For Certifyd Core Beta 27, when Core and `cloudflared` are running on the same computer, use:

`http://127.0.0.1:4010`

Save the route.

This address is important because Certifyd Core separates its public-facing service from its private administrative dashboard.

| Service | Local address |
|---|---|
| Public content service | `http://127.0.0.1:4010` |
| Private dashboard and API | `http://127.0.0.1:4000` |

**Never point your public Cloudflare hostname at port 4000.** That port is intended for Core's private administrative functions.

Cloudflare will handle the DNS routing for the published application hostname. You generally don't need to create an additional manual DNS record for that same tunnel route.

If Core and `cloudflared` run on different computers, the service address must instead identify the Core public listener at an address reachable from the connector.

## Step 6: Configure permanent sharing in Certifyd Core

Return to Certifyd Core and open:

**Configuration → Public Connection**

Select **Permanent** and configure the hostname and named-tunnel information to match your Cloudflare setup.

Core Beta 27 can detect an externally managed connector. In that situation, some local configuration fields may become read-only. For a fresh installation, configuring these fields before starting the external connector can avoid that interface limitation.

This is not a requirement imposed by Cloudflare, and an independently managed connector can already be running.

Certifyd Core also includes controls for managing a connector itself, but for permanent installations, we recommend leaving `cloudflared` under operating-system management.

Once the connection is configured, select **Enable sharing**.

Check that Core reports:

- **Connection: Permanent**
- **Sharing: Online**

Remember that enabling public sharing does not automatically publish every file in your library. You still control which works are made available.

## Step 7: Test your public link

Now test your setup as a visitor.

Open your Certifyd public profile or published content link from another device, preferably a phone using mobile data.

If everything is configured correctly, your published content should be accessible through your chosen domain.

If the link doesn't work, check the following:

1. **Core is running.** The computer hosting your content must be online.
2. **Cloudflare is connected.** Your named tunnel should report a healthy connector.
3. **Your hostname is correct.** Confirm the published application route matches the address you're opening.
4. **The public port is correct.** The documented same-computer service target is `http://127.0.0.1:4010`.
5. **Sharing is enabled.** Verify the permanent connection and sharing status in Core.
6. **The intended work is published.** A working tunnel doesn't automatically make unpublished content public.

If necessary, use Core's advanced diagnostics to inspect its public connection.

Avoid deleting existing tunnels, terminating unrelated `cloudflared` processes or reinstalling services without first checking their configuration.

## What happens when someone opens your link?

Once the setup is complete, a visitor opens your public hostname. Cloudflare receives the request and forwards it through the tunnel to the public service running on your Certifyd Core computer.

Core then serves the content you've made available through its public interface.

Your creative files and application state remain with your Core installation. Cloudflare provides the public connection, rather than becoming the application that manages your creative catalogue.

There are still dependencies: your computer needs to remain online, your connector must be connected, and Cloudflare remains part of the delivery path.

But you don't need to upload your entire creative library to a conventional hosted publishing platform simply to give fans a public address.

## Your computer. Your domain. Your content.

The difficult part of self-hosted publishing has traditionally been making a local computer reliably accessible over the internet.

Cloudflare Tunnel simplifies that process, while Certifyd Core provides the tools to manage and publish your creative work.

By connecting a domain you control to a Core installation you operate, you can establish a permanent public presence without giving up control of the underlying publishing environment.

For more information about installing and configuring Core, visit the [Certifyd Core setup guide](https://certifyd.me/core/guide/).

*This guide covers Certifyd Core Beta 27. Interface labels and connection settings may change in subsequent beta releases.*
