const fs = require('fs');
const path = require('path');

const OWNERS_FILE = path.join(__dirname, 'owners.json');

const cleanNumber = (n) => String(n || '').replace(/\D/g, '');

function loadSaved() {
  try {
    const list = JSON.parse(fs.readFileSync(OWNERS_FILE, 'utf8'));
    return Array.isArray(list) ? list.map(cleanNumber).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const saved = loadSaved();
const OWNERS = [...new Set([
  ...saved,
  ...String(process.env.OWNER_NUMBERS || '').split(',').map(cleanNumber).filter(Boolean),
])];

function addOwner(number) {
  const n = cleanNumber(number);
  if (!n || saved.includes(n)) return;
  saved.push(n);
  if (!OWNERS.includes(n)) OWNERS.push(n);
  fs.writeFileSync(OWNERS_FILE, JSON.stringify(saved, null, 2));
}

function isOwner(senderId) {
  const normalized = cleanNumber(String(senderId || '').split('@')[0].split(':')[0]);
  return !!normalized && OWNERS.includes(normalized);
}

module.exports = { OWNERS, isOwner, addOwner };
