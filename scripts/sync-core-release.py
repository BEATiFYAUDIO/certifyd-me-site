#!/usr/bin/env python3
"""Sync Core download cards and release-owned guide regions from a reviewed manifest."""

import argparse
import hashlib
import html
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "core/release/current.json"
DOWNLOADS = ROOT / "downloads/index.html"
GUIDE = ROOT / "core/guide/index.html"
IDS = {"windows-x64", "linux-x64", "linux-arm64", "linux-x64-portable",
       "linux-arm64-portable", "macos-arm64", "macos-x64"}
API = "https://api.github.com/repos/BEATiFYAUDIO/contentbox/releases"
PAGES_BEACON = re.compile(
    r'<script type="module" src="https://static\.cloudflareinsights\.com/beacon\.min\.js/[^\"]+"[^>]*></script>\n(?=</body>\n</html>\n?\Z)'
)


def fetch_json(url):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "certifyd-core-doc-check"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def fetch_text(url):
    request = urllib.request.Request(url, headers={"User-Agent": "certifyd-core-doc-check", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def latest_core_release():
    releases = fetch_json(f"{API}?per_page=30")
    candidates = [release for release in releases if not release["draft"] and
                  any(asset["name"].startswith("Certifyd-Core-") for asset in release["assets"])]
    if not candidates:
        raise ValueError("No published Core release found")
    return max(candidates, key=lambda release: release["published_at"])


def validate(data):
    tag = data["releaseTag"]
    if not re.fullmatch(r"v\d+\.\d+\.\d+-beta\.\d+", tag):
        raise ValueError("Unexpected Core release tag")
    version = tag[1:]
    if not re.fullmatch(r"[0-9a-f]{40}", data["sourceCommit"]) or data["releaseUrl"] != f"https://github.com/BEATiFYAUDIO/contentbox/releases/tag/{tag}":
        raise ValueError("Release source commit or URL is invalid")
    assets = data["assets"]
    if {item["id"] for item in assets} != IDS or len(assets) != len(IDS):
        raise ValueError("Manifest must contain exactly the seven supported Core packages")
    if data["guide"].get("reviewedReleaseTag") != tag or not data["guide"].get("reviewedBy"):
        raise ValueError("Guide instructions need explicit review for this exact release")
    if not data["guide"].get("reviewedAt") or not data["guide"].get("validationEvidence"):
        raise ValueError("Guide review needs a date and validation evidence")
    shots = data["guide"].get("screenshots", [])
    if data["guide"].get("screenshotStatus") != ("reviewed" if shots else "none"):
        raise ValueError("Screenshot status disagrees with screenshot evidence")
    for shot in shots:
        path = (ROOT / shot["path"]).resolve(strict=True)
        if not path.is_relative_to(ROOT / "core/guide/images") or shot["releaseTag"] != tag:
            raise ValueError("Screenshot path or release provenance is invalid")
        if not shot.get("reviewedBy") or not shot.get("caption") or not shot.get("sha256"):
            raise ValueError("Screenshot needs caption, hash, and reviewer")
        if hashlib.sha256(path.read_bytes()).hexdigest() != shot["sha256"]:
            raise ValueError(f"Screenshot changed after review: {path}")
    required = ["windows", "macos", "linuxDeb", "linuxPortable", "owner", "dashboard"]
    if not all(data["guide"]["instructions"].get(key) for key in required):
        raise ValueError("Guide is missing an installation or setup instruction")
    expected = {
        "windows-x64": ("windows", "win-x64.exe"),
        "linux-x64": ("linux", "linux-x64.deb"),
        "linux-arm64": ("linux", "linux-arm64.deb"),
        "linux-x64-portable": ("linux", "linux-x64.tar.gz"),
        "linux-arm64-portable": ("linux", "linux-arm64.tar.gz"),
        "macos-arm64": ("mac", "macos-arm64.dmg"),
        "macos-x64": ("mac", "macos-x64.dmg"),
    }
    for item in assets:
        family, suffix = expected[item["id"]]
        if item["family"] != family or not item["filename"].endswith(f"{version}-{suffix}"):
            raise ValueError(f"Wrong platform/architecture/filename: {item['id']}")
        if item["version"] != version or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise ValueError(f"Wrong version or SHA-256: {item['id']}")
        expected_url = f"https://github.com/BEATiFYAUDIO/contentbox/releases/download/{tag}/{item['filename']}"
        if item["url"] != expected_url or not re.fullmatch(r"[\d,]+ bytes", item["size"]):
            raise ValueError(f"Wrong release URL or size: {item['id']}")
    instructions = data["guide"]["instructions"]
    if "./start.sh" not in instructions["linuxPortable"] or ".deb" not in instructions["linuxDeb"]:
        raise ValueError("Linux package instructions must distinguish .deb from portable archives")
    if "127.0.0.1:4000" not in instructions["dashboard"] or "Create owner" not in instructions["owner"]:
        raise ValueError("Local dashboard or first-owner instruction is missing")


def generated_downloads(current, data):
    version = data["releaseTag"][1:]
    replacement = "    // Generated from /core/release/current.json; edit that file and run sync-core-release.py.\n"
    replacement += "    const CORE_DOWNLOADS = " + json.dumps(data["assets"], indent=2, ensure_ascii=False).replace("\n", "\n    ") + ";"
    pattern = r"(?:    // Generated from /core/release/current\.json; edit that file and run sync-core-release\.py\.\n)?    const CORE_DOWNLOADS = \[[\s\S]*?\n    \];"
    result, count = re.subn(pattern, lambda _: replacement, current, count=1)
    if count != 1:
        raise ValueError("Cannot locate download cards")
    meta = f'<meta name="certifyd-core-release" content="{html.escape(version)}" />'
    if 'name="certifyd-core-release"' in result:
        result = re.sub(r'<meta name="certifyd-core-release" content="[^"]*" />', meta, result, count=1)
    else:
        result = result.replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n  ' + meta, 1)
    return result


def generated_guide(data, current=None):
    """Update release-owned regions without replacing the authored walkthrough."""
    current = GUIDE.read_text() if current is None else current
    version = data["releaseTag"][1:]
    e = html.escape
    instruction = data["guide"]["instructions"]
    packages = []
    for title, ids in [
        ("Windows x64", ["windows-x64"]),
        ("macOS", ["macos-arm64", "macos-x64"]),
        ("Linux Debian packages", ["linux-x64", "linux-arm64"]),
        ("Linux portable archives", ["linux-x64-portable", "linux-arm64-portable"]),
    ]:
        assets = [item for item in data["assets"] if item["id"] in ids]
        packages.append(f'<h3>{e(title)}</h3><ul>' + "".join(
            f'<li><a href="{e(item["url"])}">{e(item["filename"])}</a>'
            f'<code class="package-hash">SHA-256: {e(item["sha256"])}</code></li>'
            for item in assets) + '</ul>')
    installation = (
        '<p><b>What to click:</b> Choose your computer below, then download the matching package. Open the installed Certifyd Core app.</p>\n'
        '<div class="choice" role="group" aria-label="Choose your operating system">'
        '<button type="button" data-os="windows" aria-pressed="false">Windows</button>'
        '<button type="button" data-os="mac" aria-pressed="false">macOS</button>'
        '<button type="button" data-os="linux" aria-pressed="false">Linux</button></div>\n'
        '<div id="install-detail" class="choice-detail">Choose your computer to see its launch steps.</div>\n'
        f'<div class="actions"><a class="action" href="/downloads/">Get Certifyd Core {e(version)}</a></div>\n'
        '<details class="release-packages"><summary>Package links, checksums and release notes</summary>'
        '<p>Windows installers are unsigned. macOS DMGs are signed and notarized. '
        'Linux Debian packages and portable archives use different installation steps. '
        'Physical Raspberry Pi installation has not been validated here.</p>'
        + ''.join(packages) + f'<p><a href="{e(data["releaseUrl"])}">Release notes</a> · '
        f'<a href="https://github.com/BEATiFYAUDIO/contentbox/releases/download/{e(data["releaseTag"])}/SHA256SUMS.txt">SHA256SUMS.txt</a></p></details>'
    )
    os_copy = {
        "windows": e(instruction["windows"]) + '<p>Windows may show a warning for this unsigned installer. Check the package filename and SHA-256 before proceeding.</p>',
        "mac": e(instruction["macos"]) + '<p>The DMGs are signed and notarized. Stop if Gatekeeper reports a different result.</p>',
        "linux": '<p>' + e(instruction["linuxDeb"]) + '</p><p>' + e(instruction["linuxPortable"]) + '</p>',
    }
    shots = data["guide"].get("screenshots", [])
    gallery = '' if not shots else '<details class="release-packages"><summary>Reviewed current-release screenshots</summary>' + ''.join(
        f'<figure class="screen" data-screenshot-release="{e(data["releaseTag"])}">'
        f'<a class="screen-shot" href="/{e(shot["path"])}"><img src="/{e(shot["path"])}" alt="{e(shot["caption"])}" loading="lazy"></a>'
        f'<figcaption>{e(data["releaseTag"])}: {e(shot["caption"])}</figcaption></figure>'
        for shot in shots) + '</details>'
    regions = {
        "meta": f'<meta name="certifyd-core-release" content="{e(version)}" />',
        "label": f'Certifyd Core · {e(version)}',
        "installation": installation,
        "owner": '<p><b>What to click:</b> ' + e(instruction["owner"]) + ' If this computer already has your Core account, sign in instead.</p>',
        "dashboard": '<details><summary>Dashboard does not open automatically?</summary><p>' + e(instruction["dashboard"]) + ' The dashboard is private to the Core computer by default. Installing Core does not enable public sharing.</p></details>',
        "screenshots": gallery,
        "os": "    choose('[data-os]','os',document.querySelector('#install-detail')," + json.dumps(os_copy, ensure_ascii=False) + ");",
    }
    for name, body in regions.items():
        start, end = ('/*', '*/') if name == 'os' else ('<!--', '-->')
        begin = f'{start} CORE_RELEASE:{name}:BEGIN {end}'
        finish = f'{start} CORE_RELEASE:{name}:END {end}'
        if current.count(begin) != 1 or current.count(finish) != 1:
            raise ValueError(f'Guide release region missing or duplicated: {name}')
        pattern = re.escape(begin) + r'[\s\S]*?' + re.escape(finish)
        current, count = re.subn(pattern, lambda _: begin + '\n' + body + '\n' + finish, current)
        if count != 1:
            raise ValueError(f'Guide release region is malformed: {name}')
    return current


def verify_remote(data):
    release = latest_core_release()
    if release["tag_name"] != data["releaseTag"]:
        raise ValueError(f"Latest published Core release is {release['tag_name']}, manifest is {data['releaseTag']}")
    match = re.search(r"`([0-9a-f]{40})`", release.get("body") or "")
    if not match or match.group(1) != data["sourceCommit"]:
        raise ValueError("Release source commit differs from manifest")
    remote = {asset["name"]: asset for asset in release["assets"]}
    actual_core_names = {name for name in remote if name.startswith("Certifyd-Core-")}
    expected_core_names = {item["filename"] for item in data["assets"]}
    if actual_core_names != expected_core_names:
        raise ValueError("Published Core asset set differs from the seven documented packages")
    sums_asset = remote.get("SHA256SUMS.txt")
    if not sums_asset:
        raise ValueError("Published release is missing SHA256SUMS.txt")
    sums_text = fetch_text(sums_asset["browser_download_url"])
    sums = dict(re.findall(r"(?m)^([0-9a-f]{64})\s+\*?(\S+)$", sums_text))
    sums_by_filename = {filename: digest for digest, filename in sums.items()}
    for item in data["assets"]:
        asset = remote.get(item["filename"])
        if not asset or asset.get("digest") != f"sha256:{item['sha256']}" or asset["size"] != int(item["size"].replace(",", "").split()[0]):
            raise ValueError(f"Release asset hash/size differs: {item['filename']}")
        if sums_by_filename.get(item["filename"]) != item["sha256"]:
            raise ValueError(f"SHA256SUMS.txt differs: {item['filename']}")


def verify_live(data):
    version = data["releaseTag"][1:]
    downloads = fetch_text("https://certifyd.me/downloads/")
    guide = fetch_text("https://certifyd.me/core/guide/")
    try:
        cards = downloads.split("const CORE_DOWNLOADS = ", 1)[1].split("const EXTENSION_DOWNLOADS = ", 1)[0]
    except IndexError as error:
        raise ValueError("Published downloads page has no Core cards") from error
    versions = set(re.findall(r'(?:"version"|version):\s*[\'"](\d+\.\d+\.\d+-beta\.\d+)[\'"]', cards))
    if versions != {version}:
        raise ValueError(f"Published Core download cards are {sorted(versions)}, expected {version}")
    for item in data["assets"]:
        if item["filename"] not in cards or item["sha256"] not in cards:
            raise ValueError(f"Published download card differs from manifest: {item['id']}")
    expected_cards = DOWNLOADS.read_text().split("const CORE_DOWNLOADS = ", 1)[1].split("const EXTENSION_DOWNLOADS = ", 1)[0]
    if cards.replace("\r\n", "\n") != expected_cards:
        raise ValueError("Published Core download cards differ from reviewed generated cards")
    match = re.search(r'<meta name="certifyd-core-release" content="([^"]+)"', guide)
    if not match:
        match = re.search(r'Based on Certifyd Core <code>v([^<]+)</code>', guide)
    guide_version = match.group(1) if match else None
    if guide_version != version:
        raise ValueError(f"Published guide is {guide_version or 'unversioned'}, downloads are {version}")
    expected_guide = generated_guide(data)
    normalized_guide = guide.replace("\r\n", "\n")
    # Hosting may consume its email-obfuscation opt-out comments around the
    # public example address. They do not change the displayed guide content.
    for marker in ("<!--email_off-->", "<!--/email_off-->"):
        expected_guide = expected_guide.replace(marker, "")
        normalized_guide = normalized_guide.replace(marker, "")
    normalized_guide, beacon_count = PAGES_BEACON.subn("", normalized_guide)
    if beacon_count > 1:
        raise ValueError("Published guide contains multiple Cloudflare beacon injections")
    if normalized_guide != expected_guide:
        expected_hash = hashlib.sha256(expected_guide.encode("utf-8")).hexdigest()
        deployed_hash = hashlib.sha256(normalized_guide.encode("utf-8")).hexdigest()
        raise ValueError(f"Published guide content differs from reviewed generated guide (expected SHA-256 {expected_hash}, deployed {deployed_hash})")


def prepare_tag(tag):
    if not re.fullmatch(r"v\d+\.\d+\.\d+-beta\.\d+", tag):
        raise ValueError("Pass an exact beta release tag, for example v0.1.0-beta.28")
    release = fetch_json(f"{API}/tags/{tag}")
    if release["draft"]:
        raise ValueError("Cannot prepare documentation from a draft release")
    data = json.loads(MANIFEST.read_text())
    assets = {asset["name"]: asset for asset in release["assets"]}
    old_version = data["releaseTag"][1:]
    version = tag[1:]
    for item in data["assets"]:
        filename = item["filename"].replace(old_version, version)
        asset = assets.get(filename)
        if not asset or not re.fullmatch(r"sha256:[0-9a-f]{64}", asset.get("digest") or ""):
            raise ValueError(f"Release asset/digest missing: {filename}")
        item.update(version=version, filename=filename, size=f"{asset['size']:,} bytes",
                    sha256=asset["digest"].removeprefix("sha256:"), url=asset["browser_download_url"])
    match = re.search(r"`([0-9a-f]{40})`", release.get("body") or "")
    if not match:
        raise ValueError("Release notes need an exact source commit")
    data.update(releaseTag=tag, sourceCommit=match.group(1), releaseUrl=release["html_url"])
    data["guide"].update(reviewedReleaseTag=None, reviewedBy=None, reviewedAt=None,
                         validationEvidence=[], screenshotStatus="none", screenshots=[])
    MANIFEST.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Prepared {tag} package metadata. Review installation behavior and guide copy, then set reviewedReleaseTag before generating pages.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="update generated site files")
    parser.add_argument("--verify-release", action="store_true", help="compare against latest published GitHub Core release")
    parser.add_argument("--verify-live", action="store_true", help="compare the two deployed pages")
    parser.add_argument("--prepare-tag", help="import package metadata for a new published tag and clear guide review")
    args = parser.parse_args()
    if args.prepare_tag:
        prepare_tag(args.prepare_tag)
        return
    data = json.loads(MANIFEST.read_text())
    validate(data)
    expected = {DOWNLOADS: generated_downloads(DOWNLOADS.read_text(), data), GUIDE: generated_guide(data)}
    for path, content in expected.items():
        if args.write:
            path.write_text(content)
        elif path.read_text() != content:
            raise ValueError(f"Generated file is stale: {path.relative_to(ROOT)}; run scripts/sync-core-release.py --write")
    if not (ROOT / "core/guide/archive/v0.1.0-beta.20/index.html").exists():
        raise ValueError("Versioned Beta 20 guide archive is missing")
    if args.verify_release:
        verify_remote(data)
    if args.verify_live:
        verify_live(data)
    print(f"Core release documentation valid: {data['releaseTag']}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(f"Core documentation check failed: {error}", file=sys.stderr)
        sys.exit(2)
