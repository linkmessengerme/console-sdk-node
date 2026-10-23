# Releasing

Use `Link Messenger <dev@linkmessenger.me>` for Git authors, committers and
taggers. Publish through the Link Messenger account or GitHub Actions. Review
source, history and built archives for personal names, paths and credentials.

1. Update both the package version and the runtime version; date the changelog.
2. Run the release checks:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm pack --ignore-scripts
```

3. Install the built package in a clean consumer environment and verify its API.
4. Commit the reviewed changes on a release branch and publish them to `main`.
   The release workflow reruns checks, creates an annotated version tag and a
   GitHub release. Existing tags are never moved.
5. Check that `npm whoami` reports `linkmessenger`, then publish the reviewed
   tarball with `npm publish <tarball> --access public --tag latest`. Use a
   temporary npm configuration or the normal login flow; never commit tokens.
   If npm requests 2FA, complete its browser/passkey confirmation.
6. Verify registry integrity and install from npm in a clean consumer project.

The GitHub workflow releases source only. npm publication is a separate step.
