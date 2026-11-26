const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const TEMP_DIR = path.join(__dirname, '..', 'temp');
const MAX_AGE = 2 * 60 * 60 * 1000;
const INTERVAL = 30 * 60 * 1000;

function runCleanup() {
  const now = Date.now();
  let files = 0;
  let bytes = 0;
  let entries;
  try { entries = fs.readdirSync(TEMP_DIR); } catch { return; }
  for (const name of entries) {
    const full = path.join(TEMP_DIR, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (now - st.mtimeMs < MAX_AGE) continue;
    try {
      if (st.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
      else fs.unlinkSync(full);
      files++;
      bytes += st.isDirectory() ? 0 : st.size;
    } catch (e) {
      if (e.code !== 'ENOENT') logger.warn(`[tempCleaner] No se pudo borrar ${full}: ${e.message}`);
    }
  }
  if (files) logger.info(`[tempCleaner] Eliminados ${files} temporales (${(bytes / 1048576).toFixed(1)} MB).`);
}

function startTempCleaner() {
  if (global.__tempCleanerTimer) return;
  try { runCleanup(); } catch (e) { logger.error('[tempCleaner] ' + e.message); }
  global.__tempCleanerTimer = setInterval(() => {
    try { runCleanup(); } catch (e) { logger.error('[tempCleaner] ' + e.message); }
  }, INTERVAL);
  global.__tempCleanerTimer.unref?.();
}

module.exports = { startTempCleaner };
