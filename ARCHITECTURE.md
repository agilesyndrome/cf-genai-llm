# Architecture

This repository is the starting point for a composable Cloudflare Worker
feature module. A feature owns one capability end to end: its middleware,
route handlers, binding expectations, schemas, migrations, and API client
helpers. The consuming site supplies the Cloudflare bindings and layers the
feature into cf-genai-base.

## Runtime contract

The module exports a feature object with middleware:

    middleware(request, env, ctx, next, state)

Middleware may short-circuit a route or call next(). Request-scoped values
belong in state; module-level state must never contain request data. Binding
access stays inside request handlers and uses Cloudflare in-process bindings.

## Repository layout

- src/index.js: public feature factory and runtime contract.
- tests/: unit tests for routing and feature behavior.
- CONTRACT.md: stable integration promises.
- Makefile: local release lifecycle.
- .github/workflows/build.yml: test/build gate.
- .github/workflows/publish.yml: tag-driven npm Trusted Publishing.

## Build and release

    make test
    make build
    make bump
    make publish
    make wait

make bump creates the next patch version, release commit, and matching v*
tag. make publish pushes main and tags; GitHub Actions publishes to npm with
OIDC provenance. make wait polls npm until the exact package version is
available. make release runs all three release stages.

Feature-owned migrations should be additive and versioned with the feature.
Publish a feature only after its required base package version is available.

make status reports the exact npm version, matching Git tag, latest publish
workflow result via gh, and local branch cleanliness/upstream alignment. It is
read-only and may show WAIT/WARN for an unpublished template or unavailable
external service.
