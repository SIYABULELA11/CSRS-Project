import NodeCache from "node-cache";
import { env } from "../config/env";

export const cache = new NodeCache({
  stdTTL: env.cacheTtlSeconds,
  checkperiod: Math.max(30, Math.floor(env.cacheTtlSeconds / 2)),
  useClones: false,
});

// These service summaries are read-only. Share concurrent cache fills instead
// of recomputing and cloning the same result for simultaneous page openings.
const inFlight = new Map<string, Promise<unknown>>();

export const getCached = async <T>(key: string, factory: () => Promise<T>): Promise<T> => {
  const hit = cache.get<T>(key);
  if (hit !== undefined) {
    return hit;
  }

  const running = inFlight.get(key);
  if (running) return running as Promise<T>;
  const pending = Promise.resolve().then(factory).then((value) => {
    cache.set(key, value);
    return value;
  }).finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
};
