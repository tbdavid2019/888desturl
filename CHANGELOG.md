# Changelog

## 2026-10-24

### Streamlined 2-Pillar UX, Technology Category Grouping & Single-Glance Dashboard

- **Relocated Promotional Features Overview into Footer (`public/index.html`)**:
  - Moved marketing cards (`#features-overview`) from prime viewport real estate down into the footer area, clearing screen clutter so user can focus strictly on core tools: 1. Redirect Tracking & 2. Final Destination Tech Stack.
- **Single-Glance Split View Dashboard (`public/index.html`, `public/result.html`)**:
  - Eliminated endless scrolling up/down by arranging results into a compact, high-density 2-pillar desktop layout:
    - **Top Destination Overview Bar**: Compact header displaying Final Destination URL, Clean URL, Google Web Risk status badge, redirect count, total duration, and quick copy action buttons.
    - **Left Pillar - Redirect Chain (`#chain-list`)**: Sleek, scannable timeline nodes displaying step number, redirect type badge, HTTP status code, timing duration, and origin URL. Includes "複製跳轉鏈路" (`#copy-chain-button`) button.
    - **Right Pillar - Web Technologies (`#tech-section`)**: High-density categorized technology stack with interactive Category Filter Tabs (`全部`, `CMS`, `網頁伺服器`, `JavaScript 框架`, etc.) and "複製技術清單" (`#copy-tech-button`) button.
    - **Secondary Details Drawer**: Compact collapsible `<details>` containing page preview screenshot and Google Web Risk safety audit details.
    - **2md Markdown Extraction**: Compact viewer with copy and external 2md link.
- **Categorized Technology Stack & Filter Tabs (`public/index.html`, `public/result.html`)**:
  - Automatically groups detected technologies by primary category with category icons (📦 CMS, 🖥️ Web servers, 🛠️ Web frameworks, ⚛️ JavaScript frameworks, 📚 JavaScript libraries, 🎨 UI frameworks, 📊 Analytics, 🏷️ Tag managers, 🛡️ Security, 🌐 CDN, etc.).
  - Category Filter Bar allows 1-click toggling between categories or viewing all.
- **Removed Verbose Descriptions from Default View into Hover Tooltips (`public/index.html`, `public/result.html`)**:
  - Cleaned up tech cards into dense, elegant chips displaying Name, Version badge (`v1.20`), Official Link (`↗`), and Confidence.
  - Moved paragraph descriptions completely into CSS hover popover tooltips and `title` attributes, eliminating visual noise.
- **Full Copy Capabilities Added (`public/index.html`, `public/result.html`)**:
  - **Copy Tech Stack (`#copy-tech-button`)**: Exports all detected technologies grouped cleanly into structured Markdown with categories, versions, and links.
  - **Copy Redirect Chain (`#copy-chain-button`)**: Copies the step-by-step redirect hops with status codes and timing.
  - **Single Tech Click-to-Copy**: Clicking any technology chip copies its name and version with a sleek toast alert.
- **Slimmed Sticky Floating Search Bar (`public/index.html`)**:
  - Reduced sticky bar height to a sleek 48-52px (`h-10 sm:h-11`) with integrated 🔍 icon, accessible hidden label, and hidden hint to ensure non-intrusive navigation without blocking content.

### Floating Sticky UX, david888 / 2md Palette & WCAG Compliance

- **Floating Sticky Trace Form UX (`public/index.html`)**:
  - Converted target URL input form (`#trace-form`) into a floating sticky container (`sticky top-2 sm:top-4 z-40 bg-white/95 backdrop-blur-md shadow-sticky border-2 border-[#d6bc7c]/80`).
  - Keeps the search bar and submit button pinned at the top while scrolling through extensive redirect chains, 2md markdown content, 7,600+ web technology badges, and search history.
