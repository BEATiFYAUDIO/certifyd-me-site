---
title: "How to Install Certifyd Core and Set Up Your Local Creator Dashboard"
slug: "install-certifyd-core-local-creator-infrastructure"
author: "Certifyd"
date: "2026-11-05"
updated: "2026-11-05"
excerpt: "Certifyd Core is built to run on the computer that holds your work. This guide walks through the published beta installation path for Windows, macOS and Linux/Pi, explains first-owner setup, and clarifies what a local dashboard does—and does not—set up."
coverImage: "/images/blog/2026/11/install-certifyd-core-local-creator-infrastructure-r1-logo.svg"
coverImageAlt: ""
coverImageCredit: ""
coverImageCreditUrl: ""
coverImageProvider: "openai"
tags: ["Certifyd Core", "creator infrastructure", "music technology", "creator ownership", "local software", "Windows", "macOS", "Linux"]
status: "published"
seoTitle: "How to Install Certifyd Core: Local Creator Infrastructure Guide"
seoDescription: "Install Certifyd Core on Windows, macOS or Linux/Pi, create a local owner account, and understand the difference between Core’s private dashboard and public creator"
---

Creators are used to being handed a login page and told that control begins there. Certifyd Core starts with a more practical question: where does the software that manages your work actually run?

Core is designed to run on the computer that holds a creator’s work. Its published installation walkthrough, labelled **v0.1.0-beta.20**, covers Windows, macOS and Linux/Pi. The immediate goal is modest but important: install Core, open its local dashboard in a browser, and create or sign into the owner account for that installation.

That is not the same thing as publishing work, opening a public creator page, connecting payments or making material available to listeners. Those are separate stages. The distinction matters because Core separates the private place where an owner manages work from the public-facing service used to share it.

## Before you start

Go to the [Certifyd downloads page](https://certifyd.me/downloads/) and choose the package for the computer that will hold your work.

The published walkthrough describes a specific beta release, while the downloads page may list newer Core artifacts. Read and follow the instructions included with the package you download when they differ from the older walkthrough, particularly on Linux where package formats can change.

## Install Certifyd Core on Windows

The documented Windows path is straightforward:

1. Download the **Windows x64 installer** from the Certifyd downloads page.
2. Run the installer.
3. Launch Certifyd Core from the **Start Menu** or desktop.

When Core starts successfully, its dashboard should open in your browser.

## Install Certifyd Core on macOS

For macOS, choose the package that matches your processor:

1. Download the **Apple Silicon** or **Intel** DMG.
2. Open the DMG.
3. Drag **Certifyd Core.app** into **Applications**.
4. Open Certifyd Core from Applications.

As with Windows, a successful launch leads to the Core dashboard in a browser.

## Install Certifyd Core on Linux or Pi

The published Linux instructions describe unpacked packages for **x64** and **ARM64** systems.

After extracting the package, open a terminal in the extracted folder. To add a desktop launcher, run this once:

```bash
./install-desktop.sh
```

You can then open Core from the apps menu. The documented direct-start alternative is:

```bash
./start.sh
```

The tray icon depends on support from the desktop environment, so its appearance is not the essential test. The useful test is whether the Core dashboard becomes available in a browser.

## Open the local dashboard

Core’s owner dashboard is local by default. If it does not open automatically after launch, open a browser **on the computer running Core** and go to:

```text
http://127.0.0.1:4000
```

`127.0.0.1` refers to that same computer. This is Core’s private dashboard surface, not a public web address that listeners can visit from elsewhere.

That boundary is central to the product’s model. Core’s local runtime keeps work and state in SQLite-backed storage, while its private dashboard and API routes are separated from an allowlisted public creator server. The default configuration uses port **4000** for the private dashboard and **4010** for the separate public creator surface.

In plain English: installing Core gives you a local place to manage your work. It does not automatically expose that work to the internet.

## Create the first owner account

When the sign-in screen appears on a new installation:

1. Choose **New here?**
2. Complete **Create owner**.
3. Keep any recovery key shown during setup somewhere safe.

If this is an existing installation, use **Sign in** instead.

The success check is simple: you reach the signed-in dashboard. The published guide describes the local account and published work as remaining with that installation through upgrades.

## What installation establishes—and what it does not

It is tempting to treat installation as a launch button. It is better understood as the moment you establish the local home for the system that manages your work.

Core has structures for work, media, profiles and splits. Its publication helpers can calculate canonical manifest hashes and receipt bindings, while its access and purchase helpers provide playback, entitlement and accounting state. Those details point toward a serious creator-owned stack, but they do not collapse into one automatic setup action.

Public sharing has its own lifecycle and consent requirement. Core coordinates startup for the listener-facing service and checks participation and payment readiness separately. Fan can discover work from configured Core origins using the public contracts Core provides, but this does not mean that installing Core automatically replicates your work across a peer-to-peer network.

That separation is a feature, not friction for its own sake. A private management dashboard should not become public merely because an installer finished. The creator should be able to distinguish between setting up the machine, managing the catalog, deciding what to share, and preparing any payment-related activity.

## A practical first-session checklist

After installation, confirm the basics:

- Core launches on the computer where you intend to keep your work.
- The dashboard opens, either automatically or at `http://127.0.0.1:4000`.
- You can create the first owner account or sign into the existing one.
- You have stored any recovery key provided during owner creation.
- You understand that the local dashboard on port 4000 is separate from the public creator surface on port 4010.

That is the right finish line for installation. From there, the creator has a local dashboard and an owner account—not an accidental public launch.

## Why this model matters

“Own your infrastructure” can become empty language quickly. Here, it begins with a concrete technical boundary: the place where you manage your work is private and local, while public access is a separate, deliberate service.

For creators, partners and investors, that is the meaningful part of the installation story. Core is not asking creators to confuse an account on someone else’s platform with control over the system holding their work. It puts the local runtime and owner setup first, then keeps publication, listener access and payment readiness as distinct choices.

Start by installing the package that matches your computer from the [Certifyd downloads page](https://certifyd.me/downloads/), then use the package’s included instructions alongside this published beta walkthrough.
