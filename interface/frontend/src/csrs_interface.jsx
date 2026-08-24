import { useEffect, useState } from 'react';
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
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import IconOnly from './assets/iconOnly.png';
import HomeVisual from './assets/homeSimplier.png';
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

const ANALYTICS_PAGES = [
  { id: 'overview', label: 'Overview', icon: '◫' },
  { id: 'customers', label: 'Customers', icon: '◎' },
  { id: 'segments', label: 'Segments', icon: '◉' },
  { id: 'dynamics', label: 'Cycle dynamics', icon: '↝' },
  { id: 'products', label: 'Products', icon: '◇' },
  { id: 'geography', label: 'Geography', icon: '⌖' },
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
const cycleLabel = (value) => String(value || '').replace('_', ' ');
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
    description: descriptions[title] || 'Research output generated from the current dynamic customer segmentation model.',
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
                  {column.render ? column.render(row[column.key], row) : String(row[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoadingView() {
  return (
    <div className="loading-view">
      <img src={IconOnly} alt="" />
      <div className="loading-mark"><span /><span /><span /></div>
      <strong>Preparing customer analytics</strong>
      <p>Loading the current model results and research outputs.</p>
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
          <img src={HomeVisual} alt="Retail professionals reviewing customer insights" />
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
            In this research, firmographic segmentation combines how customers behave—using dynamic
            RFM and fuzzy membership—with where they purchase across geographic markets. The result
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
        <div className="capability-heading">
          <span className="eyebrow">Research workspace</span>
          <h2>From customer-level evidence to strategic action</h2>
        </div>
        <div className="capability-grid">
          {[
            ['◎', 'Customer analytics', 'Search customers, compare value bands, confidence, baskets, products, and full cycle history.', 'customers'],
            ['↝', 'Behavioural movement', 'Investigate migration rates, transition flows, segment stability, and confidence over time.', 'dynamics'],
            ['⌖', 'Geographic intelligence', 'Compare market size, customer value, product breadth, revenue, and behavioural composition by country.', 'geography'],
            ['◫', 'Research evidence', 'Browse the presentation-ready figures produced by the current notebook analysis.', 'research'],
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
            <div><span>Davies–Bouldin</span><strong>{number.format(latestCycle.DaviesBouldinScore)}</strong><small>Lower is better</small></div>
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
        eyebrow="Firmographic component · Behavioural segmentation"
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

      <Panel title="Segment economics and RFM profile" eyebrow={cycleLabel(segmentData.latestCycle)}>
        <DataTable
          rows={segments}
          columns={[
            { key: 'segment', label: 'Segment', render: (value) => <SegmentBadge segment={value} /> },
            { key: 'customerCount', label: 'Customers', render: formatNumber },
            { key: 'avgRecency', label: 'Avg recency', render: (value) => `${number.format(value)} days` },
            { key: 'avgFrequency', label: 'Avg frequency', render: (value) => number.format(value) },
            { key: 'avgMonetary', label: 'Avg monetary', render: (value) => formatCurrency(value) },
            { key: 'revenue', label: 'Revenue', render: (value) => formatCurrency(value) },
            { key: 'revenuePerCustomer', label: 'Revenue/customer', render: (value) => formatCurrency(value) },
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
  const matrixMax = Math.max(...transitionRows.map((row) => Number(row.count || 0)), 1);
  const topFlows = (migration.topFlows || []).map((row) => ({
    ...row,
    flow: `${row.fromSegment} → ${row.toSegment}`,
  }));

  return (
    <>
      <PageTitle
        eyebrow="Dynamic customer movement"
        title="See where customer behaviour is changing"
        description="Track migrations, stable assignments, transition direction, membership confidence, and model behaviour across successive cycles."
      />
      <div className="metric-grid metric-grid-four">
        <MetricCard label="Transitions observed" value={formatNumber(statistics.total)} detail="Customer-cycle assignments" icon="↝" />
        <MetricCard label="Migrated" value={formatNumber(statistics.migrated)} detail={formatPercent(statistics.migrationRate)} tone="gold" icon="⇄" />
        <MetricCard label="Positive movement" value={formatNumber(migration.positiveMigrationCount)} detail="Toward higher-value segments" tone="green" icon="↗" />
        <MetricCard label="Negative movement" value={formatNumber(migration.negativeMigrationCount)} detail="Toward lower-value segments" tone="red" icon="↘" />
      </div>

      <div className="content-grid equal">
        <Panel title="Migration rate by cycle" eyebrow="Behavioural movement">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cycles}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="CycleID" tickFormatter={cycleLabel} />
                <YAxis domain={[0.75, 0.95]} tickFormatter={(value) => formatPercent(value, 0)} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatPercent(value)} />} />
                <Line type="monotone" dataKey="MigrationRate" name="Migration rate" stroke="#e59a38" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
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
                <YAxis domain={[0.6, 0.8]} tickFormatter={(value) => formatPercent(value, 0)} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatPercent(value)} />} />
                <Area type="monotone" dataKey="AverageMembership" name="Confidence" stroke="#377dc1" fill="url(#confidenceGradient)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

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
    </>
  );
}

function ProductsPage({ data }) {
  const analytics = data.productAnalytics;
  const [segment, setSegment] = useState('Champions');
  const segmentProducts = analytics.segmentProducts.filter((row) => row.segment === segment);
  const topProducts = analytics.topProducts.slice(0, 12).reverse();
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
  const topCountries = analytics.countries.slice(0, 12);
  const internationalCountries = analytics.countries
    .filter((row) => row.country !== 'United Kingdom')
    .slice(0, 12);
  const topCountryNames = new Set(topCountries.slice(0, 8).map((row) => row.country));
  const compositionMap = new Map();
  analytics.segmentComposition
    .filter((row) => topCountryNames.has(row.country))
    .forEach((row) => {
      if (!compositionMap.has(row.country)) compositionMap.set(row.country, { country: row.country });
      compositionMap.get(row.country)[row.segment] = Number(row.customers || 0);
    });
  const composition = [...compositionMap.values()].sort((left, right) =>
    topCountries.findIndex((row) => row.country === left.country)
    - topCountries.findIndex((row) => row.country === right.country));
  const highestValueMarkets = [...analytics.countries]
    .filter((row) => Number(row.customers) >= 3)
    .sort((left, right) => Number(right.revenuePerCustomer) - Number(left.revenuePerCustomer))
    .slice(0, 10)
    .reverse();

  return (
    <>
      <PageTitle
        eyebrow="Firmographic component · Geographic segmentation"
        title="Compare customer value across markets"
        description="Explore the geographic component of firmographic segmentation through market size, revenue concentration, product breadth, customer value, and behavioural composition by country."
      />
      <div className="metric-grid metric-grid-four">
        <MetricCard label="Countries" value={formatNumber(data.overview.countries)} detail="Geographic markets represented" icon="⌖" />
        <MetricCard label="Largest market" value={topCountries[0]?.country || '—'} detail={`${formatNumber(topCountries[0]?.customers)} customers`} tone="green" icon="◎" />
        <MetricCard label="Highest revenue" value={formatCurrency(topCountries[0]?.revenue, true)} detail={topCountries[0]?.country || '—'} tone="gold" icon="£" />
        <MetricCard label="Latest composition" value={cycleLabel(analytics.latestCycle)} detail="Segment mix shown below" tone="blue" icon="◉" />
      </div>

      <div className="content-grid equal">
        <Panel title="International revenue by market" eyebrow="Top twelve markets outside the UK">
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...internationalCountries].reverse()} layout="vertical" margin={{ left: 64, right: 18 }}>
                <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => formatCurrency(value, true)} />
                <YAxis type="category" dataKey="country" width={105} tick={{ fontSize: 10 }} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                <Bar dataKey="revenue" name="Revenue" fill="#168a58" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Highest customer value markets" eyebrow="Revenue per customer · minimum 3 customers">
          <div className="chart-xl">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={highestValueMarkets} layout="vertical" margin={{ left: 52, right: 18 }}>
                <CartesianGrid strokeDasharray="3 6" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => formatCurrency(value, true)} />
                <YAxis type="category" dataKey="country" width={100} tick={{ fontSize: 10 }} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => formatCurrency(value)} />} />
                <Bar dataKey="revenuePerCustomer" name="Revenue per customer" fill="#377dc1" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Behavioural composition across leading markets" eyebrow={cycleLabel(analytics.latestCycle)}>
        <div className="chart-large">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={composition} margin={{ top: 12, right: 18, left: 0, bottom: 26 }}>
              <CartesianGrid strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="country" angle={-18} textAnchor="end" interval={0} height={62} />
              <YAxis />
              <Tooltip content={<ChartTooltip valueFormatter={(value) => `${formatNumber(value)} customers`} />} />
              <Legend />
              {SEGMENTS.map((segment) => (
                <Bar key={segment} dataKey={segment} stackId="segments" fill={SEGMENT_COLORS[segment]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="panel-note">This redesigned chart uses one consistent colour for each segment across the full interface.</p>
      </Panel>

      <Panel title="Market profile detail" eyebrow="Customer, order, product, and revenue measures">
        <DataTable
          rows={analytics.countries}
          columns={[
            { key: 'country', label: 'Country' },
            { key: 'customers', label: 'Customers', render: formatNumber },
            { key: 'orders', label: 'Orders', render: formatNumber },
            { key: 'products', label: 'Distinct products', render: formatNumber },
            { key: 'quantity', label: 'Quantity', render: formatNumber },
            { key: 'revenue', label: 'Revenue', render: (value) => <strong>{formatCurrency(value)}</strong> },
            { key: 'revenuePerCustomer', label: 'Revenue/customer', render: (value) => formatCurrency(value) },
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

function ModelPage({ data }) {
  const evaluation = data.modelEvaluation;
  const averages = evaluation.averages || {};
  const cycles = evaluation.cycles || [];
  const modelFigures = data.artifacts.filter((artifact) =>
    ['performance', 'baseline', 'model diagnostics'].includes(artifact.category)
    && artifact.imageUrl,
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

      <div className="metric-grid metric-grid-four">
        <MetricCard label="Average silhouette" value={number.format(averages.silhouette)} detail="Dynamic cluster separation" icon="◉" />
        <MetricCard label="Davies–Bouldin" value={number.format(averages.daviesBouldin)} detail="Average cluster similarity" tone="blue" icon="◇" />
        <MetricCard label="Calinski–Harabasz" value={formatNumber(averages.calinskiHarabasz)} detail="Separation vs compactness" tone="gold" icon="△" />
        <MetricCard label="Average confidence" value={formatPercent(averages.averageMembership)} detail="Fuzzy membership certainty" tone="purple" icon="◎" />
      </div>

      <div className="content-grid equal">
        <Panel title="Cluster quality across cycles" eyebrow="Silhouette and Davies–Bouldin">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cycles}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="CycleID" tickFormatter={cycleLabel} />
                <YAxis yAxisId="left" domain={[0.25, 0.45]} />
                <YAxis yAxisId="right" orientation="right" domain={[0.7, 1.1]} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line yAxisId="left" dataKey="SilhouetteScore" name="Silhouette" stroke="#168a58" strokeWidth={3} />
                <Line yAxisId="right" dataKey="DaviesBouldinScore" name="Davies–Bouldin" stroke="#e59a38" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Efficiency and convergence" eyebrow="Iterations and processing time">
          <div className="chart-large">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cycles}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="CycleID" tickFormatter={cycleLabel} />
                <YAxis />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="Iterations" name="Iterations" fill="#377dc1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Model evidence" eyebrow="Selected diagnostics and validation figures">
        <FigureGallery artifacts={modelFigures} limit={6} />
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
        description="Browse behavioural, geographic, customer, product, dynamic, baseline, and model-performance outputs generated from the current research notebook."
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
                    const text = String(value ?? '—');
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
    if (page === 'dynamics') return <DynamicsPage data={data} />;
    if (page === 'products') return <ProductsPage data={data} />;
    if (page === 'geography') return <GeographyPage data={data} />;
    return <OverviewPage data={data} />;
  };

  return (
    <div className="analytics-shell">
      <aside className="analytics-sidebar">
        <div className="sidebar-heading">
          <span>Analytics workspace</span>
          <small>Current research model</small>
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
          {page === 'research' && <ResearchPage data={data} />}
          {page === 'data' && <DataExplorerPage data={data} />}
          {page === 'accessibility' && <AccessibilityPage settings={settings} setSettings={setSettings} />}
        </>
      )}
    </div>
  );
}
