# Changelog

## 2026-05-28

### Added

- Added `GET /api/final` for final-destination lookups with plain-text output by default
- Added `GET /api/f` as a shorter CLI alias for `/api/final`
- Added dynamic `GET /ai-agent-skill` output based on the current request host
- Added footer link to the live AI agent skill document
- Added multilingual UI switching with browser-language detection
- Added loop protection and termination reporting for repeated redirects
- Added user-facing error explanations for invalid URLs, DNS errors, SSL errors, refused connections, and timeouts
- Added optional `context=line` tracing mode for links that depend on the LINE in-app browser context
- Added automatic CTA clicking for `context=line` on LINE-style intermediary pages such as "前往頁面" flows

### Changed

- Preserved `GET /api/trace` as the full diagnostic endpoint for redirect-chain debugging
- Updated the hero title layout to use controlled line breaks instead of browser-driven wrapping
- Updated documentation to explain the CLI-focused endpoints and dynamic skill behavior
- Updated trace responses to expose `terminated_reason`, `terminated_message`, and `loop_detected`
- Updated API and skill docs to describe LINE-context tracing
- Updated LINE-context docs to explain intermediary-page continuation behavior

### Deployment

- Deployed live to `https://url.create360.ai`
