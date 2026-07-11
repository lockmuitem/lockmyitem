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

function set(object, path, value) {
  if (object == null || typeof object !== 'object') return object;

  const parts = toPath(path);
  if (!parts.length || !isSafePath(parts)) return object;

  let cursor = object;
  for (let index = 0; index < parts.length; index += 1) {
    const key = parts[index];
    if (index === parts.length - 1) {
      cursor[key] = value;
      return object;
    }

    if (cursor[key] == null || typeof cursor[key] !== 'object') {
      cursor[key] = /^\d+$/.test(parts[index + 1]) ? [] : {};
    }
    cursor = cursor[key];
  }

  return object;
}

module.exports = set;
module.exports.default = set;
