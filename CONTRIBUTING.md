# Contributing

figmaize is a local Figma importer released under MIT. Use Node.js 22 or newer.

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

The default suite uses local loopback servers; permit localhost listeners. Browser tests use owned fixtures in disposable Chromium contexts. Do not use personal accounts, production forms or third-party assets as CI fixtures.

Edit source files in `figma/`, then rebuild `code.js` and `ui.html`. Building may reload a running development plugin; do not build during a canvas mutation.

- Preserve editable text, semantic controls, native IDs and user edits.
- Keep unresolved mutations explicit. Never solve a timeout by blindly resubmitting.
- Keep capture independent of a specific site and MCP client.
- Include a minimal fixture, expected/actual behavior and appropriate tests.
- Never commit `.layer-bridge`, pairing codes, private Figma links or captured assets.

Before tagging a release, follow [the release status](docs/open-source-plan.md), build the plugin and inspect `npm pack --dry-run`. Generated packages should be tested from a temporary install, not just from the checkout. A tag creates GitHub prerelease artifacts; it does not publish to npm or Figma Community.

Report non-sensitive bugs through GitHub Issues. Private vulnerability reporting is not yet configured: do not post secrets or a sensitive exploit in public issues. See [SECURITY.md](SECURITY.md).
