'use strict';

function resolveFfmpegPath() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

module.exports = { resolveFfmpegPath };
