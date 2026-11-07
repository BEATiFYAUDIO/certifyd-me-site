import copy
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

    def test_current_guide_has_no_unreviewed_screenshots(self):
        guide = module.generated_guide(self.data)
        self.assertNotIn("<img src=\"images/", guide)
        self.assertNotIn("install-desktop.sh", guide)
        self.assertIn("Beta 20 archive", guide)

    def test_archive_images_exist_and_are_not_current_release_evidence(self):
        archived = (ROOT / "core/guide/archive/v0.1.0-beta.20/index.html").read_text()
        self.assertIn("Historical Beta 20 archive", archived)
        self.assertIn('content="noindex"', archived)
        for path in re.findall(r'(?:src|href)="(/core/guide/images/[^"]+)"', archived):
            self.assertTrue((ROOT / path.lstrip("/")).is_file(), path)

    def test_live_guide_requires_reviewed_content_even_when_version_matches(self):
        downloads = (ROOT / "downloads/index.html").read_text()
        reviewed_guide = module.generated_guide(self.data)
        stale_guide = reviewed_guide.replace(
            "On a Debian-compatible desktop, open the matching .deb with the graphical package installer",
            "Extract the Linux archive and run ./install-desktop.sh",
        )
        self.assertNotEqual(stale_guide, reviewed_guide)
        self.assertIn('content="0.1.0-beta.27"', stale_guide)
        with patch.object(module, "fetch_text", side_effect=[downloads, reviewed_guide]):
            module.verify_live(self.data)
        with patch.object(module, "fetch_text", side_effect=[downloads, stale_guide]):
            with self.assertRaisesRegex(ValueError, "Published guide content differs"):
                module.verify_live(self.data)


if __name__ == "__main__":
    unittest.main()
