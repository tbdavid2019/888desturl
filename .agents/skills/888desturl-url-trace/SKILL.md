---
name: 888desturl-url-trace
description: Use when you need to trace a URL through HTTP redirects, meta refresh, or JavaScript navigation, detect web technologies and server frameworks (7,600+ fingerprints via enthec/webappanalyzer), inspect LIFF URLs, check Google Web Risk security, extract 2md Markdown, or call the live 888desturl API or MCP/WebMCP endpoints.
---

# 888desturl URL Trace & Web Technology Intelligence

## Environment Setup

- **Base URL**: `https://url.david888.com`
- **MCP Endpoint**: `https://url.david888.com/mcp` (JSON-RPC 2.0 / WebMCP compatible)
- **Trace Endpoint**: `https://url.david888.com/api/trace?url=<encoded_target_url>` (Alias: `https://url.david888.com/trace?url=<encoded_target_url>`)
- **Final-Only Endpoint**: `https://url.david888.com/api/final-url?url=<encoded_target_url>&format=json`
- **Short CLI Endpoint**: `https://url.david888.com/api/f?url=<encoded_target_url>`
- **LLMs Guide**: `https://url.david888.com/llms.txt`
- **Full LLMs Reference**: `https://url.david888.com/llms-full.txt`
- **Result Page Pattern**: `https://url.david888.com/result/<result_id>`
- **Optional Context**: add `&context=line` for LINE-like mobile tracing when a link only works inside the LINE in-app browser
- **Method**: `GET` (REST) / `POST` (MCP)
- **Content Type**: `application/json`

## Workflow

1. Validate that the input is a full `http://` or `https://` URL (or domain name like `david888.com`).
2. URL-encode the target URL.
3. If the URL appears to depend on the LINE app or LIFF, add `context=line`.
4. Call `https://url.david888.com/api/f?url=<encoded_target_url>` for a quick text response of the final URL.
5. Call `https://url.david888.com/api/final-url?url=<encoded_target_url>&format=json` when you need the final URL, security status, clean URL, and detected web technologies.
6. Call `https://url.david888.com/api/trace?url=<encoded_target_url>` (or `/trace`) when you need the full redirect chain, hop timing stats, 7,600+ web technology fingerprints, and 2md markdown content.
7. Read `final_url` first and present it as the traced destination.
8. If `removed_tracking_parameters` is non-empty, present `clean_url` as the copy-friendly URL without marketing tags.
9. Summarize `redirect_count` and chain transitions with node-level status codes and durations.
10. If present, surface `security.status` (safe, flagged, or unknown) and any threat types from Google Web Risk.
11. Inspect `technologies` to discover the destination site's tech stack (CMS, Web servers, JavaScript frameworks, CDN, analytics, and software versions).
12. If `markdown_content` or `markdown_url` is present, use it for LLM document extraction and direct reading via `https://2md.aiurl.tw`.

## Response Shape

- `final_url`: string (The destination URL)
- `input_url`: string (The initial target URL or domain requested)
- `clean_url`: string (Destination URL stripped of marketing parameters)
- `removed_tracking_parameters`: Array<string> (Names of stripped tracking parameters)
- `redirect_count`: number (Number of redirect steps encountered)
- `trace_context`: "default" | "line" (Active tracing context emulation)
- `terminated_reason`: string (e.g. "completed", "timeout", "redirect_loop")
- `page_title`: string | null (Document title of destination page)
- `page_excerpt`: string | null (Brief textual excerpt from destination page)
- `total_duration_ms`: number (Total milliseconds elapsed across entire trace)
- `chain`: Array of redirect hop objects (step, url, from_url, type, status_code, status_text, duration_ms)
- `technologies`: Array of detected technology objects:
  - `name`: string (e.g. "WordPress", "Nginx", "React")
  - `version`: string | null (e.g. "6.5.2", "1.24.0")
  - `categories`: Array<{ id: number, name: string }> (e.g. [{"id": 1, "name": "CMS"}])
  - `confidence`: number (0-100)
  - `icon`: string | null
  - `website`: string | null
  - `description`: string | null
- `security`: object
  - `status`: "safe" | "flagged" | "unknown"
  - `source`: "google_webrisk"
  - `checked_url`: string
  - `message`: string
  - `threat_types`: Array<string>
- `preview_url`: string | null (Public preview screenshot URL)
- `final_image_url`: string | null (Alternative preview image URL)
- `markdown_content`: string | null (Extracted clean article/page Markdown)
- `markdown_url`: string | null (2md reader URL)
- `result_id`: string (Unique identifier for the trace result permalink)
- `result_url`: string | null (Permanent shareable web result URL)
