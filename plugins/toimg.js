const { downloadMediaMessage } = require('../utils/baileys');
const { sendReaction } = require('../utils/common');
const logger = require('../utils/logger');

function getStickerTarget(message) {
  const m = message.message;
  if (!m) return null;

  if (m.stickerMessage) return message;

  const ctx = m.extendedTextMessage?.contextInfo;
  if (ctx?.quotedMessage?.stickerMessage) {
    return {
      key: {
        remoteJid: message.key.remoteJid,
        id: ctx.stanzaId,
        fromMe: false,
        participant: ctx.participant,
      },
      message: ctx.quotedMessage,
    };
  }
  return null;
}

module.exports = {
  command: '#toimg',
  aliases: ['#stickertoimg', '#s2img'],
  handler: async (message, sock, reply) => {
    const chat = message.key.remoteJid;

    const target = getStickerTarget(message);
    if (!target) return reply('Responde a un sticker con *#toimg*.');

    await sendReaction(sock, message, '⏳');

    try {
      const buffer = await downloadMediaMessage(target, 'buffer', {});
      await sock.sendMessage(chat, { image: buffer }, { quoted: message });
      await sendReaction(sock, message, '✅');
    } catch (err) {
      logger.error('Error en #toimg: ' + err.message);
      await sendReaction(sock, message, '❌');
      reply('No se pudo convertir el sticker.');
    }
  },
};
