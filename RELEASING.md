# Releasing

Run `npx --yes @agilesyndrome/cf-genai-cli@0.1.3 release` from this directory.
It validates a clean tree, bumps the patch version if needed, commits package
metadata, creates `v<version>`, and pushes the branch and tag. The tag starts
the GitHub Actions workflow.

For the one-time npm bootstrap, run
`npx --yes @agilesyndrome/cf-genai-cli@0.1.3 publish:first` and complete npm's
interactive prompts. Then configure npm Trusted Publishing for organization
`agilesyndrome`, this repository, workflow `publish.yml`, and `npm publish`.
Later releases use GitHub OIDC and require no npm token.
