import copy
import hashlib
import importlib.util
import json
import re
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("core_release_docs", ROOT / "scripts/sync-core-release.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CoreReleaseDocsTest(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((ROOT / "core/release/current.json").read_text())

    def test_current_manifest_and_generated_pages(self):
        module.validate(self.data)
        self.assertEqual((ROOT / "core/guide/index.html").read_text(), module.generated_guide(self.data))
        self.assertEqual((ROOT / "downloads/index.html").read_text(),
                         module.generated_downloads((ROOT / "downloads/index.html").read_text(), self.data))

    def test_new_release_requires_instruction_review(self):
        changed = copy.deepcopy(self.data)
        changed["releaseTag"] = "v0.1.0-beta.28"
        changed["releaseUrl"] = "https://github.com/BEATiFYAUDIO/contentbox/releases/tag/v0.1.0-beta.28"
        with self.assertRaisesRegex(ValueError, "explicit review"):
            module.validate(changed)

    def test_wrong_architecture_or_filename_fails(self):
        changed = copy.deepcopy(self.data)
        changed["assets"][0]["filename"] = changed["assets"][0]["filename"].replace("win-x64", "win-arm64")
        with self.assertRaisesRegex(ValueError, "platform/architecture/filename"):
            module.validate(changed)

    def test_portable_command_cannot_replace_deb_instruction(self):
        changed = copy.deepcopy(self.data)
        changed["guide"]["instructions"]["linuxDeb"] = "Extract the archive and run ./start.sh"
        with self.assertRaisesRegex(ValueError, "distinguish"):
            module.validate(changed)

    def test_walkthrough_images_are_explicitly_historical(self):
        guide = module.generated_guide(self.data)
        self.assertNotIn("<img src=\"images/", guide)
        self.assertNotIn("install-desktop.sh", guide)
        self.assertIn("<!--email_off-->name@wallet.example<!--/email_off-->", guide)
        self.assertIn("Beta 20 archive", guide)
        figures = re.findall(r'<figure[^>]*>[\s\S]*?</figure>', guide)
        self.assertGreater(len(figures), 15)
        for figure in figures:
            self.assertIn('data-screenshot-release="v0.1.0-beta.20"', figure)
            self.assertIn("Beta 20 reference.", figure)
        for path in re.findall(r'(?:src|href)="(/core/guide/images/[^\"]+)"', guide):
            self.assertTrue((ROOT / path.lstrip("/")).is_file(), path)

    def test_release_sync_preserves_full_walkthrough(self):
        guide = (ROOT / "core/guide/index.html").read_text()
        changed = copy.deepcopy(self.data)
        changed["releaseTag"] = "v0.1.0-beta.28"
        changed["guide"]["instructions"]["owner"] = "Reviewed new owner instruction"
        authored = guide.replace("Your work. Your page. Your audience.", "An authored guide heading")
        updated = module.generated_guide(changed, authored)
        self.assertIn("An authored guide heading", updated)
        self.assertIn('content="0.1.0-beta.28"', updated)
        self.assertIn("Reviewed new owner instruction", updated)
        for hook in ['id="search"', 'id="search-results"', 'id="journey-card"',
                     'data-path-choice="basic"', 'data-path-choice="creator"',
                     'data-path-choice="node"', 'certifyd_logo_transparent.svg']:
            self.assertIn(hook, updated)
        self.assertEqual(28, len(re.findall(r'class="topic"', updated)))
        strip = lambda text: re.sub(
            r'(?:<!--|/\*) CORE_RELEASE:(\S+):BEGIN (?:-->|\*/)[\s\S]*?'
            r'(?:<!--|/\*) CORE_RELEASE:\1:END (?:-->|\*/)', '', text)
        self.assertEqual(strip(authored), strip(updated))
        self.assertEqual(updated, module.generated_guide(changed, updated))

    def test_release_sync_refuses_missing_duplicate_or_malformed_regions(self):
        guide = (ROOT / "core/guide/index.html").read_text()
        begin = '<!-- CORE_RELEASE:installation:BEGIN -->'
        end = '<!-- CORE_RELEASE:installation:END -->'
        for broken in [guide.replace(begin, ''), guide + begin,
                       guide.replace(begin, '__BEGIN__').replace(end, begin).replace('__BEGIN__', end)]:
            with self.subTest(broken=broken[-70:]):
                with self.assertRaisesRegex(ValueError, "Guide release region"):
                    module.generated_guide(self.data, broken)

    def test_historical_screenshot_is_not_current_release_evidence(self):
        changed = copy.deepcopy(self.data)
        path = "core/guide/images/first-run-address.png"
        changed["guide"]["screenshotStatus"] = "reviewed"
        changed["guide"]["screenshots"] = [{
            "path": path, "releaseTag": "v0.1.0-beta.20",
            "caption": "Historical dashboard", "reviewedBy": "test",
            "sha256": hashlib.sha256((ROOT / path).read_bytes()).hexdigest(),
        }]
        with self.assertRaisesRegex(ValueError, "release provenance"):
            module.validate(changed)

    def test_archive_images_exist_and_are_not_current_release_evidence(self):
        archived = (ROOT / "core/guide/archive/v0.1.0-beta.20/index.html").read_text()
        self.assertIn("Historical Beta 20 archive", archived)
        self.assertIn('content="noindex"', archived)
        for path in re.findall(r'(?:src|href)="(/core/guide/images/[^"]+)"', archived):
            self.assertTrue((ROOT / path.lstrip("/")).is_file(), path)

    def test_live_guide_requires_reviewed_content_even_when_version_matches(self):
        downloads = (ROOT / "downloads/index.html").read_text()
        reviewed_guide = module.generated_guide(self.data)
        beacon = '<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/test" data-cf-beacon=\'{}\'></script>\n'
        deployed_guide = reviewed_guide.replace("</body>", beacon + "</body>")
        stale_guide = reviewed_guide.replace(
            "On a Debian-compatible desktop, open the matching .deb with the graphical package installer",
            "Extract the Linux archive and run ./install-desktop.sh",
        ).replace("</body>", beacon + "</body>")
        self.assertNotEqual(stale_guide, reviewed_guide)
        self.assertIn('content="0.1.0-beta.27"', stale_guide)
        with patch.object(module, "fetch_text", side_effect=[downloads, deployed_guide]):
            module.verify_live(self.data)
        consumed_comments = deployed_guide.replace("<!--email_off-->", "").replace("<!--/email_off-->", "")
        with patch.object(module, "fetch_text", side_effect=[downloads, consumed_comments]):
            module.verify_live(self.data)
        misplaced_beacon = reviewed_guide.replace("</footer>\n", "</footer>\n" + beacon)
        with patch.object(module, "fetch_text", side_effect=[downloads, misplaced_beacon]):
            with self.assertRaisesRegex(ValueError, "Published guide content differs"):
                module.verify_live(self.data)
        with patch.object(module, "fetch_text", side_effect=[downloads, stale_guide]):
            with self.assertRaisesRegex(ValueError, "Published guide content differs"):
                module.verify_live(self.data)
        unexpected_script = reviewed_guide.replace("</footer>\n", "</footer>\n<script src=\"/unreviewed.js\"></script>\n")
        with patch.object(module, "fetch_text", side_effect=[downloads, unexpected_script]):
            with self.assertRaisesRegex(ValueError, "Published guide content differs"):
                module.verify_live(self.data)


if __name__ == "__main__":
    unittest.main()
