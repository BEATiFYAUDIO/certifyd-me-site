# Core release documentation contract

`core/release/current.json` is the website's authoritative Core release record. The download cards and the primary `/core/guide/` page are generated from it by `scripts/sync-core-release.py`. Do not edit their generated Core content by hand. The manifest contains the exact release tag, source commit, seven package filenames, URLs, byte sizes, SHA-256 digests, supported architectures, installation instructions, and a release-specific guide review.

## Release handoff

1. Publish and validate the Core release packages, including `SHA256SUMS.txt`, through the Core release process. The website's release check reads the latest published Core release and its asset digests from GitHub. This website change does not alter Core application code or Core release workflows.
2. In a website branch, run `python3 scripts/sync-core-release.py --prepare-tag vX.Y.Z-beta.N`. This imports the published package metadata, source commit, and URLs, and clears the guide review and screenshots. The generator refuses to pass until documentation is reviewed for the new tag.
3. Check each installer type and architecture against the release assets and Core source at `sourceCommit`: Windows installer/shortcut, macOS DMG and app launch, Linux `.deb` graphical install, Linux portable extraction and `./start.sh`, private dashboard at `127.0.0.1:4000`, and owner setup. Update `guide.instructions`, status/notes, and `guide.validationEvidence` as needed. Do not copy older steps into a newer package format. A source check is not a clean graphical installation test; qualify any untested behavior.
4. Add screenshots only from the exact release after clean-environment capture and secret review. Each `guide.screenshots[]` entry needs `path` under `core/guide/images/`, `releaseTag`, `sha256`, `caption`, and `reviewedBy`. Set `screenshotStatus` to `reviewed`. If no current screenshots are validated, leave the list empty and `screenshotStatus` as `none`; old images remain in the versioned archive.
5. Set `guide.reviewedReleaseTag` to the exact release tag, plus `reviewedBy` and `reviewedAt`. Run `python3 scripts/sync-core-release.py --write --verify-release`, then `python3 -m unittest discover -s test -p 'test_core_release_docs.py'`. Review the resulting guide and cards before merging/deploying.
6. After deployment, run `python3 scripts/sync-core-release.py --verify-live`. The daily GitHub Actions job also checks that both live pages advertise the same current release. A `core-release-published` repository dispatch can trigger it immediately when a Core release is published.

The CI workflow checks generated output, exact guide review, supported package set, filename/architecture mapping, URL, hash, byte size, latest GitHub release, and screenshot provenance. It runs on website PRs and pushes, daily, and by manual or repository dispatch. CI failure signals a release/docs mismatch; it does not by itself prevent a push unless the `Core release documentation / validate` status check is required by branch protection. The site currently has no branch protection, so enabling that required check is an outstanding repository setting.

## Beta 27 correction

The published download cards already point at `v0.1.0-beta.27`; the previous primary guide described Beta 20 and treated all Linux packages as extracted archives. Beta 27 has both Debian installers and portable archives. The new primary guide distinguishes them, names the real seven Beta 27 assets and hashes, and uses the owner/dashboard labels found in the Beta 27 source commit. The complete Beta 20 walkthrough, including its historical screenshots, is archived at `/core/guide/archive/v0.1.0-beta.20/`. The current guide deliberately has no unverified Beta 27 screenshots. Core Lab has independently streamed and hashed all seven package bytes, but no clean graphical install or dashboard capture has yet been completed there.

## Manual release steps to automate

- Connect the Core release workflow to this website workflow with the `core-release-published` repository dispatch and exact tag payload. Until then, the daily check detects new Core releases after publication.
- Require the `Core release documentation / validate` status on the protected website `main` branch and make website deployment depend on it. Without this repository setting, a failed check is visible but cannot block merge/deploy.
- Automate preparation of a website pull request after Core asset publication using `--prepare-tag`. Human review of package-specific instructions, screenshots, and sensitive content must remain a gate.
- Add release-matched clean Windows, Linux, and Mac installation evidence to the review record before claiming full end-to-end validation. The current Beta 27 review uses release metadata and source inspection, with screenshot evidence intentionally absent.
