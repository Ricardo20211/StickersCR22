const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('./logger');

const ROOT = path.join(__dirname, '..');
const MAX_AGE = 2 * 60 * 60 * 1000;
const INTERVAL = 30 * 60 * 1000;
const KEEP_CORRUPT = 3;

const BOT_DIRS = [
  path.join(ROOT, 'temp'),
  path.join(ROOT, 'plugins', 'temp'),
  path.join(ROOT, 'plugins', 'temp_stickers'),
];

const KEEP_IN_BOT_DIRS = /^mcpe_/;

const SYSTEM_TMP_PREFIXES = /^(stk_in_|stk_out_|interact_in_|interact_out_|mega_|manga_|ptt_|insta_)/;

function removeIfOld(full, now, stats) {
  let st;
  try { st = fs.lstatSync(full); } catch { return; }
  if (now - st.mtimeMs < MAX_AGE) return;
  try {
    if (st.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
    else fs.unlinkSync(full);
    stats.files++;
    stats.bytes += st.isDirectory() ? 0 : st.size;
  } catch (e) {
    if (e.code !== 'ENOENT') logger.warn(`[tempCleaner] No se pudo borrar ${full}: ${e.message}`);
  }
}

function cleanDir(dir, filter, now, stats) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (!filter(name)) continue;
    removeIfOld(path.join(dir, name), now, stats);
  }
}

function cleanCorruptDbCopies(stats) {
  let copies;
  try {
    copies = fs.readdirSync(ROOT)
      .filter(n => n.startsWith('database.json.corrupt-'))
      .map(n => ({ n, t: Number(n.split('-').pop()) || 0 }))
      .sort((a, b) => b.t - a.t);
  } catch { return; }
  for (const { n } of copies.slice(KEEP_CORRUPT)) {
    try { fs.unlinkSync(path.join(ROOT, n)); stats.files++; } catch {}
  }
}

function runCleanup() {
  const now = Date.now();
  const stats = { files: 0, bytes: 0 };

  for (const dir of BOT_DIRS) cleanDir(dir, n => !KEEP_IN_BOT_DIRS.test(n), now, stats);
  cleanDir(os.tmpdir(), n => SYSTEM_TMP_PREFIXES.test(n), now, stats);
  cleanCorruptDbCopies(stats);

  if (stats.files) {
    logger.info(`[tempCleaner] Eliminados ${stats.files} temporales (${(stats.bytes / 1048576).toFixed(1)} MB).`);
  }
  return stats;
}

function startTempCleaner() {
  if (global.__tempCleanerTimer) return;
  try { runCleanup(); } catch (e) { logger.error('[tempCleaner] ' + e.message); }
  global.__tempCleanerTimer = setInterval(() => {
    try { runCleanup(); } catch (e) { logger.error('[tempCleaner] ' + e.message); }
  }, INTERVAL);
  global.__tempCleanerTimer.unref?.();
}

module.exports = { startTempCleaner, runCleanup, MAX_AGE };
