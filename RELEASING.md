# Releasing

How to cut a new release of `n8nctl` and `n8n-workflow-validator`.

## Prerequisites

1. `NPM_TOKEN` secret is set on the GitHub repo
   (`https://github.com/trngthnh369/n8nctl/settings/secrets/actions`).
   - Generate at https://www.npmjs.com/settings/trngthnh369/tokens
   - **Granular token**, scope: `@trngthnh369`, Read and write
   - **"Bypass 2FA when publishing"**: enabled

2. Clean working tree. All tests pass locally: `npm test`.

3. `CHANGELOG.md` has the new version's entry under `## [X.Y.Z]` — the
   release workflow extracts notes from this section automatically.

## Release flow

Both packages stay in lock-step on version numbers. To cut `0.X.Y`:

```bash
# 1. Bump versions in both packages (manual, pick the right semver step)
#    — edit packages/n8nctl/package.json           → "version": "0.X.Y"
#    — edit packages/n8n-workflow-validator/package.json → "version": "0.X.Y"
#    — edit packages/n8nctl/package.json dependency:
#        "@trngthnh369/n8n-workflow-validator": "^0.X.Y"

# 2. Reinstall to refresh lockfile
npm install

# 3. Final sanity check
npm run build
npm test

# 4. Commit + tag + push
git add -A
git commit -m "chore(release): v0.X.Y"
git tag v0.X.Y
git push origin main
git push origin v0.X.Y
```

The `Release` workflow (`.github/workflows/release.yml`) triggers on
`v*.*.*` tag push. It:

1. Installs + builds + tests
2. Verifies tag matches both `package.json` versions
3. Publishes `@trngthnh369/n8n-workflow-validator` with `--provenance`
4. Publishes `@trngthnh369/n8nctl` with `--provenance`
5. Extracts the `## [X.Y.Z]` section from `CHANGELOG.md`
6. Creates a GitHub Release with those notes

## Semver guidance

| Change | Bump |
|---|---|
| Bug fix, internal refactor, docs | patch (0.2.0 → 0.2.1) |
| New feature, new command, new flag | minor (0.2.0 → 0.3.0) |
| Breaking: flag rename, required field added, command removed | major (0.2.0 → 1.0.0) |

Until `1.0.0`, we treat every `0.x.0` bump as potentially containing
breaking changes (semver warns this is allowed in `0.x`). Document any
removals / renames in `CHANGELOG.md` under a `### Breaking` subhead.

## Unpublish / yank

npm allows unpublish within 72 hours of publish. After 72h, can only
deprecate:

```bash
npm deprecate @trngthnh369/n8nctl@0.X.Y "Deprecated — use 0.X.Y+1 instead"
```

## Provenance

All publishes from CI carry Sigstore provenance attestation. Visible
badge on the npm package page confirms the package was built from a
specific GitHub commit by the release workflow. Manual `npm publish`
from a developer machine does NOT produce provenance — always tag-
trigger a CI release for production.

## Emergency publish (if CI is broken)

```bash
# Use a granular token with bypass-2FA — NEVER share in chat
export NPM_TOKEN=npm_XXXXXX
echo "//registry.npmjs.org/:_authToken=\${NPM_TOKEN}" > .npmrc
npm publish -w @trngthnh369/n8n-workflow-validator --access public
npm publish -w @trngthnh369/n8nctl --access public
rm .npmrc
```

Note: no provenance badge on emergency publishes.
