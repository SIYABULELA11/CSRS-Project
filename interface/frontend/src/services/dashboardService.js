import { apiGet } from '../config/api';

const CACHE_TTL = 120000;
const cache = new Map();

const getCached = (key, fetcher) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return Promise.resolve(cached.data);
  }
  return fetcher().then((data) => {
    cache.set(key, { data, timestamp: Date.now() });
    return data;
  });
};

export const fetchDashboardBundle = () =>
  getCached('dashboard:bundle:v2', async () => {
    const [
      overview,
      segments,
      cycles,
      migration,
      customerAnalytics,
      productAnalytics,
      geographicAnalytics,
      modelEvaluation,
      artifacts,
      schema,
      filters,
    ] = await Promise.all([
      apiGet('/api/overview'),
      apiGet('/api/segments'),
      apiGet('/api/cycles'),
      apiGet('/api/migration'),
      apiGet('/api/analytics/customers'),
      apiGet('/api/analytics/products'),
      apiGet('/api/analytics/geography'),
      apiGet('/api/model/evaluation/detailed'),
      apiGet('/api/artifacts'),
      apiGet('/api/schema'),
      apiGet('/api/filters'),
    ]);

    return {
      overview,
      segments,
      cycles,
      migration,
      customerAnalytics,
      productAnalytics,
      geographicAnalytics,
      modelEvaluation,
      artifacts,
      schema,
      filters,
    };
  });

export const fetchCustomers = ({
  page = 1,
  pageSize = 20,
  query = '',
  segment = '',
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
