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
import { apiAssetUrl } from './config/api';
import {
  clearDashboardCache,
  fetchCustomerProfile,
  fetchCustomers,
  fetchDashboardBundle,
  fetchTableRows,
} from './services/dashboardService';

const SEGMENTS = [
  'Champions',
  'Core Loyalists',
  'Mid-Tier Occasionals',
  'Hibernating / Lost',
];

const SEGMENT_COLORS = {
  Champions: '#168a58',
  'Core Loyalists': '#377dc1',
  'Mid-Tier Occasionals': '#e59a38',
  'Hibernating / Lost': '#d45d5d',
};

const GEOGRAPHIC_SEGMENTS = [
  'Dominant Core Market',
  'High-Value Export Market',
  'Growth Export Market',
  'Small Emerging Market',
];

const GEOGRAPHIC_COLORS = {
  'Dominant Core Market': '#0d6f48',
  'High-Value Export Market': '#d7912f',
  'Growth Export Market': '#377dc1',
  'Small Emerging Market': '#8a6ec1',
};

const TRANSITION_STATES = [
  'New',
  'Existing Stable',
  'Existing Migrated',
  'Inactive',
  'Reactivated',
];

const TRANSITION_COLORS = {
  New: '#377dc1',
  'Existing Stable': '#168a58',
  'Existing Migrated': '#e59a38',
  Inactive: '#85978e',
  Reactivated: '#8a6ec1',
};

