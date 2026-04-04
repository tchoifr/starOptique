export class MemoryCache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  set(key, value, ttlMs) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  getOrSet(key, ttlMs, factory) {
    const hit = this.get(key);
    if (hit !== null) return hit;
    return Promise.resolve(factory()).then((value) => this.set(key, value, ttlMs));
  }

  delete(key) {
    this.store.delete(key);
  }
}

export const cache = new MemoryCache();
