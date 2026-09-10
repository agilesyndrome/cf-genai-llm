# Releasing

## One-time bootstrap

The package must exist on npm before npm allows a Trusted Publisher to be
configured. From this directory, run the initial interactive publish:

```sh
npm publish --access public --provenance
```

Complete npm's account/2FA prompt. This publishes the version currently in
`package.json`.

## GitHub Actions releases

After the bootstrap publish, configure npm Trusted Publishing for this package:

- Provider: GitHub Actions
- Organization/user: `agilesyndrome`
- Repository: `cf-genai-llm`
- Workflow filename: `publish.yml`
- Environment: blank
- Allowed action: `npm publish`

For later releases, run `make publish`. It checks npmjs and the Git remote for
the current version/tag; if either already exists, it runs the patch bump,
commits the updated package metadata, and pushes the new matching `v*` tag.
The tag-triggered workflow then runs the package checks and publishes using
GitHub OIDC; no npm token secret is required.