- **Brand Palette Alignment with `david888.com` & `2md.aiurl.tw` (`public/index.html`, `public/result.html`, `public/offline.html`, `public/manifest.webmanifest`)**:
  - Replaced legacy teal branding with the 5 base color system:
    - Pantone 14-1064 TPG Saffron `#FFB010` (hover `#F2A600`, light `#FFF0CC`)
    - Deep Blue / Navy `#17324D` (dark `#0F2337`, hover `#1F4265`)
    - Terracotta Clay `#A9471D`
    - Warm Cream Canvas `#FFFDF7` to `#FFF9E8`
    - Warm Ink `#2B251A` and accessible muted text `#594E36`
  - Replaced 888 URL mark with Navy and Saffron badge styling.
  - Replaced Final URL hero card with Deep Navy `#17324D` and warm gold saffron `#FDE68A` text.
  - Updated PWA `theme_color` to `#FFB010` and `background_color` to `#FFFDF7` across Web Manifest, meta tags, and offline fallback.
- **Full WCAG 2.1 AA/AAA Accessibility Compliance**:
  - All body text and headings achieve AAA contrast ratios (> 12:1 to 14.8:1 against canvas).
  - All secondary and muted labels achieve AA contrast ratios (6.5:1 > 4.5:1 requirement).
  - Added explicit `<label for="url-input">`, `aria-required="true"`, and `aria-describedby="form-hint"`.
  - Added descriptive `aria-label` attributes on language switchers (`切換至繁體中文` / `Switch to English`).
  - Added clear focus rings (`focus:ring-4 focus:ring-[#FFB010]/20` and `focus:ring-[#17324D]/30`) on all interactive controls.
  - Guaranteed minimum touch targets (>= 48px) for buttons and inputs.
- **Automated Verification (`test/pwa.test.js`)**:
  - Added automated test ensuring sticky floating form classes, WCAG accessibility attributes, language switcher ARIA labels, focus rings, and Saffron/Navy palette tokens are strictly maintained.

### AI Discovery, WebMCP & Frontend Showcase Polish

- **Standard `llms.txt` & `llms-full.txt` Endpoints (`server.js`)**:
  - Implemented `/llms.txt` and `/llms-full.txt` following the llmstxt.org specification to provide LLMs and AI Agents with clean, structured machine-readable technical docs, core endpoints, and technology fingerprinting specs.
- **AI Agent Skill Enhancement (`server.js`)**:
  - Enriched `/ai-agent-skill` Markdown with complete `technologies` response schema (name, version, categories, confidence, icon, website, description) and instructions for autonomous tech stack reconnaissance.
- **Chrome WebMCP Tool Expansion (`public/index.html` & `lib/mcp.js`)**:
  - Updated declarative form annotations and imperative `navigator.modelContext.registerTool('trace_url')` to return detected `technologies` in the structured JSON tool result.
  - Expanded tool descriptions across MCP and WebMCP to explicitly mention 7,600+ technology and framework detection.
- **Frontend UI & Feature Highlights (`public/index.html` & `public/result.html`)**:
  - Added 5-in-1 capability badges directly under the homepage hero title for instant feature visibility.
  - Added "Core Capabilities & Intelligence" (核心功能與分析維度) 4-card showcase grid introducing Web Technologies, Deep Redirect Tracing, Google Web Risk, and 2md Markdown.
  - Added `llms.txt` and `API (/trace)` links to both homepage and result page footers.
  - Added bilingual i18n translations for all new feature titles and descriptions.
  - Bumped Service Worker cache version to `v3` in `public/service-worker.js` to ensure immediate client cache refresh.

### Automated CI/CD & Watchtower Deployment

- **GitHub Actions Dual-Registry Publishing (`.github/workflows/docker-publish.yml`)**:
  - Added GitHub Container Registry (`ghcr.io/tbdavid2019/888desturl:latest`) alongside Docker Hub (`tbdavid2019/888desturl:latest`).
  - Added automatic multi-arch builds (`linux/amd64`, `linux/arm64`) with automated GitHub Packages token authentication.
