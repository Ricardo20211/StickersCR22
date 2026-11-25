const { downloadContentFromMessage } = require('../utils/baileys');
const webpmux = require('node-webpmux');
const { getMessageContent } = require('../utils/common');
const logger = require('../utils/logger');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function modifyWasMetadata(originalBuf, newName, newPublisher) {
  const buf = Buffer.from(originalBuf);

  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('EOCD no encontrado — no es un ZIP válido');

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdSize   = buf.readUInt32LE(eocdOffset + 12);
  const cdCount  = buf.readUInt16LE(eocdOffset + 8);

  const cdEntries = [];
  let cdPos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(cdPos) !== 0x02014b50) throw new Error('CD entry inválida en ' + cdPos);
    const fnLen      = buf.readUInt16LE(cdPos + 28);
    const extraLen   = buf.readUInt16LE(cdPos + 30);
    const commentLen = buf.readUInt16LE(cdPos + 32);
    const filename   = buf.slice(cdPos + 46, cdPos + 46 + fnLen).toString('utf8');
    cdEntries.push({
      filename,
      compMethod:  buf.readUInt16LE(cdPos + 10),
      crc:         buf.readUInt32LE(cdPos + 16),
      compSize:    buf.readUInt32LE(cdPos + 20),
      uncompSize:  buf.readUInt32LE(cdPos + 24),
      localOffset: buf.readUInt32LE(cdPos + 42),
      cdPos,
      cdEntrySize: 46 + fnLen + extraLen + commentLen,
    });
    cdPos += 46 + fnLen + extraLen + commentLen;
  }

  const target = cdEntries.find(e => e.filename.includes('overridden_metadata'));
  if (!target) throw new Error('overridden_metadata no encontrado en el ZIP');

  const lhOffset   = target.localOffset;
  const lhFlags    = buf.readUInt16LE(lhOffset + 6);
  const hasDD      = !!(lhFlags & 0x0008);
  const lhFnLen    = buf.readUInt16LE(lhOffset + 26);
  const lhExtraLen = buf.readUInt16LE(lhOffset + 28);
  const dataStart  = lhOffset + 30 + lhFnLen + lhExtraLen;

  const origCompData = buf.slice(dataStart, dataStart + target.compSize);
  const origRaw      = target.compMethod === 0
    ? origCompData
    : zlib.inflateRawSync(origCompData);
  const origMeta     = JSON.parse(origRaw.toString());

  const newMeta    = { ...origMeta, 'sticker-pack-name': newName, 'sticker-pack-publisher': newPublisher };
  const newMetaBuf = Buffer.from(JSON.stringify(newMeta), 'utf8');
  const newComp    = target.compMethod === 0
    ? newMetaBuf
    : zlib.deflateRawSync(newMetaBuf, { level: 6 });
  const newCrc    = crc32(newMetaBuf);
  const sizeDelta = newComp.length - target.compSize;

  const prefix = Buffer.from(buf.slice(0, dataStart));
  if (!hasDD) {
    prefix.writeUInt32LE(newCrc,              lhOffset + 14);
    prefix.writeUInt32LE(newComp.length,      lhOffset + 18);
    prefix.writeUInt32LE(newMetaBuf.length,   lhOffset + 22);
  }

  let middle;
  if (hasDD) {
    const nextEntry = dataStart + target.compSize + 16;
    const newDD = Buffer.alloc(16);
    newDD.writeUInt32LE(0x08074b50, 0);
    newDD.writeUInt32LE(newCrc,           4);
    newDD.writeUInt32LE(newComp.length,   8);
    newDD.writeUInt32LE(newMetaBuf.length, 12);
    middle = Buffer.concat([newDD, buf.slice(nextEntry, cdOffset)]);
  } else {
    middle = buf.slice(dataStart + target.compSize, cdOffset);
  }

  const newCdBuf = Buffer.from(buf.slice(cdOffset, cdOffset + cdSize));
  for (const e of cdEntries) {
    const pos = e.cdPos - cdOffset;
    if (e.filename === target.filename) {
      newCdBuf.writeUInt32LE(newCrc,             pos + 16);
      newCdBuf.writeUInt32LE(newComp.length,     pos + 20);
      newCdBuf.writeUInt32LE(newMetaBuf.length,  pos + 24);
    } else if (e.localOffset > target.localOffset) {
      newCdBuf.writeUInt32LE(e.localOffset + sizeDelta, pos + 42);
    }
  }

  const newEocd = Buffer.from(buf.slice(eocdOffset));
  newEocd.writeUInt32LE(cdOffset + sizeDelta, 16);

  return Buffer.concat([prefix, newComp, middle, newCdBuf, newEocd]);
}

async function downloadSticker(stickerMsgObj) {
  const stream = await downloadContentFromMessage(stickerMsgObj, 'sticker');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { buf: Buffer.concat(chunks), meta: stickerMsgObj };
}

function resolveQuotedSticker(message) {
  const m = message.message;

  const contextInfo =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.documentMessage?.contextInfo ||
    m?.audioMessage?.contextInfo;

  const q = contextInfo?.quotedMessage;
  if (!q) return null;

  return (
    q.stickerMessage ||
    q.viewOnceMessage?.message?.stickerMessage ||
    q.ephemeralMessage?.message?.stickerMessage ||
    q.documentWithCaptionMessage?.message?.stickerMessage ||
    null
  );
}

const handler = async (message, sock, reply) => {
  const body    = getMessageContent(message).trim();
  const chat    = message.key.remoteJid;

  const stickerMsg = resolveQuotedSticker(message);
  if (!stickerMsg) {
    return reply('Responde a un sticker con:\n#s-name "paquete" "autor"');
  }

  const match = body.match(/^#s-name\s+[“"]([^“”"]+)[”"]\s+[“"]([^“”"]+)[”"]/i);
  if (!match) {
    return reply('Uso: #s-name "paquete" "autor"\nEjemplo: #s-name "mis stickers" "mi nombre"');
  }

  const newName      = match[1];
  const newPublisher = match[2];

  try {
    const { buf, meta: origMeta } = await downloadSticker(stickerMsg);
    if (!buf || !buf.length) return reply('No se pudo descargar el sticker.');

    let resultBuf;
    let sendMimetype;

    const isZip = buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;

    if (isZip) {
      resultBuf    = modifyWasMetadata(buf, newName, newPublisher);
      sendMimetype = 'application/was';
    } else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
      const img     = new webpmux.Image();
      await img.load(buf);
      const exifData   = { 'sticker-pack-name': newName, 'sticker-pack-publisher': newPublisher };
      const exifBuf    = Buffer.from(JSON.stringify(exifData));
      const exifHeader = Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
      img.exif  = Buffer.concat([exifHeader, exifBuf]);
      resultBuf    = await img.save(null);
      sendMimetype = 'image/webp';
    } else {
      return reply('Formato de sticker no reconocido.');
    }

    const height     = origMeta?.height || 512;
    const width      = origMeta?.width  || 512;
    const isAnimated = sendMimetype === 'application/was';

    await sock.sendMessage(chat, {
      sticker:     resultBuf,
      mimetype:    sendMimetype,
      isAnimated,
      height,
      width,
    }, { quoted: message });

  } catch (e) {
    logger.error(`[s-name] ${e.stack || e.message}`);
    reply('Error al renombrar el sticker.');
  }
};

module.exports = {
  command: '#s-name',
  handler,
};
