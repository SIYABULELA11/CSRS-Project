import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Sankey,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import IconOnly from './assets/iconOnly.png';
import HomeVisual from './assets/oneHero-wide.png';
import ResearchWorkspaceVisual from './assets/customer-consultation.jpg';
import './App.css';
import { apiAssetUrl, apiGet } from './config/api';
import {
  clearDashboardCache,
  fetchCustomerProfile,
  fetchCustomers,
  fetchDashboardBundle,
  fetchPcaCycle,
  fetchTableRows,
} from './services/dashboardService';

const SEGMENTS = [
  'Champions', 'High-Value Regulars', 'Loyalists', 'Valuable Customers at Risk', 'Mid-Tier Occasionals',
  'Occasional Buyers at Risk', 'Light Buyers', 'Light Buyers at Risk', 'Hibernating / Lost',
];
const SEGMENT_COLORS = {
  Champions: '#087F5B', 'High-Value Regulars': '#004D40', Loyalists: '#123B73', 'Valuable Customers at Risk': '#45A6E5',
  'Mid-Tier Occasionals': '#C46A00', 'Occasional Buyers at Risk': '#B84E35',
  'Light Buyers': '#6B3FA0', 'Light Buyers at Risk': '#C86EAB', 'Hibernating / Lost': '#6D7480',
};
const LEGACY_SEGMENT_NAMES = {
  'Champions at Risk': 'Valuable Customers at Risk', 'Loyalist at Risk': 'Valuable Customers at Risk',
  'Mid-Tier Occasional': 'Mid-Tier Occasionals', 'Occasional at Risk': 'Occasional Buyers at Risk',
  Developing: 'Light Buyers', 'Developing at Risk': 'Light Buyers at Risk',
};
const baseProfile = (name) => {
  const text = String(name || '');
  if (text.startsWith('Champions · ')) return 'High-Value Regulars';
  const base = text.split(' · ')[0].replace(/\s*\(CL-[^)]+\)$/, '').trim();
  return LEGACY_SEGMENT_NAMES[base] || base;
};
function segmentColor(name) { return SEGMENT_COLORS[baseProfile(name)] || '#738490'; }
function segmentOrder(name) {
  const base = baseProfile(name);
  const index = SEGMENTS.indexOf(base);
  return index < 0 ? SEGMENTS.length : index;
}
function orderSegmentProfiles(profiles) {
  return [...profiles].sort((left, right) => segmentOrder(left.segment || left.Segment_Name) - segmentOrder(right.segment || right.Segment_Name)
    || String(left.segment || left.Segment_Name).localeCompare(String(right.segment || right.Segment_Name), undefined, { numeric: true }));
}
const fittedRegistry = (data) => data.pcaAnalytics?.clusterRegistry || data.modelEvaluation?.clusterRegistry || data.segments?.clusterRegistry || [];
const orderClusters = (rows) => [...rows].sort((left, right) => Number(left.labelOrder ?? segmentOrder(left.businessProfile)) - Number(right.labelOrder ?? segmentOrder(right.businessProfile)) || Number(left.localIndex) - Number(right.localIndex));
const clusterColor = (cluster) => segmentColor(cluster.displayLabel || cluster.businessProfile);
function ClusterLegend({ clusters }) {
  return <div className="chart-legend-row fitted-cluster-legend">{orderClusters(clusters).map((cluster) => <span key={cluster.stableClusterId} title={cluster.labelRationale}><i style={{ background: clusterColor(cluster) }} />{cluster.displayLabel} · {formatNumber(cluster.hardWinnerCustomers)} current assignments{cluster.isSoftOnly ? ' · soft membership only' : ''}</span>)}</div>;
}
function ClusterProfileTable({ clusters }) {
  return <DataTable rows={orderClusters(clusters)} columns={[
    { key: 'localIndex', label: 'Model cluster', render: value => `Cluster ${Number(value) + 1}` },
    { key: 'displayLabel', label: 'Fitted cluster', render: (value, row) => <span style={{ color: clusterColor(row), fontWeight: 650 }}>{value}</span> },
    { key: 'stableClusterId', label: 'Tracking ID' },
    { key: 'hardWinnerCustomers', label: 'Current fit assignments', render: formatNumber },
    { key: 'fuzzyMembershipMass', label: 'Fuzzy membership mass', render: (value, row) => row.CycleID === 'Cycle_0' ? 'Hard K-means' : formatDecimal(value, 2) },
    { key: 'weightedRecency', label: 'Weighted recency (days)', render: (value) => value == null ? '—' : formatDecimal(value, 1) },
    { key: 'weightedFrequency', label: 'Weighted orders / month', render: (value) => value == null ? '—' : formatDecimal(value, 2) },
    { key: 'weightedMonetary', label: 'Weighted paid sales / month', render: (value) => value == null ? '—' : formatCurrency(value) },
    { key: 'isSoftOnly', label: 'Assignment status', render: (value) => value ? 'Soft membership only; no hard winner' : 'Has current-fit assignments' },
    { key: 'description', label: 'Profile description' },
  ]} />;
}

function ClusterQualityTable({ clusters }) {
  return <DataTable rows={orderClusters(clusters)} columns={[
    { key: 'displayLabel', label: 'Cluster', render: (value, row) => <span style={{color: clusterColor(row), fontWeight: 650}}>{value}</span> },
    { key: 'hardWinnerCustomers', label: 'Assigned customers', render: formatNumber },
    { key: 'meanSilhouette', label: 'Mean silhouette', render: value => value == null ? '—' : formatDecimal(value,3) },
    { key: 'negativeSilhouetteShare', label: 'Negative silhouette share', render: value => value == null ? '—' : formatPercent(value,1) },
    { key: 'meanMaximumMembership', label: 'Mean maximum membership', render: value => value == null ? 'Not applicable' : formatPercent(value,1) },
    { key: 'p95CentreDistance', label: '95th percentile distance', render: value => value == null ? '—' : formatDecimal(value,3) },
    { key: 'hardWithinSumSquares', label: 'Assigned-customer SSE', render: value => value == null ? '—' : formatDecimal(value,3) },
    { key: 'fuzzyObjectiveContribution', label: 'Fuzzy objective contribution', render: value => value == null ? 'Not applicable' : formatDecimal(value,3) },
  ]} />;
}

const GEOGRAPHIC_SEGMENTS = [
  'Largest Revenue Market',
  'Highest Revenue-per-Customer Market',
  'Other Markets',
];

const GEOGRAPHIC_COLORS = {
  'Largest Revenue Market': '#0d6f48',
  'Highest Revenue-per-Customer Market': '#2469a5',
  'Other Markets': '#bb7925',
};

const TRANSITION_STATES = [
  'New',
  'Existing Stable',
  'Existing Migrated',
];

const TRANSITION_COLORS = {
  New: '#377dc1',
  'Existing Stable': '#168a58',
  'Existing Migrated': '#e59a38',
  Inactive: '#85978e',
  Reactivated: '#8a6ec1',
};

const CONFIDENCE_COLORS = {
  'Low confidence': '#bc7728',
  'Moderate confidence': '#377dc1',
  'High confidence': '#168a58',
  'K-means assignment': '#7a818b',
};

const ANALYTICS_PAGES = [
  { id: 'overview', label: 'Overview' },
  { id: 'customers', label: 'Customers' },
  { id: 'segments', label: 'Behavioural' },
  { id: 'static-dynamic', label: 'Static to dynamic' },
  { id: 'comparison', label: 'Cycle comparison' },
  { id: 'dynamics', label: 'Cycle dynamics' },
  { id: 'pca', label: 'PCA segment analysis' },
  { id: 'geography', label: 'Geography' },
  { id: 'firmographic', label: 'Firmographic' },
  { id: 'products', label: 'Products' },
];

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontScale: 1,
  highContrast: false,
  reducedMotion: false,
  colorBlind: false,
};

const currency = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

const formatCurrency = (value, compact = false) => {
  const numericValue = Number(value || 0);
  if (compact && Math.abs(numericValue) >= 1000000) return `£${(numericValue / 1000000).toFixed(2)}m`;
  if (compact && Math.abs(numericValue) >= 1000) return `£${(numericValue / 1000).toFixed(1)}k`;
  return currency.format(numericValue);
};

const formatNumber = (value, compact = false) => {
  const numericValue = Number(value || 0);
  if (compact && Math.abs(numericValue) >= 1000000) return `${(numericValue / 1000000).toFixed(1)}m`;
  if (compact && Math.abs(numericValue) >= 1000) return `${(numericValue / 1000).toFixed(1)}k`;
  return integer.format(numericValue);
};

const formatPercent = (value, decimals = 1) => `${(Number(value || 0) * 100).toFixed(decimals)}%`;
const formatStoredPercent = (value, decimals = 1) => `${Number(value || 0).toFixed(decimals)}%`;
const formatDecimal = (value, decimals = 3) => Number(value || 0).toFixed(decimals);
const formatCandidateXb = (value) => {
  try {
    const scores = typeof value === 'string' ? JSON.parse(value) : value;
    if (!scores || typeof scores !== 'object') return '—';
    return Object.entries(scores)
      .map(([clusterCount, score]) => `K=${clusterCount}: ${score == null ? 'unavailable' : formatDecimal(score, 3)}`)
      .join(' · ');
  } catch {
    return '—';
  }
};
const describeSegmentProfile = (profile) => {
  if (profile.description && profile.description !== 'Customer segment derived from dynamic RFM behaviour.') {
    return profile.description;
  }
  if (profile.segment === 'Champions') return 'Best customers in the observed RFM profiles: recent purchasing with the strongest combination of order frequency and paid-sales value.';
  if (profile.segment === 'Loyalists') return 'Reliable repeat customers with recent purchase activity; the name describes the observed RFM profile.';
  const cycleMeans = `Cycle means: R ${formatDecimal(profile.avgRecency, 1)} days, F ${formatDecimal(profile.avgFrequency, 2)} purchases/month, M ${formatCurrency(profile.avgMonetary)} per month.`;
  if (baseProfile(profile.segment) === 'Valuable Customers at Risk') return `A high-frequency, high-value fitted profile with a longer purchase gap. This is a cluster interpretation; each customer has a separate risk assessment. ${cycleMeans}`;
  if (String(profile.segment || '').startsWith('Mid-Tier Occasional')) return `Customers with occasional purchases and moderate repeat/value behaviour. ${cycleMeans}`;
  if (baseProfile(profile.segment) === 'Hibernating / Lost') return 'The fitted centre describes long purchase gaps, typically more than the 90-day RFM window. This is a weighted cluster interpretation; individual members can differ. Check customer recency and the separate warning before choosing a reactivation action.';
  if (baseProfile(profile.segment) === 'Light Buyers') return `Relatively low-frequency, lower-spending customers who purchased recently; growth is not assumed. ${cycleMeans}`;
  if (baseProfile(profile.segment) === 'High-Value Regulars') return `Strong repeat purchasing and spending with a slightly longer purchase gap than the freshest Champions profile. ${cycleMeans}`;
  if (baseProfile(profile.segment) === 'Light Buyers at Risk') return `A light purchasing profile with a longer purchase gap. ${cycleMeans}`;
  if (baseProfile(profile.segment) === 'Occasional Buyers at Risk') return `Infrequent purchasing with a substantial purchase gap. ${cycleMeans}`;
  return 'A distinct cluster profile summarised from this cycle’s average RFM behaviour.';
};
const cycleLabel = (value) => String(value || '').replace('_', ' ');
const cycleIndex = (value) => Number(String(value || '').match(/\d+/)?.[0] || 0);
const shortCycleLabel = (value) => `C${cycleIndex(value)}`;
const titleFromName = (value) => String(value || '')
  .replace(/\.[^/.]+$/, '')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const pivotSeries = (rows, valueKey, labelKey = 'segment') => {
  const grouped = new Map();
  (rows || []).forEach((row) => {
    const cycle = row.CycleID;
    if (!grouped.has(cycle)) grouped.set(cycle, { cycle: cycleLabel(cycle), cycleId: cycle });
    grouped.get(cycle)[row[labelKey]] = Number(row[valueKey] || 0);
  });
  return [...grouped.values()].sort(
    (left, right) =>
      Number(String(left.cycleId).replace(/\D/g, '')) - Number(String(right.cycleId).replace(/\D/g, '')),
  );
};

const getFigureMeta = (artifact) => {
  const path = String(artifact.relativePath || '').replace(/\\/g, '/').toLowerCase();
  const exact = [
    ['baseline/cycle0_pca_unlabelled.png', 'Cycle 0 PCA before clustering', 'Shows the unlabelled three-component baseline feature space before static K-means segmentation.'],
    ['baseline/cycle0_pca_3d_unlabelled.png', 'Cycle 0 three-component PCA', 'Shows the unlabelled three-component baseline feature space in three dimensions.'],
    ['baseline/cycle0_elbow_wcss.png', 'Cycle 0 elbow and WCSS', 'Plots within-cluster sum of squares for K=2–10 and marks the elbow-selected K.'],
    ['baseline/cycle0_silhouette_by_k.png', 'Cycle 0 silhouette by K', 'Shows silhouette evidence across the same K candidates; it supports but does not override the WCSS elbow.'],
    ['baseline/cycle0_pca_clusters.png', 'Cycle 0 behavioural clusters', 'Shows the baseline behavioural customer groups in the fitted PCA feature space.'],
    ['baseline/rfm_log_transformation.png', 'RFM log transformation', 'Compares raw and log-transformed recency, frequency, and monetary distributions.'],
    ['dynamic/customer_transition_states.png', 'Customer assignment states', 'Shows new customers and whether returning customers retain or change fitted tracking IDs. Purchase activity is tracked separately.'],
    ['dynamic/segment_evolution_cycles_0_9.png', 'Behavioural segment evolution', 'Tracks the cumulative behavioural segment population from Cycle 0 to Cycle 9.'],
    ['dynamic/centroid_movement_cycles_0_9.png', 'PCA centroid movement by named profile', 'One panel per approved name, using actual fitted centres. Solid links retain the tracking ID; dashed links change ID. C0–C9 label genuine observations and absent profiles leave gaps.'],
    ['dynamic/fitted_centroid_movement_cycles_0_9.png', 'PCA centroid movement by tracking ID', 'Actual fitted centres linked by their provisional tracking IDs. Labels and colours reflect each cycle’s approved profile name; creation and retirement leave real gaps.'],
    ['validation/evaluation_metrics_cycles_0_9.png', 'Behavioural evaluation: Cycle 0 to Cycle 9', 'Measured silhouette, DB, CH, maximum membership, Xie–Beni and migration. Fuzzy measures and migration start in Cycle 1; there is no Cycle 10.'],
    ['validation/evaluation_metrics_cycles_1_9.png', 'Dynamic evaluation: Cycles 1–9', 'Six reference-style panels show the measured dynamic results. Migration is a descriptive movement measure, and maximum membership is not a calibrated probability.'],
    ['validation/evaluation_cycle0_kmeans.png', 'Cycle 0 K-means validation', 'WCSS elbow and silhouette-by-K evidence accompany the static baseline silhouette, DB, CH and inertia. Fuzzy metrics do not apply.'],
    ['validation/evaluation_geographic_market.png', 'Geographic market validation', 'Country-market silhouette, DB, CH and fixed-centre SSE, with market count and occupied groups shown separately as context.'],
    ['validation/xie_beni_index.png', 'Xie-Beni fuzzy validity', 'Tracks fuzzy cluster compactness and separation, where lower values indicate stronger validity.'],
    ['validation/dynamic_model_quality.png', 'Dynamic MDFCM validity and customer-movement diagnostics', 'Shows all five dynamic quality measures—Silhouette, Davies–Bouldin, Calinski–Harabasz, Xie–Beni, and mean maximum membership—plus comparable-customer migration as a separate movement diagnostic.'],
    ['geographic/cycle9_market_segments.png', 'Cycle 9 geographic market segments', 'Shows the geographic segment assigned to each country market using commercial and behavioural composition features.'],
    ['geographic/market_segment_evolution.png', 'Geographic market segment evolution', 'Tracks the country-level market segmentation from Cycle 0 to Cycle 9.'],
    ['firmographic/cycle9_firmographic_segments.png', 'Cycle 9 firmographic segments', 'Combines behavioural customer segments with geographic market segments.'],
    ['geographic segmentation/output.png', 'Market size vs product diversity', 'Compares customer scale with product breadth across countries.'],
    ['geographic segmentation/output2.png', 'Revenue per customer by market', 'Highlights smaller markets with unusually high customer value.'],
    ['geographic segmentation/output3.png', 'Product diversity by market', 'Ranks markets by the number of distinct products purchased.'],
    ['geographic segmentation/output4.png', 'Segment evolution across markets', 'Tracks behavioural composition across cycles in five major markets.'],
    ['geographic segmentation/output5.png', 'Segment composition by market', 'Compares the proportional segment mix across geographic markets.'],
    ['geographic segmentation/output6.png', 'Geographic revenue contribution', 'Shows the concentration of revenue across country markets.'],
    ['geographic segmentation/output7.png', 'Customer base by market', 'Ranks markets by unique customer count.'],
    ['geographic segmentation/output8.png', 'Average order value by country', 'Identifies countries with the highest average order values.'],
  ].find(([suffix]) => path.endsWith(suffix));

  if (exact) return { title: exact[1], description: exact[2] };

  const title = titleFromName(artifact.name);
  const descriptions = {
    'Revenue By Segment': 'Compares total revenue contribution across customer segments.',
    'Average Customer Revenue': 'Shows how average customer value differs by behavioural segment.',
    'Customer Value Matrix': 'Positions segments by customer value and commercial opportunity.',
    'Segment Product Heatmap': 'Shows product purchasing patterns by the behavioural profiles present in the selected cycle.',
    'Transition Heatmap': 'Summarises source-to-destination customer movements.',
    'Transition Percentage Heatmap': 'Normalises transition flows for easier segment comparison.',
    'Segment Evolution': 'Tracks changes in segment population across successive cycles.',
    'Membership Confidence': 'Shows the distribution of fuzzy membership certainty.',
    'Silhouette': 'Tracks cluster cohesion and separation across dynamic cycles.',
    'Davies Bouldin': 'Tracks average cluster similarity; lower values indicate clearer separation.',
    'Calinski Harabasz': 'Tracks between-cluster separation relative to within-cluster dispersion.',
  };
  return {
    title,
    description: descriptions[title] || 'Research output generated by the dynamic customer segmentation model.',
  };
};

function ChartTooltip({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((entry) => (
        <span key={entry.dataKey || entry.name} style={{ color: entry.color }}>
          {entry.name}: {valueFormatter ? valueFormatter(entry.value, entry.name) : number.format(Number(entry.value || 0))}
        </span>
      ))}
    </div>
  );
}

function ProductScatterTooltip({ active, payload }) {
  const product = payload?.[0]?.payload;
  if (!active || !product) return null;
  return (
    <div className="chart-tooltip">
      <strong>{product.product}</strong>
      <span>Revenue: {formatCurrency(product.revenue)}</span>
      <span>Quantity: {formatNumber(product.quantity)}</span>
      <span>Customer interactions: {formatNumber(product.customerInteractions)}</span>
    </div>
  );
}

function FittedCentroidPlot({ clusterId, points, profileName }) {
  const last = points.at(-1);
  const segment = profileName || last?.displayLabel || clusterId;
  const color = last ? clusterColor(last) : '#738490';
  const width = 520;
  const height = 335;
  const bounds = { left: 66, right: 492, top: 35, bottom: 282 };
  const domain = (key) => {
    const values = points.map((point) => Number(point[key]));
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const pad = Math.max((maximum - minimum) * 0.18, 0.025);
    return [minimum - pad, maximum + pad];
  };
  const xDomain = points.length ? domain('PC1') : [0, 1];
  const yDomain = points.length ? domain('PC2') : [0, 1];
  const x = (value) => bounds.left + (Number(value) - xDomain[0]) / (xDomain[1] - xDomain[0]) * (bounds.right - bounds.left);
  const y = (value) => bounds.bottom - (Number(value) - yDomain[0]) / (yDomain[1] - yDomain[0]) * (bounds.bottom - bounds.top);
  const positioned = points.map((point) => ({ ...point, x: x(point.PC1), y: y(point.PC2) }));
  const placedLabels = [];
  const labels = positioned.map((point) => {
    const candidates = [14, 28, 42, 56].flatMap((radius) => [
      [radius, -12], [-radius, -12], [radius, 18], [-radius, 18], [0, -radius], [0, radius],
    ]).map(([dx, dy]) => ({ x: Math.max(bounds.left + 12, Math.min(bounds.right - 12, point.x + dx)), y: Math.max(bounds.top, Math.min(bounds.bottom - 2, point.y + dy)) }));
    const penalty = (label) => placedLabels.reduce((total, other) => total + (Math.abs(label.x - other.x) < 29 && Math.abs(label.y - other.y) < 17 ? 1000 : 0), 0)
      + positioned.reduce((total, other) => total + (Math.abs(label.x - other.x) < 19 && Math.abs(label.y - other.y) < 13 ? 100 : 0), 0)
      + Math.hypot(label.x - point.x, label.y - point.y);
    const label = candidates.reduce((best, candidate) => penalty(candidate) < penalty(best) ? candidate : best);
    placedLabels.push(label);
    return label;
  });
  const observed = new Set(points.map((point) => cycleIndex(point.CycleID)));
  const missing = Array.from({ length: 10 }, (_, index) => index).filter((index) => !observed.has(index));
  return (
    <section className="centroid-mini-panel family-centroid-panel">
      <h4 style={{ color }}>{segment}<span>{profileName ? 'Profile-name view' : clusterId}<br />{points.length} fitted cycle{points.length === 1 ? '' : 's'} / 10</span></h4>
      {points.length ? (
        <svg className="family-centroid-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${segment} fitted centre positions across observed cycles. ${missing.length ? `Missing: ${missing.map((index) => `C${index}`).join(', ')}.` : 'C0 through C9.'}`}>
          {Array.from({ length: 5 }, (_, index) => {
            const fraction = index / 4;
            const tickX = bounds.left + fraction * (bounds.right - bounds.left);
            const tickY = bounds.bottom - fraction * (bounds.bottom - bounds.top);
            return <g key={index} className="centroid-axis">
              <line x1={tickX} x2={tickX} y1={bounds.top} y2={bounds.bottom} className="centroid-grid-line" />
              <line x1={bounds.left} x2={bounds.right} y1={tickY} y2={tickY} className="centroid-grid-line" />
              <text x={tickX} y={bounds.bottom + 20} textAnchor="middle">{formatDecimal(xDomain[0] + fraction * (xDomain[1] - xDomain[0]), 2)}</text>
              <text x={bounds.left - 11} y={tickY + 4} textAnchor="end">{formatDecimal(yDomain[0] + fraction * (yDomain[1] - yDomain[0]), 2)}</text>
            </g>;
          })}
          <path d={`M${bounds.left},${bounds.top}V${bounds.bottom}H${bounds.right}`} fill="none" className="centroid-axis-line" />
          <text className="centroid-axis-title" x={(bounds.left + bounds.right) / 2} y={height - 12} textAnchor="middle">PC1</text>
          <text className="centroid-axis-title" transform={`translate(17 ${(bounds.top + bounds.bottom) / 2}) rotate(-90)`} textAnchor="middle">PC2</text>
          {positioned.slice(1).map((point, index) => cycleIndex(point.CycleID) === cycleIndex(positioned[index].CycleID) + 1 && (
            <line key={`path-${point.CycleID}`} x1={positioned[index].x} y1={positioned[index].y} x2={point.x} y2={point.y} stroke={color} strokeWidth="2.5" strokeDasharray={profileName && point.stableClusterId !== positioned[index].stableClusterId ? '6 4' : undefined} opacity="0.72" />
          ))}
          {positioned.map((point, index) => (
            <g key={point.CycleID} className="family-centroid-point" tabIndex="0">
              <title>{`${segment} · ${cycleLabel(point.CycleID)} · ${point.stableClusterId}\n${formatNumber(point.hardWinnerCustomers)} current-fit assignments\nFuzzy mass ${formatDecimal(point.fuzzyMembershipMass, 2)}\nPC1 ${formatDecimal(point.PC1, 4)}, PC2 ${formatDecimal(point.PC2, 4)}, PC3 ${formatDecimal(point.PC3, 4)}\nR ${formatDecimal(point.weightedRecency, 1)} days; F ${formatDecimal(point.weightedFrequency, 2)}/month; M ${formatCurrency(point.weightedMonetary)}/month\n${point.CycleID === 'Cycle_0' ? 'Static K-means centre' : 'Fitted MDFCM centre'}\n${point.displayLabel}`}</title>
              <line x1={point.x} y1={point.y} x2={labels[index].x} y2={labels[index].y - 4} stroke={clusterColor(point)} strokeWidth="0.65" opacity="0.45" />
              <circle cx={point.x} cy={point.y} r="5" fill={clusterColor(point)} stroke="var(--surface)" strokeWidth="1.5" />
              <text x={labels[index].x} y={labels[index].y} textAnchor="middle" className="centroid-cycle-label">{shortCycleLabel(point.CycleID)}</text>
            </g>
          ))}
        </svg>
      ) : <EmptyState title="No fitted centre recorded" detail="The current registry has no fitted centre for this tracking ID." />}
      {missing.length > 0 && <p className="centroid-missing-note">{profileName ? 'No fitted centre with this name in' : 'Not fitted under this tracking ID in'}: {missing.map((index) => `C${index}`).join(', ')}. Missing positions are left empty.</p>}
    </section>
  );
}