- **Continuous Deployment with Watchtower (`docker-compose.yml`)**:
  - Added dedicated scoped Watchtower service (`watchtower-desturl`) with `com.centurylinklabs.watchtower.scope=desturl`.
  - Configured 60-second polling interval and automatic stale image cleanup (`WATCHTOWER_CLEANUP=true`).
  - Container automatically updates without manual SSH or restart commands upon Docker image publish.

### Web Technology Detection (WebAppAnalyzer Integration)

- **Fingerprints Database Compilation & Refresh (`data/technologies.json` & `scripts/update-technologies.js`)**:
  - Compiled 7,647 technology fingerprint definitions across 109 categories based on `enthec/webappanalyzer`.
  - Added `scripts/update-technologies.js` supporting both local compilation from `/tmp/webappanalyzer` and remote fetching from GitHub `enthec/webappanalyzer` raw sources.
  - Adjusted `.gitignore` to allow tracking `data/technologies.json` while keeping runtime SQLite and preview files ignored.
- **Technology Detector Engine (`lib/tech-detector.js`)**:
  - Created high-performance CommonJS detection engine with pre-indexed inverted lookups for headers, cookies, meta tags, and JS globals.
  - Supported advanced Wappalyzer syntax: version extraction (`\;version:\1`), conditional versions (`\;version:\1?trueVal:falseVal`), and custom confidence scores (`\;confidence:50`).
  - Added multi-signal matching across HTTP response headers, cookies, meta tags, script source URLs, JS global objects/properties, HTML snippets, and DOM selectors.
  - Implemented recursive `implies` resolution (e.g., WordPress implies PHP and MySQL) with circular dependency protection.
  - Added `extractPageTechSignals(page, navigationResponses, context)` helper to capture signals from the final Playwright destination page and redirect responses without launching extra browser processes.
- **Server & API Integration (`server.js`)**:
  - Integrated tech detection into `traceUrl()` after the destination page settles.
  - Included `technologies` in `buildTracePayload()` and `enrichResultWithPublicUrls()`.
  - Exposed `technologies` array across public endpoints: `/api/trace`, `/trace`, `/api/final`, `/api/final-url`, and `/api/results/:resultId`.
- **Database Storage Migration (`lib/storage.js`)**:
  - Added `technologies_json TEXT` column to SQLite `history` table with automatic PRAGMA migration for existing deployments.
  - Updated `recordTrace()` and `mapHistoryRow()` to persist and deserialize detected technologies as JSON.
- **MCP Server Enhancement (`lib/mcp.js`)**:
  - Updated `trace_url` tool output and description to include detected web technologies and server frameworks.
- **Frontend Web UI (`public/result.html` & `public/index.html`)**:
  - Added dedicated "Web Technologies" (網站技術棧) badge panel displaying detected technology items with category badges, version numbers, official website links, and confidence ratings.
  - Implemented empty state handling when no technologies are detected.
  - Strictly enforced `escapeHtml()` and `sanitizeHref()` defenses against DOM XSS on all rendered technology metadata.
- **Automated Tests (`test/tech-detector.test.js`)**:
  - Added comprehensive test suite verifying version extraction, conditional ternary logic, confidence scoring, multi-signal matching, recursive implies resolution, circular implies safety, graceful fallbacks on malformed input, storage serialization, and frontend DOM XSS sanitization.

## 2026-09-02

### Security & Hardening (7-Layer Security Audit)

- **DOM XSS Remediation in Admin & Public Pages (Layer 4)**:
  - Fixed DOM XSS vulnerability in `public/admin.html` by adding strict `escapeHtml()` and `sanitizeHref()` helpers across `renderBreakdown`, `renderTrend`, and `renderHistory`.
  - Added `sanitizeHref()` link and image source sanitization across `public/index.html` and `public/result.html` to block `javascript:` and dangerous URI schemes.
