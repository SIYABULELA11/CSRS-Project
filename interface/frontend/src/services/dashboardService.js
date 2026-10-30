import { apiGet } from '../config/api';

const CACHE_TTL = 120000;
const cache = new Map();
const inFlight = new Map();

const getCached = (key, fetcher) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return Promise.resolve(cached.data);
  }
  if (inFlight.has(key)) return inFlight.get(key);
  const pending = Promise.resolve().then(fetcher).then((data) => {
    cache.set(key, { data, timestamp: Date.now() });
    return data;
  }).finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
};

// Keep the small Render service responsive while the dashboard is opening.
const fetchInBatches = async (endpoints, concurrency = 2) => {
  const results = new Array(endpoints.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, endpoints.length) }, async () => {
    while (next < endpoints.length) {
      const index = next++;
      results[index] = await apiGet(endpoints[index]);
    }
  }));
  return results;
};

export const fetchDashboardBundle = () =>
  getCached('dashboard:bundle:v6', async () => {
    const [
      overview,
      segments,
      cycles,
      migration,
      customerAnalytics,
      productAnalytics,
      geographicAnalytics,
      firmographicAnalytics,
      cycleComparisonAnalytics,
      pcaAnalytics,
      modelEvaluation,
      artifacts,
      schema,
      filters,
    ] = await fetchInBatches([
      '/api/overview',
      '/api/segments',
      '/api/cycles',
      '/api/migration',
      '/api/analytics/customers',
      '/api/analytics/products',
      '/api/analytics/geography',
      '/api/analytics/firmographic',
      '/api/analytics/cycle-comparison',
      '/api/analytics/pca?points=none',
      '/api/model/evaluation/detailed',
      '/api/artifacts',
      '/api/schema',
      '/api/filters',
    ]);

    return {
      overview,
      segments,
      cycles,
      migration,
      customerAnalytics,
      productAnalytics,
      geographicAnalytics,
      firmographicAnalytics,
      cycleComparisonAnalytics,
      pcaAnalytics,
      modelEvaluation,
      artifacts,
      schema,
      filters,
    };
  });

export const fetchPcaCycle = (cycle) =>
  getCached(`pca:${cycle}`, () => apiGet(`/api/analytics/pca?cycle=${encodeURIComponent(cycle)}`));

export const fetchCustomers = ({
  page = 1,
  pageSize = 20,
  query = '',
  segment = '',
  cluster = '',
  country = '',
  cycle = '',
} = {}) => {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sortBy: 'Revenue',
    sortOrder: 'desc',
  });
  if (query) params.set('q', query);
  if (segment) params.set('segment', segment);
  if (cluster) params.set('cluster', cluster);
  if (country) params.set('country', country);
  if (cycle) params.set('cycle', cycle);
  return apiGet(`/api/customers?${params.toString()}`);
};

export const fetchCustomerProfile = (customerId) =>
  apiGet(`/api/customers/${encodeURIComponent(customerId)}`);

export const fetchTableRows = (table, page = 1, pageSize = 25) => {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return apiGet(`/api/tables/${encodeURIComponent(table)}?${params.toString()}`);
};

export const clearDashboardCache = () => cache.clear();
