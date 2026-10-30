/**
 * API Configuration for CSRS Frontend
 * 
 * This module provides a centralized API client for all backend communication.
 * Uses VITE_API_URL environment variable from .env.local or production .env
 */

const isLocalBackendOrigin = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)
  && window.location.port === '4000';

// A production bundle can also be served locally by the Express backend. In
// that case, keep API and artifact requests on the page's origin even when the
// build environment contains the hosted Render API URL.
export const API_URL = isLocalBackendOrigin
  ? window.location.origin
  : import.meta.env.VITE_API_URL
    || (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);

/**
 * Create headers for API requests
 */
const getHeaders = () => ({
  'Content-Type': 'application/json',
});

/**
 * Fetch wrapper with error handling
 * @param {string} endpoint - API endpoint (e.g., '/api/segments')
 * @param {object} options - fetch options (method, body, etc.)
 * @returns {Promise} - JSON response from API
 */
export const apiCall = async (endpoint, options = {}) => {
  const url = `${API_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      headers: getHeaders(),
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API Call Failed: ${url}`, error);
    throw error;
  }
};

/**
 * GET request helper
 */
export const apiGet = (endpoint) => apiCall(endpoint, { method: 'GET' });

export const apiAssetUrl = (path) => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
};

/**
 * POST request helper
 */
export const apiPost = (endpoint, data) =>
  apiCall(endpoint, {
    method: 'POST',
    body: JSON.stringify(data),
  });

/**
 * PUT request helper
 */
export const apiPut = (endpoint, data) =>
  apiCall(endpoint, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

/**
 * DELETE request helper
 */
export const apiDelete = (endpoint) => apiCall(endpoint, { method: 'DELETE' });

/**
 * Get the current API URL (useful for debugging)
 */
export const getApiUrl = () => API_URL;

export default apiCall;
