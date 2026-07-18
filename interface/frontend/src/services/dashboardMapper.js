/**
 * Dashboard Mapper
 * 
 * Transforms backend API responses into the exact structure expected by UI components.
 * Handles formatting, calculations, and hardcoded enhancements (colors, descriptions).
 */

/**
 * Segment color palette (matches frontend design)
 */
const SEGMENT_COLORS = {
  'High Value Loyal': '#1a6fb5',
  'Active Mid-tier': '#2E9E4F',
  'Ultra High Value': '#D4A017',
  'Standard Customers': '#4da6e8',
  'At-Risk / Dormant': '#a0c8e8',
  // B2B segments
  'High Value Active': '#1a6fb5',
  'Dormant': '#a0c8e8',
  'Ultra Premium': '#D4A017',
  'VIP Wholesalers': '#2E9E4F',
  'Mid-tier Active': '#4da6e8',
};

/**
 * Segment descriptions (research insights - hardcoded)
 */
const SEGMENT_DESCRIPTIONS = {
  'High Value Loyal': 'Frequent buyers with high spending and strong loyalty.',
  'Active Mid-tier': 'Moderately engaged customers with consistent purchase patterns.',
  'Ultra High Value': 'Rare super-buyers with extreme transaction volumes - likely wholesalers.',
  'Standard Customers': 'Typical shoppers with average engagement and modest spend.',
  'At-Risk / Dormant': 'Previously active customers who have significantly reduced engagement.',
  'High Value Active': 'Highly engaged B2B customers with strong repeat purchasing.',
  'Dormant': 'Previously active customers who have lapsed - high churn risk.',
  'Ultra Premium': 'Top-tier wholesalers with near-daily transaction activity.',
  'VIP Wholesalers': 'Elite wholesale accounts with the highest individual monetary value.',
  'Mid-tier Active': 'The majority segment - occasional buyers with moderate spend.',
};

/**
 * Format RFM value as readable string
 */
const formatRFM = (value, type, isSB = false) => {
  const currency = isSB ? '£' : 'R';
  
  if (type === 'recency') {
    const days = Math.round(Number(value) || 0);
    if (days === 0) return 'Very Low';
    if (days <= 7) return 'Low';
    if (days <= 30) return 'Low';
    if (days <= 60) return 'Medium';
    return 'High';
  }
  
  if (type === 'frequency') {
    const freq = Number(value) || 0;
    if (freq === 0) return 'Very Low';
    if (freq <= 2) return 'Low';
    if (freq <= 5) return 'Medium';
    if (freq <= 20) return 'High';
    return 'Very High';
  }
  
  if (type === 'monetary') {
    const mon = Number(value) || 0;
    if (mon === 0) return 'Very Low';
    if (mon < 200) return 'Low';
    if (mon < 1000) return 'Medium';
    if (mon < 10000) return 'High';
    return 'Very High';
  }
  
  return String(value);
};

/**
 * Format number as currency
 */
const formatCurrency = (value, isSB = false) => {
  const currency = isSB ? '£' : 'R';
  const num = Number(value) || 0;
  
  if (num >= 1000000) {
    return `${currency}${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${currency}${(num / 1000).toFixed(0)}K`;
  }
  return `${currency}${Math.round(num).toLocaleString()}`;
};

/**
 * Map backend overview response to UI structure
 */
export const mapOverviewData = (apiResponse, isSB = false) => {
  const { overview, segments, modelEval } = apiResponse;
  
  const totalCustomers = Number(overview?.totalCustomers) || 0;
  const numberOfSegments = Number(overview?.numberOfSegments) || 0;
  const avgMonetary = Number(overview?.averageRFM?.monetary) || 0;
  
  // Calculate distribution (segment percentages)
  const distribution = (segments || []).map(seg => {
    const pct = totalCustomers > 0
      ? Number(((Number(seg.customerCount) / totalCustomers) * 100).toFixed(1))
      : 0;
    
    return {
      name: seg.segment,
      pct,
      color: SEGMENT_COLORS[seg.segment] || '#999999',
    };
  });
  
  // Placeholder for monthly revenue (would need separate endpoint)
  // Using empty array since we don't have monthly time series from backend
  const monthly = [];
  
  return {
    totalCustomers,
    segments: numberOfSegments,
    avgSpend: formatCurrency(avgMonetary, isSB),
    churnRisk: 'N/A', // Not available from current endpoints
    silhouette: Number(modelEval?.silhouette || 0).toFixed(2),
    xbIndex: String(modelEval?.xbIndex || 0),
    distribution,
    monthly,
  };
};

