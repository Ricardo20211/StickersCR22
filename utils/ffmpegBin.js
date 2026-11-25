'use strict';

const { existsSync } = require('fs');

function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (process.platform !== 'android') {
    try {
      const p = require('ffmpeg-static');
      if (p && existsSync(p)) return p;
    } catch {}
  }
  return 'ffmpeg';
}

module.exports = { resolveFfmpegPath };
