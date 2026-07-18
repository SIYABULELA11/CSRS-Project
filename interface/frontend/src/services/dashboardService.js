/**
 * Dashboard Service
 * 
 * Fetches and aggregates data from backend APIs for the simulation dashboards.
 * Handles caching, error handling, and data combination.
 */

import { apiGet } from '../config/api';

const CACHE_TTL = 120000; // 2 minutes
const cache = new Map();

/**
 * Get cached data or fetch if expired
 */
const getCached = (key, fetcher) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return Promise.resolve(cached.data);
  }
  return fetcher().then(data => {
    cache.set(key, { data, timestamp: Date.now() });
    return data;
  });
};

/**
 * Fetch overview data (KPIs, segments, RFM)
 */
export const fetchOverviewData = () =>
  getCached('dashboard:overview', async () => {
    const overview = await apiGet('/api/overview');
    const segments = await apiGet('/api/segments');
    const modelEval = await apiGet('/api/model/evaluation');

    return {
      overview,
      segments,
      modelEval,
    };
  });

/**
 * Fetch detailed segment data
 */
export const fetchSegmentsData = () =>
  getCached('dashboard:segments', async () => {
    const segments = await apiGet('/api/segments');
    const detailedSegments = await Promise.all(
      segments.map(seg => apiGet(`/api/segments/${seg.segment}`))
    );

    return {
      segments,
      detailedSegments,
    };
  });

/**
 * Fetch customer data (paginated)
 */
export const fetchCustomersData = (page = 1, pageSize = 10) =>
  apiGet(`/api/customers?page=${page}&pageSize=${pageSize}`);

/**
 * Fetch individual customer profile
 */
export const fetchCustomerProfile = (customerId) =>
  apiGet(`/api/customers/${customerId}`);

/**
 * Fetch model evaluation metrics
 */
export const fetchModelEvaluation = () =>
  getCached('dashboard:modeleval', async () => {
    const modelEval = await apiGet('/api/model/evaluation');
    return modelEval;
  });

/**
 * Clear cache (useful for manual refresh)
 */
export const clearDashboardCache = () => {
  cache.clear();
};

export default {
  fetchOverviewData,
  fetchSegmentsData,
  fetchCustomersData,
  fetchCustomerProfile,
  fetchModelEvaluation,
  clearDashboardCache,
};
