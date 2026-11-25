'use strict';

const SOUND_STICKER_FIELD = 134;
const FUTURE_PROOF_MESSAGE_FIELD = 1;
const STICKER_FIELD = 26;
const STICKER_AUDIO_FIELD = 26;
const STICKER_PREMIUM_FIELD = 24;
const CONTEXT_INFO_FIELD = 17;
const MEDIA_DOMAIN_INFO_FIELD = 74;
const MEDIA_KEY_DOMAIN_E2EE_CHAT = 1;

const NON_CONTENT_KEYS = new Set(['messageContextInfo', 'senderKeyDistributionMessage']);

function readVarint(buf, pos) {
  let value = 0;
  let mult = 1;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new RangeError('varint truncado');
    const b = buf[pos++];
    value += (b & 0x7f) * mult;
    if (b < 0x80) return [value, pos];
    mult *= 128;
  }
  throw new RangeError('varint demasiado largo');
}

function findField(buf, field) {
  let pos = 0;
  while (pos < buf.length) {
    let tag;
    [tag, pos] = readVarint(buf, pos);
    const num = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) {
      [, pos] = readVarint(buf, pos);
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw new RangeError('campo truncado');
      if (num === field) return buf.subarray(pos, pos + len);
      pos += len;
    } else {
      return null;
    }
  }
  return null;
}

function isEmpty(msg) {
  for (const k of Object.keys(msg)) {
    if (!NON_CONTENT_KEYS.has(k) && msg[k] != null) return false;
  }
  return true;
}

let installed = false;

function installSoundStickerSupport(proto, logger) {
  if (installed || !proto?.Message?.decode) return;
  installed = true;

  const Message = proto.Message;
  const AudioMessage = proto.Message.AudioMessage;
  const originalDecode = Message.decode.bind(Message);

  Message.decode = function decode(reader, length) {
    let raw;
    if (reader instanceof Uint8Array) {
      raw = reader;
    } else if (reader && reader.buf) {
      const end = length === undefined ? reader.len : reader.pos + length;
      raw = reader.buf.subarray(reader.pos, end);
    }

    const msg = originalDecode(reader, length);
    if (!raw || !isEmpty(msg)) return msg;

    try {
      const wrapper = findField(raw, SOUND_STICKER_FIELD);
      if (!wrapper) return msg;
      const innerBytes = findField(wrapper, FUTURE_PROOF_MESSAGE_FIELD);
      if (!innerBytes) return msg;

      const inner = originalDecode(innerBytes);
      if (inner.stickerMessage) {
        const stickerBytes = findField(innerBytes, STICKER_FIELD);
        const audioBytes = stickerBytes && findField(stickerBytes, STICKER_AUDIO_FIELD);
        if (audioBytes) inner.stickerMessage.audioMessage = AudioMessage.decode(audioBytes);
      }

      for (const k of Object.keys(inner)) {
        if (inner[k] != null && msg[k] == null) msg[k] = inner[k];
      }
    } catch (e) {
      logger?.warn?.(`[soundSticker] No se pudo leer el sticker con sonido: ${e.message}`);
    }
    return msg;
  };

  installEncode(proto);
}

const hasOwn = (o, k) => o != null && o[k] != null && Object.prototype.hasOwnProperty.call(o, k);

function installEncode(proto) {
  const { Message } = proto;
  const { StickerMessage, AudioMessage, FutureProofMessage } = Message;

  if (!('audioMessage' in StickerMessage.prototype)) {
    const encodeSticker = StickerMessage.encode.bind(StickerMessage);
    StickerMessage.encode = function encode(m, w) {
      w = encodeSticker(m, w);

      if (hasOwn(m, 'premium')) w.uint32(STICKER_PREMIUM_FIELD * 8 + 0).int32(m.premium);
      if (hasOwn(m, 'audioMessage')) {
        const audio = m.audioMessage;
        AudioMessage.encode(audio, w.uint32(STICKER_AUDIO_FIELD * 8 + 2).fork());

        if (audio.mediaKey && !hasOwn(audio, 'contextInfo')) {
          w.uint32(CONTEXT_INFO_FIELD * 8 + 2).fork()
            .uint32(MEDIA_DOMAIN_INFO_FIELD * 8 + 2).fork()
            .uint32(1 * 8 + 0).int32(MEDIA_KEY_DOMAIN_E2EE_CHAT)
            .uint32(2 * 8 + 2).bytes(audio.mediaKey)
            .ldelim()
            .ldelim();
        }
        w.ldelim();
      }
      return w;
    };
  }

  if (!('audioStickerMessage' in Message.prototype)) {
    const encodeMessage = Message.encode.bind(Message);
    Message.encode = function encode(m, w) {
      w = encodeMessage(m, w);
      if (hasOwn(m, 'audioStickerMessage')) {
        const field = w.uint32(SOUND_STICKER_FIELD * 8 + 2);

        if (m.audioStickerMessage instanceof Uint8Array) field.bytes(m.audioStickerMessage);
        else FutureProofMessage.encode(m.audioStickerMessage, field.fork()).ldelim();
      }
      return w;
    };
  }
}

function isAnimatedWebp(buf) {
  return Buffer.isBuffer(buf) && buf.length > 16 &&
    buf.toString('ascii', 8, 12) === 'WEBP' && buf.indexOf('ANIM', 12, 'ascii') !== -1;
}

let baileysPromise;
const loadBaileys = () => (baileysPromise ||= import('@whiskeysockets/baileys'));

async function sendSoundSticker(sock, jid, { sticker, audio, seconds, waveform }, options = {}) {
  const { generateWAMessageContent, generateWAMessageFromContent, prepareWAMessageMedia } = await loadBaileys();
  const upload = sock.waUploadToServer;

  const [stickerContent, { audioMessage }] = await Promise.all([
    generateWAMessageContent({ sticker }, { upload }),
    prepareWAMessageMedia({ audio, mimetype: 'audio/ogg; codecs=opus' }, { upload }),
  ]);
  if (seconds) audioMessage.seconds = Math.round(seconds);
  if (waveform) audioMessage.waveform = waveform;

  const built = generateWAMessageFromContent(jid, stickerContent, {
    userJid: sock.user?.id,
    quoted: options.quoted,
  });
  const { stickerMessage, messageContextInfo } = built.message;
  stickerMessage.audioMessage = audioMessage;

  stickerMessage.isAnimated = isAnimatedWebp(sticker);
  stickerMessage.stickerSentTs = Date.now();
  stickerMessage.isAvatar = false;
  stickerMessage.isAiSticker = false;
  stickerMessage.isLottie = false;
  stickerMessage.premium = 0;

  const content = Object.create({ stickerMessage });
  content.audioStickerMessage = { message: { stickerMessage } };
  if (messageContextInfo) content.messageContextInfo = messageContextInfo;

  await sock.relayMessage(jid, content, { messageId: built.key.id });
  built.message = { stickerMessage };
  return built;
}

function getStickerAudio(stickerMessage) {
  return stickerMessage?.audioMessage || null;
}

module.exports = { installSoundStickerSupport, getStickerAudio, sendSoundSticker, _findField: findField };
