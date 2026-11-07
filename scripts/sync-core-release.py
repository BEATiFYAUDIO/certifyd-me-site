#!/usr/bin/env python3
"""Generate Core download cards and the primary guide from one reviewed release manifest."""

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


def generated_guide(data):
    tag = data["releaseTag"]
    version = tag[1:]
    e = html.escape
    items = {item["id"]: item for item in data["assets"]}
    def link(item_id):
        item = items[item_id]
        return f'<a href="{e(item["url"])}">{e(item["filename"])}</a>'
    instruction = data["guide"]["instructions"]
    def card(title, body):
        return f'<section class="card"><h2>{e(title)}</h2>{body}</section>'
    cards = [
        card("Windows x64", f'<p>{e(instruction["windows"])}</p><p>{link("windows-x64")}</p><p class="small">This installer is unsigned; Windows may show a warning. Confirm the exact filename and hash before proceeding.</p>'),
        card("macOS Apple Silicon and Intel", f'<p>{e(instruction["macos"])}</p><ul><li>Apple Silicon: {link("macos-arm64")}</li><li>Intel: {link("macos-x64")}</li></ul><p class="small">These DMGs are signed and notarized per the release validation. Stop if Gatekeeper reports a different result.</p>'),
        card("Linux x64 and ARM64", f'<p>{e(instruction["linuxDeb"])}</p><ul><li>x64: {link("linux-x64")}</li><li>ARM64: {link("linux-arm64")}</li></ul><p>{e(instruction["linuxPortable"])}</p><ul><li>x64 portable: {link("linux-x64-portable")}</li><li>ARM64 portable: {link("linux-arm64-portable")}</li></ul><p class="small">The portable command applies only to the extracted archive. Physical Raspberry Pi installation is not claimed here.</p>'),
    ]
    rows = "\n".join(f'<tr><th scope="row">{e(item["platform"])}</th><td><code>{e(item["filename"])}</code></td><td><code class="hash">{e(item["sha256"])}</code></td></tr>' for item in data["assets"])
    shots = data["guide"].get("screenshots", [])
    gallery = "" if not shots else '<section class="panel"><h2>Reviewed interface screenshots</h2>' + "".join(
        f'<figure><img src="/{e(shot["path"])}" alt="{e(shot["caption"])}" loading="lazy" /><figcaption>{e(shot["caption"])}</figcaption></figure>'
        for shot in shots) + '</section>'
    screenshot_note = ("Current-release screenshots will be added after clean-environment capture and review."
                       if not shots else "The screenshots above were reviewed for this exact release.")
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="certifyd-core-release" content="{e(version)}" />
  <meta name="description" content="Install Certifyd Core {e(version)} on Windows x64, macOS Apple Silicon or Intel, and Linux x64 or ARM64." />
  <link rel="icon" type="image/svg+xml" href="/images/certifyd-tab-icon.svg" />
  <link rel="canonical" href="https://certifyd.me/core/guide/" />
  <title>Install Certifyd Core {e(version)} | Certifyd</title>
  <style>
    :root{{--bg:#146f95;--text:#e8ecf1;--muted:#b4bdc8;--orange:#ff8a00;--blue:#5f9fff}}
    *{{box-sizing:border-box}}html{{background:#092c40}}body{{margin:0;background:linear-gradient(165deg,#146f95,#082538 75%);color:var(--text);font:17px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh}}
    a{{color:#a8d0ff}}a:hover{{color:white}}header{{border-bottom:1px solid #ffffff36;background:#082538cf}}.wrap{{max-width:1120px;margin:auto;padding:20px clamp(18px,4vw,40px)}}.brand{{display:inline-flex;align-items:center;gap:14px;color:white;text-decoration:none;font-weight:800;font-size:22px}}.brand img{{width:45px;height:45px}}main{{padding-bottom:70px}}.eyebrow{{color:var(--orange);text-transform:uppercase;font-size:13px;font-weight:850;letter-spacing:.14em}}h1{{font-size:clamp(36px,6vw,64px);line-height:1.05;margin:10px 0 18px}}h2{{font-size:26px;line-height:1.2;margin:0 0 12px}}p{{margin:0 0 15px}}.intro{{max-width:820px;font-size:19px;color:#e1eff7}}.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:16px;margin:28px 0}}.card,.panel{{background:#061b2bbd;border:1px solid #aedaf14d;border-radius:20px;padding:24px;box-shadow:0 20px 50px #0003}}.card ul{{padding-left:20px}}.card li+li{{margin-top:10px}}.small{{font-size:14px;color:var(--muted)}}.button{{display:inline-block;background:var(--orange);color:#0b1c29;font-weight:800;text-decoration:none;padding:11px 17px;border-radius:12px}}.button:hover{{color:#0b1c29;background:#ffb053}}.panel{{margin-top:18px}}.panel ol{{padding-left:24px}}.panel li+li{{margin-top:12px}}code{{overflow-wrap:anywhere}}.table-wrap{{overflow-x:auto}}table{{border-collapse:collapse;width:100%;font-size:14px}}th,td{{border-bottom:1px solid #ffffff2b;padding:10px;text-align:left;vertical-align:top}}.hash{{font-size:12px}}footer{{border-top:1px solid #ffffff36;color:var(--muted)}}
  </style>
</head>
<body>
  <header><div class="wrap"><a class="brand" href="/"><img src="/images/certifyd-tab-icon.svg" alt="" />certifyd</a></div></header>
  <main class="wrap">
    <p class="eyebrow">Certifyd Core · {e(tag)}</p>
    <h1>Install Certifyd Core</h1>
    <p class="intro">This guide covers the packages published for {e(tag)}. Choose the package for your operating system and processor, then follow its installation path. The <a href="/downloads/">downloads page</a> and this guide are generated from the same reviewed release record.</p>
    <a class="button" href="/downloads/">Choose your download</a>
    <div class="cards" id="install">{''.join(cards)}</div>
    <section class="panel" id="dashboard"><h2>Open the local dashboard</h2><p>{e(instruction["dashboard"])}</p><p>The dashboard is private to the Core computer by default. Installing Core does not enable public sharing.</p></section>
    <section class="panel" id="owner"><h2>Create your first owner</h2><ol><li>{e(instruction["owner"])}</li><li>Sign in and confirm that the real dashboard loads. On an existing installation, sign in with the existing owner instead of creating another one.</li><li>Close Core and reopen it to confirm it returns to the local dashboard.</li></ol><p class="small">Do not share passwords, recovery material, creator keys, or wallet credentials in screenshots or support requests.</p></section>
    <section class="panel" id="verify"><h2>Verify the package</h2><p>Compare your downloaded file with the SHA-256 listed below and the release's <a href="https://github.com/BEATiFYAUDIO/contentbox/releases/download/{e(tag)}/SHA256SUMS.txt">SHA256SUMS.txt</a>. Use the exact filename for your system.</p><div class="table-wrap"><table><thead><tr><th>System</th><th>Package</th><th>SHA-256</th></tr></thead><tbody>{rows}</tbody></table></div></section>
{gallery}
    <p class="small">Older walkthrough: <a href="/core/guide/archive/v0.1.0-beta.20/">Beta 20 archive</a>. Its interface screenshots and package steps are historical and are not presented as {e(tag)} evidence. {e(screenshot_note)} <a href="{e(data['releaseUrl'])}">Release notes</a>.</p>
  </main>
  <footer><div class="wrap">Certifyd Core {e(tag)} · Installation guide</div></footer>
</body>
</html>
'''


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
    if guide.replace("\r\n", "\n") != expected_guide:
        expected_hash = hashlib.sha256(expected_guide.encode("utf-8")).hexdigest()
        deployed_hash = hashlib.sha256(guide.encode("utf-8")).hexdigest()
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
