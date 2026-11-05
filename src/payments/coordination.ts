import { Redis } from "ioredis";
import { config } from "../config.js";

/**
 * Short-lived coordination state shared by gateway processes: in-flight payment
 * locks and per-payer reservations of not-yet-settled spend. Redis when
 * REDIS_URL is set (multiple processes), process memory otherwise (one origin).
 */
export interface Coordination {
  /** Returns false when the key is already held. */
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
  /** Atomically reserve `amount` for `payer` if the result stays within `limit` and `maxCount`. */
  reserve(payer: string, amount: number, limit: number | null, maxCount: number): Promise<boolean>;
  unreserve(payer: string, amount: number): Promise<void>;
  reserved(payer: string): Promise<number>;
  rateLimit(key: string, max: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; resetMs: number }>;
}

class MemoryCoordination implements Coordination {
  private locks = new Map<string, number>();
  private reservations = new Map<string, { amount: number; count: number }>();
  private windows = new Map<string, { count: number; resetAt: number }>();

  async acquire(key: string, ttlMs: number) {
    const now = Date.now();
    const until = this.locks.get(key);
    if (until && until > now) return false;
    this.locks.set(key, now + ttlMs);
    return true;
  }

  async release(key: string) {
    this.locks.delete(key);
  }

  async reserve(payer: string, amount: number, limit: number | null, maxCount: number) {
    const cur = this.reservations.get(payer) ?? { amount: 0, count: 0 };
    if (cur.count + 1 > maxCount) return false;
    if (limit !== null && cur.amount + amount > limit) return false;
    this.reservations.set(payer, { amount: cur.amount + amount, count: cur.count + 1 });
    return true;
  }

  async unreserve(payer: string, amount: number) {
    const cur = this.reservations.get(payer);
    if (!cur) return;
    const next = { amount: Math.max(0, cur.amount - amount), count: Math.max(0, cur.count - 1) };
    if (next.count === 0) this.reservations.delete(payer);
    else this.reservations.set(payer, next);
  }

  async reserved(payer: string) {
    return this.reservations.get(payer)?.amount ?? 0;
  }

  async rateLimit(key: string, max: number, windowMs: number) {
    const now = Date.now();
    const entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      if (this.windows.size > 50_000) {
        for (const [k, v] of this.windows) if (v.resetAt <= now) this.windows.delete(k);
      }
      return { allowed: true, remaining: max - 1, resetMs: windowMs };
    }
    entry.count++;
    return { allowed: entry.count <= max, remaining: Math.max(0, max - entry.count), resetMs: entry.resetAt - now };
  }
}

// Reserve atomically: both the amount and the in-flight count must stay in bounds.
const RESERVE_SCRIPT = `
local amount = tonumber(redis.call('HGET', KEYS[1], 'amount') or '0')
local count = tonumber(redis.call('HGET', KEYS[1], 'count') or '0')
local add = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local maxCount = tonumber(ARGV[3])
if count + 1 > maxCount then return 0 end
if limit >= 0 and amount + add > limit then return 0 end
redis.call('HINCRBY', KEYS[1], 'amount', add)
redis.call('HINCRBY', KEYS[1], 'count', 1)
redis.call('PEXPIRE', KEYS[1], 300000)
return 1`;

const UNRESERVE_SCRIPT = `
redis.call('HINCRBY', KEYS[1], 'amount', -tonumber(ARGV[1]))
local count = redis.call('HINCRBY', KEYS[1], 'count', -1)
if count <= 0 then redis.call('DEL', KEYS[1]) end
return 1`;

class RedisCoordination implements Coordination {
  constructor(private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number) {
    return (await this.redis.set(`mw:lock:${key}`, "1", "PX", ttlMs, "NX")) === "OK";
  }

  async release(key: string) {
    await this.redis.del(`mw:lock:${key}`);
  }

  async reserve(payer: string, amount: number, limit: number | null, maxCount: number) {
    const ok = await this.redis.eval(RESERVE_SCRIPT, 1, `mw:reserve:${payer}`, amount, limit ?? -1, maxCount);
    return Number(ok) === 1;
  }

  async unreserve(payer: string, amount: number) {
    await this.redis.eval(UNRESERVE_SCRIPT, 1, `mw:reserve:${payer}`, amount);
  }

  async reserved(payer: string) {
    return Number((await this.redis.hget(`mw:reserve:${payer}`, "amount")) ?? 0);
  }

  async rateLimit(key: string, max: number, windowMs: number) {
    const redisKey = `mw:rl:${key}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) await this.redis.pexpire(redisKey, windowMs);
    const ttl = await this.redis.pttl(redisKey);
    return { allowed: count <= max, remaining: Math.max(0, max - count), resetMs: ttl > 0 ? ttl : windowMs };
  }
}

function create(): Coordination {
  if (!config.redisUrl) return new MemoryCoordination();
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, connectTimeout: 3000, enableOfflineQueue: false });
  redis.on("error", (err) => console.error("Redis error:", err.message));
  return new RedisCoordination(redis);
}

export const coordination: Coordination = create();

export function createMemoryCoordination(): Coordination {
  return new MemoryCoordination();
}
