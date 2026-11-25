const fs = require('fs');
const path = require('path');

const URL_REGEX = /https?:\/\/\S+/i;
const FILENAME_UNSAFE = /[^a-zA-Z0-9\s\-_]/g;
const WHITESPACE = /\s+/g;

const FB_BLACKLIST = [
  /facebook\.com\/?$/,
  /facebook\.com\/\?$/,
  /\/events\//,
  /\/groups\/?\d+\/?$/,
  /\/marketplace\//,
  /\/games\//,
  /\/settings/,
  /\/help\//,
  /\/policies\//,
  /\/about\//,
  /\/messages/,
  /\/notifications/,
  /\/search\//,
];

async function sendReaction(sock, message, emoji) {
  try {
    await sock.sendMessage(message.key.remoteJid, {
      react: { text: emoji, key: message.key },
    });
  } catch {}
}

function unwrapMessage(m) {
  for (let i = 0; i < 5 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message ||
      m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

function getMessageContent(message) {
  const m = unwrapMessage(message?.message);
  if (!m) return '';

  if (m.buttonsResponseMessage?.selectedButtonId) {
    return m.buttonsResponseMessage.selectedButtonId;
  }

  if (m.templateButtonReplyMessage?.selectedId) {
    return m.templateButtonReplyMessage.selectedId;
  }

  const nativeParams = m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (nativeParams) {
    try {
      const { id } = JSON.parse(nativeParams);
      if (id) return id;
    } catch {}
  }

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  ).trim();
}

function extractFirstUrl(text) {
  if (!text) return null;
  const m = text.match(URL_REGEX);
  return m ? m[0] : null;
}

function sanitizeFilename(title, fallback = 'file') {
  const base = (title || fallback)
    .replace(FILENAME_UNSAFE, '')
    .trim()
    .replace(WHITESPACE, '_');
  return base.substring(0, 100) || fallback;
}

function isFacebookVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim().toLowerCase();
  if (!u.includes('facebook.com') && !u.includes('fb.watch') && !u.includes('fb.com')) return false;
  return !FB_BLACKLIST.some(re => re.test(u));
}

function mb(bytes) {
  return bytes / 1048576;
}

function filepathTemp(prefix, ext = '.tmp') {
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const dir = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

function parseDuration(str) {
  if (!str) return null;
  const s = str.toLowerCase()
    .replace(/días/g, 'dia')
    .replace(/dias/g, 'dia')
    .replace(/día/g, 'dia')
    .trim();
  let ms = 0;
  const re = /(\d+)\s*(dia|d|h|m)/g;
  let match;
  let found = false;
  while ((match = re.exec(s)) !== null) {
    found = true;
    const n = parseInt(match[1], 10);
    const u = match[2];
    if      (u === 'm')                ms += n * 60_000;
    else if (u === 'h')                ms += n * 3_600_000;
    else if (u === 'd' || u === 'dia') ms += n * 86_400_000;
  }
  return found ? ms : null;
}

function formatDuration(ms) {
  const days  = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins  = Math.floor((ms % 3_600_000)  / 60_000);
  const parts = [];
  if (days)  parts.push(`${days} día${days  > 1 ? 's' : ''}`);
  if (hours) parts.push(`${hours} hora${hours > 1 ? 's' : ''}`);
  if (mins)  parts.push(`${mins} minuto${mins  > 1 ? 's' : ''}`);
  return parts.length ? parts.join(', ') : '0 minutos';
}

module.exports = {
  sendReaction,
  getMessageContent,
  unwrapMessage,
  extractFirstUrl,
  sanitizeFilename,
  isFacebookVideoUrl,
  mb,
  filepathTemp,
  parseDuration,
  formatDuration,
};