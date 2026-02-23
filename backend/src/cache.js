/**
 * Simple in-memory cache with TTL
 * No Redis needed — works fine for a single-server deployment
 */

class Cache {
  constructor() {
    this.store = new Map();
  }

  set(key, value, ttlSeconds) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
      cachedAt: Date.now(),
    });
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.store.delete(key);
  }

  // How old is the cached value in seconds
  age(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    return Math.floor((Date.now() - entry.cachedAt) / 1000);
  }

  // Clear all entries
  flush() {
    this.store.clear();
  }

  // Stats for the /health endpoint
  stats() {
    const now = Date.now();
    let active = 0;
    for (const [, entry] of this.store) {
      if (now < entry.expiresAt) active++;
    }
    return { total: this.store.size, active };
  }
}

module.exports = new Cache();
