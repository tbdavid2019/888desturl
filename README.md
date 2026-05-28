# 🔗 URL Redirect Tracer (網址跳轉追蹤器)

此專案是一個基於 Node.js、Fastify 與 Playwright (Headless Chromium) 打造的網址跳轉追蹤工具（類似 WhereGoes）。它能模擬真實瀏覽器行為，精準擷取並視覺化任何網址的完整跳轉路徑，包含傳統的 HTTP 重導向（301/302/307/308）、Meta Refresh，以及複雜的 JavaScript 用戶端導向。

---

## 繁體中文說明 (Traditional Chinese)

### 🌟 核心特色
1. **模擬真實瀏覽器**：使用 Playwright 控制 Headless Chromium，不僅追蹤 HTTP 標頭，還能執行 JavaScript 並擷取用戶端跳轉。
2. **高效能載入優化**：自動攔截並阻止圖片、媒體（影片/音訊）和字型檔的載入，大幅縮短追蹤等待時間，節約頻寬。
3. **動態跳轉判定**：結合網路閒置偵測與緩衝窗口（Settle Window），確保非同步 JS 跳轉執行完畢才結束追蹤。
4. **精美現代化介面**：前端基於 Tailwind CSS，提供響應式佈局、漸層玻璃擬物（Glassmorphism）卡片、即時複製最終網址、以及清晰的跳轉鏈時間軸。
5. **完整 API 支援**：提供結構化的 JSON API，便於整合至其他系統中。
6. **開箱即用 Docker 化**：內建 Playwright 專用的 Dockerfile 與 Compose 設定，解決 Chromium 依賴問題。

### 🛠️ 技術棧
* **後端 (Backend)**: Node.js, Fastify, Playwright (Chromium)
* **前端 (Frontend)**: HTML5, Vanilla JavaScript, Tailwind CSS (via CDN)
* **部署 (Deployment)**: Docker, Docker Compose

---

### 🚀 快速開始

#### 本地開發與執行
請確保您的環境已安裝 Node.js (建議 v18+)。

1. **安裝依賴**：
   ```bash
   npm install
   ```

2. **安裝 Playwright 瀏覽器核心**（若本地未安裝）：
   ```bash
   npx playwright install chromium
   ```

3. **啟動開發伺服器**：
   ```bash
   npm start
   ```
   伺服器預設在 `http://localhost:3000` 啟動。打開瀏覽器即可存取網頁介面。

#### 使用 Docker 部署 (推薦)
Docker 映像檔基於 Playwright 官方運作環境，免去手動配置 Chromium 依賴的繁瑣步驟。

1. **建置並啟動服務**：
   ```bash
   docker-compose up -d --build
   ```

2. **停止服務**：
   ```bash
   docker-compose down
   ```

---

### 🔌 API 說明

#### 1. 追蹤網址跳轉
* **路徑**：`/api/trace`
* **方法**：`GET`
* **查詢參數**：
  * `url` (必填): 要追蹤的完整目標網址（須包含 `http://` 或 `https://`）。
* **回傳範例 (`200 OK`)**：
  ```json
  {
    "final_url": "https://example.com/target-page",
    "input_url": "http://short.url/xyz",
    "redirect_count": 2,
    "chain": [
      {
        "step": 1,
        "url": "http://short.url/xyz",
        "from_url": null,
        "type": "initial",
        "status_code": 301,
        "status_text": "Moved Permanently",
        "method": "GET",
        "duration_ms": 150
      },
      {
        "step": 2,
        "url": "https://intermediate.com/auth",
        "from_url": "http://short.url/xyz",
        "type": "http_redirect",
        "status_code": 302,
        "status_text": "Found",
        "method": "GET",
        "duration_ms": 220
      },
      {
        "step": 3,
        "url": "https://example.com/target-page",
        "from_url": "https://intermediate.com/auth",
        "type": "client_redirect",
        "status_code": 200,
        "status_text": "OK",
        "method": "GET",
        "duration_ms": 350
      }
    ]
  }
  ```

#### 2. 健康檢查
* **路徑**：`/health`
* **方法**：`GET`
* **回傳範例 (`200 OK`)**：
  ```json
  { "ok": true }
  ```

