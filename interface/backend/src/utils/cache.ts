import NodeCache from "node-cache";
import { env } from "../config/env";

export const cache = new NodeCache({
  stdTTL: env.cacheTtlSeconds,
  checkperiod: Math.max(30, Math.floor(env.cacheTtlSeconds / 2)),
});

export const getCached = async <T>(key: string, factory: () => Promise<T>): Promise<T> => {
  const hit = cache.get<T>(key);
  if (hit !== undefined) {
    return hit;
  }

  const value = await factory();
  cache.set(key, value);
  return value;
};