const ANALYTICS_PAGES = [
  { id: 'overview', label: 'Overview', icon: '◫' },
  { id: 'customers', label: 'Customers', icon: '◎' },
  { id: 'segments', label: 'Behavioural', icon: '◉' },
  { id: 'static-dynamic', label: 'Static to dynamic', icon: '⇢' },
  { id: 'comparison', label: 'Cycle comparison', icon: '⇄' },
  { id: 'dynamics', label: 'Cycle dynamics', icon: '↝' },
  { id: 'pca', label: 'PCA segment analysis', icon: '△' },
  { id: 'geography', label: 'Geography', icon: '⌖' },
  { id: 'firmographic', label: 'Firmographic', icon: '⊞' },
  { id: 'products', label: 'Products', icon: '◇' },
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
    ['baseline/cycle0_pca_clusters.png', 'Cycle 0 behavioural clusters', 'Shows the baseline behavioural customer groups in the fitted PCA feature space.'],
    ['baseline/rfm_log_transformation.png', 'RFM log transformation', 'Compares raw and log-transformed recency, frequency, and monetary distributions.'],
    ['dynamic/customer_transition_states.png', 'Customer transition states', 'Separates new, stable, migrated, inactive, and reactivated customers across cycles.'],
    ['dynamic/segment_evolution_cycles_0_10.png', 'Behavioural segment evolution', 'Tracks the cumulative behavioural segment population from Cycle 0 to Cycle 10.'],
    ['validation/xie_beni_index.png', 'Xie-Beni fuzzy validity', 'Tracks fuzzy cluster compactness and separation, where lower values indicate stronger validity.'],
    ['validation/dynamic_model_quality.png', 'Dynamic model quality', 'Compares silhouette score, membership confidence, and migration rate across cycles.'],
    ['geographic/cycle10_market_segments.png', 'Cycle 10 geographic market segments', 'Shows the geographic segment assigned to each country market using commercial and behavioural composition features.'],
    ['geographic/market_segment_evolution.png', 'Geographic market segment evolution', 'Tracks the country-level market segmentation from Cycle 0 to Cycle 10.'],
    ['firmographic/cycle10_firmographic_segments.png', 'Cycle 10 firmographic segments', 'Combines behavioural customer segments with geographic market segments.'],
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
    'Segment Product Heatmap': 'Reveals product affinities shared across the four customer segments.',
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

function CentroidPoint({ cx, cy, fill, payload }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const index = cycleIndex(payload?.CycleID);
  const offsets = [
    { x: 8, y: -12, anchor: 'start' },
    { x: 8, y: 16, anchor: 'start' },
    { x: -8, y: 18, anchor: 'end' },
    { x: 10, y: 22, anchor: 'start' },
    { x: -10, y: -16, anchor: 'end' },
    { x: 8, y: -18, anchor: 'start' },
    { x: -14, y: 14, anchor: 'end' },
    { x: -16, y: -8, anchor: 'end' },
    { x: 12, y: 9, anchor: 'start' },
    { x: -12, y: 24, anchor: 'end' },
    { x: 15, y: -5, anchor: 'start' },
  ];
  const offset = offsets[index];
  return (
    <g>
      <circle cx={cx} cy={cy} r="4.4" fill={fill} stroke="#ffffff" strokeWidth="1.4" />
      <text
        x={cx + offset.x}
        y={cy + offset.y}
        textAnchor={offset.anchor}
        className="centroid-cycle-label"
      >
        {shortCycleLabel(payload?.CycleID)}
      </text>
    </g>
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

function MetricCard({ label, value, detail, tone = 'green', icon }) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <div className="metric-top">
        <span>{label}</span>
        <b aria-hidden="true">{icon}</b>
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
        color: SEGMENT_COLORS[segment] || '#315549',
        background: `${SEGMENT_COLORS[segment] || '#315549'}16`,
        borderColor: `${SEGMENT_COLORS[segment] || '#315549'}33`,
      }}
    >
      <i style={{ background: SEGMENT_COLORS[segment] || '#315549' }} />
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
      <span>◇</span>
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
              key={row.id || row.CustomerID || `${rowIndex}-${JSON.stringify(row).slice(0, 20)}`}
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
  const sankeyData = useMemo(() => {
    const nodes = [
      ...SEGMENTS.map((segment) => ({ name: `${segment} source` })),
      ...SEGMENTS.map((segment) => ({ name: `${segment} destination` })),
    ];
    const links = (rows || [])
      .map((row) => ({
        source: SEGMENTS.indexOf(row.fromSegment),
        target: SEGMENTS.indexOf(row.toSegment) + SEGMENTS.length,
        value: Number(row.count || 0),
      }))
      .filter((link) => link.source >= 0 && link.target >= SEGMENTS.length && link.value > 0);
    return { nodes, links };
  }, [rows]);

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

function Pca3DPlot({ points }) {
  const [yaw, setYaw] = useState(38);
  const [pitch, setPitch] = useState(24);
  const projected = useMemo(() => {
    if (!points?.length) return [];
    const dimensions = ['PC1', 'PC2', 'PC3'];
    const ranges = Object.fromEntries(dimensions.map((dimension) => {
      const values = points.map((point) => Number(point[dimension] || 0));
      return [dimension, { min: Math.min(...values), max: Math.max(...values) }];
    }));
    const normalise = (value, dimension) => {
      const range = ranges[dimension];
      const width = range.max - range.min || 1;
      return ((Number(value || 0) - range.min) / width) * 2 - 1;
    };
    const yawRadians = (yaw * Math.PI) / 180;
    const pitchRadians = (pitch * Math.PI) / 180;
    return points.map((point) => {
      const coordinateX = normalise(point.PC1, 'PC1');
      const coordinateY = normalise(point.PC2, 'PC2');
      const coordinateZ = normalise(point.PC3, 'PC3');
      const rotatedX = coordinateX * Math.cos(yawRadians) + coordinateZ * Math.sin(yawRadians);
      const rotatedDepth = -coordinateX * Math.sin(yawRadians) + coordinateZ * Math.cos(yawRadians);
      const rotatedY = coordinateY * Math.cos(pitchRadians) - rotatedDepth * Math.sin(pitchRadians);
      const depth = coordinateY * Math.sin(pitchRadians) + rotatedDepth * Math.cos(pitchRadians);
      return {
        ...point,
        screenX: 380 + rotatedX * 270,
        screenY: 205 - rotatedY * 155,
        depth,
      };
    }).sort((left, right) => left.depth - right.depth);
  }, [points, yaw, pitch]);

  return (
    <div className="pca-3d-wrap">
      <svg viewBox="0 0 760 410" role="img" aria-label="Interactive three dimensional PCA segment view">
        <line x1="80" y1="340" x2="685" y2="340" className="pca-axis" />
        <line x1="80" y1="340" x2="80" y2="55" className="pca-axis" />
        <line x1="80" y1="340" x2="210" y2="245" className="pca-axis" />
        <text x="690" y="359">PC1</text>
        <text x="44" y="48">PC2</text>
        <text x="214" y="242">PC3</text>
        {projected.map((point) => (
          <circle
            key={`${point.CycleID}-${point.CustomerID}`}
            cx={point.screenX}
            cy={point.screenY}
            r={3.4 + ((point.depth + 1) / 2) * 1.8}
            fill={SEGMENT_COLORS[point.segment] || '#168a58'}
            fillOpacity="0.72"
          >
            <title>{`${point.segment}, customer ${point.CustomerID}`}</title>
          </circle>
        ))}
      </svg>
      <div className="pca-controls">
        <label>Horizontal rotation<input type="range" min="-70" max="70" value={yaw} onChange={(event) => setYaw(Number(event.target.value))} /></label>
        <label>Vertical rotation<input type="range" min="-45" max="45" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /></label>
      </div>
      <div className="chart-legend-row">
        {SEGMENTS.map((segment) => <span key={segment}><i style={{ background: SEGMENT_COLORS[segment] }} />{segment}</span>)}
      </div>
    </div>
  );
}

function ModelComputationVisuals() {
  return (
    <div className="computation-grid">
      <Panel title="Cascaded RFM to PCA" eyebrow="Dimension reduction">
        <div className="pca-computation">
          <div className="feature-stack">
            <span>log R</span><span>log F</span><span>log M</span>
            <span>RF</span><span>RM</span><span>FM</span>
          </div>
          <b>→</b>
          <div className="pca-core"><strong>PCA</strong><span>Fitted on Cycle 0</span></div>
          <b>→</b>
          <div className="component-stack">
            <span><strong>PC1</strong>64.30%</span>
            <span><strong>PC2</strong>29.85%</span>
            <span><strong>PC3</strong>4.98%</span>
          </div>
        </div>
        <p className="panel-note">Six correlated behavioural features are transformed into one stable three-component space used across all cycles.</p>
      </Panel>
      <Panel title="Dynamic segmentation computation" eyebrow="Cycle processing">
        <div className="dynamic-computation">
          {[
            ['1', 'Three-month snapshot'],
            ['2', 'Baseline scaling and PCA'],
            ['3', 'Warm-started fuzzy update'],
            ['4', 'Membership and validation'],
          ].map(([step, label], index) => (
            <div key={step}><span>{step}</span><strong>{label}</strong>{index < 3 && <b>→</b>}</div>
          ))}
        </div>
        <p className="panel-note">Every monthly update remains comparable because the Cycle 0 preprocessing transformation is reused.</p>
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
      <span>!</span>
      <h2>The analytics service could not be reached</h2>
      <p>{message}</p>
      <button className="button button-primary" onClick={onRetry}>Try again</button>
    </div>
  );
}

function HomePage({ data, setPage }) {
  const overview = data.overview;
  const latestSegments = overview.latestSegments || [];
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
            <span><b>4</b> behavioural segments</span>
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
              <strong>Converged across all cycles</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="home-metrics">
        <MetricCard label="Customer records" value={formatNumber(overview.totalCustomers)} detail="Unique customer profiles" icon="◎" />
        <MetricCard label="Analysed revenue" value={formatCurrency(overview.totalRevenue, true)} detail="Across dynamic cycles" tone="gold" icon="£" />
        <MetricCard label="Products observed" value={formatNumber(overview.products)} detail="Distinct product descriptions" tone="blue" icon="◇" />
        <MetricCard label="Analytical cycles" value={formatNumber(overview.numberOfCycles)} detail="Baseline plus dynamic updates" tone="purple" icon="↝" />
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
            ['◎', 'Customer analytics', 'Search customers, compare value bands, confidence, baskets, products, and full cycle history.', 'customers'],
            ['↝', 'Behavioural movement', 'Investigate migration rates, transition flows, segment stability, and confidence over time.', 'dynamics'],
            ['⌖', 'Geographic intelligence', 'Explore clustered market types, customer value, product breadth, revenue, and behavioural composition.', 'geography'],
            ['⊞', 'Firmographic analytics', 'Combine customer behaviour with geographic market segments for retailer-facing action.', 'firmographic'],
          ].map(([icon, title, description, target]) => (
            <button className="capability-card" key={title} onClick={() => setPage(target)}>
              <span>{icon}</span>
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
  const segmentRows = data.segments.segments || [];
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
        <MetricCard label="Customers" value={formatNumber(overview.totalCustomers)} detail={`${formatNumber(overview.analysedCustomers)} observed dynamically`} icon="◎" />
        <MetricCard label="Revenue" value={formatCurrency(overview.totalRevenue, true)} detail="Across analysed cycles" tone="gold" icon="£" />
        <MetricCard label="Average basket" value={formatCurrency(overview.averageBasketValue)} detail="Customer-cycle average" tone="blue" icon="▱" />
        <MetricCard label="Orders" value={formatNumber(overview.orders)} detail="Distinct invoices" tone="purple" icon="⌑" />
        <MetricCard label="Confidence" value={formatPercent(overview.averageMembership)} detail="Average fuzzy membership" tone="teal" icon="◉" />
        <MetricCard label="Markets" value={formatNumber(overview.countries)} detail="Countries represented" tone="red" icon="⌖" />
      </div>

      <div className="content-grid two-one">
        <Panel title="Revenue across cycles" eyebrow="Commercial trend">
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
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#168a58" strokeWidth={3} fill="url(#revenueGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Latest segment mix" eyebrow={cycleLabel(data.segments.latestCycle)}>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3}>
                  {pieData.map((entry) => <Cell key={entry.name} fill={SEGMENT_COLORS[entry.name]} />)}
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
                <span><i style={{ background: SEGMENT_COLORS[entry.name] }} />{entry.name}</span>
                <b>{formatNumber(entry.value)}</b>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="content-grid equal">
        <Panel title="Latest segment economics" eyebrow="Revenue and value">
          <div className="chart-medium">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={segmentRows} layout="vertical" margin={{ top: 4, right: 18, left: 30, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => formatCurrency(value, true)} />
                <YAxis type="category" dataKey="segment" width={122} tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                <Bar dataKey="revenue" name="Revenue" radius={[0, 6, 6, 0]}>
                  {segmentRows.map((entry) => <Cell key={entry.segment} fill={SEGMENT_COLORS[entry.segment]} />)}
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

function CustomerProfileModal({ customerId, onClose }) {
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
  const latest = profile?.history?.at(-1);

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
                <p>{profile.customer?.Country || 'Market unavailable'} · {profile.history.length} observed cycles</p>
              </div>
              {latest && <SegmentBadge segment={latest.Segment_Name} />}
            </div>
            <div className="profile-kpis">
              <div><span>Latest revenue</span><strong>{formatCurrency(latest?.Revenue)}</strong></div>
              <div><span>Average basket</span><strong>{formatCurrency(latest?.Average_Basket_Value)}</strong></div>
              <div><span>Products</span><strong>{formatNumber(latest?.Products)}</strong></div>
              <div><span>Confidence</span><strong>{formatPercent(latest?.Average_Membership)}</strong></div>
            </div>
            <Panel title="Customer value history" eyebrow="Cycle progression">
              <div className="chart-medium">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <CartesianGrid strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="cycle" />
                    <YAxis tickFormatter={(value) => formatCurrency(value, true)} />
                    <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                    <Area dataKey="revenue" name="Revenue" type="monotone" stroke="#168a58" fill="#168a5825" strokeWidth={2} />
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
  const analytics = data.customerAnalytics;
  const [filters, setFilters] = useState({
    query: '',
    segment: '',
    country: '',
    cycle: analytics.latestCycle || '',
  });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState('');

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
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <>
      <PageTitle
        eyebrow="Customer analytics"
        title="Understand every customer through behaviour"
        description="Explore customer value, basket behaviour, product breadth, segment membership, and cycle history without synthetic demographic fields."
      />
      <div className="metric-grid metric-grid-four">
        <MetricCard label="Latest customers" value={formatNumber(analytics.summary.customers)} detail={cycleLabel(analytics.latestCycle)} icon="◎" />
        <MetricCard label="Average revenue" value={formatCurrency(analytics.summary.averageRevenue)} detail="Per customer in latest cycle" tone="gold" icon="£" />
        <MetricCard label="Average basket" value={formatCurrency(analytics.summary.averageBasketValue)} detail="Across observed orders" tone="blue" icon="▱" />
        <MetricCard label="Membership confidence" value={formatPercent(analytics.summary.averageMembership)} detail="Average fuzzy certainty" tone="purple" icon="◉" />
      </div>

      <div className="content-grid equal">
        <Panel title="Customer value distribution" eyebrow="Latest cycle">
          <div className="chart-medium">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.valueBands}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="band" />
                <YAxis />
                <Tooltip content={<ChartTooltip valueFormatter={(value, name) => name === 'Revenue' ? formatCurrency(value) : formatNumber(value)} />} />
                <Bar dataKey="customers" name="Customers" fill="#168a58" radius={[7, 7, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Membership confidence" eyebrow="Assignment certainty">
          <div className="confidence-layout">
            <ResponsiveContainer width="48%" height={220}>
              <PieChart>
                <Pie data={analytics.confidenceBands} dataKey="customers" nameKey="band" innerRadius={58} outerRadius={88} paddingAngle={3}>
                  {analytics.confidenceBands.map((entry, index) => (
                    <Cell key={entry.band} fill={['#e59a38', '#377dc1', '#168a58'][index]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} customers`} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="confidence-copy">
              {analytics.confidenceBands.map((entry, index) => (
                <div key={entry.band}>
                  <i style={{ background: ['#e59a38', '#377dc1', '#168a58'][index] }} />
                  <span>{entry.band}</span>
                  <strong>{formatNumber(entry.customers)}</strong>
                </div>
              ))}
              <p>Lower-confidence assignments are useful candidates for targeted review and softer campaign decisions.</p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Customer explorer" eyebrow="Search and compare">
        <div className="filter-bar">
          <label className="search-field">
            <span>⌕</span>
            <input
              value={filters.query}
              onChange={(event) => updateFilter('query', event.target.value)}
              placeholder="Search customer ID or country"
            />
          </label>
          <select value={filters.segment} onChange={(event) => updateFilter('segment', event.target.value)}>
            <option value="">All segments</option>
            {(data.filters.segments || []).map((option) => <option key={option.value}>{option.value}</option>)}
          </select>
          <select value={filters.country} onChange={(event) => updateFilter('country', event.target.value)}>
            <option value="">All countries</option>
            {(data.filters.countries || []).map((option) => <option key={option.value}>{option.value}</option>)}
          </select>
          <select value={filters.cycle} onChange={(event) => updateFilter('cycle', event.target.value)}>
            {(data.filters.cycles || []).map((option) => <option key={option.value} value={option.value}>{cycleLabel(option.value)}</option>)}
          </select>
        </div>
        {loading && <div className="inline-loading">Loading customer records…</div>}
        {error && <EmptyState title="Customer records unavailable" detail={error} />}
        {!loading && !error && result && (
          <>
            <DataTable
              rows={result.data}
              onRowClick={(row) => setSelectedCustomer(String(row.CustomerID))}
              columns={[
                { key: 'CustomerID', label: 'Customer' },
                { key: 'Country', label: 'Country' },
                { key: 'Segment_Name', label: 'Segment', render: (value) => <SegmentBadge segment={value} /> },
                { key: 'Revenue', label: 'Revenue', render: (value) => <strong>{formatCurrency(value)}</strong> },
                { key: 'Orders', label: 'Orders', render: formatNumber },
                { key: 'Products', label: 'Products', render: formatNumber },
                { key: 'Average_Basket_Value', label: 'Avg basket', render: (value) => formatCurrency(value) },
                { key: 'Average_Membership', label: 'Confidence', render: (value) => formatPercent(value) },
                { key: 'Migration_Status', label: 'Status', render: (value) => <StatusPill tone={value === 'Stable' ? 'success' : 'warning'}>{value}</StatusPill> },
              ]}
            />
            <div className="pagination">
              <span>{formatNumber(result.meta.total)} customers · Page {result.meta.page} of {result.meta.totalPages}</span>
              <div>
                <button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>← Previous</button>
                <button disabled={page >= result.meta.totalPages} onClick={() => setPage((current) => current + 1)}>Next →</button>
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel title="Value profile by segment" eyebrow="Latest customer summary">
        <DataTable
          rows={analytics.segmentValue}
          columns={[
            { key: 'segment', label: 'Segment', render: (value) => <SegmentBadge segment={value} /> },
            { key: 'customers', label: 'Customers', render: formatNumber },
            { key: 'averageRevenue', label: 'Avg revenue', render: (value) => formatCurrency(value) },
            { key: 'averageBasketValue', label: 'Avg basket', render: (value) => formatCurrency(value) },
            { key: 'averageOrders', label: 'Avg orders', render: (value) => number.format(value) },
            { key: 'averageProducts', label: 'Avg products', render: (value) => number.format(value) },
            { key: 'averageMembership', label: 'Confidence', render: formatPercent },
          ]}
        />
      </Panel>
      {selectedCustomer && <CustomerProfileModal customerId={selectedCustomer} onClose={() => setSelectedCustomer('')} />}
    </>
  );
}

function SegmentsPage({ data }) {
  const segmentData = data.segments;
  const segments = segmentData.segments || [];
  const [selectedCycle, setSelectedCycle] = useState(segmentData.latestCycle || 'Cycle_10');
  const selectedProfiles = (segmentData.profiles || []).filter((row) => row.CycleID === selectedCycle);
  const performanceCycles = data.modelEvaluation.cycles || [];
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

  return (
    <>
      <PageTitle
        eyebrow="Firmographic component: behavioural segmentation"
        title="Four distinct customer strategies"
        description="Explore the behavioural component of firmographic segmentation through current RFM profiles, customer economics, fuzzy membership, and population movement."
      />
      <div className="segment-card-grid">
        {segments.map((segment) => (
          <article className="segment-card" key={segment.segment} style={{ '--segment-color': SEGMENT_COLORS[segment.segment] }}>
            <div className="segment-card-top">
              <SegmentBadge segment={segment.segment} />
              <strong>{formatNumber(segment.customerCount)}</strong>
            </div>
            <p>{segment.description}</p>
            <div className="segment-stats">
              <div><span>Revenue</span><b>{formatCurrency(segment.revenue, true)}</b></div>
              <div><span>Per customer</span><b>{formatCurrency(segment.revenuePerCustomer)}</b></div>
              <div><span>Confidence</span><b>{formatPercent(segment.averageMembership)}</b></div>
            </div>
          </article>
        ))}
      </div>

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
                    stroke={SEGMENT_COLORS[segment.segment]}
                    fill={SEGMENT_COLORS[segment.segment]}
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
                {SEGMENTS.map((segment) => (
                  <Area
                    key={segment}
                    type="monotone"
                    dataKey={segment}
                    stackId="population"
                    stroke={SEGMENT_COLORS[segment]}
                    fill={SEGMENT_COLORS[segment]}
                    fillOpacity={0.74}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="content-grid equal">
        <Panel title="Behavioural model separation" eyebrow="Performance across Cycle 0 to Cycle 10">
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
        <Panel title="Fuzzy validity and confidence" eyebrow="Xie-Beni across Cycle 0 to Cycle 10">
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
        title="Segment economics and cascaded RFM profile"
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
            { key: 'avgFrequency', label: 'Avg frequency', render: (value) => number.format(value) },
            { key: 'avgMonetary', label: 'Avg monetary', render: (value) => formatCurrency(value) },
            { key: 'avgRF', label: 'RF', render: (value) => formatDecimal(value, 2) },
            { key: 'avgRM', label: 'RM', render: (value) => formatDecimal(value, 2) },
            { key: 'avgFM', label: 'FM', render: (value) => formatDecimal(value, 2) },
            { key: 'revenue', label: 'Revenue', render: (value) => formatCurrency(value) },
            { key: 'averageMembership', label: 'Confidence', render: formatPercent },
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
        description="The lifecycle view separates new, stable, migrated, inactive, and reactivated customers while measuring behavioural movement among comparable customers."
      />
      <div className="metric-grid metric-grid-six">
        <MetricCard label="Comparable records" value={formatNumber(statistics.total)} detail="Stable plus migrated" icon="↝" />
        <MetricCard label="Migrated" value={formatNumber(statistics.migrated)} detail={formatPercent(statistics.migrationRate)} tone="gold" icon="⇄" />
        <MetricCard label="New" value={formatNumber(totalState('New'))} detail="First observed cycle" tone="blue" icon="+" />
        <MetricCard label="Inactive" value={formatNumber(totalState('Inactive'))} detail="Retained in cumulative history" icon="○" />
        <MetricCard label="Reactivated" value={formatNumber(totalState('Reactivated'))} detail="Returned after inactivity" tone="purple" icon="↻" />
        <MetricCard label="Stable" value={formatNumber(statistics.stable)} detail="Same behavioural segment" tone="green" icon="=" />
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
          <p className="panel-note">New, inactive, and reactivated customers are excluded from the migration-rate denominator.</p>
        </Panel>
        <Panel title="Membership confidence by cycle" eyebrow="Fuzzy assignment certainty">
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
                <YAxis domain={[0.6, 1]} tickFormatter={(value) => formatPercent(value, 0)} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatPercent(value)} />} />
                <Area type="monotone" dataKey="AverageMembership" name="Confidence" stroke="#377dc1" fill="url(#confidenceGradient)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Customer lifecycle states" eyebrow="Cumulative customer snapshots">
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
        <p className="panel-note">Flow width represents the number of comparable customers moving between behavioural segments or remaining stable.</p>
      </Panel>

      <div className="content-grid equal">
        <Panel title="Transition matrix" eyebrow="Source to destination">
          <div className="matrix-scroll">
            <div className="transition-matrix">
              <span />
              {SEGMENTS.map((segment) => <b key={segment}>{segment}</b>)}
              {SEGMENTS.map((fromSegment) => (
                <div className="matrix-row" key={fromSegment}>
                  <strong>{fromSegment}</strong>
                  {SEGMENTS.map((toSegment) => {
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
            { key: 'CustomersProcessed', label: 'Processed', render: formatNumber },
            { key: 'ActiveCustomers', label: 'Active', render: formatNumber },
            { key: 'InactiveCustomers', label: 'Inactive', render: formatNumber },
            { key: 'NewCustomers', label: 'New', render: formatNumber },
            { key: 'ReactivatedCustomers', label: 'Reactivated', render: formatNumber },
            { key: 'ComparableCustomers', label: 'Comparable', render: formatNumber },
            { key: 'MigrationRate', label: 'Migration rate', render: (value) => value == null ? 'Baseline' : formatStoredPercent(value) },
            { key: 'AverageMembership', label: 'Confidence', render: formatPercent },
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
  const populationTrend = pivotSeries(data.segments.trends || [], 'customers');

  return (
    <>
      <PageTitle
        eyebrow="Segmentation evolution"
        title="From a static baseline to dynamic customer intelligence"
        description="Compare the Cycle 0 K-Means baseline with warm-started fuzzy updates that preserve customer history, membership confidence, transition states, and market context over time."
      />
      <section className="static-dynamic-journey">
        <article>
          <span>Static baseline</span>
          <h2>Cycle 0 K-Means</h2>
          <p>Creates the initial four behavioural groups in a stable PCA feature space and provides the centroids used to initialise dynamic updates.</p>
          <div><strong>{formatNumber(baseline.CustomersProcessed)}</strong><small>customers</small></div>
        </article>
        <b>→</b>
        <article className="dynamic-stage">
          <span>Dynamic segmentation</span>
          <h2>Cycle 1 to Cycle 10 fuzzy updates</h2>
          <p>Updates segment membership every month using cumulative three-month customer evidence while retaining inactive and reactivated customers.</p>
          <div><strong>{formatNumber(latest.CustomersProcessed)}</strong><small>customer histories</small></div>
        </article>
      </section>

      <div className="metric-grid metric-grid-four">
        <MetricCard label="Baseline silhouette" value={formatDecimal(baseline.SilhouetteScore)} detail="Cycle 0 cluster separation" icon="◉" />
        <MetricCard label="Baseline Xie-Beni" value={formatDecimal(baseline.XieBeniIndex)} detail="Hard-partition validity reference" tone="blue" icon="◇" />
        <MetricCard label="Latest silhouette" value={formatDecimal(latest.SilhouetteScore)} detail={cycleLabel(latest.CycleID)} tone="green" icon="◉" />
        <MetricCard label="Latest Xie-Beni" value={formatDecimal(latest.XieBeniIndex)} detail="Fuzzy compactness and separation" tone="gold" icon="◇" />
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
                {SEGMENTS.map((segment) => (
                  <Area key={segment} dataKey={segment} stackId="segments" stroke={SEGMENT_COLORS[segment]} fill={SEGMENT_COLORS[segment]} fillOpacity={0.7} />
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
          ['Fuzzy confidence', 'Membership scores express assignment certainty instead of treating every customer boundary as equally clear.'],
          ['Market context', 'Behavioural groups are combined with geographic market clusters to create firmographic customer-market segments.'],
        ].map(([title, description]) => <article key={title}><span>✓</span><div><h3>{title}</h3><p>{description}</p></div></article>)}
      </div>
    </>
  );
}

function CycleComparisonPage({ data }) {
  const comparison = data.cycleComparisonAnalytics;
  const cycleOptions = comparison.definitions || [];
  const [fromCycle, setFromCycle] = useState(comparison.defaultFrom || 'Cycle_0');
  const [toCycle, setToCycle] = useState(comparison.defaultTo || 'Cycle_10');
  const fromMetrics = (comparison.cycles || []).find((row) => row.CycleID === fromCycle) || {};
  const toMetrics = (comparison.cycles || []).find((row) => row.CycleID === toCycle) || {};
  const profileRows = SEGMENTS.map((segment) => {
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
        description="Review changes in customer population, behavioural value, cluster quality, and fuzzy validity from Cycle 0 through Cycle 10."
      />
      <section className="cycle-comparison-controls">
        <label>From cycle<select value={fromCycle} onChange={(event) => setFromCycle(event.target.value)}>{cycleOptions.map((cycle) => <option key={cycle.CycleID} value={cycle.CycleID}>{cycleLabel(cycle.CycleID)}</option>)}</select></label>
        <span>⇄</span>
        <label>To cycle<select value={toCycle} onChange={(event) => setToCycle(event.target.value)}>{cycleOptions.map((cycle) => <option key={cycle.CycleID} value={cycle.CycleID}>{cycleLabel(cycle.CycleID)}</option>)}</select></label>
      </section>

      <div className="metric-grid metric-grid-six">
        <MetricCard label="Customer change" value={signedNumber(Number(toMetrics.CustomersProcessed || 0) - Number(fromMetrics.CustomersProcessed || 0))} detail={`${cycleLabel(fromCycle)} to ${cycleLabel(toCycle)}`} icon="◎" />
        <MetricCard label="Silhouette" value={`${formatDecimal(fromMetrics.SilhouetteScore)} / ${formatDecimal(toMetrics.SilhouetteScore)}`} detail="From / to" tone="green" icon="◉" />
        <MetricCard label="Xie-Beni" value={`${formatDecimal(fromMetrics.XieBeniIndex)} / ${formatDecimal(toMetrics.XieBeniIndex)}`} detail="Lower indicates stronger validity" tone="blue" icon="◇" />
        <MetricCard label="Membership" value={`${formatPercent(fromMetrics.AverageMembership)} / ${formatPercent(toMetrics.AverageMembership)}`} detail="Average confidence" tone="purple" icon="◎" />
        <MetricCard label="Active customers" value={`${formatNumber(fromMetrics.ActiveCustomers)} / ${formatNumber(toMetrics.ActiveCustomers)}`} detail="From / to" icon="●" />
        <MetricCard label="Migration rate" value={toMetrics.MigrationRate == null ? 'Baseline' : formatStoredPercent(toMetrics.MigrationRate)} detail={cycleLabel(toCycle)} tone="gold" icon="⇄" />
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
        <Panel title="Average monetary value by segment" eyebrow="Behavioural value comparison">
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
        <DataTable
          rows={profileRows}
          columns={[
            { key: 'segment', label: 'Segment', render: (value) => <SegmentBadge segment={value} /> },
            { key: 'fromCustomers', label: `${cycleLabel(fromCycle)} customers`, render: formatNumber },
            { key: 'toCustomers', label: `${cycleLabel(toCycle)} customers`, render: formatNumber },
            { key: 'customerChange', label: 'Change', render: signedNumber },
            { key: 'fromRecency', label: 'Recency from', render: (value) => formatDecimal(value, 1) },
            { key: 'toRecency', label: 'Recency to', render: (value) => formatDecimal(value, 1) },
            { key: 'fromFrequency', label: 'Frequency from', render: (value) => formatDecimal(value, 2) },
            { key: 'toFrequency', label: 'Frequency to', render: (value) => formatDecimal(value, 2) },
            { key: 'fromMonetary', label: 'Monetary from', render: formatCurrency },
            { key: 'toMonetary', label: 'Monetary to', render: formatCurrency },
          ]}
        />
      </Panel>
    </>
  );
}

function PcaSegmentAnalysisPage({ data }) {
  const analytics = data.pcaAnalytics;
  const cycleOptions = data.filters.cycles || [];
  const [selectedCycle, setSelectedCycle] = useState(cycleOptions.at(-1)?.value || 'Cycle_10');
  const selectedPoints = (analytics.points || []).filter((point) => point.CycleID === selectedCycle);
  const selectedProfiles = (analytics.featureProfiles || []).filter((profile) => profile.CycleID === selectedCycle);
  const centroids = useMemo(() => analytics.centroids || [], [analytics.centroids]);
  const centroidDomains = useMemo(() => {
    const paddedDomain = (values) => {
      if (!values.length) return ['auto', 'auto'];
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const span = Math.max(maximum - minimum, 0.1);
      const padding = span * 0.16;
      return [minimum - padding, maximum + padding];
    };
    return {
      x: paddedDomain(centroids.map((centroid) => Number(centroid.PC1)).filter(Number.isFinite)),
      y: paddedDomain(centroids.map((centroid) => Number(centroid.PC2)).filter(Number.isFinite)),
    };
  }, [centroids]);

  return (
    <>
      <PageTitle
        eyebrow="PCA segment analysis"
        title="Explore customer segments in a stable feature space"
        description="Inspect two-dimensional and interactive three-dimensional PCA views for every cycle, then follow centroid movement from Cycle 0 to Cycle 10."
        action={(
          <select className="page-select" value={selectedCycle} onChange={(event) => setSelectedCycle(event.target.value)}>
            {cycleOptions.map((cycle) => <option key={cycle.value} value={cycle.value}>{cycleLabel(cycle.value)}</option>)}
          </select>
        )}
      />

      <div className="content-grid equal">
        <Panel title="Two-dimensional PCA segment view" eyebrow={`${cycleLabel(selectedCycle)}: PC1 vs PC2`}>
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 18, right: 22, bottom: 18, left: 10 }}>
                <CartesianGrid strokeDasharray="3 6" />
                <XAxis type="number" dataKey="PC1" name="PC1" />
                <YAxis type="number" dataKey="PC2" name="PC2" />
                <ZAxis range={[22, 22]} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Legend />
                {SEGMENTS.map((segment) => (
                  <Scatter key={segment} name={segment} data={selectedPoints.filter((point) => point.segment === segment)} fill={SEGMENT_COLORS[segment]} fillOpacity={0.72} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Interactive three-dimensional PCA view" eyebrow={`${cycleLabel(selectedCycle)}: PC1, PC2, and PC3`}>
          <Pca3DPlot points={selectedPoints} />
        </Panel>
      </div>

      <div className="content-grid two-one pca-centroid-layout">
        <Panel title="Dynamic centroid movement" eyebrow="PC1 vs PC2 from Cycle 0 to Cycle 10">
          <div className="chart-xl centroid-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 34, right: 44, bottom: 24, left: 20 }}>
                <CartesianGrid strokeDasharray="3 6" />
                <XAxis
                  type="number"
                  dataKey="PC1"
                  name="PC1"
                  domain={centroidDomains.x}
                  tickCount={6}
                  tickFormatter={(value) => Number(value).toFixed(2)}
                />
                <YAxis
                  type="number"
                  dataKey="PC2"
                  name="PC2"
                  domain={centroidDomains.y}
                  tickCount={6}
                  tickFormatter={(value) => Number(value).toFixed(2)}
                />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Legend />
                {SEGMENTS.map((segment) => (
                  <Scatter
                    key={segment}
                    name={segment}
                    data={centroids
                      .filter((centroid) => centroid.segment === segment)
                      .sort((left, right) => cycleIndex(left.CycleID) - cycleIndex(right.CycleID))}
                    fill={SEGMENT_COLORS[segment]}
                    line={{ stroke: SEGMENT_COLORS[segment], strokeWidth: 2.5 }}
                    shape={<CentroidPoint />}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Explained variance" eyebrow="Cycle 0 PCA model">
          <div className="variance-list">
            {(analytics.explainedVariance || []).map((item) => (
              <div key={item.component}><span>{item.component}</span><i><b style={{ width: `${item.percentage}%` }} /></i><strong>{item.percentage.toFixed(2)}%</strong></div>
            ))}
          </div>
          <p className="panel-note">The same fitted PCA transformation is applied to every dynamic cycle for direct centroid and customer comparison.</p>
        </Panel>
      </div>

      <Panel title="RFM and cascaded feature profile" eyebrow={cycleLabel(selectedCycle)}>
        <DataTable
          rows={selectedProfiles}
          columns={[
            { key: 'segment', label: 'Segment', render: (value) => <SegmentBadge segment={value} /> },
            { key: 'customers', label: 'Customers', render: formatNumber },
            { key: 'recency', label: 'Recency', render: (value) => formatDecimal(value, 2) },
            { key: 'frequency', label: 'Frequency', render: (value) => formatDecimal(value, 2) },
            { key: 'monetary', label: 'Monetary', render: formatCurrency },
            { key: 'rf', label: 'RF', render: (value) => formatDecimal(value, 2) },
            { key: 'rm', label: 'RM', render: (value) => formatDecimal(value, 2) },
            { key: 'fm', label: 'FM', render: (value) => formatDecimal(value, 2) },
            { key: 'averageMembership', label: 'Confidence', render: formatPercent },
          ]}
        />
      </Panel>
    </>
  );
}

function ProductsPage({ data }) {
  const analytics = data.productAnalytics;
  const [segment, setSegment] = useState('Champions');
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
        description="Reveal revenue-driving products, segment-specific affinities, product breadth, and changes in commercial demand across cycles."
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
            {analytics.portfolio.map((row) => (
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
                <Bar dataKey="revenue" name="Revenue" radius={[0, 6, 6, 0]}>
                  {segmentRevenueProducts.map((row) => <Cell key={row.label} fill={SEGMENT_COLORS[row.segment]} />)}
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
              {SEGMENTS.map((name) => <option key={name}>{name}</option>)}
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
    'Core Loyalists': Number(market.coreLoyalistsShare || 0) * 100,
    'Mid-Tier Occasionals': Number(market.midTierOccasionalsShare || 0) * 100,
    'Hibernating / Lost': Number(market.hibernatingLostShare || 0) * 100,
  }));
  const evolutionMarkets = topMarkets.slice(0, 3);

  return (
    <>
      <PageTitle
        eyebrow="Firmographic component: geographic segmentation"
        title="Discover distinct geographic market segments"
        description="Thirty-seven country markets are clustered from customer scale, revenue, order behaviour, product diversity, repeat purchasing, and behavioural segment composition."
      />
      <div className="metric-grid metric-grid-four">
        <MetricCard label="Geographic markets" value={formatNumber(markets.length)} detail="Country-level observations" icon="⌖" />
        <MetricCard label="Market segments" value={formatNumber(segmentSummary.length)} detail="K-Means geographic groups" tone="blue" icon="⊞" />
        <MetricCard label="Largest market" value={topMarkets[0]?.country || '-'} detail={`${formatNumber(topMarkets[0]?.customers)} customers`} tone="green" icon="◎" />
        <MetricCard label="Geographic silhouette" value={formatDecimal(latestQuality.SilhouetteScore)} detail={cycleLabel(analytics.latestCycle)} tone="gold" icon="◉" />
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
                <Bar dataKey="revenue" name="Revenue" radius={[0, 6, 6, 0]}>
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
              {SEGMENTS.map((segment) => (
                <Bar key={segment} dataKey={segment} stackId="segments" fill={SEGMENT_COLORS[segment]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="panel-note">Behavioural shares are included with commercial market measures when geographic segments are created.</p>
      </Panel>

      <section className="geographic-evolution-section">
        <div className="section-heading-inline">
          <div><span className="eyebrow">Cycle 0 to Cycle 10</span><h2>Geographic behavioural segment evolution across cycles</h2></div>
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
                      {SEGMENTS.map((segment) => (
                        <Line key={segment} dataKey={segment} name={segment} stroke={SEGMENT_COLORS[segment]} strokeWidth={2.2} dot={{ r: 2.5 }} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            );
          })}
        </div>
        <div className="chart-legend-row">
          {SEGMENTS.map((segment) => <span key={segment}><i style={{ background: SEGMENT_COLORS[segment] }} />{segment}</span>)}
        </div>
      </section>

      <Panel title="Market behavioural composition detail" eyebrow={cycleLabel(analytics.latestCycle)}>
        <DataTable
          rows={markets}
          columns={[
            { key: 'country', label: 'Country' },
            { key: 'geographicSegment', label: 'Geographic segment' },
            { key: 'championsShare', label: 'Champions', render: formatPercent },
            { key: 'coreLoyalistsShare', label: 'Core Loyalists', render: formatPercent },
            { key: 'midTierOccasionalsShare', label: 'Mid-Tier Occasionals', render: formatPercent },
            { key: 'hibernatingLostShare', label: 'Hibernating / Lost', render: formatPercent },
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
  const combinations = analytics.combinations || [];
  const combinationChart = combinations.slice(0, 12).reverse();
  const evolution = pivotSeries(analytics.evolution || [], 'customers', 'geographicSegment');
  const matrixRows = GEOGRAPHIC_SEGMENTS.map((geographicSegment) => {
    const row = { geographicSegment };
    SEGMENTS.forEach((behaviouralSegment) => {
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
        description="Each customer receives a firmographic label formed from a dynamic behavioural segment and a clustered geographic market segment, such as High-Value Export Champions."
      />
      <section className="integration-banner">
        <div><span>Behavioural segment</span><strong>How the customer behaves</strong></div>
        <b>+</b>
        <div><span>Geographic segment</span><strong>What type of market they purchase in</strong></div>
        <b>=</b>
        <div><span>Firmographic segment</span><strong>Customer behaviour in market context</strong></div>
      </section>

      <div className="metric-grid metric-grid-six">
        <MetricCard label="Customers" value={formatNumber(summary.customers)} detail={cycleLabel(analytics.latestCycle)} icon="◎" />
        <MetricCard label="Firmographic groups" value={formatNumber(summary.firmographicSegments)} detail="Occupied combinations" tone="gold" icon="⊞" />
        <MetricCard label="Geographic segments" value={formatNumber(summary.geographicSegments)} detail={`${formatNumber(summary.markets)} markets`} tone="blue" icon="⌖" />
        <MetricCard label="Behavioural segments" value={formatNumber(summary.behaviouralSegments)} detail="Dynamic RFM groups" tone="green" icon="◉" />
        <MetricCard label="Active customers" value={formatNumber(summary.activeCustomers)} detail="Current cycle purchasers" icon="●" />
        <MetricCard label="Average confidence" value={formatPercent(summary.averageMembership)} detail="Fuzzy membership" tone="purple" icon="◇" />
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
                {SEGMENTS.map((segment) => (
                  <Bar key={segment} dataKey={segment} stackId="behaviour" fill={SEGMENT_COLORS[segment]} />
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
            { key: 'averageMembership', label: 'Confidence', render: formatPercent },
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

function Cycle10SimulationPage({ data }) {
  const simulation = data.cycle10Simulation || {};
  const model = simulation.model || {};
  const definition = simulation.definition || {};
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const transitionRows = simulation.transitionMatrix || [];
  const matrixMax = Math.max(...transitionRows.map((row) => Number(row.customers || 0)), 1);

  const startSimulation = () => {
    setRunning(true);
    window.setTimeout(() => {
      setRunning(false);
      setRevealed(true);
    }, 850);
  };

  return (
    <main className="standalone-page simulation-page">
      <PageTitle
        eyebrow="Precomputed live simulation"
        title="Run the Cycle 10 customer segmentation view"
        description="Start a reproducible playback of the model's stored Cycle 10 result. The interface loads the completed behavioural, geographic, firmographic, transition, and validation evidence without retraining the research model."
        action={<StatusPill tone="success">Precomputed and ready</StatusPill>}
      />

      <section className="simulation-launch">
        <div>
          <span className="eyebrow">Simulation window</span>
          <h2>{String(definition.PeriodStart || '').slice(0, 10)} to {String(definition.PeriodEnd || '').slice(0, 10)}</h2>
          <p>
            The three-month feature window begins on {String(definition.WindowStart || '').slice(0, 10)}.
            Baseline preprocessing is reused so Cycle 10 remains comparable with every earlier cycle.
          </p>
        </div>
        <button className="button button-primary simulation-button" onClick={startSimulation} disabled={running}>
          {running ? 'Loading Cycle 10 evidence...' : revealed ? 'Replay Cycle 10 simulation' : 'Start Cycle 10 simulation'}
        </button>
      </section>

      {!revealed && !running && (
        <div className="simulation-placeholder">
          <span>10</span>
          <strong>Cycle 10 is ready for inspection</strong>
          <p>Select the simulation button to reveal the precomputed research result.</p>
        </div>
      )}
      {running && (
        <div className="simulation-placeholder simulation-running">
          <div className="loading-mark"><span /><span /><span /></div>
          <strong>Preparing Cycle 10 analytical evidence</strong>
          <p>Loading lifecycle states, market clusters, firmographic groups, and model validation.</p>
        </div>
      )}

      {revealed && (
        <div className="simulation-results">
          <div className="metric-grid metric-grid-six">
            <MetricCard label="Processed" value={formatNumber(model.CustomersProcessed)} detail="Cumulative customers" icon="◎" />
            <MetricCard label="Active" value={formatNumber(model.ActiveCustomers)} detail="Purchased in window" tone="green" icon="●" />
            <MetricCard label="Inactive" value={formatNumber(model.InactiveCustomers)} detail="Retained in snapshot" icon="○" />
            <MetricCard label="Migration rate" value={formatStoredPercent(model.MigrationRate)} detail={`${formatNumber(model.ComparableCustomers)} comparable`} tone="gold" icon="⇄" />
            <MetricCard label="Xie-Beni index" value={formatDecimal(model.XieBeniIndex)} detail="Fuzzy validity" tone="blue" icon="◇" />
            <MetricCard label="Confidence" value={formatPercent(model.AverageMembership)} detail="Average membership" tone="purple" icon="◉" />
          </div>

          <div className="content-grid equal">
            <Panel title="Cycle 10 lifecycle states" eyebrow="Customer transition classification">
              <div className="chart-large">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={simulation.transitionStates || []} layout="vertical" margin={{ left: 72, right: 18 }}>
                    <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="state" width={120} />
                    <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} customers`} />} />
                    <Bar dataKey="customers" name="Customers" radius={[0, 6, 6, 0]}>
                      {(simulation.transitionStates || []).map((row) => (
                        <Cell key={row.state} fill={TRANSITION_COLORS[row.state] || '#168a58'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Cycle 9 and Cycle 10 segments" eyebrow="Customer population comparison">
              <div className="chart-large">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={simulation.segmentComparison || []}>
                    <CartesianGrid strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="segment" interval={0} angle={-12} textAnchor="end" height={68} />
                    <YAxis />
                    <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} customers`} />} />
                    <Legend />
                    <Bar dataKey="previousCustomers" name="Cycle 9" fill="#9eb3a8" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="currentCustomers" name="Cycle 10" fill="#168a58" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="content-grid equal">
            <Panel title="Cycle 10 transition matrix" eyebrow="Comparable customers only">
              <div className="matrix-scroll">
                <div className="transition-matrix">
                  <span />
                  {SEGMENTS.map((segment) => <b key={segment}>{segment}</b>)}
                  {SEGMENTS.map((fromSegment) => (
                    <div className="matrix-row" key={fromSegment}>
                      <strong>{fromSegment}</strong>
                      {SEGMENTS.map((toSegment) => {
                        const cell = transitionRows.find(
                          (row) => row.fromSegment === fromSegment && row.toSegment === toSegment,
                        );
                        const value = Number(cell?.customers || 0);
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
            </Panel>
            <Panel title="Cycle 10 geographic segments" eyebrow="Country market clustering">
              <div className="chart-large">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={simulation.geographicSegments || []} layout="vertical" margin={{ left: 125, right: 18 }}>
                    <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="segment" width={180} />
                    <Tooltip content={<ChartTooltip valueFormatter={(value) => formatNumber(value)} />} />
                    <Legend />
                    <Bar dataKey="customers" name="Customers" radius={[0, 6, 6, 0]}>
                      {(simulation.geographicSegments || []).map((row) => (
                        <Cell key={row.segment} fill={GEOGRAPHIC_COLORS[row.segment] || '#168a58'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <Panel title="Cycle 10 firmographic combinations" eyebrow="Largest behavioural and geographic groups">
            <div className="chart-xl">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(simulation.firmographicSegments || []).slice(0, 12).reverse()} layout="vertical" margin={{ left: 160, right: 18 }}>
                  <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="segment" width={230} tick={{ fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} customers`} />} />
                  <Bar dataKey="customers" name="Customers" fill="#168a58" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Highest-value Cycle 10 customers" eyebrow="Customer-level simulation evidence">
            <DataTable
              rows={simulation.topCustomers || []}
              columns={[
                { key: 'CustomerID', label: 'Customer ID' },
                { key: 'Country', label: 'Country' },
                { key: 'firmographicSegment', label: 'Firmographic segment' },
                { key: 'behaviouralSegment', label: 'Behavioural segment', render: (value) => <SegmentBadge segment={value} /> },
                { key: 'transitionState', label: 'Transition state' },
                { key: 'Revenue', label: 'Revenue', render: (value) => <strong>{formatCurrency(value)}</strong> },
                { key: 'Orders', label: 'Orders', render: formatNumber },
                { key: 'averageMembership', label: 'Confidence', render: formatPercent },
              ]}
            />
          </Panel>
        </div>
      )}
    </main>
  );
}

function ModelPage({ data }) {
  const evaluation = data.modelEvaluation;
  const averages = evaluation.averages || {};
  const cycles = evaluation.cycles || [];
  const modelFigures = data.artifacts.filter((artifact) =>
    [
      'performance',
      'baseline',
      'model diagnostics',
      'dynamic segmentation',
      'validation',
      'geographic segmentation',
      'firmographic segmentation',
    ].includes(artifact.category) && artifact.imageUrl,
  );

  return (
    <main className="standalone-page">
      <PageTitle
        eyebrow="Model and methodology"
        title="A behavioural and geographic firmographic model"
        description="See how Cascade RFM and dynamic fuzzy clustering produce behavioural segments that are integrated with geographic markets, validation metrics, and model-generated evidence."
        action={<StatusPill tone="success">All dynamic cycles converged</StatusPill>}
      />

      <section className="model-flow">
        {[
          ['01', 'Transaction preparation', 'Clean online retail transactions and organise them into sequential time cycles.'],
          ['02', 'Cascade RFM', 'Build Recency, Frequency, Monetary, and interaction features for each customer-cycle.'],
          ['03', 'Baseline clustering', 'Use PCA and K-Means to initialise four interpretable behavioural segments.'],
          ['04', 'Dynamic fuzzy updates', 'Warm-start each cycle, update centroids, and preserve fuzzy membership confidence.'],
          ['05', 'Decision intelligence', 'Connect segments to customers, products, revenue, migration, and geography.'],
        ].map(([step, title, description], index) => (
          <article key={step}>
            <span>{step}</span>
            <h3>{title}</h3>
            <p>{description}</p>
            {index < 4 && <b>→</b>}
          </article>
        ))}
      </section>

      <ModelComputationVisuals />

      <div className="metric-grid metric-grid-six">
        <MetricCard label="Average silhouette" value={formatDecimal(averages.silhouette)} detail="Dynamic cluster separation" icon="◉" />
        <MetricCard label="Average Xie-Beni" value={formatDecimal(averages.xieBeni)} detail="Fuzzy compactness" tone="green" icon="◎" />
        <MetricCard label="Davies-Bouldin" value={formatDecimal(averages.daviesBouldin)} detail="Average cluster similarity" tone="blue" icon="◇" />
        <MetricCard label="Calinski-Harabasz" value={formatNumber(averages.calinskiHarabasz)} detail="Separation vs compactness" tone="gold" icon="△" />
        <MetricCard label="Average confidence" value={formatPercent(averages.averageMembership)} detail="Fuzzy membership certainty" tone="purple" icon="◎" />
        <MetricCard label="Converged cycles" value={`${formatNumber(averages.convergedCycles)}/${formatNumber(averages.dynamicCycles)}`} detail="All dynamic updates" icon="✓" />
      </div>

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

      <Panel title="Model evaluation by cycle" eyebrow="Cycle 0 to Cycle 10 evidence">
        <DataTable
          rows={cycles}
          columns={[
            { key: 'CycleID', label: 'Cycle', render: cycleLabel },
            { key: 'CustomersProcessed', label: 'Customers', render: formatNumber },
            { key: 'SilhouetteScore', label: 'Silhouette', render: formatDecimal },
            { key: 'DaviesBouldinScore', label: 'Davies-Bouldin', render: formatDecimal },
            { key: 'XieBeniIndex', label: 'Xie-Beni', render: formatDecimal },
            { key: 'FuzzyObjective', label: 'Fuzzy objective', render: (value) => formatDecimal(value, 2) },
            { key: 'AverageMembership', label: 'Confidence', render: formatPercent },
            { key: 'Iterations', label: 'Iterations', render: formatNumber },
            { key: 'Converged', label: 'Converged', render: (value) => Number(value) === 1 ? 'Yes' : 'No' },
          ]}
        />
      </Panel>

      <Panel title="Model evidence" eyebrow="Diagnostics, validation, and segmentation figures">
        <FigureGallery artifacts={modelFigures} />
      </Panel>
    </main>
  );
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
        description="Browse behavioural, geographic, customer, product, dynamic, baseline, and model-performance outputs generated by the executed research notebook."
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
            The original dataset contains 541,909 transaction records recorded from December 2010 to December 2011.
            The model cleans the records, constructs cumulative customer snapshots, and stores reproducible behavioural,
            geographic, firmographic, transition, and model evaluation outputs in SQLite.
          </p>
        </div>
        <a
          className="button button-primary"
          href="https://www.kaggle.com/datasets/jihyeseo/online-retail-data-set-from-uci-ml-repo/data"
          target="_blank"
          rel="noreferrer"
        >
          View dataset on Kaggle
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
              <span>{item.icon}</span>{item.label}
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
    { id: 'simulation', label: 'Cycle 10' },
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
        <span>◐</span> Accessibility
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
          {page === 'simulation' && <Cycle10SimulationPage data={data} />}
          {page === 'research' && <ResearchPage data={data} />}
          {page === 'data' && <DataExplorerPage data={data} />}
          {page === 'accessibility' && <AccessibilityPage settings={settings} setSettings={setSettings} />}
        </>
      )}
    </div>
  );
}