---

### 📂 檔案結構
```text
├── Dockerfile              # Docker 建置設定 (基於 Playwright Ubuntu 映像檔)
├── docker-compose.yml      # Docker Compose 設定檔，配置了 1GB 的 shm 供 Chromium 穩定運行
├── package.json            # 專案依賴與腳本
├── server.js               # Fastify 伺服器與 Playwright 追蹤核心邏輯
└── public/
    └── index.html          # 前端網頁介面 (Tailwind CSS + Vanilla JS)
```

---
---

## English Description

### 🌟 Features
1. **Real Browser Simulation**: Controls Headless Chromium via Playwright, tracing not just HTTP headers but also executing JavaScript and handling client-side redirects.
2. **Performance Optimizations**: Aborts requests for images, media (audio/video), and fonts, significantly speeding up tracer latency and saving bandwidth.
3. **Dynamic Settle Mechanism**: Employs network idle checks combined with a settle window to guarantee asynchronous JS redirects complete before finalizing.
4. **Stunning & Modern UI**: Built with Tailwind CSS, featuring a responsive layout, glassmorphic cards, instant final URL clipboard copying, and a structured vertical timeline of the redirect chain.
5. **Structured JSON API**: Offers a clean developer API ready to be integrated into external services or workflows.
6. **Containerized**: Pre-configured Dockerfile and docker-compose.yml to run headless Playwright seamlessly without dependency issues.

### 🛠️ Tech Stack
* **Backend**: Node.js, Fastify, Playwright (Chromium)
* **Frontend**: HTML5, Vanilla JavaScript, Tailwind CSS (via CDN)
* **Deployment**: Docker, Docker Compose

---

### 🚀 Quick Start

#### Local Development
Make sure you have Node.js installed (v18+ recommended).

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Install Playwright Browsers** (if not already installed on your host):
   ```bash
   npx playwright install chromium
   ```

3. **Start the Application**:
   ```bash
   npm start
   ```
   The application will start on `http://localhost:3000`. Open your browser and navigate to this URL to view the interface.

#### Deploy with Docker (Recommended)
Docker runs the service inside the official Playwright container, eliminating any system-level Chromium dependency issues.

1. **Build and Run**:
   ```bash
   docker-compose up -d --build
   ```

2. **Stop the Service**:
   ```bash
   docker-compose down
   ```

---

### 🔌 API Documentation

#### 1. Trace Redirects
* **Path**: `/api/trace`
* **Method**: `GET`
* **Query Parameters**:
  * `url` (Required): The full URL to trace (must start with `http://` or `https://`).
* **Example Response (`200 OK`)**:
  ```json
  {
    "final_url": "https://example.com/target-page",
    "input_url": "http://short.url/xyz",
    "redirect_count": 2,
    "chain": [
      {
        "step": 1,
        "url": "http://short.url/xyz",
        "from_url": null,
        "type": "initial",
        "status_code": 301,
        "status_text": "Moved Permanently",
        "method": "GET",
        "duration_ms": 150
      },
      {
        "step": 2,
        "url": "https://intermediate.com/auth",
        "from_url": "http://short.url/xyz",
        "type": "http_redirect",
        "status_code": 302,
        "status_text": "Found",
        "method": "GET",
        "duration_ms": 220
      },
      {
        "step": 3,
        "url": "https://example.com/target-page",
        "from_url": "https://intermediate.com/auth",
        "type": "client_redirect",
        "status_code": 200,
        "status_text": "OK",
        "method": "GET",
        "duration_ms": 350
      }
    ]
  }
  ```

#### 2. Health Check
* **Path**: `/health`
* **Method**: `GET`
* **Example Response (`200 OK`)**:
  ```json
  { "ok": true }
  ```

---

### 📂 Directory Structure
```text
├── Dockerfile              # Docker configuration (using Playwright Ubuntu image)
├── docker-compose.yml      # docker-compose setup, configured with 1GB shm for Chromium stability
├── package.json            # Project manifests & start script
├── server.js               # Fastify server & core Playwright trace implementation
└── public/
    └── index.html          # Web UI client (Tailwind CSS & Vanilla JS)
```
