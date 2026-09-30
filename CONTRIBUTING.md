# Contributing

figmaize is a development-stage local Figma importer. The code is available under the MIT license. An npm package and a Community listing are not yet available.

## Local development

Use Node.js 22 or newer for the proposed release baseline. The current package still declares the older prototype baseline of Node 18; it has not yet been narrowed through a compatibility matrix.

```sh
node scripts/build.mjs
node --test tests/*.test.mjs extension/*.test.mjs
```

Browser integration tests are opt-in and need Playwright and Chromium:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
LB_TEST_BROWSER=1 node --test tests/capture-url.test.mjs tests/site-capture.test.mjs
```

Change `figma/importer.js`, `figma/bridge-ui.js`, and `figma/ui.template.html`, then rebuild. `figma/code.js` and `figma/ui.html` are generated outputs. Building can reload a running development plugin; avoid doing it during a canvas mutation.

## Contributions

- Use owned HTML fixtures to reproduce layout and interaction bugs.
- Preserve editable text, semantic controls, relative coordinates and native IDs during reorganization.
- Keep unresolved canvas mutations explicit. Never fix a timeout by blindly submitting the same mutation again.
- Keep the collector independent of the MCP client and site brand. Site-specific behavior belongs in an optional adapter with its own fixture.
- Include the reproduction, expected/actual behavior, and relevant tests with each change.
- Keep `.layer-bridge`, pairing codes, personal Figma links and captured third-party assets out of commits and release packages.

Before a public release, use the checklist in [the release plan](docs/open-source-plan.md). Report reproducible non-sensitive bugs at https://github.com/parktaesu123/figmaize/issues. A private security reporting channel is not configured yet; do not post tokens or private captures in public issues.
