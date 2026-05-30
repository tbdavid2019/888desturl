const fs = require('node:fs');
const path = require('node:path');

function loadSqlite3() {
  try {
    return require('sqlite3').verbose();
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return null;
    }

    throw error;
  }
}

function openDatabase(sqlite3, filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(db);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes
      });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row || null);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows || []);
    });
  });
}

function toPublicPreviewUrl(relativePath) {
  if (!relativePath) {
    return null;
  }

  return `/previews/${relativePath.split(path.sep).join('/')}`;
}

function mapHistoryRow(row) {
  return {
    id: row.id,
    created_at: row.created_at,
    input_url: row.input_url,
    final_url: row.final_url,
    client_type: row.client_type,
    request_path: row.request_path,
    redirect_count: row.redirect_count,
    step_count: row.step_count,
    terminated_reason: row.terminated_reason,
    terminated_message: row.terminated_message,
    trace_context: row.trace_context,
    page_title: row.page_title,
    page_excerpt: row.page_excerpt,
    preview_url: toPublicPreviewUrl(row.preview_path),
    security_status: row.security_status,
    security_message: row.security_message,
    security_checked_url: row.security_checked_url,
    threat_types: row.threat_types ? row.threat_types.split(',').filter(Boolean) : [],
    loop_detected: Boolean(row.loop_detected)
  };
}

