const fs = require('fs');
const { execFile } = require('child_process');
const { execFfmpeg } = require('../utils/ffmpegQueue');
const ffmpegPath = require('../utils/ffmpegBin').resolveFfmpegPath();
const { downloadContentFromMessage } = require('../utils/baileys');
const { sendReaction, filepathTemp, getMessageContent, unwrapMessage } = require('../utils/common');
const logger = require('../utils/logger');

const MAX_SECONDS = 5 * 60;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_DOC_BYTES = 100 * 1024 * 1024;
const FFMPEG_TIMEOUT = 300 * 1000;
const MAX_QUEUE = 3;
const SIDE_NORMAL = 720;
const SIDE_HQ = 1920;

const queue = global.__cuadradoQueue || (global.__cuadradoQueue = { tail: Promise.resolve(), pending: 0 });

function enqueue(task) {
  queue.pending++;
  const run = queue.tail.then(task, task);
  queue.tail = run.catch(() => {}).finally(() => { queue.pending--; });
  return run;
}

const MODES = {
  recorte: { aliases: ['recorte', 'recortar', 'crop', 'corte'], label: 'recortado' },
  barras:  { aliases: ['barras', 'bordes', 'negro', 'pad'], label: 'con barras' },
  blur:    { aliases: ['blur', 'fondo', 'difuminado', 'desenfoque'], label: 'con fondo difuminado' },
};

function parseMode(arg) {
  if (!arg) return 'recorte';
  const a = arg.toLowerCase();
  return Object.keys(MODES).find(k => MODES[k].aliases.includes(a)) || null;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFfmpeg(ffmpegPath, args, { timeout: FFMPEG_TIMEOUT, maxBuffer: 20 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        if (err.userMsg) return reject(err);
        const tail = String(stderr || '').trim().split('\n').slice(-3).join(' | ');
        return reject(new Error(`${err.killed ? 'timeout' : err.message} ${tail}`));
      }
      resolve();
    });
  });
}

function probe(inputPath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-hide_banner', '-i', inputPath], { timeout: 30000 }, (_err, _out, stderr) => {
      const info = String(stderr || '');
      const d = info.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const videoLine = info.split('\n').find(l => /Stream #\d+:\d+.*?: Video:/.test(l)) || '';
      const size = videoLine.match(/,\s*(\d{2,5})x(\d{2,5})/);
      resolve({
        hasAudio: /Stream #\d+:\d+.*?: Audio:/.test(info),
        hasVideo: !!videoLine,
        width: size ? Number(size[1]) : 0,
        height: size ? Number(size[2]) : 0,
        seconds: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
      });
    });
  });
}

const even = n => Math.max(2, Math.floor(n / 2) * 2);

function squareSide(info, mode, hq) {
  const base = mode === 'recorte' ? Math.min(info.width, info.height) : Math.max(info.width, info.height);
  return even(Math.min(base || SIDE_NORMAL, hq ? SIDE_HQ : SIDE_NORMAL));
}

function buildFilter(mode, s) {
  if (mode === 'recorte') {
    return `[0:v:0]scale=${s}:${s}:force_original_aspect_ratio=increase,crop=${s}:${s},setsar=1[v]`;
  }
  if (mode === 'barras') {
    return `[0:v:0]scale=${s}:${s}:force_original_aspect_ratio=decrease,` +
      `pad=${s}:${s}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v]`;
  }
  const small = even(s / 4);
  return `[0:v:0]split[a][b];` +
    `[a]scale=${small}:${small}:force_original_aspect_ratio=increase,crop=${small}:${small},` +
    `boxblur=10:2,scale=${s}:${s}[bg];` +
    `[b]scale=${s}:${s}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`;
}

function buildArgs(inputPath, outputPath, mode, side, withAudio, hq) {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-filter_complex', buildFilter(mode, side),
    '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', hq ? '17' : '23', '-pix_fmt', 'yuv420p',
  ];
  if (withAudio) args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', hq ? '256k' : '128k', '-ac', '2');
  else args.push('-an');
  args.push('-movflags', '+faststart', outputPath);
  return args;
}

