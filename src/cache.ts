export const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 100;
/** 60 s in-memory cache with in-flight de-duplication. Holds nothing worth persisting. */
export class Cache {
  private done = new Map<string, { at: number; value: unknown }>();
  private inflight = new Map<string, Promise<unknown>>();
  async get<T>(key: string, now: number, load: () => Promise<T>): Promise<T> {
    const hit = this.done.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.value as T;
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const p = load().then((value) => {
      this.done.delete(key);
      this.done.set(key, { at: now, value });
      while (this.done.size > CACHE_MAX) this.done.delete(this.done.keys().next().value!);
      return value;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
  clear() { this.done.clear(); }
}
