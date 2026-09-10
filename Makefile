.PHONY: check test build bump publish wait release status

PACKAGE_NAME := $(shell node -p "require('./package.json').name")
VERSION = $(shell node -p "require('./package.json').version")
MAX_ATTEMPTS ?= 30
WAIT_SECONDS ?= 10

check:
	npm run check

test:
	npm test

build:
	npm run build

bump:
	@test -z "$$(git status --porcelain)" || (echo "Working tree must be clean before bumping." >&2; exit 1)
	npm version patch --no-git-tag-version
	git add package.json
	@test ! -e package-lock.json || git add package-lock.json
	git commit -m "Release $(PACKAGE_NAME) v$$(node -p "require('./package.json').version")"
	git tag "v$$(node -p "require('./package.json').version")"

publish:
	git push origin main --follow-tags

wait:
	@echo "Waiting for $(PACKAGE_NAME)@$(VERSION) to appear on npm..."
	@attempt=0; \
	until test "$$(npm view "$(PACKAGE_NAME)@$(VERSION)" version 2>/dev/null || true)" = "$(VERSION)"; do \
		attempt=$$((attempt + 1)); \
		if test "$$attempt" -ge "$(MAX_ATTEMPTS)"; then \
			echo "Timed out waiting for $(PACKAGE_NAME)@$(VERSION) on npm." >&2; exit 1; \
		fi; \
		sleep "$(WAIT_SECONDS)"; \
	done
	@echo "$(PACKAGE_NAME)@$(VERSION) is available on npm."

release: bump
	$$(MAKE) publish wait

status:
	@set -eu; \
	package="$(PACKAGE_NAME)"; version="$(VERSION)"; tag="v$$version"; \
	npm_version="$$(npm view "$$package@$$version" version 2>/dev/null || true)"; \
	seen="$$npm_version"; test -n "$$seen" || seen=none; \
	if test "$$npm_version" = "$$version"; then echo "<OK> $$package v$$version published on npmjs"; else echo "<WAIT> $$package v$$version not available on npmjs (seen: $$seen)"; fi; \
	if git tag --list "$$tag" | grep -q .; then echo "<OK> Git tag $$tag exists"; else echo "<WARN> Git tag $$tag is missing"; fi; \
	repo="$$(git remote get-url origin | sed -E 's#^git@github.com:##; s#^ssh://git@github.com/##; s#^https://github.com/##; s#\\.git$$$$##')"; \
	if command -v gh >/dev/null 2>&1; then \
		run="$$(gh run list --repo "$$repo" --workflow publish.yml --limit 1 --json status,conclusion,databaseId,headSha --jq '.[0] | "\(.status) \(.conclusion // "-") #\(.databaseId) \(.headSha[0:7])"' 2>/dev/null || true)"; \
		case "$$run" in \
			completed\ success*) echo "<OK> GitHub Actions publish $$run" ;; \
			completed\ *) echo "<WARN> GitHub Actions publish $$run" ;; \
			*in_progress*) echo "<WAIT> GitHub Actions publish $$run" ;; \
			*) echo "<WARN> GitHub Actions publish status unavailable" ;; \
		esac; \
	else \
		echo "<WARN> gh is not installed; GitHub Actions status unavailable"; \
	fi; \
	if test -z "$$(git status --porcelain)"; then echo "<OK> Working tree clean"; else echo "<WARN> Working tree has local changes"; fi; \
	branch="$$(git branch --show-current)"; upstream="$$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"; \
	if test -z "$$upstream"; then \
		echo "<WARN> $$branch has no upstream branch"; \
	else \
		counts="$$(git rev-list --left-right --count "$$upstream"...HEAD)"; \
		case "$$counts" in \
			"0	0") echo "<OK> $$branch matches $$upstream" ;; \
			*) echo "<WARN> $$branch differs from $$upstream (behind/ahead: $$counts)" ;; \
		esac; \
	fi
