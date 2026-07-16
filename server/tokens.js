'use strict';

const crypto = require('crypto');

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(secret, payload) {
  const body = encode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + signature;
}

function verify(secret, token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest();
  let actual;
  try {
    actual = Buffer.from(parts[1], 'base64url');
  } catch (_error) {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

function randomToken(bytes) {
  return crypto.randomBytes(bytes || 16).toString('base64url');
}

module.exports = { sign, verify, randomToken };