- **Supply Chain Vulnerability Patching (Layer 5)**:
  - Remediated high-severity vulnerability in `fast-uri` (`GHSA-7p8r-x3mc-p8w7`) achieving 0 vulnerabilities across all dependencies.
  - Updated `Dockerfile` to copy `package*.json` and run `npm ci --omit=dev` for deterministic, secure container builds.
- **SSRF & Cloud Metadata Protection (Layer 2)**:
  - Blocked access to cloud metadata IP/hosts (`169.254.169.254`, `169.254.170.2`, `metadata.google.internal`, `100.100.100.200`, `fd00:ec2::254`) in both the trace entrypoint and Playwright route interception.
  - Added strict alphanumeric validation for `resultId` route parameters (`/^[a-zA-Z0-9_-]{1,64}$/`).
- **HTTP Security Headers Injection (Layer 6)**:
  - Added global Fastify response hook setting `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` (`DENY` for `/admin`), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and `Cross-Origin-Opener-Policy`.
- **Timing Attack Hardening (Layer 7)**:
  - Hardened `secureEquals` in `lib/admin-auth.js` by comparing SHA-256 pre-hashed buffers before `crypto.timingSafeEqual`, eliminating length-leakage timing vulnerabilities.
- **ReDoS Protection in HTML-to-MD (Layer 7)**:
  - Replaced nested regex quantifiers with linear non-greedy patterns in `lib/html-to-md.js` and added scheme filtering on markdown links.
- **Secrets & Git Protection (Layer 1)**:
  - Expanded `.gitignore` to comprehensively exclude all `.env.*`, `*.pem`, `*.key`, `*.pfx`, `*.crt`, `*.cert`.
- **Audit Skill & Automated Tests**:
  - Added `.agents/skills/security-audit/SKILL.md` defining the 7-Layer security audit standard.
  - Added automated security unit test suite in `test/security.test.js`.

## 2026-08-30

- Redesigned homepage UX & layout:
  - Replaced the oversized hero header with a compact, modern brand navbar (`888 URL` badge + title + language & PWA install actions), drastically reducing vertical space consumption.
  - Eliminated unnecessary vertical scrolling: input form and results are now immediately visible above the fold on desktop and mobile.
  - Added smooth auto-scroll into view when trace results load.
- Added automatic intermediate shortlink and countdown redirect bypass (`maybeContinueShortlinkIntermediate`):
  - Automatically identifies countdown intermediate landing pages (such as 888短網址系統, Sink, and interstitial redirectors).
  - Detects and triggers explicit fast-forward actions (`#btn-redirect-now`, `#target-link`, `Redirect Now`, `立即前往`, `點擊跳轉`) to bypass countdown wait times without stopping on intermediate transitional screens.
  - Automatically extracts JavaScript redirect target variables (`trackingConfig.target`, `target`, and `<meta http-equiv="refresh">`) to ensure tracing reaches the true final destination.
- Added unit test in `test/shortlink-intermediate.test.js`.
- Added Docker Quickstart guide in `README.md` for developers to install and run `tbdavid2019/888desturl:latest` directly via single-line `docker run` and `docker compose`.
- Added HTML to Markdown dual-route detection (雙路線偵測):
  - Built-in lightweight HTML to Markdown parser and active DOM extractor in `lib/html-to-md.js`.
  - Automatically extracts page text into clean Markdown (`markdown_content`) and provides companion URL `markdown_url` (`https://2md.aiurl.tw/<final_url>`).
  - Added dedicated "頁面內容 Markdown" (HTML to MD) preview panel in `public/index.html` and `public/result.html` with one-click "複製 Markdown" (Copy Markdown) and "在 2md 開啟 ↗" (Open in 2md) actions.