async function deleteIfExists(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function walkFiles(rootDir) {
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function createNoopStore(options) {
  const { dbPath, previewDir, logger, reason } = options;

  return {
    enabled: false,
    dbPath,
    previewDir,
    reason,
    toPublicPreviewUrl,
    async initialize() {
      logger.warn({ dbPath, reason }, 'SQLite history is disabled');
    },
    async recordTrace() {},
    async getHistory() {
      throw new Error(reason);
    },
    async getStats() {
      throw new Error(reason);
    },
    async cleanup() {
      const retentionMs = Number(options.previewRetentionDays || 7) * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - retentionMs;
      const files = await walkFiles(previewDir);
      for (const filePath of files) {
        const stats = await fs.promises.stat(filePath).catch(() => null);
        if (stats && stats.mtimeMs < cutoff) {
          await deleteIfExists(filePath);
        }
      }
    }
  };
}

async function createHistoryStore(options) {
  const {
    dataDir,
    logger,
    previewRetentionDays = 7,
    historyRetentionDays = 90
  } = options;

  const dbPath = path.join(dataDir, 'history.sqlite');
  const previewDir = path.join(dataDir, 'previews');
  await fs.promises.mkdir(previewDir, { recursive: true });

  const sqlite3 = loadSqlite3();
  if (!sqlite3) {
    return createNoopStore({
      dbPath,
      previewDir,
      logger,
      previewRetentionDays,
      reason:
        "The 'sqlite3' package is not installed yet. Install dependencies in the deployment environment to enable server history and admin stats."
    });
  }

  const db = await openDatabase(sqlite3, dbPath);

  async function initialize() {
    await run(
      db,
      `CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        input_url TEXT NOT NULL,
        final_url TEXT,
        client_type TEXT NOT NULL,
        request_path TEXT NOT NULL,
        redirect_count INTEGER NOT NULL DEFAULT 0,
        step_count INTEGER NOT NULL DEFAULT 0,
        terminated_reason TEXT,
        terminated_message TEXT,
        trace_context TEXT,
        page_title TEXT,
        page_excerpt TEXT,
        preview_path TEXT,
        security_status TEXT NOT NULL DEFAULT 'unknown',
        security_message TEXT,
        security_checked_url TEXT,
        threat_types TEXT,
        loop_detected INTEGER NOT NULL DEFAULT 0
      )`
    );

    await run(db, 'CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC)');
    await run(db, 'CREATE INDEX IF NOT EXISTS idx_history_client_type ON history(client_type)');
    await run(db, 'CREATE INDEX IF NOT EXISTS idx_history_security_status ON history(security_status)');
  }

  async function recordTrace(entry) {
    await run(
      db,
      `INSERT INTO history (
        created_at,
        input_url,
        final_url,
        client_type,
        request_path,
        redirect_count,
        step_count,
        terminated_reason,
        terminated_message,
        trace_context,
        page_title,
        page_excerpt,
        preview_path,
        security_status,
        security_message,
        security_checked_url,
        threat_types,
        loop_detected
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.created_at,
        entry.input_url,
        entry.final_url,
        entry.client_type,
        entry.request_path,
        entry.redirect_count,
        entry.step_count,
        entry.terminated_reason,
        entry.terminated_message,
        entry.trace_context,
        entry.page_title,
        entry.page_excerpt,
        entry.preview_path,
        entry.security_status,
        entry.security_message,
        entry.security_checked_url,
        entry.threat_types.join(','),
        entry.loop_detected ? 1 : 0
      ]
    );
  }

  async function cleanup() {
    const previewCutoffIso = new Date(
      Date.now() - Number(previewRetentionDays) * 24 * 60 * 60 * 1000
    ).toISOString();
    const stalePreviewRows = await all(
      db,
      'SELECT id, preview_path FROM history WHERE preview_path IS NOT NULL AND created_at < ?',
      [previewCutoffIso]
    );

    for (const row of stalePreviewRows) {
      await deleteIfExists(path.join(previewDir, row.preview_path));
      await run(db, 'UPDATE history SET preview_path = NULL WHERE id = ?', [row.id]);
    }

    if (Number(historyRetentionDays) > 0) {
      const historyCutoffIso = new Date(
        Date.now() - Number(historyRetentionDays) * 24 * 60 * 60 * 1000
      ).toISOString();
      const staleHistoryRows = await all(
        db,
        'SELECT id, preview_path FROM history WHERE created_at < ?',
        [historyCutoffIso]
      );

      for (const row of staleHistoryRows) {
        if (row.preview_path) {
          await deleteIfExists(path.join(previewDir, row.preview_path));
        }
      }

      await run(db, 'DELETE FROM history WHERE created_at < ?', [historyCutoffIso]);
    }
  }

  async function getStats() {
    const last7DaysIso = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const total = await get(db, 'SELECT COUNT(*) AS count FROM history');
    const flagged = await get(
      db,
      "SELECT COUNT(*) AS count FROM history WHERE security_status = 'flagged'"
    );
    const avgRedirects = await get(db, 'SELECT AVG(redirect_count) AS value FROM history');
    const clientBreakdown = await all(
      db,
      'SELECT client_type, COUNT(*) AS count FROM history GROUP BY client_type ORDER BY client_type ASC'
    );
    const requestBreakdown = await all(
      db,
      'SELECT request_path, COUNT(*) AS count FROM history GROUP BY request_path ORDER BY count DESC'
    );
    const dailyTrend = await all(
      db,
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
       FROM history
       WHERE substr(created_at, 1, 10) >= ?
       GROUP BY day
       ORDER BY day DESC`,
      [last7DaysIso]
    );
    const latest = await all(
      db,
      `SELECT *
       FROM history
       ORDER BY created_at DESC
       LIMIT 10`
    );

    return {
      total_queries: total ? total.count : 0,
      flagged_queries: flagged ? flagged.count : 0,
      average_redirect_count: avgRedirects && avgRedirects.value ? Number(avgRedirects.value) : 0,
      by_client_type: clientBreakdown,
      by_request_path: requestBreakdown,
      daily_trend: dailyTrend,
      latest: latest.map(mapHistoryRow)
    };
  }

  async function getHistory(options = {}) {
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
    const offset = Math.max(0, Number(options.offset) || 0);
    const clientType =
      options.client_type === 'web' || options.client_type === 'api' ? options.client_type : null;

    const whereSql = clientType ? 'WHERE client_type = ?' : '';
    const params = clientType ? [clientType, limit, offset] : [limit, offset];
    const countParams = clientType ? [clientType] : [];
    const rows = await all(
      db,
      `SELECT *
       FROM history
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );
    const total = await get(
      db,
      `SELECT COUNT(*) AS count
       FROM history
       ${whereSql}`,
      countParams
    );

    return {
      total: total ? total.count : 0,
      limit,
      offset,
      items: rows.map(mapHistoryRow)
    };
  }

  return {
    enabled: true,
    dbPath,
    previewDir,
    toPublicPreviewUrl,
    initialize,
    recordTrace,
    cleanup,
    getStats,
    getHistory
  };
}

module.exports = {
  createHistoryStore,
  toPublicPreviewUrl
};