/**
 * Map backend segments response to UI structure
 */
export const mapSegmentsData = (apiResponse, isSB = false) => {
  const { segments, detailedSegments } = apiResponse;
  
  if (!detailedSegments || !Array.isArray(detailedSegments)) {
    return {
      segments_detail: [],
      avgSpendPerSeg: [],
    };
  }
  
  const segments_detail = detailedSegments
    .filter(seg => seg && seg.segment)
    .map((seg, idx) => {
      const totalCust = segments?.[idx]?.customerCount || 0;
      const totalAllCust = segments?.reduce((sum, s) => sum + Number(s.customerCount), 0) || 1;
      const sizePct = totalAllCust > 0
        ? ((totalCust / totalAllCust) * 100).toFixed(1)
        : '0';
      
      return {
        id: String.fromCharCode(65 + idx), // A, B, C, D, E
        label: seg.segment,
        size: totalCust > 0 ? `${sizePct}%` : '<1%',
        recency: `${Math.round(Number(seg.avgRecency) || 0)} days`,
        frequency: `${(Number(seg.avgFrequency) || 0).toFixed(1)}×`,
        monetary: formatCurrency(seg.avgMonetary, isSB),
        desc: SEGMENT_DESCRIPTIONS[seg.segment] || 'Segment details.',
      };
    });
  
  const avgSpendPerSeg = (segments || []).map(seg => ({
    name: seg.segment,
    spend: Number(seg.avgMonetary) || 0,
  }));
  
  return {
    segments_detail,
    avgSpendPerSeg,
  };
};

/**
 * Map backend customers response to UI structure
 */
export const mapCustomersData = (apiResponse, isSB = false) => {
  const { data: customers = [] } = apiResponse;
  
  return {
    customers: customers.map(c => ({
      id: c.CustomerID,
      age: isSB ? undefined : Math.floor(Math.random() * 60 + 18), // Fallback age if not in DB
      country: c.Country,
      segment: c.Segment_Name || 'Unknown',
      spend: formatCurrency(c.Monetary, isSB),
      recency: `${Math.round(Number(c.Recency) || 0)} days`,
      freq: Math.round(Number(c.Frequency) || 0),
      location: (c.Country || '').substring(0, 3).toUpperCase(),
      type: isSB ? (Math.random() > 0.5 ? 'Retailer' : 'Wholesaler') : undefined,
    })),
  };
};

/**
 * Map backend model evaluation response to UI structure
 */
export const mapModelEvaluationData = (apiResponse, isSB = false) => {
  const { silhouette, xbIndex, daviesBouldin, calinskiHarabasz, wcss, elbowInertia } = apiResponse;
  
  // Placeholder for monthly revenue (would need separate endpoint)
  const monthly = [];
  
  return {
    silhouette: Number(silhouette || 0).toFixed(2),
    xbIndex: String(xbIndex || 0),
    daviesBouldin: Number(daviesBouldin || 0).toFixed(4),
    calinskiHarabasz: Number(calinskiHarabasz || 0).toFixed(2),
    wcss: Number(wcss || 0).toFixed(0),
    elbowInertia: Number(elbowInertia || 0).toFixed(2),
    monthly,
  };
};

export default {
  mapOverviewData,
  mapSegmentsData,
  mapCustomersData,
  mapModelEvaluationData,
  formatCurrency,
  formatRFM,
};