async function toSquare(inputPath, outputPath, mode, hq) {
  const info = await probe(inputPath);
  if (!info.hasVideo) throw Object.assign(new Error('sin stream de video'), { userMsg: 'El archivo no es un video válido.' });
  if (info.seconds > MAX_SECONDS) {
    throw Object.assign(new Error('video muy largo'), { userMsg: `El video es muy largo (máx. ${MAX_SECONDS / 60} minutos).` });
  }
  const side = squareSide(info, mode, hq);
  await runFfmpeg(buildArgs(inputPath, outputPath, mode, side, info.hasAudio, hq));
  return side;
}

function pickVideo(m) {
  m = unwrapMessage(m);
  if (!m) return null;
  if (m.videoMessage) return { media: m.videoMessage, type: 'video' };
  if (m.documentMessage?.mimetype?.startsWith('video/')) return { media: m.documentMessage, type: 'document' };
  return null;
}

function getVideoSource(message) {
  const m = unwrapMessage(message.message);
  if (!m) return null;
  const own = pickVideo(m);
  if (own) return own;
  const ctx =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo;
  return ctx?.quotedMessage ? pickVideo(ctx.quotedMessage) : null;
}

async function downloadToFile(media, type, filePath, maxBytes) {
  const stream = await downloadContentFromMessage(media, type);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('archivo demasiado grande'), { userMsg: 'El video es demasiado grande.' });
    chunks.push(chunk);
  }
  fs.writeFileSync(filePath, Buffer.concat(chunks));
}

module.exports = {
  command: '#recortar',
  aliases: ['#1:1', '#1x1', '#square'],
  _internals: { parseMode, squareSide, buildFilter, buildArgs, toSquare },
  handler: async (message, sock, reply) => {
    const body   = getMessageContent(message);
    const chat   = message.key.remoteJid;
    const arg    = body.trim().split(/\s+/)[1];

    const usage =
      `Uso: responde a un video con *#recortar [modo]* para dejarlo en 1:1\n` +
      `• *#recortar* — recorta los lados (por defecto)\n` +
      `• *#recortar barras* — video completo con barras negras\n` +
      `• *#recortar blur* — video completo con fondo difuminado\n` +
      `Envíalo como *documento* para recibirlo en alta calidad.`;

    const mode = parseMode(arg);
    if (!mode) return reply(usage);

    const source = getVideoSource(message);
    if (!source) return reply(usage);

    const asDoc    = source.type === 'document';
    const maxBytes = asDoc ? MAX_DOC_BYTES : MAX_BYTES;

    const seconds = Number(source.media.seconds) || 0;
    if (seconds > MAX_SECONDS) return reply(`El video es muy largo (máx. ${MAX_SECONDS / 60} minutos).`);
    const size = Number(source.media.fileLength) || 0;
    if (size > maxBytes) return reply(`El video es demasiado grande (máx. ${maxBytes / 1048576} MB).`);

    if (queue.pending >= MAX_QUEUE) return reply('Hay muchos videos en proceso, intenta en un momento.');

    await sendReaction(sock, message, '⌛');

    const inputPath  = filepathTemp('cuadrado_in', '.mp4');
    const outputPath = filepathTemp('cuadrado_out', '.mp4');

    try {
      let side;
      await enqueue(async () => {
        await downloadToFile(source.media, source.type, inputPath, maxBytes);
        side = await toSquare(inputPath, outputPath, mode, asDoc);
      });

      const caption = `1:1 ${MODES[mode].label} (${side}x${side})`;
      const baseName = (source.media.fileName || 'video').replace(/\.[^.]+$/, '');
      const content = asDoc
        ? { document: fs.readFileSync(outputPath), mimetype: 'video/mp4', fileName: `${baseName}_1x1.mp4`, caption }
        : { video: fs.readFileSync(outputPath), mimetype: 'video/mp4', caption };

      await sock.sendMessage(chat, content, { quoted: message });

      await sendReaction(sock, message, '✅');
    } catch (err) {
      logger.error('[#recortar] Error: ' + err.message);
      await sendReaction(sock, message, '❌');
      const timedOut = /timeout|SIGKILL/i.test(err.message);
      reply(err.userMsg || (timedOut ? 'El video tardó demasiado y se canceló.' : 'Error convirtiendo el video a 1:1.'));
    } finally {
      try { fs.unlinkSync(inputPath); } catch {}
      try { fs.unlinkSync(outputPath); } catch {}
    }
  },
};
