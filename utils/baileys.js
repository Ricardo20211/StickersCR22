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

function installCompat(sock) {
  if (!sock || typeof sock.findUserId === 'function') return sock;
  sock.findUserId = async (jid) => {
    const mapping = sock.signalRepository?.lidMapping;
    if (!jid || !mapping) return null;
    const stripDevice = j => j ? j.replace(/:\d+@/, '@') : null;
    if (jid.endsWith('@lid')) {
      const pn = await mapping.getPNForLID(jid);
      return pn ? { phoneNumber: stripDevice(pn), lid: jid } : null;
    }
    const lid = await mapping.getLIDForPN(jid);
    return { phoneNumber: stripDevice(jid), lid: stripDevice(lid) };
  };
  return sock;
}

module.exports = {
  installCompat,
  downloadContentFromMessage: asyncExport('downloadContentFromMessage'),
  downloadMediaMessage: asyncExport('downloadMediaMessage'),
};
