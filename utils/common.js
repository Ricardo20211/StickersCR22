const fs = require('fs');
const path = require('path');

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

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  ).trim();
}

function filepathTemp(prefix, ext = '.tmp') {
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const dir = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

module.exports = { sendReaction, getMessageContent, unwrapMessage, filepathTemp };