- Added millisecond (ms) timing logs and duration tracking:
  - Recorded overall trace duration `total_duration_ms` and displayed in the main stats grid on homepage and result page.
  - Recorded per-hop timing `duration_ms` and cumulative elapsed time `elapsed_ms` in the Redirect Chain timeline logs.
  - Added `total_duration_ms` and `markdown_content` to SQLite storage schema and trace persistence.
- Added unit tests in `test/html-to-md.test.js` and `test/timing-and-markdown.test.js`.
- Added automatic URL scheme normalization across the entire repository: bare domain inputs (e.g. `david888.com`, `aiurl.tw/104`), protocol-relative URLs (`//example.com`), and `localhost` are automatically normalized by prepending `https://` (or `http://` for localhost) in both the frontend and backend API endpoints (`/api/trace`, `/api/final`, `/api/f`), MCP handlers (`trace_url`, `clean_url`), and WebMCP client tools.
- Added Chrome WebMCP (Web Model Context Protocol) support on the homepage:
  - Declarative API: annotated `<form toolname="trace_url" tooldescription="...">` and `<input toolparamdescription="...">` for browser AI agents to discover and interact with form fields natively.
  - Imperative API: registered `trace_url` and `clean_url` tools via `document.modelContext` / `navigator.modelContext` allowing in-browser AI assistants (such as Chrome Model Context Tool Inspector) to invoke tracing directly within the tab.
- Added GitHub Actions workflow (`.github/workflows/docker-publish.yml`) to automatically build and push multi-architecture Docker images (`linux/amd64` and `linux/arm64`) to Docker Hub (`tbdavid2019/888desturl`).
- Added dual-server Watchtower integration across both production nodes (`url.david888.com` on `git.glsoft.ai` [x86_64] and `url.create360.ai` on `office.fanpokka.ai` [aarch64/ARM64]) for automated zero-touch rolling updates.
- Added Chrome WebMCP support badge and documentation links in the footer of homepage and result pages.
- Added automated WebMCP contract tests in `test/webmcp.test.js` and URL normalization unit tests in `test/url-normalize.test.js`.

### Fixed

- Fixed `Failed to fetch` caused by expired Let's Encrypt certificate on `url.david888.com` by renewing the certificate on `git.glsoft.ai` and updating the cron renewal script (`renewSSL_bitnami.sh`) to automatically renew `url.david888.com` alongside other domains.
- Fixed UI and API validation errors (`網址格式無效`) when users enter domain names directly without manually typing `http://` or `https://`.
- Fixed false `timeout` warnings on websites with ongoing background network requests/analytics (such as `david888.com`) by enhancing `waitForPageToSettle` to recognize `load` state combined with navigation idle window.

### Changed

- Updated frontend input helper hint, placeholder, and error messages to indicate that full `https://` or bare domain (e.g. `david888.com`) can be inputted directly.
- Updated MCP tool descriptions in `lib/mcp.js` to explicitly state bare domain support.

## 2026-08-19

### Added

- Added standard Model Context Protocol (MCP) server endpoints (`POST /mcp`, `GET /mcp`, `OPTIONS /mcp`) with JSON-RPC 2.0 transport compatible with Cloudflare WebMCP bridge.
- Added `trace_url` tool exposing full redirect tracing, security analysis, and parameter cleaning to browser AI agents and external MCP clients.
- Added `clean_url` tool for instant offline marketing parameter stripping.
- Added automated MCP contract and unit tests in `test/mcp.test.js`.
- Added `mcp` client type tracking in server history, admin stats breakdown, and admin dashboard filters.

### Changed

- Updated Service Worker to exclude `/mcp` traffic from runtime and app shell caches.
- Updated `/ai-agent-skill` endpoint to document MCP endpoint and capabilities.

## 2026-07-31

### Added

- Added an installable PWA manifest with standard, maskable, and Apple touch icons.
- Added a Service Worker with versioned App Shell caching, runtime static-asset caching, and a dedicated offline page.
- Added a bilingual install action that appears when the browser exposes the native install prompt.
- Added automated PWA contract tests for install metadata, cache boundaries, page metadata, and Service Worker registration.

