---
name: security-audit
description: 7-Layer full repository security audit framework for 888desturl, covering secrets leakage, server & API architecture, SSRF, XSS/DOM sanitization, dependency CVEs, HTTP headers, and timing attacks.
---

# 🛡️ 888desturl 7-Layer Security Audit Framework

Use this skill to audit and harden the `888desturl` repository across all 7 layers of application and infrastructure security.

## 📋 Audit Layers

### Layer 1: 🔑 Secrets & Credentials Exposure
- Scrutinize Git history and working tree for hardcoded API keys, passwords, or tokens.
- Ensure `.gitignore` and `.dockerignore` comprehensively exclude `.env`, `.env.*`, `*.pem`, `*.key`, `*.crt`, `*.pfx`, `*.cert`.

### Layer 2: 🛡️ API Endpoints & Server Architecture
- **SSRF Mitigation**: Block internal IP addresses and cloud metadata services (`169.254.169.254`, `metadata.google.internal`, etc.) in request interceptors.
- **Path Traversal / Parameter Validation**: Strictly validate `resultId` parameters with alphanumeric regex (`/^[a-zA-Z0-9_-]{1,64}$/`).
- **Resource Exhaustion & Timeouts**: Ensure all external requests have bounded settle deadlines, loop counters, and max redirect limits.

### Layer 3: 🧠 AI & MCP Guardrails
- Validate JSON-RPC 2.0 protocol specifications in `lib/mcp.js`.
- Prevent leaking database errors, file paths, or internal server errors to LLM/MCP clients.

### Layer 4: 💻 Client-side Security & Data Storage
- **XSS & DOM Sanitization**: Enforce `escapeHtml` for all interpolated text and `sanitizeHref` for all `href` and `src` attributes.
- Disallow `javascript:` and dangerous URI schemes.

### Layer 5: 📦 Supply Chain & Dependency CVEs
- Run `npm audit` and fix vulnerabilities (`npm audit fix`).
- Enforce reproducible Docker builds with `COPY package*.json ./` and `npm ci --omit=dev`.

### Layer 6: 🌐 HTTP Security Headers & Infrastructure
- Set standard security headers on all responses:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN` (`DENY` on `/admin`)
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Cross-Origin-Opener-Policy: same-origin-allow-popups`

### Layer 7: 📐 Quantitative, URL Parsing & Timing Safety
- Use SHA-256 pre-hashed buffers before `crypto.timingSafeEqual` in admin authentication to eliminate length-leakage timing vulnerabilities.
- Ensure ReDoS-safe linear regular expressions in `lib/html-to-md.js`.
