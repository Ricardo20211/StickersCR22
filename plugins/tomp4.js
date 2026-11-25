const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('../utils/ffmpegBin').resolveFfmpegPath();
const { downloadMediaMessage } = require('../utils/baileys');
const { sendReaction, filepathTemp } = require('../utils/common');
const logger = require('../utils/logger');

ffmpeg.setFfmpegPath(ffmpegPath);

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

function convertToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilter('scale=trunc(iw/2)*2:trunc(ih/2)*2')
      .videoCodec('libx264')
      .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart'])
      .toFormat('mp4')
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

module.exports = {
  command: '#tomp4',
  aliases: ['#stickertovideo', '#s2mp4'],
  handler: async (message, sock, reply) => {
    const chat = message.key.remoteJid;

    const target = getStickerTarget(message);
    if (!target) return reply('Responde a un sticker animado con *#tomp4*.');

    await sendReaction(sock, message, '⏳');

    const inputPath  = filepathTemp('tomp4_in',  '.webp');
    const outputPath = filepathTemp('tomp4_out', '.mp4');

    try {
      const buffer = await downloadMediaMessage(target, 'buffer', {});
      fs.writeFileSync(inputPath, buffer);

      await convertToMp4(inputPath, outputPath);

      await sock.sendMessage(
        chat,
        { video: fs.readFileSync(outputPath), gifPlayback: true },
        { quoted: message }
      );

      await sendReaction(sock, message, '✅');
    } catch (err) {
      logger.error('Error en #tomp4: ' + err.message);
      await sendReaction(sock, message, '❌');
      reply('No se pudo convertir el sticker. Asegúrate de que sea un sticker animado.');
    } finally {
      for (const p of [inputPath, outputPath]) {
        try { fs.unlinkSync(p); } catch {}
      }
    }
  },
};
