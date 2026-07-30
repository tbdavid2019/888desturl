# Spec: Final URL tracking-parameter analysis

## Objective

For every traced final URL, preserve the literal destination and provide a second, safe-to-copy `clean_url` with only known tracking parameters removed. The API also reports the parameter names it removed, without exposing their values. This helps users share canonical-looking links while retaining the actual traced URL for diagnostics and safety checks.

## Tech Stack

Node.js with Fastify, Playwright, and vanilla browser JavaScript. No new dependencies or database columns are required.

## Commands

- Test: `node --test lib/url-cleaner.test.js`
- Run app: `npm start`

## Project Structure

- `lib/url-cleaner.js` — pure URL analysis and cleaning rules.
- `lib/url-cleaner.test.js` — Node built-in test coverage for the cleaning contract.
- `server.js` — adds the analysis fields to API and result payloads.
- `public/index.html` and `public/result.html` — show the clean URL and copy action.

## API Contract

Existing fields are unchanged. Responses from `GET /api/trace`, `GET /api/final?format=json`, and `GET /api/results/:resultId` add:

```json
{
  "final_url": "https://www.threads.com/@haneko0912/post/DbWbVBZE5l3?xmt=abc&slof=1",
  "clean_url": "https://www.threads.com/@haneko0912/post/DbWbVBZE5l3",
  "removed_tracking_parameters": ["xmt", "slof"]
}
```

`clean_url` is `null` and `removed_tracking_parameters` is an empty array when no final URL exists. The text form of `/api/final` remains unchanged for CLI compatibility.

## Code Style

```js
const analysis = analyzeUrl(finalUrl);

return {
  ...result,
  clean_url: analysis.clean_url,
  removed_tracking_parameters: analysis.removed_tracking_parameters
};
```

Use small pure functions, snake_case payload keys to match the existing public API, and no URL rewrite outside the explicit rules below.

## Tracking Rules

- Always remove common known tracking keys: `utm_*`, `fbclid`, `gclid`, `dclid`, `msclkid`, `_ga`, `_gl`, `igshid`, `mibextid`, `mc_cid`, and `mc_eid`.
- Remove `xmt` and `slof` only for `threads.com` and its subdomains.
- Preserve all other query parameters and the URL fragment.
- Do not remove generic keys such as `id`, `token`, `state`, or `ref` because they may change page behavior.

## Testing Strategy

Use Node's built-in test runner to cover common tracking removal, Threads-specific removal, preservation of functional parameters/fragments, host scoping, and invalid/missing URLs. Manually verify API JSON fields and both browser UI copy actions after starting the app.

## Boundaries

- Always: keep `final_url` unchanged; use it for Web Risk checks and trace history; run tests before handoff.
- Ask first: add dependencies, change the SQLite schema, or broaden deletion rules beyond known trackers.
- Never: remove unknown query parameters, expose removed parameter values in output, or change the text form of `/api/final`.

## Success Criteria

- The provided Threads example produces the expected clean URL and reports `xmt` and `slof`.
- Existing API fields and text `/api/final` output remain compatible.
- Existing and newly stored result pages expose the same computed analysis.
- Both pages let a user open or copy the clean URL.
