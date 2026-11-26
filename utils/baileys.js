'use strict';

let baileysPromise;

function loadBaileys() {
  if (!baileysPromise) {
    baileysPromise = import('@whiskeysockets/baileys').catch(error => {
      baileysPromise = null;
      throw error;
    });
  }
  return baileysPromise;
}

const asyncExport = name => async (...args) => {
  const baileys = await loadBaileys();
  return baileys[name](...args);
};

module.exports = {
  downloadContentFromMessage: asyncExport('downloadContentFromMessage'),
  downloadMediaMessage: asyncExport('downloadMediaMessage'),
};
