.PHONY: install build test lint lint-fix clean help version-patch version-minor version-major publish

# Absolute paths
ROOT_DIR := $(shell pwd)

# Default target
help:
	@echo "Alphalite - Available commands:"
	@echo ""
	@echo "  make install          Install dependencies"
	@echo "  make build            Build the library"
	@echo "  make test             Run tests"
	@echo "  make lint             Run linter"
	@echo "  make lint-fix         Run linter with auto-fix"
	@echo "  make clean            Remove node_modules and build output"
	@echo ""
	@echo "  make version-patch    Bump patch version (0.1.0 -> 0.1.1)"
	@echo "  make version-minor    Bump minor version (0.1.0 -> 0.2.0)"
	@echo "  make version-major    Bump major version (0.1.0 -> 1.0.0)"
	@echo "  make publish          Build, test, and publish to npm"

# Install dependencies
install:
	@echo "Installing dependencies..."
	npm install
	@echo "Dependencies installed"

# Build the library
build:
	@echo "Building library..."
	npm run build
	@echo "Library built to $(ROOT_DIR)/lib"

# Run tests
test:
	@echo "Running tests..."
	npm test

# Run linter
lint:
	@echo "Running linter..."
	npm run lint

# Run linter with auto-fix
lint-fix:
	@echo "Running linter with auto-fix..."
	npm run lint:fix

# Clean up
clean:
	@echo "Cleaning up..."
	rm -rf node_modules
	rm -rf lib
	rm -f package-lock.json
	@echo "Cleaned"

# Version bumping (updates package.json, commits, and tags)
version-patch:
	@echo "Bumping patch version..."
	@npm version patch --no-git-tag-version
	@VERSION=$$(node -p "require('./package.json').version") && \
		git add package.json package-lock.json && \
		git commit -m "Bump version to v$$VERSION" && \
		git tag -a "v$$VERSION" -m "Release v$$VERSION" && \
		echo "Version bumped to v$$VERSION and tagged"

version-minor:
	@echo "Bumping minor version..."
	@npm version minor --no-git-tag-version
	@VERSION=$$(node -p "require('./package.json').version") && \
		git add package.json package-lock.json && \
		git commit -m "Bump version to v$$VERSION" && \
		git tag -a "v$$VERSION" -m "Release v$$VERSION" && \
		echo "Version bumped to v$$VERSION and tagged"

version-major:
	@echo "Bumping major version..."
	@npm version major --no-git-tag-version
	@VERSION=$$(node -p "require('./package.json').version") && \
		git add package.json package-lock.json && \
		git commit -m "Bump version to v$$VERSION" && \
		git tag -a "v$$VERSION" -m "Release v$$VERSION" && \
		echo "Version bumped to v$$VERSION and tagged"

# Publish to npm (builds and tests via prepublishOnly)
publish:
	@echo "Publishing to npm..."
	npm publish
	@echo "Published version $$(node -p "require('./package.json').version")"
	@echo "Pushing tags to origin..."
	git push && git push --tags
