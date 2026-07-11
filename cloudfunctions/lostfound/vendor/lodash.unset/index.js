const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function toPath(path) {
  if (Array.isArray(path)) return path.map(String);
  return String(path || '')
    .replace(/\[(["']?)([^\]"']+)\1\]/g, '.$2')
    .split('.')
    .filter(Boolean);
}

function isSafePath(path) {
  return path.every((key) => !BLOCKED_KEYS.has(key));
}

function unset(object, path) {
  if (object == null || typeof object !== 'object') return true;

  const parts = toPath(path);
  if (!parts.length || !isSafePath(parts)) return false;

  let cursor = object;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor[parts[index]];
    if (cursor == null || typeof cursor !== 'object') return true;
  }

  delete cursor[parts[parts.length - 1]];
  return true;
}

module.exports = unset;
module.exports.default = unset;
