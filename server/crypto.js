const crypto = require('crypto');
const cfg = require('./config');

const KEY = crypto.createHash('sha256').update(cfg.JWT_SECRET).digest();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('base64') + ':' + tag.toString('base64') + ':' + enc.toString('base64');
}

function decrypt(payload) {
  try {
    const [ivB64, tagB64, dataB64] = String(payload).split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

function maskSecret(secret, keep = 14) {
  if (!secret) return '';
  const shown = secret.length > keep ? secret.slice(0, keep) : secret;
  return shown + '••••••••••';
}

module.exports = { encrypt, decrypt, maskSecret };