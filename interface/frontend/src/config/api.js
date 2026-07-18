/**
 * API Configuration for CSRS Frontend
 * 
 * This module provides a centralized API client for all backend communication.
 * Uses VITE_API_URL environment variable from .env.local or production .env
 */

const API_URL = import.meta.env.VITE_API_URL || 'https://csrs-project.onrender.com';

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