### Changed

- Added PWA metadata and Service Worker registration to the main and standalone result pages.
- Kept API, admin, preview-image, and health-check traffic outside the PWA cache.

## 2026-07-30

### Added

- Added final-URL tracking-parameter analysis with `clean_url` and `removed_tracking_parameters` to `GET /api/trace`, `GET /api/final?format=json`, and `GET /api/results/:resultId`.
- Added conservative removal rules for common tracking parameters (`utm_*`, click IDs, analytics IDs, and Mailchimp IDs), plus Threads-specific `xmt` and `slof` parameters.
- Updated `GET /ai-agent-skill` to document the URL-cleaning response fields and the recommended presentation flow for agents.

### Changed

- Kept `final_url` unchanged for trace history, diagnostics, and Google Web Risk checks; only the additional `clean_url` is sanitised for sharing.
- Updated the main and standalone result pages to present a single recommended share action when tracking parameters are removed, avoiding competing original-versus-clean URL copy controls.
- Expanded README API documentation with the cleaning contract, exact rules, and plain-text `/api/final` compatibility behaviour.

### Deployment

- Deployed to `https://url.david888.com` and `https://url.create360.ai`.

## 2026-06-02

### Added

- Added static redirect URL unwrapping (`unwrapRedirectUrlRecursively`) for YouTube, Facebook, Google, and Slack URLs to avoid warning interstitial screens and bot detection.
- Added virtual static redirect steps (Status: `302 Found (Static Unwrap)`) to trace chains when static unwrapping resolves a target URL.
- Added dynamic click bypass logic for YouTube redirect warning pages during navigation.

## 2026-06-01

### Added

- Added `GET /api/results/:resultId/final-image` for retrieving the stored final-image preview metadata
- Added `GET /api/results/:resultId/web-risk` for retrieving the stored Web Risk result separately
- Added `final_image_url` as a response alias for stored preview images

### Changed

- Updated `GET /api/results/:resultId` to return a nested `security` object in addition to legacy flat security fields
- Updated public security responses to expose `source`, `checked_at`, and `threat_types`
- Updated SQLite history storage to persist full Web Risk metadata for later result lookups

## 2026-05-30

### Added

- Added final-only Google Web Risk checks after redirect tracing completes
- Added final-page screenshot previews with 7-day retention and scheduled cleanup
- Added stable per-trace result IDs and standalone result pages
- Added result-page copy-link support and share metadata for standalone results
- Added browser localStorage recent-search history on the main web UI
- Added SQLite-backed server history and usage statistics plumbing
- Added an admin login flow, rate-limited login attempts, and an admin dashboard
- Added `.env.example` plus documented setup for Web Risk and admin credentials

### Changed

- Updated `/api/trace` and `/api/final?format=json` to return `preview_url` and `security`
- Updated `/api/trace` and `/api/final?format=json` to expose `result_id` and `result_url`
- Updated admin history to link directly to standalone result pages
- Updated Docker Compose to load `.env` and persist `./data` into the container
- Updated repository ignores so secrets and runtime data stay out of git and Docker image context

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
- Added automatic Web UI fallback to retry with `context=line` when standard tracing looks like an app-only link failure

### Changed

- Preserved `GET /api/trace` as the full diagnostic endpoint for redirect-chain debugging
- Updated the hero title layout to use controlled line breaks instead of browser-driven wrapping
- Updated documentation to explain the CLI-focused endpoints and dynamic skill behavior
- Updated trace responses to expose `terminated_reason`, `terminated_message`, and `loop_detected`
- Updated API and skill docs to describe LINE-context tracing
- Updated LINE-context docs to explain intermediary-page continuation behavior

### Deployment

- Deployed live to `https://url.create360.ai`