function Panel({ title, eyebrow, action, className = '', children }) {
  return (
    <section className={`panel ${className}`}>
      {(title || eyebrow || action) && (
        <div className="panel-header">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            {title && <h3>{title}</h3>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function PageTitle({ eyebrow, title, description, action }) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function MetricCard({ label, value, detail, tone = 'green' }) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <div className="metric-top">
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function SegmentBadge({ segment }) {
  return (
    <span
      className="segment-badge"
      style={{
        color: segmentColor(segment) || '#315549',
      }}
    >
      <i style={{ background: segmentColor(segment) || '#315549' }} />
      {segment}
    </span>
  );
}

function StatusPill({ children, tone = 'neutral' }) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

function EmptyState({ title = 'No results available', detail }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}

function DataTable({ columns, rows, onRowClick, compact = false }) {
  if (!rows?.length) return <EmptyState />;
  return (
    <div className={`table-scroll ${compact ? 'table-compact' : ''}`}>
      <table>
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={row.id || (row.CustomerID ? `${row.CycleID || ''}-${row.CustomerID}` : `${rowIndex}-${JSON.stringify(row).slice(0, 20)}`)}
              onClick={() => onRowClick?.(row)}
              className={onRowClick ? 'clickable-row' : ''}
            >
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render ? column.render(row[column.key], row) : String(row[column.key] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MigrationSankey({ rows }) {
  const labels = orderSegmentProfiles([...new Set((rows || []).flatMap((row) => [row.fromSegment, row.toSegment]).filter(Boolean))].map((segment) => ({ segment }))).map((row) => row.segment);
  const sankeyData = useMemo(() => {
    const nodes = [
      ...labels.map((segment) => ({ name: `${segment} source` })),
      ...labels.map((segment) => ({ name: `${segment} destination` })),
    ];
    const links = (rows || [])
      .map((row) => ({
        source: labels.indexOf(row.fromSegment),
        target: labels.indexOf(row.toSegment) + labels.length,
        value: Number(row.count || 0),
      }))
      .filter((link) => link.source >= 0 && link.target >= labels.length && link.value > 0);
    return { nodes, links };
  }, [rows, labels]);

  if (!sankeyData.links.length) return <EmptyState title="No migration flows available" />;
  return (
    <div className="chart-xl sankey-chart">
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={sankeyData}
          dataKey="value"
          nodePadding={28}
          nodeWidth={14}
          linkCurvature={0.56}
          margin={{ top: 20, right: 170, bottom: 20, left: 170 }}
        >
          <Tooltip formatter={(value) => [`${formatNumber(value)} customers`, 'Flow']} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}

function PcaPointTooltip({ active, payload }) {
  const point = payload?.find((entry) => entry?.payload)?.payload;
  if (!active || !point) return null;
  return <div className="chart-tooltip">
    <strong>{point.isCentroid ? point.displayLabel : `Customer ${point.CustomerID}`}</strong>
    <span>{point.isCentroid ? 'Actual fitted centre' : point.segment}</span>
    <span>Tracking ID: {point.stableClusterId}</span>
    <span>PC1 {formatDecimal(point.PC1, 3)} · PC2 {formatDecimal(point.PC2, 3)} · PC3 {formatDecimal(point.PC3, 3)}</span>
    {point.isCentroid ? <span>{formatNumber(point.hardWinnerCustomers)} current assignments · fuzzy mass {formatDecimal(point.fuzzyMembershipMass, 2)}</span> : <>
      <span>{point.assignmentType || point.activityStatus} · last fitted {cycleLabel(point.lastFittedCycle || point.CycleID)}</span>
      <span>{point.CycleID === 'Cycle_0' ? 'Hard K-means assignment' : `${point.assignmentType === 'retained historical' ? 'Retained' : 'Current'} maximum membership ${formatPercent(point.membership)}`}</span>
    </>}
  </div>;
}

function Pca3DPlot({ points, clusters = [] }) {
  const [yaw, setYaw] = useState(38);
  const [pitch, setPitch] = useState(24);
  const projected = useMemo(() => {
    const plotted = [...(points || []), ...clusters.map((row) => ({ ...row, isCentroid: true, segment: row.displayLabel, color: clusterColor(row) }))];
    if (!plotted.length) return [];
    const dimensions = ['PC1', 'PC2', 'PC3'];
    const ranges = Object.fromEntries(dimensions.map((dimension) => {
      const values = plotted.map((point) => Number(point[dimension] || 0));
      return [dimension, { min: Math.min(...values), max: Math.max(...values) }];
    }));
    const commonSpan = Math.max(...dimensions.map((dimension) => ranges[dimension].max - ranges[dimension].min)) || 1;
    const normalise = (value, dimension) => {
      const range = ranges[dimension];
      return ((Number(value || 0) - (range.min + range.max) / 2) / commonSpan) * 2;
    };
    const yawRadians = (yaw * Math.PI) / 180;
    const pitchRadians = (pitch * Math.PI) / 180;
    return plotted.map((point) => {
      const coordinateX = normalise(point.PC1, 'PC1');
      const coordinateY = normalise(point.PC2, 'PC2');
      const coordinateZ = normalise(point.PC3, 'PC3');
      const rotatedX = coordinateX * Math.cos(yawRadians) + coordinateZ * Math.sin(yawRadians);
      const rotatedDepth = -coordinateX * Math.sin(yawRadians) + coordinateZ * Math.cos(yawRadians);
      const rotatedY = coordinateY * Math.cos(pitchRadians) - rotatedDepth * Math.sin(pitchRadians);
      const depth = coordinateY * Math.sin(pitchRadians) + rotatedDepth * Math.cos(pitchRadians);
      return {
        ...point,
        screenX: 380 + rotatedX * 170,
        screenY: 205 - rotatedY * 170,
        depth,
      };
    }).sort((left, right) => left.depth - right.depth);
  }, [points, clusters, yaw, pitch]);
  const axisDirections = useMemo(() => {
    const y = yaw * Math.PI / 180;
    const p = pitch * Math.PI / 180;
    return [['PC1', 1, 0, 0], ['PC2', 0, 1, 0], ['PC3', 0, 0, 1]].map(([name, x, vertical, z]) => {
      const rotatedX = x * Math.cos(y) + z * Math.sin(y);
      const depth = -x * Math.sin(y) + z * Math.cos(y);
      const rotatedY = vertical * Math.cos(p) - depth * Math.sin(p);
      return { name, x: 95 + rotatedX * 55, y: 330 - rotatedY * 55 };
    });
  }, [yaw, pitch]);

  return (
    <div className="pca-3d-wrap">
      <svg viewBox="0 0 760 410" role="img" aria-label="Interactive three dimensional PCA segment view">
        {axisDirections.map((axis) => <g key={axis.name}><line x1="95" y1="330" x2={axis.x} y2={axis.y} className="pca-axis" /><text x={axis.x + 7} y={axis.y - 5}>{axis.name}</text></g>)}
        {projected.map((point) => point.isCentroid ? (
          <polygon key={`centre-${point.stableClusterId}`} points={`${point.screenX},${point.screenY - 8} ${point.screenX + 8},${point.screenY} ${point.screenX},${point.screenY + 8} ${point.screenX - 8},${point.screenY}`} fill={point.color} stroke="var(--text)" strokeWidth="1.2">
            <title>{`${point.displayLabel} · ${point.stableClusterId} · fitted centre · ${formatNumber(point.hardWinnerCustomers)} hard winners · fuzzy mass ${formatDecimal(point.fuzzyMembershipMass, 2)}`}</title>
          </polygon>
        ) : (
          <circle
            key={`${point.CycleID}-${point.CustomerID}`}
            cx={point.screenX}
            cy={point.screenY}
            r={3.4 + ((point.depth + 1) / 2) * 1.8}
            fill={point.color || segmentColor(point.businessProfile || point.segment)}
            fillOpacity="0.72"
          >
            <title>{`${point.segment} | customer ${point.CustomerID} | tracking ID ${point.stableClusterId || 'not assigned'} | highest membership ${formatPercent(point.membership, 1)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="pca-controls">
        <label>Horizontal rotation<input type="range" min="-70" max="70" value={yaw} onChange={(event) => setYaw(Number(event.target.value))} /></label>
        <label>Vertical rotation<input type="range" min="-45" max="45" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /></label>
      </div>
      <ClusterLegend clusters={clusters} />
    </div>
  );
}

function ModelComputationVisuals({ explainedVariance = [] }) {
  const varianceByComponent = Object.fromEntries(
    explainedVariance.map((item) => [item.component, item.percentage]),
  );
  const varianceLabel = (component) => Number.isFinite(Number(varianceByComponent[component]))
    ? `${formatDecimal(varianceByComponent[component], 2)}%`
    : '—';
  return (
    <div className="computation-grid">
      <Panel title="RFM feature construction to PCA" eyebrow="Dimension reduction">
        <div className="pca-computation">
          <div className="feature-stack">
            <span>log R</span><span>log F</span><span>log M</span>
            <span>RF</span><span>RM</span><span>FM</span>
          </div>
          <b>→</b>
          <div className="pca-core"><strong>PCA</strong><span>Fitted on Cycle 0</span></div>
          <b>→</b>
          <div className="component-stack">
            <span><strong>PC1</strong>{varianceLabel('PC1')}</span>
            <span><strong>PC2</strong>{varianceLabel('PC2')}</span>
            <span><strong>PC3</strong>{varianceLabel('PC3')}</span>
          </div>
        </div>
        <p className="panel-note">R, F, and M are transformed with log1p; RF, RM, and FM multiply those logged values. All six features are Min–Max scaled before PCA. The Cycle 0 scaler and PCA model are reused across cycles. Higher raw recency means a longer purchase gap; RF and RM are model interactions, not standalone business quality scores.</p>
      </Panel>
      <Panel title="Dynamic segmentation computation" eyebrow="Cycle processing">
        <div className="dynamic-computation">
          {[
            ['1', 'All observed customer snapshots'],
            ['2', 'MDFCM condition checks'],
            ['3', 'Replace prior mass for refitted customers'],
            ['4', 'Incremental movement or permitted K alternatives'],
            ['5', 'Membership, Xie–Beni, and validation'],
          ].map(([step, label], index) => (
            <div key={step}><span>{step}</span><strong>{label}</strong>{index < 4 && <b>→</b>}</div>
          ))}
        </div>
        <p className="panel-note">Every observed customer is refitted from the same 90-day RFM window. Overlapping windows replace that customer’s old observation and mass rather than adding a duplicate. Cycle 0 scaling and PCA are reused.</p>
      </Panel>
    </div>
  );
}

function LoadingView() {
  return (
    <div className="loading-view">
      <img src={IconOnly} alt="" />
      <div className="loading-mark"><span /><span /><span /></div>
      <strong>Preparing customer analytics</strong>
      <p>Loading model results and research outputs.</p>
    </div>
  );
}

function ErrorView({ message, onRetry }) {
  return (
    <div className="error-view">
      <h2>The analytics service could not be reached</h2>
      <p>{message}</p>
      <button className="button button-primary" onClick={onRetry}>Try again</button>
    </div>
  );
}

function HomePage({ data, setPage }) {
  const overview = data.overview;
  const latestSegments = orderSegmentProfiles(overview.latestSegments || []);
  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="home-copy">
          <span className="hero-kicker">Customer Segmentation in the Retail Sector</span>
          <h1>Firmographic customer segmentation built from <em>behaviour and geography.</em></h1>
          <p>
            Explore one integrated framework combining dynamic behavioural RFM segmentation with
            geographic market segmentation, customer value, migration, products, and model quality.
          </p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={() => setPage('overview')}>
              Open analytics <span>→</span>
            </button>
            <button className="button button-secondary" onClick={() => setPage('research')}>
              View research figures
            </button>
          </div>
          <div className="hero-proof">
            <span><b>{formatNumber(overview.numberOfSegments ?? 4)}</b> core RFM families</span>
            <span><b>{formatNumber(overview.countries)}</b> geographic markets</span>
            <span><b>1</b> firmographic view</span>
          </div>
        </div>
        <div className="home-visual">
          <img
            className="home-visual-subject"
            src={HomeVisual}
            alt="Customer celebrating a retail insight on a tablet"
            loading="eager"
            fetchPriority="high"
          />
          <div className="visual-card visual-card-top">
            <span>Latest cycle</span>
            <strong>{cycleLabel(overview.latestCycle?.CycleID)}</strong>
            <small>{formatNumber(overview.latestCycle?.CustomersProcessed)} customers processed</small>
          </div>
          <div className="visual-card visual-card-bottom">
            <i />
            <div>
              <span>Model status</span>
              <strong>{formatNumber(data.modelEvaluation?.averages?.convergedCycles)} / {formatNumber(data.modelEvaluation?.averages?.dynamicCycles)} dynamic cycles converged</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="home-metrics">
        <MetricCard label="Customer records" value={formatNumber(overview.totalCustomers)} detail="Unique customer profiles" />
        <MetricCard label="Study-period paid sales" value={formatCurrency(overview.totalRevenue, true)} detail="December 2010–November 2011; returns excluded" tone="gold" />
        <MetricCard label="Products observed" value={formatNumber(overview.products)} detail={overview.productScope || 'Distinct product descriptions in Cycles 1–9'} tone="blue" />
        <MetricCard label="Analytical cycles" value={formatNumber(overview.numberOfCycles)} detail="Baseline plus dynamic updates" tone="purple" />
      </section>

      <section className="home-story section-wrap">
        <div className="story-copy">
          <span className="eyebrow">Firmographic framework</span>
          <h2>Behavioural segmentation + geographic segmentation</h2>
          <p>
            In this research, firmographic segmentation combines dynamic RFM and fuzzy membership
            patterns with the geographic markets where customers make purchases. The result
            is a location-aware view of customer value, movement, and commercial opportunity.
          </p>
          <p className="panel-note">Current fitted clusters are listed from the model registry with distinct labels and tracking IDs. Customer risk warnings are separate from cluster categories; every observed customer is refitted at each snapshot.</p>
          <button className="text-link" onClick={() => setPage('segments')}>Explore segment profiles <span>→</span></button>
        </div>
        <div className="segment-snapshot">
          {latestSegments.map((segment) => (
            <div className="snapshot-row" key={segment.Segment_Name}>
              <div>
                <SegmentBadge segment={segment.Segment_Name} />
                <small>{formatNumber(segment.Customers)} customers</small>
              </div>
              <strong>{formatCurrency(segment.Revenue, true)}</strong>
              <span>{formatCurrency(segment.Revenue_Per_Customer)} per customer</span>
            </div>
          ))}
        </div>
      </section>

      <section className="home-capabilities section-wrap">
        <div className="capability-intro">
          <div className="capability-heading">
            <span className="eyebrow">Research workspace</span>
            <h2>From customer-level evidence to strategic action</h2>
          </div>
          <div className="capability-visual">
            <img
              src={ResearchWorkspaceVisual}
              alt="Business professionals discussing strategic customer evidence"
              loading="lazy"
            />
          </div>
        </div>
        <div className="capability-grid">
          {[
            ['Customer analytics', 'Search customers, compare value bands, confidence, baskets, products, and full cycle history.', 'customers'],
            ['Behavioural movement', 'Investigate migration rates, transition flows, segment stability, and confidence over time.', 'dynamics'],
            ['Geographic intelligence', 'Explore clustered market types, customer value, product breadth, revenue, and behavioural composition.', 'geography'],
            ['Firmographic analytics', 'Combine customer behaviour with geographic market segments for retailer-facing action.', 'firmographic'],
          ].map(([title, description, target]) => (
            <button className="capability-card" key={title} onClick={() => setPage(target)}>
              <h3>{title}</h3>
              <p>{description}</p>
              <b>Explore →</b>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function OverviewPage({ data }) {
  const overview = data.overview;
  const segmentRows = orderSegmentProfiles(data.segments.segments || []);
  const latestCycle = overview.latestCycle || {};
  const revenueTrend = (overview.revenueByCycle || []).map((row) => ({
    cycle: cycleLabel(row.CycleID),
    revenue: Number(row.Revenue || 0),
    customers: Number(row.Customers || 0),
  }));
  const pieData = segmentRows.map((segment) => ({
    name: segment.segment,
    value: Number(segment.customerCount || 0),
  }));
  const totalLatestRevenue = segmentRows.reduce((total, segment) => total + Number(segment.revenue || 0), 0);
  const champion = segmentRows.find((segment) => segment.segment === 'Champions');

  return (
    <>
      <PageTitle
        eyebrow="Firmographic segmentation overview"
        title="Behavioural and geographic intelligence dashboard"
        description="An integrated firmographic view of behavioural segments, geographic markets, customer value, commercial performance, and model quality."
        action={<StatusPill tone="success">● Data connected</StatusPill>}
      />

      <div className="metric-grid metric-grid-six">
        <MetricCard label="Customers" value={formatNumber(overview.totalCustomers)} detail={`${formatNumber(overview.analysedCustomers)} observed dynamically`} />
        <MetricCard label="Study-period paid sales" value={formatCurrency(overview.totalRevenue, true)} detail="December 2010–November 2011; returns excluded" tone="gold" />
        <MetricCard label="Average basket" value={formatCurrency(overview.averageBasketValue)} detail="Customer-cycle average" tone="blue" />
        <MetricCard label="Orders" value={formatNumber(overview.orders)} detail="Distinct invoices" tone="purple" />
        <MetricCard label="Confidence" value={formatPercent(overview.averageMembership)} detail="Latest cycle’s fitted customers" tone="teal" />
        <MetricCard label="Markets" value={formatNumber(overview.countries)} detail="Countries represented" tone="red" />
      </div>

      <div className="content-grid two-one">
        <Panel title="Gross paid sales across cycles" eyebrow="Returns and cancellations excluded">
          <p className="panel-note">Actual cycle sales total the full study period. Cycle 0 combines December 2010–February 2011 (three months); Cycles 1–9 each cover one month. The baseline point is therefore a longer sales period.</p>
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueTrend} margin={{ top: 12, right: 16, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#168a58" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#168a58" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="cycle" />
                <YAxis tickFormatter={(value) => formatCurrency(value, true)} width={64} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                <Area type="monotone" dataKey="revenue" name="Positive paid sales" stroke="#168a58" strokeWidth={3} fill="url(#revenueGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Latest segment mix" eyebrow={cycleLabel(data.segments.latestCycle)}>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3}>
                  {pieData.map((entry) => <Cell key={entry.name} fill={segmentColor(entry.name)} />)}
                </Pie>
                <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} customers`} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <strong>{formatNumber(latestCycle.CustomersProcessed)}</strong>
              <span>customers</span>
            </div>
          </div>
          <div className="legend-list">
            {pieData.map((entry) => (
              <div key={entry.name}>
                <span><i style={{ background: segmentColor(entry.name) }} />{entry.name}</span>
                <b>{formatNumber(entry.value)}</b>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="content-grid equal">
        <Panel title="Latest segment sales" eyebrow="Positive paid sales only">
          <div className="chart-medium">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={segmentRows} layout="vertical" margin={{ top: 4, right: 18, left: 30, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => formatCurrency(value, true)} />
                <YAxis type="category" dataKey="segment" width={122} tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                <Bar dataKey="revenue" name="Positive paid sales" radius={[0, 6, 6, 0]}>
                  {segmentRows.map((entry) => <Cell key={entry.segment} fill={segmentColor(entry.segment)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Latest model health" eyebrow={cycleLabel(latestCycle.CycleID)}>
          <div className="quality-grid">
            <div><span>Silhouette score</span><strong>{number.format(latestCycle.SilhouetteScore)}</strong><small>Cluster separation</small></div>
            <div><span>Davies-Bouldin</span><strong>{number.format(latestCycle.DaviesBouldinScore)}</strong><small>Lower is better</small></div>
            <div><span>Average confidence</span><strong>{formatPercent(latestCycle.AverageMembership)}</strong><small>Fuzzy membership</small></div>
            <div><span>Convergence</span><strong>{latestCycle.Converged ? 'Achieved' : 'Review'}</strong><small>{formatNumber(latestCycle.Iterations)} iterations</small></div>
          </div>
          <div className="insight-banner">
            <span>Key reading</span>
            <p>
              Champions represent {formatPercent(Number(champion?.revenue || 0) / (totalLatestRevenue || 1))}
              {' '}of latest-cycle revenue from {formatPercent(Number(champion?.customerCount || 0) / Number(latestCycle.CustomersProcessed || 1))}
              {' '}of customers.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}

function CustomerProfileModal({ customerId, selectedCycle, clusterRegistry = [], onClose }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetchCustomerProfile(customerId)
      .then((response) => active && setProfile(response))
      .catch((requestError) => active && setError(requestError.message));
    return () => { active = false; };
  }, [customerId]);

  const history = (profile?.history || []).map((row) => ({
    cycle: cycleLabel(row.CycleID),
    revenue: Number(row.Revenue || 0),
    membership: Number(row.Average_Membership || 0),
  }));
  const selected = profile?.history?.find((row) => row.CycleID === selectedCycle)
    || profile?.history?.at(-1);
  const membershipRows = (() => {
    try {
      return JSON.parse(selected?.Membership_Details || '[]');
    } catch {
      return [];
    }
  })();

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="profile-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close profile">×</button>
        {!profile && !error && <LoadingView />}
        {error && <EmptyState title="Customer profile unavailable" detail={error} />}
        {profile && (
          <>
            <div className="profile-heading">
              <div className="avatar">{String(customerId).slice(-2)}</div>
              <div>
                <span className="eyebrow">Customer profile</span>
                <h2>Customer {customerId}</h2>
                <p>{profile.customer?.Country || 'Market unavailable'} · {cycleLabel(selected?.CycleID)} selected · {profile.history.length} observed cycles</p>
              </div>
              {selected && <SegmentBadge segment={selected.assignedClusterLabel || selected.Segment_Name} />}
            </div>
            <div className="profile-kpis">
              <div><span>Recency</span><strong>{formatNumber(selected?.Recency)} days</strong></div>
              <div><span>90-day orders / 3</span><strong>{formatDecimal(selected?.Frequency, 2)} / month equivalent</strong></div>
              <div><span>90-day paid sales / 3</span><strong>{formatCurrency(selected?.Monetary)}</strong></div>
              <div><span>Assigned cluster</span><strong>{selected?.assignedClusterLabel || 'Unavailable'}</strong></div>
              <div><span>Purchase activity</span><strong>{selected?.Activity_Status || 'Unavailable'}</strong></div>
              <div><span>Individual recency status</span><strong>{selected?.Lifecycle_Status || 'Unavailable'}</strong><small>Separate from the fitted cluster’s weighted profile.</small></div>
              <div><span>Assignment basis</span><strong>{selected?.Assignment_Mode || 'Baseline fit'}</strong></div>
              <div><span>Assignment last fitted</span><strong>{cycleLabel(selected?.lastFittedCycle)}</strong><small>{selected?.assignmentType}{selected?.assignmentType === 'retained historical' && !selected?.currentPrimaryStillFitted ? ' · primary ID retired from current fit' : ''}</small></div>
              <div><span>Risk label</span><strong>{selected?.Risk_Status || 'Not assessed'}</strong><small>{selected?.Risk_Reasons || 'No stored risk comparison for this cycle.'}</small></div>
            </div>
            <Panel title={selected?.CycleID === 'Cycle_0' ? 'Cycle 0 cluster assignment' : 'Current fuzzy membership'} eyebrow={`${cycleLabel(selected?.CycleID)} · ${selected?.CycleID === 'Cycle_0' ? 'one-hot K-means assignment' : 'percentages across all segments'}`}>
              <div className="membership-list">
                {membershipRows.length ? membershipRows.map((item) => (
                  <div className="membership-row" key={`${item.stable_cluster_id}-${item.cluster_index}`}>
                    <div className="membership-label"><span>{clusterRegistry.find((row) => row.CycleID === selected.assignmentCycle && row.stableClusterId === item.stable_cluster_id)?.displayLabel || `${item.segment_name} (${item.stable_cluster_id})`}</span><strong>{formatPercent(Number(item.membership || 0))}</strong></div>
                    <div className="membership-track"><span style={{ width: `${Math.max(0, Math.min(100, Number(item.membership || 0) * 100))}%` }} /></div>
                    <small>{item.stable_cluster_id || `Cluster ${Number(item.cluster_index) + 1}`}</small>
                  </div>
                )) : <EmptyState title="Membership details unavailable" detail="The selected cycle has no stored membership vector." />}
              </div>
              <p className="method-copy">Cycle 0 uses static K-means, so its one-hot membership vector records one hard assignment. Cycles 1–9 use MDFCM fuzzy memberships: each percentage is the customer’s degree of membership in a fitted cluster, and the profile shown at the top is the largest-membership cluster.</p>
              {selected?.assignmentType === 'retained historical' && <p className="method-copy">This vector was last fitted in {cycleLabel(selected.lastFittedCycle)} and has been retained. It is not a fresh current-cycle confidence measurement. Its historical IDs do not increase the current fitted cluster count.</p>}
            </Panel>
            <Panel title="Customer history across cycles" eyebrow="Previous and current cycle assignments">
              <div className="profile-kpis profile-kpis-secondary">
                <div><span>Previous cycle</span><strong>{cycleLabel(selected?.PreviousCycleID)}</strong></div>
                <div><span>Previous segment</span><strong>{selected?.Previous_Segment_Name || 'Baseline / new'}</strong></div>
                <div><span>Previous / current cluster tracking ID</span><strong>{selected?.Previous_Stable_Cluster_ID || '—'} → {selected?.Stable_Cluster_ID || '—'}</strong></div>
                <div><span>Transition</span><strong>{selected?.Transition_Status || 'Baseline'}</strong></div>
                <div><span>Movement explanation</span><strong>{selected?.Migration_Cause || 'Baseline assignment'}</strong></div>
              </div>
              <p className="method-copy">This customer-level history compares the largest-membership profile and tracking ID from one cycle with the next. A changed profile can reflect changed RFM behaviour, a changed cluster boundary, or the model’s best-fit cluster matching. Tracking IDs are provisional: matches must meet the recorded centre-distance and membership-overlap rules.</p>
            </Panel>
            <Panel title="Customer value history" eyebrow="Cycle progression">
              <p className="panel-note">Sales show actual cycle totals. Cycle 0 covers three months; Cycles 1–9 each cover one month. The RFM paid-sales feature above is a monthly equivalent of the preceding 90-day sales total divided by three, so it differs from a commercial cycle total.</p>
              <div className="chart-medium">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <CartesianGrid strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="cycle" />
                    <YAxis tickFormatter={(value) => formatCurrency(value, true)} />
                    <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                    <Area dataKey="revenue" name="Cycle paid sales" type="monotone" stroke="#168a58" fill="#168a5825" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Highest-value products" eyebrow="Purchase affinity">
              <DataTable
                compact
                rows={profile.topProducts}
                columns={[
                  { key: 'product', label: 'Product' },
                  { key: 'orders', label: 'Orders', render: formatNumber },
                  { key: 'quantity', label: 'Quantity', render: formatNumber },
                  { key: 'revenue', label: 'Revenue', render: (value) => formatCurrency(value) },
                ]}
              />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

function CustomersPage({ data }) {
  const [analytics, setAnalytics] = useState(data.customerAnalytics);
  const [filters, setFilters] = useState({
    query: '',
    segment: '',
    cluster: '',
    country: '',
    cycle: analytics.latestCycle || '',
  });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedCustomerCycle, setSelectedCustomerCycle] = useState('');
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const allCycles = filters.cycle === 'All';
  const analyticsMatchesCycle = (analytics.cycle || analytics.latestCycle) === filters.cycle;
  const observationLabel = allCycles ? 'customer-cycle records' : 'customers';
  const riskRows = orderSegmentProfiles(analytics.riskByCluster || []);
  const currentRiskRows = riskRows.filter((row) => row.currentPrimaryStillFitted !== false);
  const historicalRiskRows = riskRows.filter((row) => row.currentPrimaryStillFitted === false);
  const customerClusterChoices = [...(data.filters.clusters || [])].filter((row) => allCycles || cycleIndex(row.CycleID) <= cycleIndex(filters.cycle)).sort((left, right) => cycleIndex(right.CycleID) - cycleIndex(left.CycleID)).filter((row, index, rows) => rows.findIndex((other) => other.value === row.value) === index);
  const currentClusterChoices = customerClusterChoices.filter((row) => allCycles || row.CycleID === filters.cycle);

  useEffect(() => {
    let active = true;
    setAnalyticsLoading(true);
    setAnalyticsError('');
    apiGet(`/api/analytics/customers?cycle=${encodeURIComponent(filters.cycle)}`)
      .then((response) => { if (active) setAnalytics(response); })
      .catch((requestError) => { if (active) setAnalyticsError(requestError.message); })
      .finally(() => { if (active) setAnalyticsLoading(false); });
    return () => { active = false; };
  }, [filters.cycle]);

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      setLoading(true);
      setError('');
      fetchCustomers({ page, pageSize: 18, ...filters })
        .then((response) => active && setResult(response))
        .catch((requestError) => active && setError(requestError.message))
        .finally(() => active && setLoading(false));
    }, 180);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [page, filters]);

  const updateFilter = (key, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value, ...(key === 'cycle' ? { cluster: '' } : {}) }));
  };

  return (
    <>
      <PageTitle
        eyebrow="Customer analytics"
        title="Understand every customer through behaviour"
        description="Explore customer value, basket behaviour, segment membership, and cycle history. Sales values include positive paid transactions only and exclude returns and cancellations."
      />
      <p className="panel-note">Choose a cycle in the customer explorer to update these summaries. “All cycles” shows a customer once per observed cycle; record counts include repeated customers across time. Sales, orders, products, and quantities are actual cycle totals: Cycle 0 spans three months and Cycles 1–9 each span one month. RFM frequency and paid-sales rates use the exact preceding 90 days, divided by three to give monthly equivalents. Search, segment, and country filters apply to the explorer table. Hover over a risk label or open a customer to see the recorded reason.</p>
      {analyticsLoading && <div className="inline-loading">Updating cycle summaries…</div>}
      {analyticsError && <EmptyState title="Cycle summaries unavailable" detail={analyticsError} />}
      {analyticsMatchesCycle && !analyticsError && <>
      <div className="metric-grid metric-grid-four">
        <MetricCard label={allCycles ? 'Customer-cycle records' : 'Customers'} value={formatNumber(analytics.summary.customers)} detail={allCycles ? `${formatNumber(analytics.summary.uniqueCustomers)} unique customers across ${formatNumber(analytics.summary.cycles)} cycles` : cycleLabel(filters.cycle)} />
        <MetricCard label="Average positive paid sales" value={formatCurrency(analytics.summary.averageRevenue)} detail={allCycles ? 'Per customer-cycle record' : 'Per customer in selected cycle'} tone="gold" />
        <MetricCard label="Mean customer basket value" value={formatCurrency(analytics.summary.averageBasketValue)} detail="Mean across records; zero for no current orders" tone="blue" />
        <MetricCard label="Mean max membership" value={filters.cycle === 'Cycle_0' || analytics.summary.averageMembership == null ? '—' : formatPercent(analytics.summary.averageMembership)} detail={filters.cycle === 'Cycle_0' ? 'Hard K-means assignments' : 'All fitted customer snapshots; excludes Cycle 0'} tone="purple" />
      </div>

      <div className="content-grid equal">
        <Panel title="Customer value distribution" eyebrow={allCycles ? 'All cycles · customer-cycle records' : cycleLabel(filters.cycle)}>
          <div className="chart-medium">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.valueBands}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="band" />
                <YAxis />
                <Tooltip content={<ChartTooltip valueFormatter={(value, name) => name === 'Revenue' ? formatCurrency(value) : formatNumber(value)} />} />
                <Bar dataKey="customers" name={allCycles ? 'Customer-cycle records' : 'Customers'} fill="#168a58" radius={[7, 7, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Membership confidence" eyebrow="Membership concentration">
          <div className="confidence-layout">
            <ResponsiveContainer width="48%" height={220}>
              <PieChart>
                <Pie data={analytics.confidenceBands} dataKey="customers" nameKey="band" innerRadius={58} outerRadius={88} paddingAngle={3}>
                  {analytics.confidenceBands.map((entry) => (
                    <Cell key={entry.band} fill={CONFIDENCE_COLORS[entry.band] || '#7a818b'} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} ${observationLabel}`} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="confidence-copy">
              {analytics.confidenceBands.map((entry) => (
                <div key={entry.band}>
                  <i style={{ background: CONFIDENCE_COLORS[entry.band] || '#7a818b' }} />
                  <span>{entry.band}</span>
                  <strong>{formatNumber(entry.customers)}</strong>
                </div>
              ))}
              <p>Lower membership values indicate a less distinct fuzzy assignment. Cycle 0’s hard K-means assignments are shown separately and do not measure fuzzy certainty.</p>
            </div>
          </div>
        </Panel>
      </div>
      <Panel title="Customer risk warnings by assigned cluster" eyebrow={allCycles ? 'All cycles · customer-cycle comparisons' : cycleLabel(filters.cycle)}>
        <p className="panel-note">{analytics.riskMethod || 'Customer warnings compare current and previous fitted memberships, 90-day purchase rates, and individual recency using the saved study rules.'} The warning percentage combines At risk and Slipping customers among assessed observations. Lost customers are shown separately and excluded from that denominator. These are descriptive warning rules, not churn probabilities.</p>
        <div className="chart-medium">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={currentRiskRows} layout="vertical" margin={{ left: 20, right: 30 }}>
              <CartesianGrid strokeDasharray="3 6" horizontal={false} />
              <XAxis type="number" domain={[0, 1]} tickFormatter={(value) => formatPercent(value, 0)} />
              <YAxis type="category" dataKey="segment" width={190} tick={{ fontSize: 11 }} />
              <Tooltip content={<ChartTooltip valueFormatter={(value) => value == null ? 'Not assessed' : formatPercent(value)} />} />
              <Bar dataKey="atRiskRate" name="At risk or slipping / assessed" radius={[0, 4, 4, 0]}>{currentRiskRows.map((row) => <Cell key={`${row.stableClusterId}-${row.segment}`} fill={segmentColor(row.segment)} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="panel-note">Rows use actual assigned cluster IDs. A cluster name containing “at Risk” describes its weighted profile; the customer warning is assessed for the individual. Purchase gaps of 31–60 days receive At risk, 61–90 days Slipping, and more than 90 days Lost. Earlier deterioration can also trigger At risk. Historical retired assignments, if present in an older run, are listed separately.</p>
        <DataTable rows={currentRiskRows} columns={[
          { key: 'segment', label: 'Assigned cluster', render: (value) => <SegmentBadge segment={value} /> },
          { key: 'customers', label: allCycles ? 'Records' : 'Customers', render: formatNumber },
          { key: 'assessedCustomers', label: 'Assessed', render: formatNumber },
          { key: 'atRiskCustomers', label: 'At risk or slipping', render: formatNumber },
          { key: 'slippingCustomers', label: 'Of these: slipping', render: (value) => value == null ? '—' : formatNumber(value) },
          { key: 'lostCustomers', label: 'Lost', render: (value) => value == null ? '—' : formatNumber(value) },
          { key: 'atRiskRate', label: 'Warning rate / assessed', render: (value) => value == null ? 'Not assessed' : formatPercent(value) },
        ]} />
        {historicalRiskRows.length > 0 && <details className="historical-cluster-details"><summary>{historicalRiskRows.length} historical retired-cluster assignments</summary><DataTable rows={historicalRiskRows} columns={[
          { key: 'segment', label: 'Historical assigned cluster' }, { key: 'customers', label: allCycles ? 'Records' : 'Customers', render: formatNumber }, { key: 'atRiskCustomers', label: 'Individual warnings', render: formatNumber }, { key: 'atRiskRate', label: 'Warning rate / assessed', render: (value) => value == null ? 'Not assessed' : formatPercent(value) },
        ]} /></details>}
      </Panel>
      </>}

      <Panel title="Customer explorer" eyebrow="Search and compare">
        <div className="filter-bar">
          <label className="search-field">
            <input
              value={filters.query}
              onChange={(event) => updateFilter('query', event.target.value)}
              placeholder="Search customer ID or country"
            />
          </label>
          <select value={filters.cluster} onChange={(event) => updateFilter('cluster', event.target.value)} aria-label="Assigned cluster filter">
            <option value="">All assigned clusters</option>
            <optgroup label={allCycles ? 'Fitted tracking IDs across cycles' : 'Currently fitted clusters'}>{currentClusterChoices.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.value}</option>)}</optgroup>
          </select>
          <select value={filters.country} onChange={(event) => updateFilter('country', event.target.value)}>
            <option value="">All countries</option>
            {(data.filters.countries || []).map((option) => <option key={option.value}>{option.value}</option>)}
          </select>
          <select value={filters.cycle} onChange={(event) => updateFilter('cycle', event.target.value)}>
            <option value="All">All cycles</option>
            {(data.filters.cycles || []).map((option) => <option key={option.value} value={option.value}>{cycleLabel(option.value)}</option>)}
          </select>
        </div>
        {loading && <div className="inline-loading">Loading customer records…</div>}
        {error && <EmptyState title="Customer records unavailable" detail={error} />}
        {!loading && !error && result && (
          <>
            <DataTable
              rows={result.data}
              onRowClick={(row) => { setSelectedCustomer(String(row.CustomerID)); setSelectedCustomerCycle(row.CycleID || filters.cycle); }}
              columns={[
                { key: 'CustomerID', label: 'Customer' },
                { key: 'CycleID', label: 'Cycle', render: cycleLabel },
                { key: 'Country', label: 'Country' },
                { key: 'assignedClusterLabel', label: 'Assigned cluster', render: (value) => <SegmentBadge segment={value} /> },
                { key: 'assignmentType', label: 'Assignment basis', render: (value, row) => <span title={row.currentPrimaryStillFitted ? 'The primary tracking ID remains fitted in this cycle.' : 'This is a retained historical ID, outside the current fitted registry.'}>{value || '—'}{row.assignmentType === 'retained historical' ? ` · ${cycleLabel(row.lastFittedCycle)}` : ''}</span> },
                { key: 'Lifecycle_Status', label: 'Individual recency status', render: (value) => value || '—' },
                { key: 'Revenue', label: 'Cycle paid sales', render: (value) => <strong>{formatCurrency(value)}</strong> },
                { key: 'Orders', label: 'Orders', render: formatNumber },
                { key: 'Products', label: 'Products', render: formatNumber },
                { key: 'Average_Basket_Value', label: 'Avg basket', render: (value) => formatCurrency(value) },
                { key: 'Average_Membership', label: 'Max membership', render: (value, row) => row.CycleID === 'Cycle_0' ? 'Hard K-means' : formatPercent(value) },
                { key: 'Migration_Status', label: 'Status', render: (value) => <StatusPill tone={value === 'Stable' ? 'success' : 'warning'}>{value}</StatusPill> },
                { key: 'Risk_Status', label: 'Customer risk warning', render: (value, row) => <span className={`customer-risk-label ${{ 'At risk': 'customer-at-risk', Slipping: 'customer-slipping', Lost: 'customer-lost' }[value] || ''}`} title={row.Risk_Reasons || 'No risk assessment available'}>{value || 'Not assessed'}</span> },
              ]}
            />
            <div className="pagination">
              <span>{formatNumber(result.meta.total)} {observationLabel} · Page {result.meta.page} of {result.meta.totalPages}</span>
              <div>
                <button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>← Previous</button>
                <button disabled={page >= result.meta.totalPages} onClick={() => setPage((current) => current + 1)}>Next →</button>
              </div>
            </div>
          </>
        )}
      </Panel>

      {analyticsMatchesCycle && !analyticsError && <Panel title="Value profile by segment" eyebrow={allCycles ? 'All cycles · customer-cycle means' : cycleLabel(filters.cycle)}>
        <DataTable
          rows={orderSegmentProfiles(analytics.segmentValue || [])}
          columns={[
            { key: 'segment', label: 'Segment', render: (value) => <SegmentBadge segment={value} /> },
            { key: 'customers', label: allCycles ? 'Records' : 'Customers', render: formatNumber },
            { key: 'averageRevenue', label: 'Mean cycle paid sales', render: (value) => formatCurrency(value) },
            { key: 'averageBasketValue', label: 'Avg basket', render: (value) => formatCurrency(value) },
            { key: 'averageOrders', label: 'Avg orders', render: (value) => number.format(value) },
            { key: 'averageProducts', label: 'Avg products', render: (value) => number.format(value) },
            { key: 'averageMembership', label: 'Confidence', render: (value) => value == null ? 'N/A' : formatPercent(value) },
          ]}
        />
      </Panel>}
      {selectedCustomer && <CustomerProfileModal customerId={selectedCustomer} selectedCycle={selectedCustomerCycle} clusterRegistry={fittedRegistry(data)} onClose={() => setSelectedCustomer('')} />}
    </>
  );
}

function SegmentsPage({ data }) {
  const segmentData = data.segments;
  const segments = orderSegmentProfiles(segmentData.segments || []);
  const [selectedCycle, setSelectedCycle] = useState(segmentData.latestCycle || 'Cycle_9');
  const currentClusters = orderClusters(fittedRegistry(data).filter((row) => row.CycleID === selectedCycle));
  const selectedProfiles = orderSegmentProfiles((segmentData.profiles || []).filter((row) => row.CycleID === selectedCycle));
  const performanceCycles = data.modelEvaluation.cycles || [];
  const selectedEvaluation = performanceCycles.find((row) => row.CycleID === selectedCycle) || {};
  const populationNames = orderSegmentProfiles([...new Set((segmentData.trends || []).map((row) => row.segment))].map((segment) => ({ segment }))).map((row) => row.segment);
  const populationTrend = pivotSeries(segmentData.trends, 'customers');
  const maxima = {
    recency: Math.max(...segments.map((segment) => Number(segment.avgRecency || 0)), 1),
    frequency: Math.max(...segments.map((segment) => Number(segment.avgFrequency || 0)), 1),
    monetary: Math.max(...segments.map((segment) => Number(segment.avgMonetary || 0)), 1),
    value: Math.max(...segments.map((segment) => Number(segment.revenuePerCustomer || 0)), 1),
  };
  const radarData = [
    { metric: 'Recency', key: 'recency' },
    { metric: 'Frequency', key: 'frequency' },
    { metric: 'Monetary', key: 'monetary' },
    { metric: 'Confidence', key: 'confidence' },
    { metric: 'Customer value', key: 'value' },
  ].map((metric) => {
    const row = { metric: metric.metric };
    segments.forEach((segment) => {
      if (metric.key === 'recency') row[segment.segment] = 100 - (Number(segment.avgRecency || 0) / maxima.recency) * 100;
      if (metric.key === 'frequency') row[segment.segment] = (Number(segment.avgFrequency || 0) / maxima.frequency) * 100;
      if (metric.key === 'monetary') row[segment.segment] = (Number(segment.avgMonetary || 0) / maxima.monetary) * 100;
      if (metric.key === 'confidence') row[segment.segment] = Number(segment.averageMembership || 0) * 100;
      if (metric.key === 'value') row[segment.segment] = (Number(segment.revenuePerCustomer || 0) / maxima.value) * 100;
    });
    return row;
  });
  const primaryProfiles = segments;
  const renderProfileCards = (profiles) => (
    <div className="segment-card-grid">
      {profiles.map((segment) => (
        <article className="segment-card" key={segment.segment} style={{ '--segment-color': segmentColor(segment.segment) }}>
          <div className="segment-card-top">
            <SegmentBadge segment={segment.segment} />
            <strong>{formatNumber(segment.customerCount)}</strong>
          </div>
          <p>{describeSegmentProfile(segment)}</p>
          <div className="segment-stats">
            <div><span>Revenue</span><b>{formatCurrency(segment.revenue, true)}</b></div>
            <div><span>Per customer</span><b>{formatCurrency(segment.revenuePerCustomer)}</b></div>
            <div><span>Mean max membership</span><b>{formatPercent(segment.averageMembership)}</b></div>
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <>
      <PageTitle
        eyebrow="Firmographic component: behavioural segmentation"
        title={`${formatNumber(currentClusters.length)} fitted clusters in ${cycleLabel(selectedCycle)}`}
        description="The fitted-centre registry supplies the actual cluster count and one distinct label per centre. Every observed customer receives a fresh assignment each cycle. Purchase inactivity and customer warning flags are separate attributes."
        action={<select value={selectedCycle} onChange={(event) => setSelectedCycle(event.target.value)}>{(data.filters.cycles || []).map((option) => <option key={option.value} value={option.value}>{cycleLabel(option.value)}</option>)}</select>}
      />
      <Panel title="Current fitted cluster profiles" eyebrow={`${cycleLabel(selectedCycle)} · one row per actual model centre`}>
        <p className="panel-note">There are {currentClusters.length} current centres. Every centre is listed, including a soft-only centre with positive fuzzy mass and zero largest-membership winners. Weighted RFM uses all observed customers in this snapshot, with a consistent 90-day purchase window. Category names interpret cluster profiles; individual risk warnings use each customer's recorded changes.</p>
        <ClusterProfileTable clusters={currentClusters} />
      </Panel>
      <p className="panel-note">The following summaries describe customer assignments in {cycleLabel(segmentData.latestCycle)}. The centre registry defines fitted K. Purchase inactivity is a separate attribute; it does not remove a customer from the model or freeze their membership.</p>
      <section className="profile-hierarchy-group">
        <div className="section-heading-inline"><div><span className="eyebrow">Population reporting groups</span><h2>Customer assignment summaries</h2></div><p>All observed customers are fitted; the registry above defines the current centre count.</p></div>
        {renderProfileCards(primaryProfiles)}
      </section>


      <Panel title={`Evaluation metrics for ${cycleLabel(selectedCycle)}`} eyebrow="Choose a cycle in the profile table below to inspect its scores">
        <div className="metric-grid metric-grid-six">
          <MetricCard label="Silhouette" value={formatDecimal(selectedEvaluation.SilhouetteScore)} detail="Higher indicates better separation" />
          <MetricCard label="Davies–Bouldin" value={formatDecimal(selectedEvaluation.DaviesBouldinScore)} detail="Lower indicates better separation" tone="gold" />
          <MetricCard label="Calinski–Harabasz" value={formatNumber(selectedEvaluation.CalinskiHarabaszScore)} detail="Higher indicates stronger separation" tone="blue" />
          {selectedCycle === 'Cycle_0' ? <MetricCard label="K-means WCSS" value={formatDecimal(selectedEvaluation.Inertia, 2)} detail="Cycle 0 static baseline; primary K-selection evidence" tone="purple" /> : <>
            <MetricCard label="Xie–Beni" value={formatDecimal(selectedEvaluation.XieBeniIndex)} detail="Lower indicates stronger fuzzy validity" tone="purple" />
            <MetricCard label="Mean maximum membership" value={formatPercent(selectedEvaluation.AverageMembership)} detail="Average strongest MDFCM membership" tone="teal" />
          </>}
        </div>
        <p className="method-copy">Cycle 0 is static K-means, with K selected primarily from the WCSS elbow and silhouette as supporting evidence. Its silhouette, Davies–Bouldin, and Calinski–Harabasz scores use the hard assignments. MDFCM and fuzzy validity metrics apply only to Cycles 1–9.</p>
      </Panel>

      <div className="content-grid equal">
        <Panel title="Comparative segment profile" eyebrow="Normalised behavioural strengths">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                {segments.map((segment) => (
                  <Radar
                    key={segment.segment}
                    name={segment.segment}
                    dataKey={segment.segment}
                    stroke={segmentColor(segment.segment)}
                    fill={segmentColor(segment.segment)}
                    fillOpacity={0.08}
                    strokeWidth={2}
                  />
                ))}
                <Legend />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Population evolution" eyebrow="Customers by cycle">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={populationTrend}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="cycle" />
                <YAxis />
                <Tooltip content={<ChartTooltip valueFormatter={formatNumber} />} />
                {populationNames.map((segment) => (
                  <Area
                    key={segment}
                    type="monotone"
                    dataKey={segment}
                    stackId="population"
                    stroke={segmentColor(segment)}
                    fill={segmentColor(segment)}
                    fillOpacity={0.74}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="content-grid equal">
        <Panel title="Behavioural model separation" eyebrow="Performance across Cycle 0 to Cycle 9">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceCycles}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="CycleID" tickFormatter={cycleLabel} />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line yAxisId="left" dataKey="SilhouetteScore" name="Silhouette" stroke="#168a58" strokeWidth={3} dot={{ r: 3 }} />
                <Line yAxisId="right" dataKey="DaviesBouldinScore" name="Davies-Bouldin" stroke="#e59a38" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Fuzzy validity and confidence" eyebrow="Xie-Beni across Cycle 1 to Cycle 9">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceCycles}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="CycleID" tickFormatter={cycleLabel} />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" domain={[0, 1]} tickFormatter={(value) => formatPercent(value, 0)} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line yAxisId="left" dataKey="XieBeniIndex" name="Xie-Beni" stroke="#377dc1" strokeWidth={3} dot={{ r: 3 }} />
                <Line yAxisId="right" dataKey="AverageMembership" name="Membership" stroke="#8a6ec1" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel
        title="Segment economics and RFM profile"
        eyebrow={cycleLabel(selectedCycle)}
        action={(
          <select value={selectedCycle} onChange={(event) => setSelectedCycle(event.target.value)}>
            {(data.filters.cycles || []).map((option) => <option key={option.value} value={option.value}>{cycleLabel(option.value)}</option>)}
          </select>
        )}
      >
        <DataTable
          rows={selectedProfiles}
          columns={[
            { key: 'segment', label: 'Segment', render: (value) => <SegmentBadge segment={value} /> },
            { key: 'customerCount', label: 'Customers', render: formatNumber },
            { key: 'avgRecency', label: 'Avg recency', render: (value) => `${number.format(value)} days` },
            { key: 'avgFrequency', label: 'Mean orders / month', render: (value) => number.format(value) },
            { key: 'avgMonetary', label: 'Mean paid sales / month', render: (value) => formatCurrency(value) },
            { key: 'avgRF', label: 'RF', render: (value) => formatDecimal(value, 2) },
            { key: 'avgRM', label: 'RM', render: (value) => formatDecimal(value, 2) },
            { key: 'avgFM', label: 'FM', render: (value) => formatDecimal(value, 2) },
            { key: 'revenue', label: 'Cycle paid sales', render: (value) => formatCurrency(value) },
            { key: 'averageMembership', label: 'Confidence', render: (value) => value == null ? 'N/A' : formatPercent(value) },
          ]}
        />
      </Panel>

      <div className="strategy-grid">
        {segments.map((segment) => (
          <Panel key={segment.segment} title={segment.segment} eyebrow="Recommended actions" className="strategy-panel">
            <ol>
              {(segment.recommendations || []).map((recommendation) => <li key={recommendation}>{recommendation}</li>)}
            </ol>
          </Panel>
        ))}
      </div>
    </>
  );
}

function DynamicsPage({ data }) {
  const migration = data.migration;
  const cycles = migration.cycleMigration || [];
  const statistics = migration.migrationStatistics || {};
  const transitionRows = migration.transitionMatrix || [];
  const transitionStateTotals = migration.transitionStateTotals || [];
  const transitionStateEvolution = pivotSeries(
    migration.transitionStateEvolution || [],
    'customers',
    'state',
  );
  const matrixNames = orderSegmentProfiles([...new Set(transitionRows.flatMap((row) => [row.fromSegment, row.toSegment]))].filter(Boolean).map((segment) => ({ segment }))).map((row) => row.segment);
  const matrixMax = Math.max(...transitionRows.map((row) => Number(row.count || 0)), 1);
  const topFlows = (migration.topFlows || []).map((row) => ({
    ...row,
    flow: `${row.fromSegment} to ${row.toSegment}`,
  }));
  const totalState = (name) => Number(
    transitionStateTotals.find((row) => row.state === name)?.customers || 0,
  );

  return (
    <>
      <PageTitle
        eyebrow="Dynamic customer movement"
        title="Track every customer state across time"
        description="Track new customers and changes in fitted tracking IDs. Purchase inactivity and reactivation are separate commercial-activity measures; all observed customers remain fitted."
      />
      <div className="metric-grid metric-grid-six">
        <MetricCard label="Comparable records" value={formatNumber(statistics.total)} detail="Stable plus migrated" />
        <MetricCard label="Migrated" value={formatNumber(statistics.migrated)} detail={formatPercent(statistics.migrationRate)} tone="gold" />
        <MetricCard label="New" value={formatNumber(totalState('New'))} detail="First observed cycle" tone="blue" />
        <MetricCard label="Inactive" value={formatNumber(cycles.reduce((sum, row) => sum + Number(row.InactiveCustomers || 0), 0))} detail="Customer-cycle records; still fitted" />
        <MetricCard label="Reactivated" value={formatNumber(cycles.reduce((sum, row) => sum + Number(row.ReactivatedCustomers || 0), 0))} detail="Purchase returns after an inactive month" tone="purple" />
        <MetricCard label="Stable" value={formatNumber(statistics.stable)} detail="Same tracked cluster ID" tone="green" />
      </div>

      <div className="content-grid equal">
        <Panel title="Migration rate by cycle" eyebrow="Comparable customers only">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cycles}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="CycleID" tickFormatter={cycleLabel} />
                <YAxis domain={[0, 100]} tickFormatter={(value) => formatStoredPercent(value, 0)} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatStoredPercent(value)} />} />
                <Line type="monotone" dataKey="MigrationRate" name="Migration rate" stroke="#e59a38" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="panel-note">Migration uses the comparable observations recorded in the model summary. Purchase activity is tracked separately, and customers without a purchase this month still participate in fitting.</p>
        </Panel>
        <Panel title="Membership confidence by cycle" eyebrow="Fuzzy membership concentration">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cycles}>
                <defs>
                  <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#377dc1" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#377dc1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="CycleID" tickFormatter={cycleLabel} />
                <YAxis domain={[0, 1]} tickFormatter={(value) => formatPercent(value, 0)} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatPercent(value)} />} />
                <Area type="monotone" dataKey="AverageMembership" name="Confidence" stroke="#377dc1" fill="url(#confidenceGradient)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Current assignment states" eyebrow="Every observed customer is fitted">
        <div className="chart-xl">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={transitionStateEvolution} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="cycle" />
              <YAxis />
              <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} customers`} />} />
              <Legend />
              {TRANSITION_STATES.map((state) => (
                <Bar key={state} dataKey={state} stackId="states" fill={TRANSITION_COLORS[state]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Customer segment migration Sankey" eyebrow="Source-to-destination flow across dynamic cycles">
        <MigrationSankey rows={transitionRows} />
        <p className="panel-note">Flow width counts displayed profile transitions among returning customers. A profile rename can change the displayed name while keeping the same tracking ID; the Model page reports that distinction and the feature/boundary diagnostics.</p>
      </Panel>

      <div className="content-grid equal">
        <Panel title="Transition matrix" eyebrow="Source to destination">
          <div className="matrix-scroll">
            <div className="transition-matrix">
              <span />
              {matrixNames.map((segment) => <b key={segment}>{segment}</b>)}
              {matrixNames.map((fromSegment) => (
                <div className="matrix-row" key={fromSegment}>
                  <strong>{fromSegment}</strong>
                  {matrixNames.map((toSegment) => {
                    const cell = transitionRows.find(
                      (row) => row.fromSegment === fromSegment && row.toSegment === toSegment,
                    );
                    const value = Number(cell?.count || 0);
                    const intensity = 0.08 + (value / matrixMax) * 0.82;
                    return (
                      <span
                        key={toSegment}
                        title={`${fromSegment} to ${toSegment}: ${formatNumber(value)}`}
                        style={{ background: `rgba(22, 138, 88, ${intensity})`, color: intensity > 0.48 ? '#fff' : 'var(--text)' }}
                      >
                        {formatNumber(value)}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="panel-note">Diagonal cells indicate stable segment assignments; off-diagonal cells show behavioural migration.</p>
        </Panel>
        <Panel title="Largest customer flows" eyebrow="Transition volume">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topFlows.slice().reverse()} layout="vertical" margin={{ left: 88, right: 18 }}>
                <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                <XAxis type="number" />
                <YAxis type="category" dataKey="flow" width={170} tick={{ fontSize: 10 }} />
                <Tooltip content={<ChartTooltip valueFormatter={formatNumber} />} />
                <Bar dataKey="count" name="Customers" fill="#168a58" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Cycle movement detail" eyebrow="Lifecycle and fuzzy model evidence">
        <DataTable
          rows={cycles}
          columns={[
            { key: 'CycleID', label: 'Cycle', render: cycleLabel },
            { key: 'CustomersProcessed', label: 'Customer records', render: formatNumber },
            { key: 'ModelFitCustomers', label: 'Purchasers fitted', render: formatNumber },
            { key: 'RetainedInactiveCustomers', label: 'Historical assignments retained', render: formatNumber },
            { key: 'ActiveCustomers', label: 'Active', render: formatNumber },
            { key: 'InactiveCustomers', label: 'Inactive', render: formatNumber },
            { key: 'NewCustomers', label: 'New', render: formatNumber },
            { key: 'ReactivatedCustomers', label: 'Reactivated', render: formatNumber },
            { key: 'ComparableCustomers', label: 'Comparable', render: formatNumber },
            { key: 'MigrationRate', label: 'Migration rate', render: (value) => value == null ? 'Baseline' : formatStoredPercent(value) },
            { key: 'AverageMembership', label: 'Confidence', render: (value) => value == null ? 'N/A' : formatPercent(value) },
          ]}
        />
      </Panel>
    </>
  );
}

function StaticToDynamicPage({ data }) {
  const cycles = data.modelEvaluation.cycles || [];
  const baseline = cycles.find((row) => row.CycleID === 'Cycle_0') || {};
  const latest = cycles.at(-1) || {};
  const populationNames = orderSegmentProfiles([...new Set((data.segments.trends || []).map((row) => row.segment))].map((segment) => ({ segment }))).map((row) => row.segment);
  const populationTrend = pivotSeries(data.segments.trends || [], 'customers');

  return (
    <>
      <PageTitle
        eyebrow="Segmentation evolution"
        title="From a Cycle 0 baseline to monthly updates"
        description="Cycle 0 establishes static K-means starting groups. MDFCM incrementally updates fuzzy centres only in Cycles 1–9, while customer history supports comparisons between periods."
      />
      <section className="static-dynamic-journey">
        <article>
          <span>Static baseline</span>
          <h2>Cycle 0 K-Means</h2>
          <p>Creates the five starting groups in the Cycle 0 PCA space and supplies the initial centres for the monthly updates.</p>
          <div><strong>{formatNumber(baseline.CustomersProcessed)}</strong><small>customers</small></div>
        </article>
        <b>→</b>
        <article className="dynamic-stage">
          <span>Dynamic segmentation</span>
          <h2>Cycle 1 to Cycle 9 fuzzy updates</h2>
          <p>Refits every observed customer at each monthly snapshot using the same 90-day RFM window. Customers with no purchase this month remain in the fit. Current snapshots replace earlier customer observations so overlapping windows do not double-count historical membership mass. MDFCM decisions determine whether K changes.</p>
          <div><strong>{formatNumber(latest.CustomersProcessed)}</strong><small>customer histories</small></div>
        </article>
      </section>

      <div className="metric-grid metric-grid-four">
        <MetricCard label="Baseline silhouette" value={formatDecimal(baseline.SilhouetteScore)} detail="Cycle 0 cluster separation" />
        <MetricCard label="Baseline K-means WCSS" value={formatDecimal(baseline.Inertia, 2)} detail="Cycle 0 elbow-selected static model" tone="blue" />
        <MetricCard label="Latest silhouette" value={formatDecimal(latest.SilhouetteScore)} detail={cycleLabel(latest.CycleID)} tone="green" />
        <MetricCard label="Latest Xie-Beni" value={formatDecimal(latest.XieBeniIndex)} detail="Fuzzy compactness and separation" tone="gold" />
      </div>

      <div className="content-grid equal">
        <Panel title="Segment population through time" eyebrow="Cycle 0 baseline plus dynamic updates">
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={populationTrend}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="cycle" />
                <YAxis />
                <Tooltip content={<ChartTooltip valueFormatter={formatNumber} />} />
                <Legend />
                {populationNames.map((segment) => (
                  <Area key={segment} dataKey={segment} stackId="segments" stroke={segmentColor(segment)} fill={segmentColor(segment)} fillOpacity={0.7} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Model quality through time" eyebrow="Silhouette and Xie-Beni">
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cycles}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="CycleID" tickFormatter={cycleLabel} />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line yAxisId="left" dataKey="SilhouetteScore" name="Silhouette" stroke="#168a58" strokeWidth={3} dot={{ r: 3 }} />
                <Line yAxisId="right" dataKey="XieBeniIndex" name="Xie-Beni" stroke="#377dc1" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="benefit-grid">
        {[
          ['Customer continuity', 'Cumulative snapshots retain active, inactive, reactivated, and newly observed customers.'],
          ['Movement evidence', 'Stable and migrated customers are separated from lifecycle states for interpretable transition analysis.'],
          ['Fuzzy confidence', 'Membership scores show how strongly an observation belongs to each fitted centre; maximum membership is not a calibrated probability that its label is correct.'],
          ['Market context', 'Behavioural groups are combined with geographic market clusters to create firmographic customer-market segments.'],
        ].map(([title, description]) => <article key={title}><div><h3>{title}</h3><p>{description}</p></div></article>)}
      </div>
    </>
  );
}

function CycleComparisonPage({ data }) {
  const comparison = data.cycleComparisonAnalytics;
  const cycleOptions = comparison.definitions || [];
  const [fromCycle, setFromCycle] = useState(comparison.defaultFrom || 'Cycle_0');
  const [toCycle, setToCycle] = useState(comparison.defaultTo || 'Cycle_9');
  const fromMetrics = (comparison.cycles || []).find((row) => row.CycleID === fromCycle) || {};
  const toMetrics = (comparison.cycles || []).find((row) => row.CycleID === toCycle) || {};
  const comparisonNames = orderSegmentProfiles([...new Set((comparison.profiles || []).filter((row) => row.CycleID === fromCycle || row.CycleID === toCycle).map((row) => row.segment))].map((segment) => ({ segment }))).map((row) => row.segment);
  const profileRows = comparisonNames.map((segment) => {
    const fromProfile = (comparison.profiles || []).find((row) => row.CycleID === fromCycle && row.segment === segment) || {};
    const toProfile = (comparison.profiles || []).find((row) => row.CycleID === toCycle && row.segment === segment) || {};
    return {
      segment,
      fromCustomers: Number(fromProfile.customers || 0),
      toCustomers: Number(toProfile.customers || 0),
      customerChange: Number(toProfile.customers || 0) - Number(fromProfile.customers || 0),
      fromRevenue: Number(fromProfile.revenue || 0),
      toRevenue: Number(toProfile.revenue || 0),
      fromRecency: Number(fromProfile.recency || 0),
      toRecency: Number(toProfile.recency || 0),
      fromFrequency: Number(fromProfile.frequency || 0),
      toFrequency: Number(toProfile.frequency || 0),
      fromMonetary: Number(fromProfile.monetary || 0),
      toMonetary: Number(toProfile.monetary || 0),
    };
  });
  const signedNumber = (value) => `${Number(value) > 0 ? '+' : ''}${formatNumber(value)}`;

  return (
    <>
      <PageTitle
        eyebrow="Cycle comparison"
        title="Compare customer segments between any two cycles"
        description="Review customer population, behavioural value, and cluster quality from Cycle 0 through Cycle 9, with fuzzy validity metrics for dynamic cycles."
      />
      <section className="cycle-comparison-controls">
        <label>From cycle<select value={fromCycle} onChange={(event) => setFromCycle(event.target.value)}>{cycleOptions.map((cycle) => <option key={cycle.CycleID} value={cycle.CycleID}>{cycleLabel(cycle.CycleID)}</option>)}</select></label>
        <span>vs.</span>
        <label>To cycle<select value={toCycle} onChange={(event) => setToCycle(event.target.value)}>{cycleOptions.map((cycle) => <option key={cycle.CycleID} value={cycle.CycleID}>{cycleLabel(cycle.CycleID)}</option>)}</select></label>
      </section>

      <div className="metric-grid metric-grid-six">
        <MetricCard label="Customer change" value={signedNumber(Number(toMetrics.CustomersProcessed || 0) - Number(fromMetrics.CustomersProcessed || 0))} detail={`${cycleLabel(fromCycle)} to ${cycleLabel(toCycle)}`} />
        <MetricCard label="Silhouette" value={`${formatDecimal(fromMetrics.SilhouetteScore)} / ${formatDecimal(toMetrics.SilhouetteScore)}`} detail="From / to" tone="green" />
        <MetricCard label="Xie-Beni" value={`${fromMetrics.XieBeniIndex == null ? 'N/A' : formatDecimal(fromMetrics.XieBeniIndex)} / ${toMetrics.XieBeniIndex == null ? 'N/A' : formatDecimal(toMetrics.XieBeniIndex)}`} detail="From / to; applies only to fuzzy cycles" tone="blue" />
        <MetricCard label="Fuzzy membership" value={`${fromMetrics.AverageMembership == null ? 'N/A' : formatPercent(fromMetrics.AverageMembership)} / ${toMetrics.AverageMembership == null ? 'N/A' : formatPercent(toMetrics.AverageMembership)}`} detail="From / to; Cycle 0 uses crisp K-means" tone="purple" />
        <MetricCard label="Active customers" value={`${formatNumber(fromMetrics.ActiveCustomers)} / ${formatNumber(toMetrics.ActiveCustomers)}`} detail="From / to" />
        <MetricCard label="Migration rate" value={toMetrics.MigrationRate == null ? 'Baseline' : formatStoredPercent(toMetrics.MigrationRate)} detail={cycleLabel(toCycle)} tone="gold" />
      </div>

      <div className="content-grid equal">
        <Panel title="Segment population comparison" eyebrow={`${cycleLabel(fromCycle)} and ${cycleLabel(toCycle)}`}>
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={profileRows} margin={{ bottom: 42 }}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="segment" interval={0} angle={-12} textAnchor="end" height={76} />
                <YAxis />
                <Tooltip content={<ChartTooltip valueFormatter={formatNumber} />} />
                <Legend />
                <Bar dataKey="fromCustomers" name={cycleLabel(fromCycle)} fill="#9eb3a8" radius={[5, 5, 0, 0]} />
                <Bar dataKey="toCustomers" name={cycleLabel(toCycle)} fill="#168a58" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Average monthly paid sales by segment" eyebrow="RFM monthly rate comparison">
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={profileRows} margin={{ bottom: 42 }}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="segment" interval={0} angle={-12} textAnchor="end" height={76} />
                <YAxis tickFormatter={(value) => formatCurrency(value, true)} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                <Legend />
                <Bar dataKey="fromMonetary" name={cycleLabel(fromCycle)} fill="#9eb3a8" radius={[5, 5, 0, 0]} />
                <Bar dataKey="toMonetary" name={cycleLabel(toCycle)} fill="#e59a38" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Segment-level cycle comparison" eyebrow="Population and RFM changes">
        <p className="panel-note">Recency is exact days since the last qualifying purchase. Frequency and paid-sales value use the same exact trailing 90-day window in every cycle, divided by three to give monthly equivalents. Commercial cycle totals are kept separately.</p>
        <DataTable
          rows={profileRows}
          columns={[
            { key: 'segment', label: 'Segment', render: (value) => <SegmentBadge segment={value} /> },
            { key: 'fromCustomers', label: `${cycleLabel(fromCycle)} customers`, render: formatNumber },
            { key: 'toCustomers', label: `${cycleLabel(toCycle)} customers`, render: formatNumber },
            { key: 'customerChange', label: 'Change', render: signedNumber },
            { key: 'fromRecency', label: 'Recency from', render: (value) => formatDecimal(value, 1) },
            { key: 'toRecency', label: 'Recency to', render: (value) => formatDecimal(value, 1) },
            { key: 'fromFrequency', label: 'Orders / month from', render: (value) => formatDecimal(value, 2) },
            { key: 'toFrequency', label: 'Orders / month to', render: (value) => formatDecimal(value, 2) },
            { key: 'fromMonetary', label: 'Paid sales / month from', render: formatCurrency },
            { key: 'toMonetary', label: 'Paid sales / month to', render: formatCurrency },
          ]}
        />
      </Panel>
    </>
  );
}

function PcaSegmentAnalysisPage({ data }) {
  const analytics = data.pcaAnalytics;
  const cycleOptions = data.filters.cycles || [];
  const [selectedCycle, setSelectedCycle] = useState(cycleOptions.at(-1)?.value || 'Cycle_9');
  const [pointState, setPointState] = useState({ cycle: null, points: [], loading: false, error: '' });
  const [pointRetry, setPointRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPointState({ cycle: selectedCycle, points: [], loading: true, error: '' });
    fetchPcaCycle(selectedCycle).then((result) => {
      if (!cancelled) setPointState({ cycle: selectedCycle, points: result.points || [], loading: false, error: '' });
    }).catch((requestError) => {
      if (!cancelled) setPointState({ cycle: selectedCycle, points: [], loading: false, error: requestError.message || 'Unable to load PCA customers.' });
    });
    return () => { cancelled = true; };
  }, [selectedCycle, pointRetry]);
  const registry = fittedRegistry(data);
  const selectedRegistry = orderClusters(registry.filter((cluster) => cluster.CycleID === selectedCycle));
  const cyclePoints = pointState.cycle === selectedCycle
    ? pointState.points
    : (analytics.points || []).filter((point) => point.CycleID === selectedCycle);
  const selectedPoints = cyclePoints.filter((point) => point.assignmentType !== 'retained historical' && !String(point.assignmentMode || '').startsWith('Retained')).map((point) => {
    const cluster = selectedRegistry.find((row) => row.stableClusterId === point.stableClusterId);
    return { ...point, segment: cluster?.displayLabel || point.currentFittedClusterLabel || point.stableClusterId, businessProfile: cluster?.businessProfile || point.segment, color: cluster ? clusterColor(cluster) : segmentColor(point.segment) };
  });
  const selectedCounts = (analytics.clusterCounts || []).find((row) => row.CycleID === selectedCycle);
  const purchaseInactiveCount = selectedCounts?.purchaseInactiveCustomers ?? selectedPoints.filter((point) => point.activityStatus === 'Inactive').length;
  const selectedQuality = (data.modelEvaluation?.cycles || []).find((row) => row.CycleID === selectedCycle);
  const explainedVariance = analytics.explainedVariance || [];
  const twoComponentVariance = explainedVariance.slice(0, 2).reduce((total, item) => total + Number(item.percentage || 0), 0);
  const threeComponentVariance = explainedVariance.slice(0, 3).reduce((total, item) => total + Number(item.percentage || 0), 0);
  const clusterPaths = [...new Set(registry.map((row) => row.stableClusterId))].map((clusterId) => ({ clusterId, points: registry.filter((row) => row.stableClusterId === clusterId).sort((left, right) => cycleIndex(left.CycleID) - cycleIndex(right.CycleID)) })).sort((left, right) => Number(left.points.at(-1)?.labelOrder) - Number(right.points.at(-1)?.labelOrder) || left.clusterId.localeCompare(right.clusterId));
  const profilePaths = SEGMENTS.map(profileName => ({profileName, points: registry.filter(row => row.businessProfile === profileName).sort((a,b) => cycleIndex(a.CycleID)-cycleIndex(b.CycleID))})).filter(row => row.points.length);

  return (
    <>
      <PageTitle eyebrow="PCA cluster analysis" title="Inspect the current fitted clusters and their movement"
        description="The selected cycle's fitted-centre registry defines its cluster count. Every customer observed before the snapshot is fitted, including customers without a purchase this month. Purchase activity does not decide model participation."
        action={<select className="page-select" value={selectedCycle} onChange={(event) => setSelectedCycle(event.target.value)}>{cycleOptions.map((cycle) => <option key={cycle.value} value={cycle.value}>{cycleLabel(cycle.value)}</option>)}</select>} />
      <div className="metric-grid metric-grid-four">
        <MetricCard label="Fitted clusters (K)" value={formatNumber(selectedRegistry.length)} detail={`${cycleLabel(selectedCycle)} · actual model centres`} />
        <MetricCard label="Current fitted customers" value={formatNumber(selectedRegistry.reduce((sum, row) => sum + Number(row.hardWinnerCustomers || 0), 0))} detail={selectedCycle === 'Cycle_0' ? 'Static K-means assignments' : 'Scope of current MDFCM validation'} />
        <MetricCard label="Cluster separation" value={selectedQuality?.SilhouetteScore == null ? 'Unavailable' : formatDecimal(selectedQuality.SilhouetteScore, 3)} detail="Silhouette · higher is better (−1 to 1)" />
        <MetricCard label="No purchases this cycle" value={formatNumber(purchaseInactiveCount)} detail="Included in the current model fit" />
      </div>
      {pointState.loading && <p className="panel-note" role="status">Loading customer points for {cycleLabel(selectedCycle)}…</p>}
      {pointState.error && <p className="panel-note" role="alert">{pointState.error} <button className="button button-secondary" onClick={() => setPointRetry((value) => value + 1)}>Retry PCA points</button></p>}
      <div className="content-grid equal">
        <Panel title="Current fitted customers: PC1 vs PC2" eyebrow={`${cycleLabel(selectedCycle)} · ${selectedRegistry.length} fitted centres`}>
          <p className="panel-note">Each dot is one currently fitted customer, whether or not they purchased in the commercial cycle. Diamonds mark fitted centres; the legend lists all {formatNumber(selectedRegistry.length)} registry entries, including a centre with no hard-label winner. Colours describe the fitted cluster's current label. PCA reuses the Cycle 0 reference.</p>
          <div className="chart-xl"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 18, right: 22, bottom: 18, left: 10 }}>
            <CartesianGrid strokeDasharray="3 6" /><XAxis type="number" dataKey="PC1" name="PC1" /><YAxis type="number" dataKey="PC2" name="PC2" /><ZAxis range={[22, 22]} /><Tooltip content={<PcaPointTooltip />} cursor={{ strokeDasharray: '3 3' }} />
            {selectedRegistry.map((cluster) => <Scatter key={cluster.stableClusterId} name={cluster.displayLabel} data={selectedPoints.filter((point) => point.stableClusterId === cluster.stableClusterId)} fill={clusterColor(cluster)} fillOpacity={0.78} />)}
            <Scatter name="Fitted centre" data={selectedRegistry.map((row) => ({ ...row, isCentroid: true }))} shape="diamond">{selectedRegistry.map((cluster) => <Cell key={cluster.stableClusterId} fill={clusterColor(cluster)} stroke="var(--text)" strokeWidth={1.2} />)}</Scatter>
          </ScatterChart></ResponsiveContainer></div>
          <ClusterLegend clusters={selectedRegistry} />
        </Panel>
        <Panel title="Current fitted customers: three-dimensional PCA" eyebrow={`${cycleLabel(selectedCycle)} · PC1, PC2 and PC3`}>
          <Pca3DPlot points={selectedPoints} clusters={selectedRegistry} />
          <p className="panel-note">Uses the same current-fit population as the metrics and one common scale for all three PCA axes. The small axis guide rotates with the points. Diamonds mark all fitted centres, including soft-only centres. Rotate the view to inspect overlap; a projection does not establish segment accuracy.</p>
        </Panel>
      </div>
      <Panel title={`Current fitted cluster profiles: ${selectedRegistry.length} centres`} eyebrow={cycleLabel(selectedCycle)}>
        <p className="panel-note">One row per registry centre. Weighted RFM summarizes all currently fitted customers using membership weights and the same 90-day purchase window. Soft-only centres remain visible and contribute to fuzzy validity. Labels distinguish fitted centres even when their broader profile is similar.</p>
        <ClusterProfileTable clusters={selectedRegistry} />
      </Panel>
      <Panel title="PCA centroid movement by named profile" eyebrow={`Cycle 0 to Cycle 9 · ${formatNumber(registry.length)} actual fitted positions`}>
        <p className="panel-note">A tracking ID, such as CL-001, links a fitted centre to its best supported match in the next cycle using centre distance and customer-membership overlap. A matched centre keeps the ID; an unmatched centre receives a new one, and an unmatched previous ID is retired. Profile names are assigned separately from current RFM, so a name can move to a different ID and the same ID can change its name. A new ID alone does not mean that K increased.</p>
        <p className="panel-note">One panel per approved profile name. Every point is an actual fitted centre in the shared PCA space, with its cycle and tracking ID in the tooltip. Solid lines join consecutive positions with the same tracking ID; dashed lines indicate that the same profile name belongs to a different ID. Missing profiles leave genuine gaps. These are centre positions, not averages of assigned customer points. Each panel uses its own axis range.</p>
        <div className="centroid-multiples-grid">{profilePaths.map(({profileName, points}) => <FittedCentroidPlot key={profileName} profileName={profileName} points={points} />)}</div>
        <details className="historical-cluster-details"><summary>Inspect all {clusterPaths.length} tracking-ID paths</summary>
          <p className="panel-note">This view follows accepted tracking links separately from names, including retired centres. The total number of historical paths can exceed the number of centres fitted in any one cycle.</p>
          <div className="centroid-multiples-grid">{clusterPaths.map(({clusterId, points}) => <FittedCentroidPlot key={clusterId} clusterId={clusterId} points={points} />)}</div>
        </details>
      </Panel>
      <Panel title="Quality of each fitted cluster" eyebrow={cycleLabel(selectedCycle)}>
        <p className="panel-note">Silhouette uses each customer's highest-membership assignment in the complete three-dimensional PCA fit. Distances and SSE use the actual fitted centre. Fuzzy contributions include every customer's partial membership. Cycle 0 has no fuzzy confidence or objective. Davies–Bouldin, Calinski–Harabasz and Xie–Beni assess the complete partition and remain cycle-level measures.</p>
        <ClusterQualityTable clusters={selectedRegistry} />
      </Panel>
      <Panel title="Explained variance" eyebrow="Cycle 0 PCA reference">
        <div className="variance-list">{explainedVariance.map((item) => <div key={item.component}><span>{item.component}</span><i><b style={{ width: `${item.percentage}%` }} /></i><strong>{item.percentage.toFixed(2)}%</strong></div>)}</div>
        <p className="panel-note">PC1 and PC2 explain {formatPercent(twoComponentVariance / 100)} of baseline feature variance; all three explain {formatPercent(threeComponentVariance / 100)}. Clustering uses all three weighted combinations of the scaled model features.</p>
      </Panel>
    </>
  );
}

function ProductsPage({ data }) {
  const analytics = data.productAnalytics;
  const productSegments = orderSegmentProfiles([...new Set(analytics.segmentProducts.map((row) => row.segment))].map((segment) => ({ segment }))).map((row) => row.segment);
  const [segment, setSegment] = useState(productSegments[0] || '');
  const segmentProducts = analytics.segmentProducts.filter((row) => row.segment === segment);
  const topProducts = analytics.topProducts.slice(0, 12).reverse();
  const segmentRevenueProducts = analytics.segmentProducts
    .filter((row) => Number(row.rank) <= 3)
    .map((row) => ({ ...row, label: `${row.segment}: ${row.product}` }))
    .reverse();
  const revenueTrend = analytics.revenueByCycle.map((row) => ({
    ...row,
    cycle: cycleLabel(row.CycleID),
  }));

  return (
    <>
      <PageTitle
        eyebrow="Product intelligence"
        title="Connect customer segments to product demand"
        description="Compare qualifying paid product sales across the observed customer assignment labels, with consistent colours and hierarchy. Product sales use observed purchases; inactive customers do not generate current-cycle demand."
      />
      <div className="content-grid two-one">
        <Panel title="Top products by revenue" eyebrow="Across dynamic cycles">
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProducts} layout="vertical" margin={{ left: 118, right: 18 }}>
                <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => formatCurrency(value, true)} />
                <YAxis type="category" dataKey="product" width={196} tick={{ fontSize: 10 }} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                <Bar dataKey="revenue" name="Revenue" fill="#168a58" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Segment portfolios" eyebrow="Commercial breadth">
          <div className="portfolio-list">
            {orderSegmentProfiles(analytics.portfolio || []).map((row) => (
              <div key={row.segment}>
                <SegmentBadge segment={row.segment} />
                <strong>{formatCurrency(row.revenue, true)}</strong>
                <span>{formatNumber(row.products)} products · {formatNumber(row.orders)} orders</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="content-grid equal">
        <Panel title="Top revenue-generating products by customer segment" eyebrow="Leading three products per segment">
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={segmentRevenueProducts} layout="vertical" margin={{ left: 130, right: 18 }}>
                <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => formatCurrency(value, true)} />
                <YAxis type="category" dataKey="label" width={220} tick={{ fontSize: 9 }} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                <Bar dataKey="revenue" name="Positive paid sales" radius={[0, 6, 6, 0]}>
                  {segmentRevenueProducts.map((row) => <Cell key={row.label} fill={segmentColor(row.segment)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Product demand and commercial value" eyebrow="Quantity, revenue, and customer reach">
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 18, right: 24, bottom: 18, left: 12 }}>
                <CartesianGrid strokeDasharray="3 6" />
                <XAxis type="number" dataKey="quantity" name="Quantity" tickFormatter={(value) => formatNumber(value, true)} />
                <YAxis type="number" dataKey="revenue" name="Revenue" tickFormatter={(value) => formatCurrency(value, true)} />
                <ZAxis type="number" dataKey="customerInteractions" range={[55, 420]} name="Customer reach" />
                <Tooltip content={<ProductScatterTooltip />} />
                <Scatter data={analytics.productQuadrant || []} fill="#168a58" fillOpacity={0.7} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="panel-note">Larger points indicate products purchased by more customer-segment combinations.</p>
        </Panel>
      </div>

      <div className="content-grid equal">
        <Panel title="Revenue trend" eyebrow="Product sales by cycle">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueTrend}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="cycle" />
                <YAxis tickFormatter={(value) => formatCurrency(value, true)} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                <Area dataKey="revenue" name="Revenue" type="monotone" stroke="#168a58" fill="#168a5827" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel
          title="Segment product leaders"
          eyebrow="Top five by revenue"
          action={
            <select value={segment} onChange={(event) => setSegment(event.target.value)}>
              {productSegments.map((name) => <option key={name}>{name}</option>)}
            </select>
          }
        >
          <DataTable
            compact
            rows={segmentProducts}
            columns={[
              { key: 'rank', label: '#' },
              { key: 'product', label: 'Product' },
              { key: 'quantity', label: 'Quantity', render: formatNumber },
              { key: 'revenue', label: 'Revenue', render: (value) => formatCurrency(value) },
            ]}
          />
        </Panel>
      </div>

      <Panel title="Product performance detail" eyebrow="Top twenty products">
        <DataTable
          rows={analytics.topProducts}
          columns={[
            { key: 'product', label: 'Product' },
            { key: 'revenue', label: 'Revenue', render: (value) => <strong>{formatCurrency(value)}</strong> },
            { key: 'quantity', label: 'Quantity', render: formatNumber },
            { key: 'orders', label: 'Orders', render: formatNumber },
            { key: 'customerInteractions', label: 'Customer interactions', render: formatNumber },
            { key: 'averagePrice', label: 'Average price', render: (value) => formatCurrency(value) },
          ]}
        />
      </Panel>
    </>
  );
}

function GeographyPage({ data }) {
  const analytics = data.geographicAnalytics;
  const markets = analytics.markets || [];
  const segmentSummary = analytics.segmentSummary || [];
  const topMarkets = markets.slice(0, 12);
  const marketEvolution = pivotSeries(analytics.evolution || [], 'markets');
  const latestQuality = (analytics.quality || []).at(-1) || {};
  const composition = markets.slice(0, 12).map((market) => ({
    country: market.country,
    Champions: Number(market.championsShare || 0) * 100,
    'Loyalists': Number(market.loyalistsShare || 0) * 100,
    'Mid-Tier Occasionals': Number(market.midTierOccasionalsShare || 0) * 100,
    'Light Buyers': Number(market.developingShare || 0) * 100,
    'Hibernating / Lost': Number(market.hibernatingLostShare || 0) * 100,
  }));
  const compositionNames = Object.keys(composition[0] || {}).filter((name) => name !== 'country' && composition.some((row) => Number(row[name]) > 0));
  const evolutionMarkets = topMarkets.slice(0, 3);

  return (
    <>
      <PageTitle
        eyebrow="Firmographic component: geographic segmentation"
        title="Discover distinct geographic market segments"
        description="Country markets are assigned to three K-means groups using country-level customer scale, revenue, order behaviour, product breadth, repeat purchasing, and customer-group composition. The Model page explains the feature preparation and fixed geographic reference."
      />
      <p className="panel-note">Commercial market measures use an exact trailing 90-day transaction window. Customer-group composition uses the current customer snapshot. These window sales differ from the one-month cycle sales shown for dynamic customers.</p>
      <div className="metric-grid metric-grid-four">
        <MetricCard label="Geographic markets" value={formatNumber(markets.length)} detail="Country-level observations" />
        <MetricCard label="Market segments" value={formatNumber(segmentSummary.length)} detail="Three K-means geographic groups" tone="blue" />
        <MetricCard label="Largest market" value={topMarkets[0]?.country || '-'} detail={`${formatNumber(topMarkets[0]?.customers)} customers`} tone="green" />
        <MetricCard label="Geographic silhouette" value={formatDecimal(latestQuality.SilhouetteScore)} detail={cycleLabel(analytics.latestCycle)} tone="gold" />
      </div>

      <div className="content-grid equal">
        <Panel title="Leading markets by revenue" eyebrow="Colour shows geographic segment">
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...topMarkets].reverse()} layout="vertical" margin={{ left: 64, right: 18 }}>
                <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => formatCurrency(value, true)} />
                <YAxis type="category" dataKey="country" width={105} tick={{ fontSize: 10 }} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                <Bar dataKey="revenue" name="Positive paid sales" radius={[0, 6, 6, 0]}>
                  {[...topMarkets].reverse().map((market) => (
                    <Cell key={market.country} fill={GEOGRAPHIC_COLORS[market.geographicSegment] || '#168a58'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Geographic segment scale" eyebrow={cycleLabel(analytics.latestCycle)}>
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={segmentSummary} dataKey="markets" nameKey="segment" innerRadius={78} outerRadius={132} paddingAngle={3}>
                  {segmentSummary.map((segment) => (
                    <Cell key={segment.segment} fill={GEOGRAPHIC_COLORS[segment.segment] || '#168a58'} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} markets`} />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="content-grid equal">
        <Panel title="Market segment evolution" eyebrow="Geographic clustering across cycles">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={marketEvolution}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="cycle" />
                <YAxis />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} markets`} />} />
                <Legend />
                {GEOGRAPHIC_SEGMENTS.map((segment) => (
                  <Bar key={segment} dataKey={segment} stackId="markets" fill={GEOGRAPHIC_COLORS[segment]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Geographic model quality" eyebrow="Silhouette and Davies-Bouldin">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.quality || []}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="CycleID" tickFormatter={cycleLabel} />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line yAxisId="left" dataKey="SilhouetteScore" name="Silhouette" stroke="#168a58" strokeWidth={3} />
                <Line yAxisId="right" dataKey="DaviesBouldinScore" name="Davies-Bouldin" stroke="#e59a38" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Behavioural segment composition across geographic markets" eyebrow="Leading markets in the latest cycle">
        <div className="chart-large">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={composition} margin={{ top: 12, right: 18, left: 0, bottom: 26 }}>
              <CartesianGrid strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="country" angle={-18} textAnchor="end" interval={0} height={62} />
              <YAxis domain={[0, 100]} tickFormatter={(value) => formatStoredPercent(value, 0)} />
              <Tooltip content={<ChartTooltip valueFormatter={(value) => formatStoredPercent(value)} />} />
              <Legend />
              {compositionNames.map((segment) => (
                <Bar key={segment} dataKey={segment} stackId="segments" fill={segmentColor(segment)} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="panel-note">Behavioural shares are included with commercial market measures when geographic segments are created.</p>
      </Panel>

      <section className="geographic-evolution-section">
        <div className="section-heading-inline">
          <div><span className="eyebrow">Cycle 0 to Cycle 9</span><h2>Geographic behavioural segment evolution across cycles</h2></div>
          <p>Each chart tracks how the behavioural customer mix changes within one major geographic market.</p>
        </div>
        <div className="geographic-evolution-grid">
          {evolutionMarkets.map((market) => {
            const marketRows = (analytics.behaviouralEvolution || [])
              .filter((row) => row.country === market.country)
              .map((row) => ({ ...row, cycle: cycleLabel(row.CycleID) }));
            return (
              <Panel key={market.country} title={market.country} eyebrow={market.geographicSegment}>
                <div className="chart-medium">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={marketRows}>
                      <CartesianGrid strokeDasharray="3 6" vertical={false} />
                      <XAxis dataKey="cycle" tick={{ fontSize: 9 }} />
                      <YAxis domain={[0, 100]} tickFormatter={(value) => formatStoredPercent(value, 0)} />
                      <Tooltip content={<ChartTooltip valueFormatter={(value) => formatStoredPercent(value)} />} />
                      {compositionNames.map((segment) => (
                        <Line key={segment} dataKey={segment} name={segment} stroke={segmentColor(segment)} strokeWidth={2.2} dot={{ r: 2.5 }} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            );
          })}
        </div>
        <div className="chart-legend-row">
          {compositionNames.map((segment) => <span key={segment}><i style={{ background: segmentColor(segment) }} />{segment}</span>)}
        </div>
      </section>

      <Panel title="Market behavioural composition detail" eyebrow={cycleLabel(analytics.latestCycle)}>
        <DataTable
          rows={markets}
          columns={[
            { key: 'country', label: 'Country' },
            { key: 'geographicSegment', label: 'Geographic segment' },
            { key: 'championsShare', label: 'Champions', render: formatPercent },
            { key: 'loyalistsShare', label: 'Loyalists', render: formatPercent },
            { key: 'midTierOccasionalsShare', label: 'Mid-Tier Occasionals', render: formatPercent },
            { key: 'developingShare', label: 'Light Buyers family', render: formatPercent },
            { key: 'hibernatingLostShare', label: 'Hibernating / Lost', render: formatPercent },
            { key: 'atRiskShare', label: 'At risk (separate label)', render: formatPercent },
          ]}
        />
      </Panel>

      <Panel title="Geographic segmentation detail" eyebrow="Market features and assigned segment">
        <DataTable
          rows={markets}
          columns={[
            { key: 'country', label: 'Country' },
            { key: 'geographicSegment', label: 'Geographic segment' },
            { key: 'customers', label: 'Customers', render: formatNumber },
            { key: 'activeCustomers', label: 'Active', render: formatNumber },
            { key: 'orders', label: 'Orders', render: formatNumber },
            { key: 'products', label: 'Distinct products', render: formatNumber },
            { key: 'revenue', label: 'Revenue', render: (value) => <strong>{formatCurrency(value)}</strong> },
            { key: 'revenuePerCustomer', label: 'Revenue/customer', render: (value) => formatCurrency(value) },
            { key: 'repeatPurchaseRate', label: 'Repeat rate', render: formatPercent },
          ]}
        />
      </Panel>
    </>
  );
}

function FirmographicPage({ data }) {
  const analytics = data.firmographicAnalytics;
  const summary = analytics.summary || {};
  const combinations = [...(analytics.combinations || [])].sort((left, right) => segmentOrder(left.behaviouralSegment) - segmentOrder(right.behaviouralSegment) || String(left.geographicSegment).localeCompare(String(right.geographicSegment)));
  const combinationChart = combinations.slice(0, 12).reverse();
  const evolution = pivotSeries(analytics.evolution || [], 'customers', 'geographicSegment');
  const behaviouralNames = orderSegmentProfiles([...new Set((analytics.matrix || []).map((row) => row.behaviouralSegment))].map((segment) => ({ segment }))).map((row) => row.segment);
  const matrixRows = GEOGRAPHIC_SEGMENTS.map((geographicSegment) => {
    const row = { geographicSegment };
    behaviouralNames.forEach((behaviouralSegment) => {
      row[behaviouralSegment] = Number(
        (analytics.matrix || []).find(
          (item) => item.geographicSegment === geographicSegment
            && item.behaviouralSegment === behaviouralSegment,
        )?.customers || 0,
      );
    });
    return row;
  });
  const activity = [
    { name: 'Active', value: Number(summary.activeCustomers || 0), color: '#168a58' },
    { name: 'Inactive', value: Number(summary.inactiveCustomers || 0), color: '#85978e' },
  ];

  return (
    <>
      <PageTitle
        eyebrow="Firmographic customer-market segmentation"
        title="Combine behaviour with geographic market context"
        description="Each customer receives a derived customer-market label formed from a dynamic behavioural profile and an interpretable country-market profile, such as Highest Revenue per Customer Champions. The combinations use three geographic market groups and the stored behavioural assignment labels. Risk remains a separate customer label. These labels do not verify company size or legal business type."
      />
      <section className="integration-banner">
        <div><span>Behavioural segment</span><strong>How the customer behaves</strong></div>
        <b>+</b>
        <div><span>Geographic segment</span><strong>What type of market they purchase in</strong></div>
        <b>=</b>
        <div><span>Firmographic segment</span><strong>Customer behaviour in market context</strong></div>
      </section>

      <div className="metric-grid metric-grid-six">
        <MetricCard label="Customers" value={formatNumber(summary.customers)} detail={cycleLabel(analytics.latestCycle)} />
        <MetricCard label="Firmographic groups" value={formatNumber(summary.firmographicSegments)} detail="Occupied combinations" tone="gold" />
        <MetricCard label="Geographic segments" value={formatNumber(summary.geographicSegments)} detail={`${formatNumber(summary.markets)} markets`} tone="blue" />
        <MetricCard label="Behavioural segments" value={formatNumber(summary.behaviouralSegments)} detail="Dynamic RFM groups" tone="green" />
        <MetricCard label="Active customers" value={formatNumber(summary.activeCustomers)} detail="Current cycle purchasers" />
        <MetricCard label="Average confidence" value={formatPercent(summary.averageMembership)} detail="Fuzzy membership" tone="purple" />
      </div>

      <div className="content-grid two-one">
        <Panel title="Largest firmographic combinations" eyebrow={cycleLabel(analytics.latestCycle)}>
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={combinationChart} layout="vertical" margin={{ left: 160, right: 18 }}>
                <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                <XAxis type="number" />
                <YAxis type="category" dataKey="firmographicSegment" width={230} tick={{ fontSize: 10 }} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} customers`} />} />
                <Bar dataKey="customers" name="Customers" fill="#168a58" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Customer activity" eyebrow="Cumulative customer base">
          <div className="chart-xl donut-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={activity} dataKey="value" nameKey="name" innerRadius={80} outerRadius={126} paddingAngle={3}>
                  {activity.map((item) => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} customers`} />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center"><strong>{formatNumber(summary.customers)}</strong><span>customers</span></div>
          </div>
        </Panel>
      </div>

      <div className="content-grid equal">
        <Panel title="Behaviour within each market segment" eyebrow="Firmographic composition matrix">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={matrixRows} margin={{ bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="geographicSegment" angle={-12} textAnchor="end" height={70} interval={0} />
                <YAxis />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} customers`} />} />
                <Legend />
                {behaviouralNames.map((segment) => (
                  <Bar key={segment} dataKey={segment} stackId="behaviour" fill={segmentColor(segment)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Firmographic customer evolution" eyebrow="Customer base by market segment">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={evolution}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="cycle" />
                <YAxis />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} customers`} />} />
                <Legend />
                {GEOGRAPHIC_SEGMENTS.map((segment) => (
                  <Area key={segment} dataKey={segment} stackId="markets" stroke={GEOGRAPHIC_COLORS[segment]} fill={GEOGRAPHIC_COLORS[segment]} fillOpacity={0.72} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Firmographic segment detail" eyebrow="Behavioural and geographic combination">
        <DataTable
          rows={combinations}
          columns={[
            { key: 'firmographicSegment', label: 'Firmographic segment' },
            { key: 'geographicSegment', label: 'Geographic segment' },
            { key: 'behaviouralSegment', label: 'Behavioural segment', render: (value) => <SegmentBadge segment={value} /> },
            { key: 'customers', label: 'Customers', render: formatNumber },
            { key: 'activeCustomers', label: 'Active', render: formatNumber },
            { key: 'inactiveCustomers', label: 'Inactive', render: formatNumber },
            { key: 'markets', label: 'Markets', render: formatNumber },
            { key: 'averageMembership', label: 'Confidence', render: (value) => value == null ? 'N/A' : formatPercent(value) },
          ]}
        />
      </Panel>
    </>
  );
}

function FigureGallery({ artifacts, limit }) {
  const [activeImage, setActiveImage] = useState(null);
  const visible = typeof limit === 'number' ? artifacts.slice(0, limit) : artifacts;
  if (!visible.length) return <EmptyState title="No figures in this category" />;
  return (
    <>
      <div className="figure-grid">
        {visible.map((artifact) => {
          const meta = getFigureMeta(artifact);
          return (
            <button className="figure-card" key={artifact.relativePath} onClick={() => setActiveImage({ artifact, meta })}>
              <div className="figure-image">
                <img src={apiAssetUrl(artifact.imageUrl)} alt={meta.title} loading="lazy" />
              </div>
              <div>
                <span>{artifact.category}</span>
                <h3>{meta.title}</h3>
                <p>{meta.description}</p>
              </div>
            </button>
          );
        })}
      </div>
      {activeImage && (
        <div className="modal-backdrop image-backdrop" onMouseDown={() => setActiveImage(null)}>
          <div className="image-modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setActiveImage(null)} aria-label="Close figure">×</button>
            <img src={apiAssetUrl(activeImage.artifact.imageUrl)} alt={activeImage.meta.title} />
            <div>
              <span className="eyebrow">{activeImage.artifact.category}</span>
              <h2>{activeImage.meta.title}</h2>
              <p>{activeImage.meta.description}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SemanticConsistencyPanel({ audit }) {
  const totals = audit?.totals || {};
  return <Panel title="Do segment names and customer movements stay meaningful?" eyebrow="Profile continuity and migration diagnostics">
    <p className="method-copy"><strong>Cluster identity:</strong> tracking IDs link centres using distance and fuzzy customer overlap. Names are checked separately against each centre’s membership-weighted recency, frequency and monetary profile. A continued ID can receive a different name when its profile changes; “Champions remain Champions” is checked from the saved RFM evidence and is not assumed from the ID.</p>
    <p className="method-copy"><strong>Behavioural migration:</strong> for each customer present in consecutive cycles, compare current RFM against the previous centres, then previous RFM against the current centres. The first comparison holds boundaries fixed; the second holds customer features fixed. Comparing both with the actual assignment distinguishes feature-supported movement, boundary-supported movement, both, and a combined effect.</p>
    <p className="method-copy">Every observed customer receives updated RFM and membership each cycle. Without another purchase, recency increases while frequency and spend can stay positive until those purchases leave the 90-day window. Lifetime history establishes customer eligibility and the latest purchase date; F/M use the rolling window. Individual warnings are At risk at 31–60 days, Slipping at 61–90, and Lost beyond 90; earlier deterioration can also trigger At risk.</p>
    {audit?.available ? <>
      <div className="metric-grid metric-grid-six">
        <MetricCard label="Centre profiles checked" value={formatNumber(totals.profileChecks)} detail={`${formatNumber(totals.profileRuleFailures)} recency-rule failures`} />
        <MetricCard label="Names retained on linked IDs" value={`${formatNumber(totals.sameNameLinks)} / ${formatNumber(totals.primaryIdLinks)}`} detail={`${formatNumber(totals.renamedLinks)} linked centres changed descriptive names`} />
        <MetricCard label="Customer comparisons" value={formatNumber(totals.sharedCustomerComparisons)} detail="Returning customers across adjacent cycles" />
        <MetricCard label="Tracking-ID migrations" value={formatNumber(totals.actualIdMigrations)} detail={`${formatNumber(totals.profileOnlyRenames)} further label changes kept the same ID`} />
      </div>
      <DataTable rows={audit.cycles || []} columns={[
        { key: 'cycleId', label: 'Cycle', render: cycleLabel },
        { key: 'sharedCustomers', label: 'Returning customers', render: formatNumber },
        { key: 'actualIdMigrations', label: 'ID changed', render: formatNumber },
        { key: 'behaviourOnly', label: 'Feature change alone', render: formatNumber },
        { key: 'boundaryOnly', label: 'Boundary change alone', render: formatNumber },
        { key: 'both', label: 'Both separately switch', render: formatNumber },
        { key: 'interaction', label: 'Combined effect', render: formatNumber },
        { key: 'renamedCentres', label: 'Linked centres renamed', render: formatNumber },
        { key: 'profileOnlyRenames', label: 'Label changed; same ID', render: formatNumber },
      ]} />
      <p className="method-copy">The four movement columns partition actual tracking-ID changes. “Both” means either change on its own crosses a boundary; “Combined effect” means the changes together cross it. These geometric diagnostics support interpretation and do not establish a causal explanation. {formatNumber(totals.unchangedRfmMigrants)} migrations had numerically unchanged RFM. Relative naming rules remain descriptive study choices.</p>
    </> : <p className="method-copy">The current run has no saved continuity audit. Numerical evidence is shown only after that audit is available.</p>}
  </Panel>;
}

function ModelPage({ data }) {
  const evaluation = data.modelEvaluation;
  const geographicMethod = evaluation.geographicMethod || {};
  const averages = evaluation.averages || {};
  const cycles = evaluation.cycles || [];
  const candidateEvaluations = evaluation.candidateEvaluations || [];
  const baselineProfiles = evaluation.baselineProfiles || [];
  const latestCycleId = evaluation.latest?.CycleID || 'Cycle_9';
  const [qualityCycle, setQualityCycle] = useState(latestCycleId);
  const modelRegistry = fittedRegistry(data);
  const countChecks = cycles.map(cycle => {
    const entries = modelRegistry.filter(row => row.CycleID === cycle.CycleID);
    const names = new Set(entries.map(row => row.displayLabel)).size;
    const colours = new Set(entries.map(clusterColor)).size;
    const filters = (data.filters?.clusters || []).filter(row => row.CycleID === cycle.CycleID).length;
    const k = Number(cycle.SelectedK);
    return { cycleId: cycle.CycleID, fittedK: k, displayedClusters: entries.length,
      distinctNames: names, distinctColours: colours, customerFilterEntries: filters,
      status: [entries.length, names, colours, filters].every(value => value === k) ? 'Match' : 'Review mismatch' };
  });
  const latestFittedClusters = orderClusters(modelRegistry.filter((row) => row.CycleID === latestCycleId));
  const baselineProfileDescriptions = {
    Champions: 'Most recent, highest-frequency, and highest-monetary profile in the baseline.',
    'Loyalists': 'Repeat-customer profile with recent purchases and consistent order frequency.',
    'Mid-Tier Occasionals': 'A moderate-frequency and moderate-spend profile relative to the other baseline centres.',
    'Light Buyers': 'Relatively low-frequency, lower-spending recent buyers; growth is not assumed.',
    'Valuable Customers at Risk': 'Meaningful rolling-window purchasing value with a weighted purchase gap of 31–90 days.',
    'Light Buyers at Risk': 'A light purchasing profile with a weighted purchase gap of 31–90 days.',
  };
  const baselineProfileRows = orderSegmentProfiles(baselineProfiles).map((profile) => ({
    ...profile,
    segment: modelRegistry.find((row) => row.CycleID === 'Cycle_0' && row.stableClusterId === profile.stableClusterId)?.displayLabel || profile.segment,
    interpretation: baselineProfileDescriptions[profile.segment] || 'RFM profile observed in the baseline.',
  }));
  const clusterCountPath = cycles.map((row) => `${cycleLabel(row.CycleID)}: K=${formatNumber(row.SelectedK)}`).join('  →  ');
  const structureChanges = cycles.slice(1).map((row) => {
    const action = row.SelectedOperation === 'incremental_center_movement'
      ? 'K retained; existing centres moved incrementally'
      : row.SelectedOperation === 'eliminate_one_cluster'
        ? 'K−1 candidate selected'
        : row.SelectedOperation === 'split_one_cluster'
          ? 'K+1 candidate selected'
          : String(row.SelectedOperation || 'operation recorded');
    return `${cycleLabel(row.CycleID)} ${action}`;
  }).join(' · ');
  const hardWinnerSummary = cycles.slice(1).map((row) =>
    `${cycleLabel(row.CycleID)} ${formatNumber(row.HardWinningClusterCount)}/${formatNumber(row.SelectedK)} centres win a customer’s largest-membership label`,
  ).join('; ');
  const changedKSelected = cycles.slice(1).some((row) =>
    row.SelectedOperation === 'eliminate_one_cluster' || row.SelectedOperation === 'split_one_cluster',
  );
  const operationLabel = (action) => ({
    incremental_center_movement: 'Move existing centres with the incremental update (Eqs. 14–16)',
    eliminate_one_cluster: 'Remove one previous cluster as a K−1 starting point',
    retain_structure: 'Retain the current cluster count',
    split_one_cluster: 'Split one previous cluster as a K+1 starting point',
  }[action] || action || '—');
  const trackingSources = (value) => {
    try {
      const ids = JSON.parse(value || '[]');
      return ids.length ? ids.join(', ') : '—';
    } catch {
      return '—';
    }
  };
  const modelFigures = data.artifacts.filter((artifact) =>
    [
      'performance',
      'baseline',
      'model diagnostics',
      'dynamic segmentation',
      'validation',
      'methodology',
      'geographic segmentation',
      'firmographic segmentation',
    ].includes(artifact.category) && artifact.imageUrl,
  );
  const cycle0KSelectionFigures = modelFigures.filter((artifact) =>
    /cycle0_(elbow_wcss|silhouette_by_k)\.png$/i.test(String(artifact.relativePath || '')),
  );
  const otherModelFigures = modelFigures.filter((artifact) =>
    !cycle0KSelectionFigures.some((selected) => selected.relativePath === artifact.relativePath),
  );

  return (
    <main className="standalone-page">
      <PageTitle
        eyebrow="Model and methodology"
        title="A behavioural and geographic firmographic model"
        description="See how RFM features and fuzzy clustering describe changing customer behaviour, then how those profiles are compared with geographic markets."
        action={<StatusPill tone="success">{formatNumber(averages.convergedCycles)} of {formatNumber(averages.dynamicCycles)} cycle fits converged</StatusPill>}
      />

      <Panel title="Fitted K and displayed clusters" eyebrow="One visible entry per actual fitted centre">
        <p className="method-copy">Every cycle uses its own fitted K from the loaded results. The PCA legend, fitted-profile tables and customer filter list each centre separately. Performance metrics use that cycle’s numerical assignments and memberships. Descriptive labels do not combine centres or determine K; a qualifier distinguishes genuine centres with similar supported profiles.</p>
        <DataTable rows={countChecks} columns={[
          { key: 'cycleId', label: 'Cycle', render: cycleLabel },
          { key: 'fittedK', label: 'Fitted K', render: formatNumber },
          { key: 'displayedClusters', label: 'Displayed clusters', render: formatNumber },
          { key: 'distinctNames', label: 'Distinct display names', render: formatNumber },
          { key: 'distinctColours', label: 'Distinct PCA colours', render: formatNumber },
          { key: 'customerFilterEntries', label: 'Customer filter entries', render: formatNumber },
          { key: 'status', label: 'Count check' },
        ]} />
        <p className="panel-note">The approved names distinguish Champions from High-Value Regulars, use factual Light Buyers descriptions, and retain one Hibernating / Lost category above 90 days. These reporting names preserve the fitted model and its individual customer warnings.</p>
      </Panel>

      <section className="model-flow">
        {[
          ['01', 'Verified transaction source', 'Use the cell-verified UCI Online Retail workbook and retain wholesale-oriented wording without assuming every customer is a registered business.'],
          ['02', 'Paid-sales cleaning', 'Exclude unlinked customers, exact repeated rows, cancellations, returns, zero-price lines, and invalid negative-price adjustments from model inputs; retain source records and cleaning counts in the audit.'],
          ['03', 'Cycle features and recency', 'Monthly snapshots include every customer observed before the snapshot. Every cycle uses exact recency and the same trailing 90-day RFM purchase window. Frequency and paid sales are divided by three for monthly equivalents; commercial cycle totals are separate.'],
          ['04', 'Transform and reduce', 'Apply log1p to R, F, and M, then form RF, RM, and FM by multiplying those logged values. Min–Max scale the six features and project them into three PCA components. “Cascaded” refers to this feature construction, not a separate clustering step.'],
          ['05', 'Cycle 0 baseline', 'Choose K from the K-means within-cluster sum-of-squares (WCSS) elbow over K=2–10; silhouette supports the choice. Fit static K-means at that K and store crisp one-hot assignments. MDFCM starts only in Cycle 1.'],
          ['06', 'Dynamic fuzzy updates', 'Use the two MDFCM condition checks to decide which cluster counts may be compared. When c is retained, move its centres with the paper’s incremental update equations; use fuzzy C-means and Xie–Beni to compare any permitted c−1 or c+1 candidates.'],
          ['07', 'Track and interpret', 'Keep the best-fit cluster tracking IDs separate from cycle-specific RFM profile names; compare customer changes with cluster movement and geographic market results.'],
        ].map(([step, title, description], index) => (
          <article key={step}>
            <span>{step}</span>
            <h3>{title}</h3>
            <p>{description}</p>
            {index < 6 && <b>→</b>}
          </article>
        ))}
      </section>

      <Panel title="Data processing in the methodology order" eyebrow="Inputs to Cycle 0 K-means and Cycles 1–9 MDFCM">
        <ol className="method-list preprocessing-order">
          <li><strong>Data cleaning — missing values and invalid records.</strong> Keep customer-linked qualifying paid sales. Audit missing identifiers, invalid dates and values, exact duplicates, returns, cancellations, and zero or negative quantity/price records.</li>
          <li><strong>Cycles and recency window — customer snapshots.</strong> Build Cycle 0 and the monthly Cycle 1–9 snapshots. Include every customer observed before each snapshot, using only prior transactions and the exact trailing 90-day RFM window. Refit all observed customers even when they did not purchase this month.</li>
          <li><strong>Feature engineering — cascaded RFM.</strong> Calculate exact recency in days, distinct invoices in the preceding 90 days divided by three, and positive paid sales in that same window divided by three. F/M are comparable monthly equivalents in every cycle. The model uses R, F, M and their RF, RM, FM interactions.</li>
          <li><strong>Normalization — log transformation.</strong> Apply log1p to R, F, M; form RF, RM, FM by multiplying the logged base values. This is the precise cascaded feature construction implemented here.</li>
          <li><strong>Standardization — Min–Max scaling.</strong> Fit the scaler on Cycle 0 and reuse it for later customer snapshots; later observations can fall beyond the original fitted range.</li>
          <li><strong>Dimension reduction — principal component analysis.</strong> Fit three PCA components on the scaled Cycle 0 features and project every later cycle into that same reference space.</li>
        </ol>
      </Panel>

      <div className="content-grid equal model-methodology-grid">
        <Panel title="Cycle and feature definitions" eyebrow="Time windows and treatment">
          <ul className="method-list">
            <li><strong>Cycle 0:</strong> 1 December 2010 through February 2011; the period end is 1 March, exclusive.</li>
            <li><strong>Cycles 1–9:</strong> monthly March through November 2011; the partial December 2011 period is excluded.</li>
            <li><strong>Recency:</strong> exact days since the most recent qualifying paid purchase, without capping. An individual gap beyond 90 days means no purchase inside the current RFM window. The Hibernating / Lost cluster label describes its weighted centre; individual members can differ.</li>
            <li><strong>Frequency:</strong> distinct qualifying paid invoices in the exact trailing 90-day window, divided by three to give a monthly equivalent in every cycle.</li>
            <li><strong>Monetary:</strong> qualifying positive paid sales in the same trailing 90 days, divided by three. Returns and cancellations are excluded. Exact commercial cycle sales are stored separately.</li>
            <li><strong>Purchase activity:</strong> Active/Inactive records whether a customer purchased in the commercial cycle. Both are fitted at every snapshot. The current 90-day RFM values and fuzzy memberships are recomputed; inactivity does not freeze a prior assignment.</li>
            <li><strong>Overlapping snapshots:</strong> a returning customer’s previous observation and membership mass are replaced before their current observation is added. The same customer is not counted twice because consecutive 90-day windows overlap.</li>
            <li><strong>Excluded rows:</strong> zero/negative-quantity, zero/negative-price, and cancellation records remain in the source and cleaning audit but are excluded from customer modelling.</li>
          </ul>
        </Panel>
        <Panel title="How the cluster count is chosen" eyebrow="Dynamic fuzzy candidate comparison">
          <p className="method-copy">Cycle 0 is static K-means. The MDFCM branches apply only to Cycles 1–9: Condition 1 alone compares K−1 and K+1; Condition 2 alone compares K and K+1; both compare K−1, K, and K+1; neither retains K and moves its existing centres incrementally using the paper’s Eqs. 14–16. Condition 2 follows Eq. 9: each incoming customer must be farther from every prior centre than half that centre’s farthest separation from another prior centre. A monthly batch meets a condition if at least one fitted customer satisfies it. Only permitted changed-K alternatives use standard fuzzy C-means, initialized by removing a prior centre for K−1 or splitting one for K+1; converged finite options are compared by Xie–Beni.</p>
          <p className="method-copy">Observed path: {clusterCountPath}. Selected operations: {structureChanges}. MDFCM conditions are evaluated on all observed customer snapshots; the recorded condition counts show whether any customer qualified for each branch. FCM uses m=2 and stops when absolute objective change is at most 0.01, with a 300-iteration safety cap. The paper gives E_FCM=0.01 but does not fully specify its stopping calculation; this project interprets it as absolute objective change. Full-population monthly snapshot batches and the batch-level condition rule are project adaptations.</p>
          <p className="method-copy">Cycle 0 stores a one-hot representation of its static K-means assignments. MDFCM produces fuzzy membership percentages only in Cycles 1–9. Charts colour each customer by the assigned or largest-membership cluster, while the stored vector remains available in customer details.</p>
        </Panel>
      </div>

      <Panel title="How the three geographic market groups are formed" eyebrow="Country-market K-means · separate from behavioural MDFCM">
        <p className="method-copy">Each observation is a country market. Exact trailing 90-day transactions provide customer count, positive paid sales, orders per customer, paid sales per customer, distinct product breadth, repeat-purchase rate, and stored behavioural-profile shares. These describe the country’s commercial activity and customer mix.</p>
        <p className="method-copy">{geographicMethod.preprocessing || 'The scale measures are transformed with log1p; a RobustScaler is fitted on Cycle 0.'} K-means is fitted to the scaled Cycle 0 country features with K={geographicMethod.clusterCount || 3}, {geographicMethod.nInit || 50} initializations, and random seed {geographicMethod.randomState ?? 42}. {geographicMethod.laterCycles || 'Later snapshots use the frozen Cycle 0 scaler and centres.'}</p>
        <p className="method-copy">{geographicMethod.selection || 'Three descriptive market groups are specified for the geographic analysis; behavioural elbow selection is a separate procedure.'} Baseline groups are named from their total revenue, then the remaining groups’ average revenue per customer: Largest Revenue Market, Highest Revenue-per-Customer Market, and Other Markets. A name describes the baseline group and can be less literal in later cycles.</p>
        <p className="method-copy">{geographicMethod.risk || 'At-risk share is displayed as customer context and is excluded from the geographic fitting features.'} Geographic results combine with customer assignment labels to form customer-market labels. They do not establish company size, industry, or legal business type.</p>
        <div className="chart-legend-row">{GEOGRAPHIC_SEGMENTS.map((segment) => <span key={segment}><i style={{ background: GEOGRAPHIC_COLORS[segment] }} />{segment}</span>)}</div>
      </Panel>

      <ModelComputationVisuals explainedVariance={data.pcaAnalytics?.explainedVariance} />

      <div className="metric-grid metric-grid-six">
        <MetricCard label="Selected Cycle 0 K" value={formatNumber(evaluation.baseline?.clusterCount)} detail="Accepted WCSS elbow choice" tone="green" />
        <MetricCard label="Cycle 0 inertia (WCSS)" value={formatDecimal(evaluation.baseline?.Inertia)} detail="Static model fit at the elbow-selected K" />
        <MetricCard label="Cycle 0 silhouette" value={formatDecimal(evaluation.baseline?.SilhouetteScore)} detail="Computed from static K-means assignments" />
        <MetricCard label="Cycle 0 Davies–Bouldin" value={formatDecimal(evaluation.baseline?.DaviesBouldinScore)} detail="Computed from static K-means assignments" />
        <MetricCard label="Cycle 0 Calinski–Harabasz" value={formatNumber(evaluation.baseline?.CalinskiHarabaszScore)} detail="Computed from static K-means assignments" />
        <MetricCard label="Average silhouette" value={formatDecimal(averages.silhouette)} detail="Dynamic cluster separation" />
        <MetricCard label="Average Xie-Beni" value={formatDecimal(averages.xieBeni)} detail="Fuzzy compactness" tone="green" />
        <MetricCard label="Davies-Bouldin" value={formatDecimal(averages.daviesBouldin)} detail="Average cluster similarity" tone="blue" />
        <MetricCard label="Calinski-Harabasz" value={formatNumber(averages.calinskiHarabasz)} detail="Separation vs compactness" tone="gold" />
        <MetricCard label="Mean max membership" value={formatPercent(averages.averageMembership)} detail="Average strongest fuzzy membership; not a probability" tone="purple" />
        <MetricCard label="Converged cycles" value={`${formatNumber(averages.convergedCycles)}/${formatNumber(averages.dynamicCycles)}`} detail="All dynamic updates" />
      </div>

      <p className="method-copy">Fitted centres versus customer labels: {hardWinnerSummary}. {changedKSelected ? 'At least one cycle selected a changed-K operation.' : 'No cycle selected a K−1 or K+1 operation in this run. Evaluated alternatives, where permitted, are recorded below.'} Any soft-only centre still contributes to fuzzy membership and Xie–Beni, while hard-label Silhouette, Davies–Bouldin, and Calinski–Harabasz use the largest-membership assignments of all currently fitted customers; a centre with no hard winner is absent from those hard-label calculations. A tracking ID creation or retirement is separate from an MDFCM change in K.</p>

      {evaluation.populationQualityDiagnostics?.available && <Panel title="Does the overall score hide weaker customer groups?" eyebrow={`${cycleLabel(evaluation.populationQualityDiagnostics.latestCycle)} · same fit, different population views`}>
        <p className="method-copy">This breakdown keeps the saved model and assignments fixed. A distinct dormant group can raise overall separation and membership concentration while purchasing customers still overlap. Compare the populations before concluding that a higher headline score means better segmentation. These are subset diagnostics; no alternative model was fitted to improve the figures.</p>
        <DataTable rows={evaluation.populationQualityDiagnostics.latest || []} columns={[
          { key: 'scope', label: 'Population' },
          { key: 'customers', label: 'Customers', render: formatNumber },
          { key: 'occupied_labels', label: 'Assigned centres represented', render: formatNumber },
          { key: 'silhouette', label: 'Silhouette within population', render: value => value == null ? 'Unavailable: one occupied label' : formatDecimal(value,3) },
          { key: 'mean_max_membership', label: 'Mean maximum membership', render: value => formatPercent(value,1) },
        ]} />
        <p className="method-copy">The 90-day and monthly-purchaser populations overlap, so these rows must not be added together. High membership is not a probability of a correct label, and scores from the previous purchaser-only model use a different population.</p>
      </Panel>}

      <Panel title="Cycle 0 static K-means baseline" eyebrow="K selected primarily from the WCSS elbow; silhouette is supporting evidence">
        <p className="method-copy">These are the Cycle 0 K-means clusters, shown with their tracking ID and RFM family profile. Their stored membership vectors are one-hot hard assignments, not fuzzy confidence scores. The profile labels summarize observed RFM behaviour; distinct numeric centres may share one business-group name. Customer risk labels are evaluated separately.</p>
        <DataTable
          rows={baselineProfileRows}
          columns={[
            { key: 'clusterNumber', label: 'K-means group', render: (value) => `Cluster ${formatNumber(Number(value) + 1)}` },
            { key: 'stableClusterId', label: 'Tracking ID' },
            { key: 'segment', label: 'RFM family' },
            { key: 'customers', label: 'Customers', render: (value) => formatNumber(value) },
            { key: 'recency', label: 'Mean recency (days)', render: (value) => formatDecimal(value, 1) },
            { key: 'frequency', label: 'Mean frequency / month', render: (value) => formatDecimal(value, 2) },
            { key: 'monetary', label: 'Mean paid sales / month', render: (value) => formatCurrency(value) },
            { key: 'interpretation', label: 'Profile interpretation' },
          ]}
        />
      </Panel>

      <Panel title="Cycle 0 K-selection evidence" eyebrow="Accepted baseline: K=5 from the WCSS elbow">
        <p className="method-copy">The elbow plot shows the measured WCSS for each tested K and marks the accepted Cycle 0 choice of K=5. The companion silhouette plot provides supporting evidence; a different silhouette maximum does not override the accepted elbow choice.</p>
        <FigureGallery artifacts={cycle0KSelectionFigures} />
      </Panel>

      <Panel title={`${latestFittedClusters.length} fitted clusters in ${cycleLabel(latestCycleId)}`} eyebrow="Current registry · all currently fitted customers">
        <p className="method-copy">The row count equals the selected model K. Each centre has one distinct display label and tracking ID; soft-only centres are included. Weighted RFM uses all current customer snapshots. A customer risk warning is a separate individual assessment, and monthly purchase inactivity does not remove a customer from fitting or create another centre.</p>
        <ClusterProfileTable clusters={latestFittedClusters} />
      </Panel>

      <Panel title="Quality of each fitted cluster" eyebrow={cycleLabel(qualityCycle)} action={<select value={qualityCycle} onChange={event => setQualityCycle(event.target.value)} aria-label="Per-cluster quality cycle">{cycles.map(row => <option key={row.CycleID} value={row.CycleID}>{cycleLabel(row.CycleID)}</option>)}</select>}>
        <p className="method-copy">Each row uses the existing fitted cluster, its actual centre, and current memberships. Mean silhouette and negative-silhouette share summarize hard assignments within the full partition. Fuzzy objective contributions sum to the cycle objective. Cycle 0 membership confidence is unavailable; its assigned-customer SSE sums to inertia. DB, CH and XB remain cycle-level measures.</p>
        <ClusterQualityTable clusters={modelRegistry.filter(row => row.CycleID === qualityCycle)} />
      </Panel>

      <Panel title="Cluster-count changes and tracking" eyebrow="Baseline followed by fuzzy structure choices">
        <p className="method-copy">Selected cluster count by cycle: {clusterCountPath}. Selected operations: {structureChanges}. Candidate-level records show only the options permitted by each cycle’s condition checks. For K−1, a prior centre is omitted as a candidate initialization; for K+1, a prior centre is split to seed standard FCM. These are candidate starts, not guaranteed mergers or splits of real customer groups. The retained-K path uses the paper’s Eqs. 14–16. In this full-snapshot adaptation, replaced observations leave zero historical carry-over mass, so that blend reduces to the current population’s fuzzy centre update initialized from previous centres.</p>
        <p className="method-copy"><strong>What lineage means here:</strong> each cycle’s fitted clusters are paired one-to-one with the previous cycle using normalized centre distance and fuzzy-membership weighted Jaccard across shared customers. The SQLite column `CustomerOverlapJaccard` is a legacy name for this weighted score. A tracking ID continues only when weighted Jaccard is at least 0.05 and match cost is lower than retiring the old centre and creating a new one. These IDs are provisional tracking aids, not proof that a cluster is an unchanged real-world group. Secondary split/merge contribution links describe fuzzy membership overlap; they are lineage evidence, not MDFCM structure operations.</p>      </Panel>

      <SemanticConsistencyPanel audit={evaluation.semanticConsistency} />

      <Panel title="MDFCM candidate checks" eyebrow="Condition-permitted cluster counts evaluated in each cycle">
        <p className="method-copy">Each row is a permitted candidate operation. The selected changed-K row has the lowest finite Xie–Beni score among converged candidates. For K−1, the source ID is the omitted prior centre; for K+1, it is the centre split to seed standard FCM. When c is retained, the selected operation is the incremental centre movement. The rows below record the alternatives permitted by the observed condition checks. An unselected or unpermitted option is not reported as a real structure change. These candidate choices are separate from provisional tracking IDs.</p>        <DataTable
          rows={candidateEvaluations}
          columns={[
            { key: 'CycleID', label: 'Cycle', render: cycleLabel },
            { key: 'PreviousK', label: 'Previous K', render: formatNumber },
            { key: 'CandidateK', label: 'Candidate K', render: formatNumber },
            { key: 'InitializationAction', label: 'Candidate start', render: operationLabel },
            { key: 'SourceStableClusterIDs', label: 'Source tracking IDs', render: trackingSources },
            { key: 'ResultStableClusterIDs', label: 'Selected result ID(s)', render: trackingSources },
            { key: 'XieBeniIndex', label: 'Xie–Beni', render: (value) => formatDecimal(value, 4) },
            { key: 'Iterations', label: 'FCM iterations', render: formatNumber },
            { key: 'Converged', label: 'Converged', render: (value) => Number(value) === 1 ? 'Yes' : 'No' },
            { key: 'FinalObjectiveChange', label: 'Final objective change', render: (value) => formatDecimal(value, 5) },
            { key: 'Selected', label: 'Selected', render: (value) => Number(value) === 1 ? 'Yes' : 'No' },
          ]}
        />
      </Panel>

      <div className="content-grid equal">
        <Panel title="Cluster quality across cycles" eyebrow="Silhouette and Davies-Bouldin">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cycles}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="CycleID" tickFormatter={cycleLabel} />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line yAxisId="left" dataKey="SilhouetteScore" name="Silhouette" stroke="#168a58" strokeWidth={3} />
                <Line yAxisId="right" dataKey="DaviesBouldinScore" name="Davies-Bouldin" stroke="#e59a38" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Fuzzy validity and confidence" eyebrow="Xie-Beni and membership">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cycles}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="CycleID" tickFormatter={cycleLabel} />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" domain={[0, 1]} tickFormatter={(value) => formatPercent(value, 0)} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line yAxisId="left" dataKey="XieBeniIndex" name="Xie-Beni" stroke="#168a58" strokeWidth={3} />
                <Line yAxisId="right" dataKey="AverageMembership" name="Membership" stroke="#8a6ec1" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Model evaluation by cycle" eyebrow="Cycle 0 to Cycle 9 evidence">
        <p className="method-copy">Cycle 0 uses static K-means; Cycles 1–9 use dynamic MDFCM. Inertia (WCSS: the sum of squared distances to fitted centres), silhouette, Davies–Bouldin and Calinski–Harabasz are reported for Cycle 0. Xie–Beni, fuzzy objective, and mean maximum membership are reported for Cycles 1–9 only. A dash means a measure does not apply to that method or is unavailable.</p>
        <DataTable
          rows={cycles}
          columns={[
            { key: 'CycleID', label: 'Cycle', render: cycleLabel },
            { key: 'CustomersProcessed', label: 'Customers', render: formatNumber },
            { key: 'SilhouetteScore', label: 'Silhouette', render: (value) => value == null ? '—' : formatDecimal(value, 3) },
            { key: 'DaviesBouldinScore', label: 'Davies-Bouldin', render: (value) => value == null ? '—' : formatDecimal(value, 3) },
            { key: 'CalinskiHarabaszScore', label: 'Calinski–Harabasz', render: (value) => value == null ? '—' : integer.format(Number(value)) },
            { key: 'XieBeniIndex', label: 'Xie-Beni', render: (value) => value == null ? '—' : formatDecimal(value, 3) },
            { key: 'Inertia', label: 'Inertia / hard WCSS', render: (value) => value == null ? '—' : formatDecimal(value, 2) },
            { key: 'SelectedK', label: 'Selected K', render: (value) => value == null ? '—' : formatNumber(value) },
            { key: 'HardWinningClusterCount', label: 'Hard-winning centres', render: (value) => value == null ? '—' : formatNumber(value) },
            { key: 'SoftOnlyCentreLocalIndexes', label: 'Soft-only centre numbers', render: (value) => Array.isArray(value) && value.length ? value.map((index) => Number(index) + 1).join(', ') : 'None' },
            { key: 'MDFCMDecision', label: 'MDFCM decision' },
            { key: 'SelectedOperation', label: 'Selected operation', render: operationLabel },
            { key: 'SelectedSourceStableClusterIDs', label: 'Source tracking IDs', render: trackingSources },
            { key: 'SelectedResultStableClusterIDs', label: 'Result tracking IDs', render: trackingSources },
            { key: 'Condition1ObservationCount', label: 'C1 customers', render: (value) => value == null ? '—' : formatNumber(value) },
            { key: 'Condition2ObservationCount', label: 'C2 customers', render: (value) => value == null ? '—' : formatNumber(value) },
            { key: 'CandidateXB', label: 'XB by eligible K', render: formatCandidateXb },
            { key: 'AverageMembership', label: 'Mean max membership', render: (value) => value == null ? '—' : formatPercent(value, 1) },
            { key: 'Iterations', label: 'Iterations', render: (value) => value == null ? '—' : formatNumber(value) },
            { key: 'ConvergenceCriterion', label: 'Stop rule' },
            { key: 'Converged', label: 'FCM fit converged', render: (value) => value == null ? '—' : Number(value) === 1 ? 'Yes' : 'No' },
          ]}
        />
      </Panel>

      <Panel title="Model evidence" eyebrow="Diagnostics, validation, and segmentation figures">
        <FigureGallery artifacts={otherModelFigures} />
      </Panel>
    </main>
  );
}

function EvaluationMetricPlot({ title, direction, rows, field, formatter = value => formatDecimal(value,3), xKey = 'cycleNumber', xLabel = 'Cycle', selectedX }) {
  const observed = rows.filter(row => row[field] != null && Number.isFinite(Number(row[field])));
  return <article className="evaluation-metric-plot">
    <h3>{title}</h3><p>{direction}</p>
    <div className="evaluation-chart">
      {observed.length ? <ResponsiveContainer width="100%" height="100%">
        <LineChart data={observed} margin={{top:14,right:18,bottom:24,left:6}}>
          <CartesianGrid stroke="var(--border-strong)" strokeWidth={0.65} />
          <XAxis dataKey={xKey} type="number" domain={['dataMin','dataMax']} ticks={observed.map(row => Number(row[xKey]))} allowDecimals={false} tick={{fontSize:11,fill:'var(--text-soft)'}} label={{value:xLabel,position:'insideBottom',offset:-15,fill:'var(--text-soft)',fontSize:12}} />
          <YAxis domain={['auto','auto']} width={62} tick={{fontSize:11,fill:'var(--text-soft)'}} tickFormatter={formatter} />
          <Tooltip formatter={value => [formatter(Number(value)),title]} labelFormatter={value => `${xLabel} ${value}`} contentStyle={{background:'var(--surface)',border:'1px solid var(--border)',fontSize:12}} />
          {selectedX != null && <ReferenceLine x={selectedX} stroke="var(--text-faint)" strokeDasharray="4 4" label={{value:`K=${selectedX}`,position:'insideTopRight',fill:'var(--text-soft)',fontSize:11}} />}
          <Line type="linear" dataKey={field} stroke="var(--evaluation-green)" strokeWidth={2.3} dot={{r:3.5,fill:'var(--evaluation-green)',strokeWidth:0}} activeDot={{r:5}} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer> : <EmptyState title="Metric unavailable" />}
    </div>
  </article>;
}

function EvaluationPage({ data }) {
  const evaluation = data.modelEvaluation;
  const report = evaluation.evaluationReport || {};
  const baseline = report.baseline || evaluation.baseline || {};
  const dynamic = (report.dynamicCycles || evaluation.dynamicCycles || []).map(row => ({...row,cycleNumber:cycleIndex(row.CycleID)}));
  const geographic = report.geographic || {};
  const marketRows = (geographic.cycles || data.geographicAnalytics?.quality || []).map(row => ({...row,cycleNumber:cycleIndex(row.CycleID)}));
  const latestMarket = marketRows.at(-1) || {};
  const baselineK = baseline.SelectedK ?? baseline.clusterCount;
  const selection = report.kSelection || [];
  const figure = key => (data.artifacts || []).filter(item => item.relativePath === report.figures?.[key]);
  const definitions = [
    {field:'SilhouetteScore',title:'Silhouette score',direction:'Higher indicates better separation'},
    {field:'DaviesBouldinScore',title:'Davies–Bouldin index',direction:'Lower is better'},
    {field:'CalinskiHarabaszScore',title:'Calinski–Harabasz score',direction:'Higher is better',formatter:value=>formatNumber(value)},
    {field:'AverageMembership',title:'Mean maximum membership',direction:'Stronger concentration; not a probability',formatter:value=>formatPercent(value,1)},
    {field:'XieBeniIndex',title:'Xie–Beni index',direction:'Lower is better'},
    {field:'MigrationRate',title:'Migration rate',direction:'Returning customers; descriptive measure',formatter:value=>formatStoredPercent(value,1)},
  ];
  const globalColumns = [
    {key:'CycleID',label:'Cycle',render:cycleLabel},
    {key:'ModelFitCustomers',label:'Customers fitted',render:formatNumber},
    {key:'SelectedK',label:'Fitted K',render:formatNumber},
    {key:'SilhouetteScore',label:'Silhouette',render:value=>formatDecimal(value,3)},
    {key:'DaviesBouldinScore',label:'Davies–Bouldin',render:value=>formatDecimal(value,3)},
    {key:'CalinskiHarabaszScore',label:'Calinski–Harabasz',render:value=>formatNumber(value)},
    {key:'XieBeniIndex',label:'Xie–Beni',render:value=>value==null?'Not applicable':formatDecimal(value,3)},
    {key:'AverageMembership',label:'Mean maximum membership',render:value=>value==null?'Not applicable':formatPercent(value,1)},
    {key:'MigrationRate',label:'Migration rate',render:value=>value==null?'Not applicable':formatStoredPercent(value,1)},
    {key:'Inertia',label:'Inertia / hard WCSS',render:value=>formatDecimal(value,3)},
  ];
  return <main className="standalone-page evaluation-page">
    <PageTitle eyebrow="Model evaluation" title="Evaluate the baseline, dynamic cycles and geographic markets" description="Review the measured results in three stages. The panels use observed values from the current run; missing or inapplicable metrics are left unavailable." />
    <nav className="evaluation-section-links" aria-label="Evaluation sections"><a href="#evaluation-baseline">Cycle 0</a><a href="#evaluation-dynamic">Cycles 1–9</a><a href="#evaluation-markets">Geographic markets</a></nav>

    <section id="evaluation-baseline" className="evaluation-section">
      <div className="evaluation-section-title"><span className="eyebrow">01 · Static baseline</span><h2>Cycle 0: K-means validation</h2><p>The accepted WCSS elbow chooses K={formatNumber(baselineK)}; silhouette is supporting evidence. This is one static baseline, so fuzzy membership and Xie–Beni do not apply.</p></div>
      <div className="metric-grid metric-grid-six">
        <MetricCard label="Customers fitted" value={formatNumber(baseline.ModelFitCustomers ?? baseline.CustomersProcessed)} detail="Cycle 0 customer snapshot" />
        <MetricCard label="Accepted K" value={formatNumber(baselineK)} detail="WCSS elbow selection" />
        <MetricCard label="Inertia (WCSS)" value={formatDecimal(baseline.Inertia,3)} detail="Squared distance to assigned K-means centres" />
        <MetricCard label="Silhouette" value={formatDecimal(baseline.SilhouetteScore,3)} detail="Higher indicates better separation" />
        <MetricCard label="Davies–Bouldin" value={formatDecimal(baseline.DaviesBouldinScore,3)} detail="Lower is better" />
        <MetricCard label="Calinski–Harabasz" value={formatNumber(baseline.CalinskiHarabaszScore)} detail="Higher is better" />
      </div>
      <div className="evaluation-metric-grid evaluation-metric-grid-two">
        <EvaluationMetricPlot title="WCSS elbow" direction="Primary K-selection evidence" rows={selection} field="Inertia" xKey="K" xLabel="Number of clusters (K)" selectedX={baselineK} formatter={value=>formatDecimal(value,1)} />
        <EvaluationMetricPlot title="Silhouette by candidate K" direction="Supporting K-selection evidence" rows={selection} field="Silhouette_Score" xKey="K" xLabel="Number of clusters (K)" selectedX={baselineK} />
      </div>
      <details className="evaluation-export"><summary>View the combined Cycle 0 evaluation figure</summary><FigureGallery artifacts={figure('baseline')} /></details>
    </section>

    <section id="evaluation-dynamic" className="evaluation-section">
      <div className="evaluation-section-title"><span className="eyebrow">02 · Dynamic behavioural model</span><h2>Cycles 1–9: MDFCM evaluation</h2><p>Each cycle evaluates all currently observed customer snapshots in the shared PCA space. Silhouette, DB and CH use highest-membership assignments; Xie–Beni uses fuzzy memberships. Migration describes assignment movement and is not a quality target. Maximum membership is not a calibrated probability of a correct label.</p></div>
      <div className="evaluation-metric-grid">{definitions.map(metric => <EvaluationMetricPlot key={metric.field} {...metric} rows={dynamic} />)}</div>
      <Panel title="Dynamic results by cycle" eyebrow="Same fitted population as the plots"><DataTable rows={dynamic} columns={globalColumns} /></Panel>
      <details className="evaluation-export"><summary>View the combined Cycles 1–9 evaluation figure</summary><FigureGallery artifacts={figure('dynamic')} /></details>
    </section>

    <section id="evaluation-markets" className="evaluation-section">
      <div className="evaluation-section-title"><span className="eyebrow">03 · Geographic and market model</span><h2>Geographic market segmentation validation</h2><p>The geographic model groups country markets into K=3 categories. K-means and RobustScaler are fitted on Cycle 0; later market snapshots use the fixed baseline reference. These results evaluate country markets, rather than individual customer clusters.</p></div>
      <div className="metric-grid metric-grid-six">
        <MetricCard label="Geographic K" value={formatNumber(geographic.fittedK ?? data.geographicAnalytics.clusterCount)} detail="Specified baseline market groups" />
        <MetricCard label="Country markets" value={formatNumber(latestMarket.Markets)} detail={cycleLabel(latestMarket.CycleID)} />
        <MetricCard label="Market silhouette" value={formatDecimal(latestMarket.SilhouetteScore,3)} detail="Latest market snapshot" />
        <MetricCard label="Market Davies–Bouldin" value={formatDecimal(latestMarket.DaviesBouldinScore,3)} detail="Lower is better" />
        <MetricCard label="Market Calinski–Harabasz" value={formatNumber(latestMarket.CalinskiHarabaszScore)} detail="Higher is better" />
        <MetricCard label="Fixed-centre SSE" value={latestMarket.Inertia==null?'Unavailable':formatNumber(latestMarket.Inertia)} detail="Squared distance in the market feature space" />
      </div>
      <div className="evaluation-metric-grid">
        {definitions.slice(0,3).map(metric => <EvaluationMetricPlot key={metric.field} {...metric} rows={marketRows} />)}
        <EvaluationMetricPlot title="Distance to fixed market centres" direction="Squared-error total; scale and count sensitive" rows={marketRows} field="Inertia" formatter={value=>formatNumber(value)} />
        <EvaluationMetricPlot title="Country markets evaluated" direction="Population context; not a quality score" rows={marketRows} field="Markets" formatter={value=>formatNumber(value)} />
        <EvaluationMetricPlot title="Occupied geographic groups" direction="Model context; baseline K=3" rows={marketRows} field="OccupiedK" formatter={value=>formatNumber(value)} />
      </div>
      <Panel title="Country-market validation by cycle" eyebrow="Fixed baseline scaler and centres">
        <DataTable rows={marketRows} columns={[
          {key:'CycleID',label:'Cycle',render:cycleLabel},{key:'Markets',label:'Markets',render:formatNumber},
          {key:'OccupiedK',label:'Occupied groups',render:value=>value==null?'Unavailable':formatNumber(value)},
          ...globalColumns.filter(column=>['SilhouetteScore','DaviesBouldinScore','CalinskiHarabaszScore'].includes(column.key)),
          {key:'Inertia',label:'Fixed-centre SSE',render:value=>value==null?'Unavailable':formatDecimal(value,3)},
        ]} />
        <p className="panel-note">Market counts and occupied groups provide context, not performance scores. SSE depends on scale and the number of markets. No fuzzy metrics apply to this K-means model. Customer–market combinations are derived from the geographic and behavioural assignments; they are not a separately trained company-type model.</p>
      </Panel>
      <details className="evaluation-export"><summary>View the combined geographic market evaluation figure</summary><FigureGallery artifacts={figure('geographic')} /></details>
    </section>
  </main>;
}

function ResearchPage({ data }) {
  const researchArtifacts = data.artifacts.filter((artifact) => artifact.imageUrl);
  const categories = ['All', ...new Set(researchArtifacts.map((artifact) => artifact.category))];
  const [category, setCategory] = useState('All');
  const visible = category === 'All'
    ? researchArtifacts
    : researchArtifacts.filter((artifact) => artifact.category === category);

  return (
    <main className="standalone-page">
      <PageTitle
        eyebrow="Research figure library"
        title="Explore the firmographic model’s visual evidence"
        description="Browse behavioural, geographic, customer, product, dynamic, baseline, and model-performance outputs generated by the executed model pipeline."
        action={(
          <a
            className="button button-secondary"
            href="https://sites.google.com/myuwc.ac.za/honourproject/web"
            target="_blank"
            rel="noreferrer"
          >
            Visit project site
          </a>
        )}
      />
      <div className="research-summary">
        <div><strong>{formatNumber(researchArtifacts.length)}</strong><span>research figures</span></div>
        <div><strong>{formatNumber(categories.length - 1)}</strong><span>analytical themes</span></div>
        <p>Click any figure to open a larger, presentation-ready view with an interpretation prompt.</p>
      </div>
      <div className="chip-row">
        {categories.map((name) => (
          <button key={name} className={category === name ? 'active' : ''} onClick={() => setCategory(name)}>
            {name}
          </button>
        ))}
      </div>
      <FigureGallery artifacts={visible} />
    </main>
  );
}

function DataExplorerPage({ data }) {
  const [table, setTable] = useState(data.schema[0]?.table || '');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!table) return;
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      setLoading(true);
      setError('');
      return fetchTableRows(table, page, 25)
        .then((response) => active && setRows(response))
        .catch((requestError) => active && setError(requestError.message))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; };
  }, [table, page]);

  const selectTable = (name) => {
    setTable(name);
    setPage(1);
  };

  return (
    <main className="standalone-page data-page">
      <PageTitle
        eyebrow="Relational data explorer"
        title="Inspect the evidence behind the interface"
        description="Review the current SQLite tables, fields, record counts, and paginated source rows used by the customer analytics."
        action={<StatusPill tone="success">{formatNumber(data.schema.length)} live tables</StatusPill>}
      />
      <section className="dataset-brief">
        <div>
          <span className="eyebrow">Research dataset</span>
          <h2>Online Retail transaction data</h2>
          <p>
            Source: UCI Machine Learning Repository, dataset 352. The original dataset contains 541,909 transaction records recorded from December 2010 to December 2011.
            The model cleans the records, constructs cumulative customer snapshots, and stores reproducible behavioural,
            geographic, firmographic, transition, and model evaluation outputs in SQLite.
          </p>
        </div>
        <a
          className="button button-primary"
          href="https://archive.ics.uci.edu/dataset/352/online+retail"
          target="_blank"
          rel="noreferrer"
        >
          View dataset at UCI
        </a>
      </section>
      <div className="data-layout">
        <aside className="schema-panel">
          <span className="eyebrow">Database tables</span>
          <div className="schema-list">
            {data.schema.map((schema) => (
              <button key={schema.table} className={table === schema.table ? 'active' : ''} onClick={() => selectTable(schema.table)}>
                <span>{titleFromName(schema.table)}</span>
                <b>{formatNumber(schema.rowCount)}</b>
              </button>
            ))}
          </div>
          <div className="schema-legend">
            <h3>Schema groups</h3>
            <p><i className="legend-source" />Customer and preprocessing records</p>
            <p><i className="legend-dynamic" />Dynamic segment and cycle results</p>
            <p><i className="legend-summary" />Business intelligence summaries</p>
          </div>
        </aside>
        <Panel
          className="data-table-panel"
          title={titleFromName(table)}
          eyebrow="Table records"
          action={rows && <StatusPill>{formatNumber(rows.meta.total)} rows</StatusPill>}
        >
          <div className="column-chips">
            {(rows?.columns || data.schema.find((schema) => schema.table === table)?.columns || []).map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
          {loading && <div className="inline-loading">Loading table rows…</div>}
          {error && <EmptyState title="Table unavailable" detail={error} />}
          {!loading && !error && rows && (
            <>
              <DataTable
                compact
                rows={rows.data}
                columns={rows.columns.map((column) => ({
                  key: column,
                  label: titleFromName(column),
                  render: (value) => {
                    if (typeof value === 'number') return number.format(value);
                    const text = String(value ?? '-');
                    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
                  },
                }))}
              />
              <div className="pagination">
                <span>Page {rows.meta.page} of {rows.meta.totalPages}</span>
                <div>
                  <button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>← Previous</button>
                  <button disabled={page >= rows.meta.totalPages} onClick={() => setPage((current) => current + 1)}>Next →</button>
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>
    </main>
  );
}

function AccessibilityPage({ settings, setSettings }) {
  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  return (
    <main className="standalone-page accessibility-page">
      <PageTitle
        eyebrow="Accessibility preferences"
        title="Make the research interface work for you"
        description="These preferences are stored locally in this browser and change presentation only."
      />
      <div className="accessibility-grid">
        <Panel title="Theme" eyebrow="Colour appearance">
          <div className="segmented-control">
            {['light', 'dark', 'system'].map((theme) => (
              <button key={theme} className={settings.theme === theme ? 'active' : ''} onClick={() => update('theme', theme)}>
                {titleFromName(theme)}
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Font scaling" eyebrow="Text size">
          <input
            className="range-control"
            type="range"
            min="0.9"
            max="1.3"
            step="0.05"
            value={settings.fontScale}
            onChange={(event) => update('fontScale', Number(event.target.value))}
          />
          <p className="setting-value">Current scale: {settings.fontScale.toFixed(2)}×</p>
        </Panel>
        <Panel title="High contrast" eyebrow="Stronger boundaries">
          <button className={`toggle-button ${settings.highContrast ? 'active' : ''}`} onClick={() => update('highContrast', !settings.highContrast)}>
            <span><i /></span>{settings.highContrast ? 'Enabled' : 'Disabled'}
          </button>
        </Panel>
        <Panel title="Reduced motion" eyebrow="Animation preference">
          <button className={`toggle-button ${settings.reducedMotion ? 'active' : ''}`} onClick={() => update('reducedMotion', !settings.reducedMotion)}>
            <span><i /></span>{settings.reducedMotion ? 'Enabled' : 'Disabled'}
          </button>
        </Panel>
        <Panel title="Colour-blind friendly palette" eyebrow="Chart distinction">
          <button className={`toggle-button ${settings.colorBlind ? 'active' : ''}`} onClick={() => update('colorBlind', !settings.colorBlind)}>
            <span><i /></span>{settings.colorBlind ? 'Enabled' : 'Disabled'}
          </button>
        </Panel>
        <Panel title="Reset preferences" eyebrow="Return to defaults">
          <button className="button button-secondary" onClick={() => setSettings(DEFAULT_SETTINGS)}>Reset preferences</button>
        </Panel>
      </div>
    </main>
  );
}

function AnalyticsShell({ page, setPage, data }) {
  const renderPage = () => {
    if (page === 'customers') return <CustomersPage data={data} />;
    if (page === 'segments') return <SegmentsPage data={data} />;
    if (page === 'static-dynamic') return <StaticToDynamicPage data={data} />;
    if (page === 'comparison') return <CycleComparisonPage data={data} />;
    if (page === 'dynamics') return <DynamicsPage data={data} />;
    if (page === 'pca') return <PcaSegmentAnalysisPage data={data} />;
    if (page === 'products') return <ProductsPage data={data} />;
    if (page === 'geography') return <GeographyPage data={data} />;
    if (page === 'firmographic') return <FirmographicPage data={data} />;
    return <OverviewPage data={data} />;
  };

  return (
    <div className="analytics-shell">
      <aside className="analytics-sidebar">
        <div className="sidebar-heading">
          <span>Analytics workspace</span>
          <small>Customer intelligence platform</small>
        </div>
        <nav>
          {ANALYTICS_PAGES.map((item) => (
            <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <i />
          <div><strong>Database connected</strong><span>{formatNumber(data.overview.analysedCustomers)} analysed customers</span></div>
        </div>
      </aside>
      <main className="analytics-content">{renderPage()}</main>
    </div>
  );
}

function Header({ page, setPage }) {
  const analyticsActive = ANALYTICS_PAGES.some((item) => item.id === page);
  const topNav = [
    { id: 'home', label: 'Home' },
    { id: 'overview', label: 'Analytics', active: analyticsActive },
    { id: 'model', label: 'Model' },
    { id: 'evaluation', label: 'Evaluation' },
    { id: 'research', label: 'Research' },
    { id: 'data', label: 'Data' },
  ];
  return (
    <header className="app-header">
      <button className="brand" onClick={() => setPage('home')} aria-label="Customer Segmentation in the Retail Sector home">
        <img src={IconOnly} alt="" />
        <div><strong>CSRS</strong><span>Customer Segmentation in the Retail Sector</span></div>
      </button>
      <nav className="top-nav">
        {topNav.map((item) => (
          <button key={item.id} className={(item.active || page === item.id) ? 'active' : ''} onClick={() => setPage(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      <button className={`accessibility-link ${page === 'accessibility' ? 'active' : ''}`} onClick={() => setPage('accessibility')}>
        Accessibility
      </button>
    </header>
  );
}

export default function CSRS() {
  const [page, setPage] = useState('home');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(() => {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('csrs-accessibility') || '{}') };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const loadData = () => {
    setLoading(true);
    setError('');
    fetchDashboardBundle()
      .then(setData)
      .catch((requestError) => setError(requestError.message || 'Unable to load dashboard data.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    document.title = 'CSRS | Customer Segmentation in the Retail Sector';
    fetchDashboardBundle()
      .then(setData)
      .catch((requestError) => setError(requestError.message || 'Unable to load dashboard data.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.contrast = settings.highContrast ? 'high' : 'standard';
    root.dataset.motion = settings.reducedMotion ? 'reduced' : 'standard';
    root.dataset.palette = settings.colorBlind ? 'accessible' : 'standard';
    root.style.setProperty('--font-scale', settings.fontScale);
    localStorage.setItem('csrs-accessibility', JSON.stringify(settings));
  }, [settings]);

  const navigate = (nextPage) => {
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: settings.reducedMotion ? 'auto' : 'smooth' });
  };

  const retry = () => {
    clearDashboardCache();
    loadData();
  };

  return (
    <div className="app-frame">
      <Header page={page} setPage={navigate} />
      {loading && <LoadingView />}
      {!loading && error && <ErrorView message={error} onRetry={retry} />}
      {!loading && data && (
        <>
          {page === 'home' && <HomePage data={data} setPage={navigate} />}
          {ANALYTICS_PAGES.some((item) => item.id === page) && (
            <AnalyticsShell page={page} setPage={navigate} data={data} />
          )}
          {page === 'model' && <ModelPage data={data} />}
          {page === 'evaluation' && <EvaluationPage data={data} />}
          {page === 'research' && <ResearchPage data={data} />}
          {page === 'data' && <DataExplorerPage data={data} />}
          {page === 'accessibility' && <AccessibilityPage settings={settings} setSettings={setSettings} />}
        </>
      )}
    </div>
  );
}
