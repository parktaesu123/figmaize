# figmaize implementation and release status

The product is a Figma plugin with a local collector. MCP is optional; capture, classification, deduplication and layer creation do not require per-element LLM calls.

## Implemented in 0.3.0-alpha.1

| Stage | Delivered |
| --- | --- |
| Plugin workflow | URL input, page/selected/site scope, discovery checklist, viewport and limits, collection list, progress, import/cancel/resume |
| Shared service | Authenticated HTTP routes and MCP tools call the same site jobs; detached workers, disk checkpoints, saved job IDs, unresolved-mutation blocking |
| Editable canvas | Native text, controls, measured Auto Layout, nested page/state boards; optional site pages, exact-match instances, selector-matched variants and prototype links |
| Installation | Node 22+, pinned Playwright, explicit Chromium installation, setup/doctor CLI, user data directory, optional MCP configuration |
| Distribution | Source install, npm tarball packaging, development-plugin bundle, CI, release workflow, MIT license, changelog, contribution and issue templates |
| Case separation | Toss remains an independent example. Captures, private journals, connection codes and Figma file links are excluded |

## Verification boundaries

The default suite covers the collector schema, bridge authentication/queue, MCP, importer API model, compact states, resumable journals and extension delivery. Opt-in Chromium tests cover DOM capture, video/raster fallback, three page types, selected-page scope, cancellation/resume and plugin UI controls.

API model tests check instances, variants and prototype reactions. Native Figma verification must additionally be performed before promoting an alpha: create a small collection, verify actual COMPONENT/INSTANCE/COMPONENT_SET nodes and edit a label. A model test is not proof of every native Figma constraint or every site's visual fidelity.

Local validation: 85 default tests passed (6 browser cases skipped there), and all 12 browser-suite tests passed, including real detached workers, setup/doctor and the plugin UI. The packaged tarball was installed outside the checkout and passed doctor. The new native options remain pending desktop verification: the current Figma session reported a reconnection/sync problem.

## Remaining publication steps

1. Inspect the packaged tarball and generated plugin bundle; never include local data or credentials.
2. Run CI and Chromium tests. The CI matrix covers Node 22/24 on Ubuntu and Node 22 on Windows/macOS; native Figma is a separate desktop check.
3. Push a version tag to generate GitHub prerelease artifacts. The workflow uses the repository's scoped GitHub Actions token; no npm publishing token is stored.
4. For npm publication, verify ownership/availability of the desired package name and configure npm authentication or trusted publishing. Registry publication is intentionally not automatic.
5. For Figma Community, obtain the account-assigned numeric plugin ID and generate a candidate using `node scripts/release-plugin.mjs ID`. Review localhost network access, provide listing/support materials and submit through Figma. The development ID is not a public Community registration.
6. Enable GitHub private vulnerability reporting in repository settings before advertising a private security reporting link.

No Community approval, npm name reservation or publication is claimed. Remote hosting, OAuth and paid infrastructure are outside this local alpha.

## Future work

- Broader visual fidelity fixtures for fonts, complex CSS and responsive states.
- Better component family inference beyond stable URL/DOM identity, with explicit review before merging unrelated elements.
- Design variables and richer prototype semantics after native validation.
- Managed remote collectors only if their cost, authentication and data policies are explicitly chosen.

The existing `layer-bridge` scene format and pluginData keys remain compatible. Existing imported collections are not destructively migrated or overwritten.
