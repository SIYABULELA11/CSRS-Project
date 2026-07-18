import { useState, useEffect } from "react";
import IconOnly from "./assets/iconOnly.png";
import HeroImg from "./assets/home.png";
import HomeSimplified from "./assets/homeSimplier.png";
import ModelShowcase from "./assets/model.png";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { fetchOverviewData, fetchSegmentsData, fetchCustomersData, fetchModelEvaluation } from "./services/dashboardService";
import { mapOverviewData, mapSegmentsData, mapCustomersData, mapModelEvaluationData } from "./services/dashboardMapper";

// ─── DATA ──────────────────────────────────────────────────────────────────

// SIM_A - Research data (no backend data available)
const SIM_A = {
  totalCustomers: 22702,
  segments: 5,
  avgSpend: "R170",
  churnRisk: "18%",
  silhouette: 0.62,
  xbIndex: "0.14",
  distribution: [
    { name: "High Value Loyal", pct: 18.1, color: "#1a6fb5" },
    { name: "Active Mid-tier", pct: 26.9, color: "#2E9E4F" },
    { name: "Ultra High Value", pct: 0.2, color: "#D4A017" },
    { name: "Standard Customers", pct: 28.0, color: "#4da6e8" },
    { name: "At-Risk / Dormant", pct: 26.9, color: "#a0c8e8" },
  ],
  segments_detail: [
    { id: "A", label: "High Value Loyal", size: "18%", recency: "Low (8 days)", frequency: "High (2.3×)", monetary: "High (R187)", desc: "Frequent buyers with high spending and strong loyalty." },
    { id: "B", label: "Active Mid-tier", size: "27%", recency: "Low (29 days)", frequency: "Medium (2.1×)", monetary: "Medium (R156)", desc: "Moderately engaged customers with consistent purchase patterns." },
    { id: "C", label: "Ultra High Value", size: "<1%", recency: "Very Low", frequency: "Very High", monetary: "Very High (R614K)", desc: "Rare super-buyers with extreme transaction volumes - likely wholesalers." },
    { id: "D", label: "Standard Customers", size: "28%", recency: "Medium (56 days)", frequency: "Low (1.9×)", monetary: "Low (R124)", desc: "Typical shoppers with average engagement and modest spend." },
    { id: "E", label: "At-Risk / Dormant", size: "27%", recency: "High (85 days)", frequency: "Low (1.8×)", monetary: "Low (R121)", desc: "Previously active customers who have significantly reduced engagement." },
  ],
  monthly: [
    { month: "Jul", revenue: 659781 },
    { month: "Aug", revenue: 1207069 },
    { month: "Sep", revenue: 1151415 },
    { month: "Oct", revenue: 848998 },
  ],
  avgSpendPerSeg: [
    { name: "High Value Loyal", spend: 187 },
    { name: "Active Mid-tier", spend: 156 },
    { name: "Ultra High", spend: 614540 },
    { name: "Standard", spend: 124 },
    { name: "At-Risk", spend: 121 },
  ],
  customers: [
    { id: "CU-4138", age: 43, segment: "High Value Loyal", spend: "R12,400", recency: "8 days", freq: 17, location: "Cape Town" },
    { id: "CU-5703", age: 67, segment: "At-Risk / Dormant", spend: "R4,200", recency: "80 days", freq: 5, location: "Johannesburg" },
    { id: "CU-3312", age: 35, segment: "Active Mid-tier", spend: "R2,900", recency: "22 days", freq: 9, location: "Durban" },
    { id: "CU-7891", age: 52, segment: "Standard Customers", spend: "R1,100", recency: "55 days", freq: 3, location: "Pretoria" },
    { id: "CU-2041", age: 29, segment: "High Value Loyal", spend: "R8,760", recency: "5 days", freq: 24, location: "Cape Town" },
  ],
};

const SIM_B = {
  totalCustomers: 4339,
  segments: 5,
  avgSpend: "£474",
  churnRisk: "24%",
  silhouette: 0.58,
  xbIndex: "0.19",
  distribution: [
    { name: "High Value Active", pct: 5.2, color: "#1a6fb5" },
    { name: "Dormant", pct: 24.5, color: "#a0c8e8" },
    { name: "Ultra Premium", pct: 0.2, color: "#D4A017" },
    { name: "VIP Wholesalers", pct: 0.1, color: "#2E9E4F" },
    { name: "Mid-tier Active", pct: 70.0, color: "#4da6e8" },
  ],
  segments_detail: [
    { id: "A", label: "High Value Active", size: "5.2%", recency: "Low (14 days)", frequency: "High (20.8×)", monetary: "High (£12,366)", desc: "Highly engaged B2B customers with strong repeat purchasing." },
    { id: "B", label: "Dormant", size: "24.5%", recency: "Very High (248 days)", frequency: "Low (1.6×)", monetary: "Low (£478)", desc: "Previously active customers who have lapsed - high churn risk." },
    { id: "C", label: "Ultra Premium", size: "<1%", recency: "Very Low (6 days)", frequency: "Very High (121×)", monetary: "Very High (£55K)", desc: "Top-tier wholesalers with near-daily transaction activity." },
    { id: "D", label: "VIP Wholesalers", size: "<1%", recency: "Low (7 days)", frequency: "High (43×)", monetary: "Very High (£191K)", desc: "Elite wholesale accounts with the highest individual monetary value." },
    { id: "E", label: "Mid-tier Active", size: "70%", recency: "Medium (43 days)", frequency: "Medium (3.6×)", monetary: "Medium (£1,324)", desc: "The majority segment - occasional buyers with moderate spend." },
  ],
  monthly: [
    { month: "Dec'10", revenue: 572714 },
    { month: "Jan", revenue: 569445 },
    { month: "Feb", revenue: 447137 },
    { month: "Mar", revenue: 595501 },
    { month: "Apr", revenue: 469200 },
    { month: "May", revenue: 678595 },
    { month: "Jun", revenue: 661214 },
    { month: "Jul", revenue: 600091 },
    { month: "Aug", revenue: 645344 },
    { month: "Sep", revenue: 952838 },
    { month: "Oct", revenue: 1039319 },
    { month: "Nov", revenue: 1161817 },
  ],
  avgSpendPerSeg: [
    { name: "High Value Active", spend: 12366 },
    { name: "Dormant", spend: 478 },
    { name: "Ultra Premium", spend: 55313 },
    { name: "VIP Wholesalers", spend: 190864 },
    { name: "Mid-tier Active", spend: 1324 },
  ],
  customers: [
    { id: "C-17850", country: "United Kingdom", segment: "Mid-tier Active", spend: "£2,315", recency: "15 days", freq: 4, type: "Retailer" },
    { id: "C-12346", country: "Germany", segment: "Dormant", spend: "£977", recency: "310 days", freq: 1, type: "Wholesaler" },
    { id: "C-14688", country: "France", segment: "High Value Active", spend: "£19,450", recency: "7 days", freq: 28, type: "Distributor" },
    { id: "C-17511", country: "Australia", segment: "VIP Wholesalers", spend: "£142,000", recency: "3 days", freq: 61, type: "Wholesaler" },
    { id: "C-15311", country: "United Kingdom", segment: "Mid-tier Active", spend: "£890", recency: "38 days", freq: 3, type: "Retailer" },
  ],
};

// ─── COLOUR TOKENS ──────────────────────────────────────────────────────────

const T = {
  bg: "#ffffff",
  bgCard: "#fafafa",
  bgSidebar: "#dff2e6",
  border: "#e3e7f0",
  borderLight: "#eef2f7",
  blue900: "#0f3d2a",
  blue700: "#14663a",
  blue500: "#1f8a4b",
  blue300: "#64c08a",
  blue100: "#e3f6ea",
  blueNav: "#d6eddc",
  green700: "#1a7a3c",
  green500: "#2e9e4f",
  green300: "#6fcf8f",
  green100: "#d4f0dc",
  gold700: "#9a6a00",
  gold500: "#d4a017",
  gold300: "#f0c84a",
  gold100: "#fdf3cc",
  danger: "#c0392b",
  dangerBg: "#fdecea",
  text: "#0b1220",
  textMuted: "#4b5563",
  textDim: "#8b94a7",
  white: "#ffffff",
};

// ─── SHARED STYLES ──────────────────────────────────────────────────────────

const s = {
  card: {
    background: T.bgCard,
    border: `1px solid ${T.border}`,
    borderRadius: 10,
    padding: "1rem 1.25rem",
  },
  kpi: {
    background: T.blue100,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    padding: "0.85rem 1rem",
    textAlign: "center",
  },
  tag: (color) => ({
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 500,
    background: color + "22",
    color: color,
    border: `1px solid ${color}44`,
  }),
  btn: (active) => ({
    background: active ? T.blue700 : "transparent",
    color: active ? T.white : T.textMuted,
    border: `1px solid ${active ? T.blue700 : T.borderLight}`,
    borderRadius: 6,
    padding: "5px 14px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s",
  }),
  sideLink: (active) => ({
    display: "block",
    padding: "9px 14px",
    fontSize: 12,
    color: active ? T.blue900 : T.textMuted,
    background: active ? T.gold100 : "rgba(255,255,255,0.6)",
    borderLeft: `3px solid ${active ? T.gold500 : "transparent"}`,
    cursor: "pointer",
    textDecoration: "none",
    borderRadius: 8,
    margin: "0 12px 6px",
    transition: "all 0.12s",
    fontFamily: "inherit",
    fontWeight: active ? 600 : 500,
    letterSpacing: "0.02em",
    border: `1px solid ${active ? T.gold300 : "transparent"}`,
  }),
  navLink: (active) => ({
    padding: "6px 14px",
    fontSize: 12,
    color: active ? T.blue900 : T.textMuted,
    cursor: "pointer",
    background: active ? T.gold100 : "transparent",
    borderRadius: 6,
    fontFamily: "inherit",
    fontWeight: active ? 600 : 500,
    border: `1px solid ${active ? T.gold300 : "transparent"}`,
    letterSpacing: "0.03em",
    transition: "color 0.12s, background 0.12s, border-color 0.12s",
    textTransform: "uppercase",
  }),
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: T.gold700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 10,
    marginTop: 0,
  },
  h2: {
    fontSize: 18,
    fontWeight: 600,
    color: T.blue900,
    margin: "0 0 4px 0",
  },
  h3: {
    fontSize: 14,
    fontWeight: 600,
    color: T.blue700,
    margin: "0 0 6px 0",
    letterSpacing: "0.02em",
  },
  sub: {
    fontSize: 12,
    color: T.textMuted,
    margin: 0,
  },
  p: {
    fontSize: 13,
    color: T.textMuted,
    lineHeight: 1.6,
    margin: "0 0 8px 0",
  },
};

// ─── TOOLTIP ────────────────────────────────────────────────────────────────

const ChartTip = ({ active, payload, label, prefix = "" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: T.white, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
      <p style={{ margin: 0, fontSize: 11, color: T.textMuted }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 600, color: p.color || T.blue700 }}>
          {prefix}{typeof p.value === "number" ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  );
};

// ─── KPI CARD ────────────────────────────────────────────────────────────────

const KpiCard = ({ label, value, accent }) => (
  <div style={s.kpi}>
    <p style={{ fontSize: 10, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 4px" }}>{label}</p>
    <p style={{ fontSize: 22, fontWeight: 700, color: accent || T.blue700, margin: 0, fontVariantNumeric: "tabular-nums" }}>{value}</p>
  </div>
);

// ─── SEGMENT DONUT ───────────────────────────────────────────────────────────

const SegmentDonut = ({ data }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie data={data} cx="50%" cy="45%" innerRadius={50} outerRadius={75}
          dataKey="pct" paddingAngle={2} stroke="none">
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Pie>
        <Tooltip content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const d = payload[0].payload;
          return (
            <div style={{ background: T.white, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px" }}>
              <p style={{ margin: 0, fontSize: 12, color: T.blue900 }}>{d.name}</p>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: d.color }}>{d.pct}%</p>
            </div>
          );
        }} />
      </PieChart>
    </ResponsiveContainer>
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", marginTop: 8 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.textMuted }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{d.name}</span>
          <span style={{ fontWeight: 600, color: T.text, fontVariantNumeric: "tabular-nums", minWidth: 35, textAlign: "right" }}>{d.pct}%</span>
        </div>
      ))}
    </div>
  </div>
);

// ─── PAGES ──────────────────────────────────────────────────────────────────

const HomePage = ({ setPage }) => (
  <div style={{ maxWidth: "100%", margin: 0, padding: 0 }}>
    <div style={{ padding: "4rem 2rem", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", background: "#fff", borderBottom: `1px solid ${T.border}` }}>
      <p style={{ fontSize: 13, letterSpacing: "0.3em", color: T.blue700, textTransform: "uppercase", margin: "0 0 16px", fontWeight: 600 }}>Research Project</p>
      <h1 style={{ fontSize: 48, fontWeight: 700, color: T.blue900, margin: "0 0 16px", lineHeight: 1.2, maxWidth: 620 }}>
        Customer Segmentation<br />
        <span style={{ color: T.blue500 }}>in the Retail Sector</span>
      </h1>
      <p style={{ fontSize: 17, color: T.textMuted, margin: "0 0 2.5rem", lineHeight: 1.8, maxWidth: 600 }}>
        Transforming customer data into actionable insights using Cascade RFM with Dynamic Modified Fuzzy C-Means clustering.
      </p>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
        <button style={{ ...s.btn(true), padding: "14px 32px", fontSize: 14, fontWeight: 600 }} onClick={() => setPage("simA")}>
          Simulation A - Cosmetic Retail
        </button>
        <button style={{ ...s.btn(false), padding: "14px 32px", fontSize: 14, fontWeight: 600 }} onClick={() => setPage("simB")}>
          Simulation B - Online Retail
        </button>
        <button style={{ ...s.btn(false), padding: "14px 32px", fontSize: 14, fontWeight: 600 }} onClick={() => setPage("model")}>
          View Model
        </button>
      </div>
    </div>

    <div style={{ display: "flex", alignItems: "stretch", minHeight: "600px", borderBottom: `1px solid ${T.border}`, position: "relative", overflow: "hidden", background: "#fff" }}>
      {/* Left Image Section with Gradient Overlay */}
      <div style={{ 
        flex: 1, 
        position: "relative",
        backgroundImage: `url(${HomeSimplified})`, 
        backgroundSize: "cover", 
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        minHeight: "600px"
      }}>
        {/* Gradient Fade Overlay - Right to Left */}
        <div style={{ 
          position: "absolute", 
          inset: 0, 
          background: "linear-gradient(to left, rgba(255,255,255,1) 0%, rgba(255,255,255,0.8) 10%, rgba(255,255,255,0.3) 40%, rgba(255,255,255,0) 100%)",
          pointerEvents: "none"
        }} />
        
        {/* Subtle Enhancement Overlay */}
        <div style={{ 
          position: "absolute", 
          inset: 0, 
          background: "linear-gradient(135deg, rgba(20, 102, 58, 0) 0%, rgba(20, 102, 58, 0.05) 100%)",
          pointerEvents: "none"
        }} />
      </div>

      {/* Right Content Section */}
      <div style={{ flex: 1, padding: "3rem 2.5rem", overflow: "auto", display: "flex", flexDirection: "column", justifyContent: "flex-start", background: "#fff", position: "relative", zIndex: 2 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: "1.5rem" }}>
          {[
            { n: "27,041", label: "Total Customers", sub: "Across both simulations" },
            { n: "5", label: "Dynamic Segments", sub: "Adaptive CDFCM clusters" },
          ].map((c, i) => (
            <div key={i} style={{ ...s.card, textAlign: "center", padding: "1.5rem" }}>
              <p style={{ fontSize: 32, fontWeight: 700, color: T.blue700, margin: "0 0 8px" }}>{c.n}</p>
              <p style={{ fontSize: 14, fontWeight: 600, color: T.blue900, margin: "0 0 4px" }}>{c.label}</p>
              <p style={{ fontSize: 12, color: T.textMuted, margin: 0 }}>{c.sub}</p>
            </div>
          ))}
        </div>

        <div style={{ ...s.card, textAlign: "center", marginBottom: "1.5rem", padding: "1.5rem" }}>
          <p style={{ fontSize: 28, fontWeight: 700, color: T.blue700, margin: "0 0 8px" }}>Cascade RFM</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: T.blue900, margin: "0 0 6px" }}>Core Algorithm</p>
          <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>Recency · Frequency · Monetary</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
          {[
            {
              tag: "Simulation A", tagColor: T.blue700, title: "Cosmetic Retailer South Africa",
              desc: "Analysis of Cosmetic Retailer retail transaction records from August–October 2023 across South African stores. 22,702 unique customers segmented using Cascade RFM + MDFCM.", items: ["22,702 unique customers", "4-month transaction window", "South African retail context"]
            },
            {
              tag: "Simulation B", tagColor: T.blue700, title: "UK Online Retail (UCI)",
              desc: "UK-based non-store online retail dataset spanning Dec 2010–Dec 2011. 4,339 B2B customers segmented with firmographic enrichment.", items: ["4,339 B2B customers", "13-month transaction window", "541,909 individual transactions"]
            },
          ].map((c, i) => (
            <div key={i} style={{ ...s.card, cursor: "pointer", padding: "1.5rem", textAlign: "center" }} onClick={() => setPage(i === 0 ? "simA" : "simB")}>
              <span style={s.tag(c.tagColor)}>{c.tag}</span>
              <h3 style={{ ...s.h3, marginTop: 12, fontSize: 20, fontWeight: 700 }}>{c.title}</h3>
              <p style={{ ...s.p, fontSize: 15, lineHeight: 1.8 }}>{c.desc}</p>
              <ul style={{ margin: "1rem 0 0", padding: "0", textAlign: "center", listStyle: "none" }}>
                {c.items.map((item, j) => (
                  <li key={j} style={{ fontSize: 14, color: T.textMuted, marginBottom: 6 }}>• {item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const ModelPage = () => (
  <div style={{ maxWidth: "100%", margin: 0, padding: 0 }}>
    <div style={{ backgroundImage: `url(${ModelShowcase})`, backgroundSize: "cover", backgroundPosition: "center", minHeight: "420px", display: "flex", alignItems: "flex-end", borderBottom: `1px solid ${T.border}`, boxShadow: "0 12px 32px rgba(8, 24, 16, 0.12)" }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.2) 100%)", pointerEvents: "none" }} />
    </div>

    <div style={{ maxWidth: 780, margin: "0 auto", padding: "3rem 2rem" }}>
      <p style={s.sectionTitle}>The Model</p>
      <h2 style={{ ...s.h2, marginBottom: 6 }}>Cascade RFM with Dynamic Modified Fuzzy C-Means</h2>
      <p style={{ ...s.p, marginBottom: "2rem", fontSize: 14 }}>
        A novel segmentation framework that combines Cascaded RFM decomposition with dynamic cluster adaptation, enabling customer segments to evolve in response to changing purchase behaviour over time.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: "1.5rem" }}>
      {[
        { title: "Phase 1: Cascaded RFM", color: T.blue700, steps: ["Compute base Recency, Frequency, Monetary", "Decompose into structural pairs: RF, RM, FM", "Isolate Recency-dominant segments", "Score customers per time cycle"] },
        { title: "Phase 2: Initial K-Means", color: T.blue500700, steps: ["Standardise RFM features (Z-score)", "Run K-Means to establish baseline clusters", "Initialise centroids for MDFCM", "Compute Silhouette Score for validation"] },
        { title: "Phase 3: MDFCM / CDFCM", color: T.gold500, steps: ["Process new data batches over time cycles", "Update cluster memberships using fuzzy logic", "Create new clusters for anomalous behaviour", "Merge or delete low-weight clusters"] },
        { title: "Phase 4: Validation", color: T.blue500, steps: ["Silhouette Score - cluster separation quality", "Xie-Beni Index - compactness & validity", "Migration tracking across time cycles", "Segment stability analysis"] },
      ].map((ph, i) => (
        <div key={i} style={{ ...s.card }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: ph.color }} />
            <h3 style={{ ...s.h3, margin: 0, color: ph.color }}>{ph.title}</h3>
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 14px" }}>
            {ph.steps.map((step, j) => (
              <li key={j} style={{ fontSize: 13, color: T.textMuted, marginBottom: 6, lineHeight: 1.6 }}>{step}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>

    <div style={{ ...s.card }}>
      <h3 style={s.h3}>Model Architecture - Time-Dynamic Adaptation</h3>
      <div style={{ display: "flex", gap: 12, alignItems: "stretch", marginTop: 4 }}>
        {["Time Cycle 0\n(Baseline)", "Time Cycle 1\n(Updated)", "Time Cycle 2\n(Evolved)"].map((tc, i) => (
          <div key={i} style={{ flex: 1, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px", textAlign: "center" }}>
            <p style={{ fontSize: 14, color: T.blue700, margin: "0 0 8px", whiteSpace: "pre-line", fontWeight: 700 }}>{tc}</p>
            <p style={{ fontSize: 13, color: T.textMuted, margin: 0, lineHeight: 1.6 }}>
              {i === 0 ? "K-Means baseline\ncentroid init" : i === 1 ? "New data batch\nfuzzy update" : "Cluster birth/death\nadaptation"}
            </p>
          </div>
        ))}
      </div>
    </div>
    </div>
  </div>
);

// ─── SIMULATION PAGES ───────────────────────────────────────────────────────

const Overview = ({ data, isSB }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: "1.5rem" }}>
    {/* Top Section: KPIs and Image */}
    <div style={{ display: "flex", alignItems: "stretch", gap: 16, position: "relative", background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 8px 24px rgba(8, 24, 16, 0.12)" }}>
      {/* Left Content Section */}
      <div style={{ flex: 0.6, padding: "2rem", display: "flex", flexDirection: "column", justifyContent: "center", background: "linear-gradient(135deg, #ffffff 0%, #f8fdfb 100%)" }}>
        <p style={{ ...s.sectionTitle, marginBottom: "1.5rem" }}>Overview</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
          <KpiCard label="Total Customers" value={data.totalCustomers.toLocaleString()} />
          <KpiCard label="Segments" value={data.segments} accent={T.green500} />
          <KpiCard label="Avg Spend" value={data.avgSpend} accent={T.gold500} />
          <KpiCard label="Churn Risk" value={data.churnRisk} accent={T.danger} />
        </div>
      </div>

      {/* Right Image Section with Gradient Overlay */}
      <div style={{ 
        flex: 1.4, 
        position: "relative",
        backgroundImage: `url(${HeroImg})`, 
        backgroundSize: "cover", 
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        minHeight: "380px",
        overflow: "hidden"
      }}>
        {/* Left Fade Overlay - soft fade from left */}
        <div style={{ 
          position: "absolute", 
          left: 0,
          top: 0,
          bottom: 0,
          width: "120px",
          background: "linear-gradient(to right, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0) 100%)",
          pointerEvents: "none"
        }} />
        
        {/* Subtle Enhancement Overlay */}
        <div style={{ 
          position: "absolute", 
          inset: 0, 
          background: "linear-gradient(135deg, rgba(31, 138, 75, 0) 0%, rgba(31, 138, 75, 0.08) 100%)",
          pointerEvents: "none"
        }} />
      </div>
    </div>

    {/* Charts Section */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Revenue Chart */}
      <div style={{ ...s.card, borderTop: `4px solid ${T.blue700}`, boxShadow: "0 4px 12px rgba(8, 24, 16, 0.08)" }}>
        <p style={{ ...s.sectionTitle, marginBottom: 12 }}>Revenue Over Time ({isSB ? "£" : "R"})</p>
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={data.monthly} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={T.blue700} stopOpacity={0.3} />
                <stop offset="95%" stopColor={T.blue700} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: T.textDim }} />
            <YAxis tickFormatter={v => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${Math.round(v / 1000)}K`} tick={{ fontSize: 10, fill: T.textDim }} width={42} />
            <Tooltip content={<ChartTip prefix={isSB ? "£" : "R"} />} />
            <Area type="monotone" dataKey="revenue" stroke={T.blue700} fill="url(#rev)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Donut Chart */}
      <div style={{ ...s.card, borderTop: `4px solid ${T.green500}`, boxShadow: "0 4px 12px rgba(8, 24, 16, 0.08)" }}>
        <p style={{ ...s.sectionTitle, marginBottom: 10 }}>Customer Distribution by Segment</p>
        <SegmentDonut data={data.distribution} />
      </div>
    </div>

    {/* Key Insights Section */}
    <div style={{ ...s.card, borderTop: `4px solid ${T.gold500}`, boxShadow: "0 4px 12px rgba(8, 24, 16, 0.08)" }}>
      <p style={{ ...s.sectionTitle, marginBottom: 14 }}>Key Insights</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        {[
          { label: "Highest Revenue", value: isSB ? "Mid-tier Active" : "Standard Customers", icon: "▲", color: T.blue700 },
          { label: "Highest Churn Risk", value: isSB ? "Dormant Segment" : "At-Risk Segment", icon: "!", color: T.danger },
          { label: "Most Frequent Buyers", value: isSB ? "High Value Active" : "High Value Loyal", icon: "★", color: T.gold500 },
        ].map((insight, i) => (
          <div key={i} style={{ background: "linear-gradient(135deg, " + insight.color + "08 0%, " + insight.color + "04 100%)", borderRadius: 12, padding: "14px 16px", borderLeft: `4px solid ${insight.color}`, transition: "all 0.3s ease", boxShadow: "0 2px 8px rgba(8, 24, 16, 0.04)", cursor: "default" }}>
            <p style={{ fontSize: 11, color: T.textDim, margin: "0 0 4px", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 600 }}>{insight.label}</p>
            <p style={{ fontSize: 14, fontWeight: 700, color: insight.color, margin: 0 }}>{insight.value}</p>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const DataFeatures = ({ isSB }) => {
  const rows = isSB
    ? [{ id: "C-17850", country: "UK", income: "N/A", spend: 2315, freq: 4 }, { id: "C-14688", country: "FR", income: "N/A", spend: 19450, freq: 28 }, { id: "C-12346", country: "DE", income: "N/A", spend: 977, freq: 1 }]
    : [{ id: "1001", country: "CPT", income: "R8,200", spend: 187, freq: 17 }, { id: "1002", country: "JHB", income: "R4,500", spend: 121, freq: 5 }, { id: "1004", country: "DBN", income: "R11,000", spend: 241, freq: 12 }];

  return (
    <div>
      <p style={s.sectionTitle}>Data &amp; Features</p>
      <div style={{ ...s.card, marginBottom: 16 }}>
        <h3 style={s.h3}>{isSB ? "UK Online Retail Transactional Dataset (UCI)" : "Cosmetic Retailer Retail Transaction Dataset"}</h3>
        <p style={s.p}>
          {isSB
            ? "Transactional records for a UK-based non-store online retailer spanning 01/12/2010 – 09/12/2011. The company primarily sells unique all-occasion gifts to B2B wholesalers."
            : "Point-of-sale records from Cosmetic Retailer South Africa stores covering August–October 2023. Contains SKU-level purchase data linked to customer loyalty card IDs."}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 12 }}>
          {[
            { l: "Records", v: isSB ? "541,909" : "55,145" },
            { l: "Unique Customers", v: isSB ? "4,339" : "22,702" },
            { l: "Date Range", v: isSB ? "Dec'10 – Dec'11" : "Jul – Oct 2023" },
          ].map((s2, i) => (
            <div key={i} style={{ background: T.bg, borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
              <p style={{ fontSize: 11, color: T.textDim, margin: "0 0 2px" }}>{s2.l}</p>
              <p style={{ fontSize: 14, fontWeight: 600, color: T.blue700, margin: 0 }}>{s2.v}</p>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={s.card}>
          <p style={{ ...s.sectionTitle, marginBottom: 10 }}>Features Used</p>
          {[
            { f: "Recency", d: "Days since last transaction" },
            { f: "Frequency", d: "Number of unique transactions" },
            { f: "Monetary", d: "Total spend value" },
            { f: "RF Score", d: "Recency × Frequency composite" },
            { f: "RM Score", d: "Recency × Monetary composite" },
            { f: "FM Score", d: "Frequency × Monetary composite" },
          ].map((feat, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: i < 5 ? `1px solid ${T.border}` : "none" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.blue500 }}>{feat.f}</span>
              <span style={{ fontSize: 11, color: T.textMuted }}>{feat.d}</span>
            </div>
          ))}
        </div>

        <div style={s.card}>
          <p style={{ ...s.sectionTitle, marginBottom: 10 }}>Data Preview</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>{["CustomerID", isSB ? "Country" : "Location", "Spend", "Frequency"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "4px 6px", color: T.textDim, fontWeight: 600, borderBottom: `1px solid ${T.border}`, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: "5px 6px", color: T.text, fontVariantNumeric: "tabular-nums" }}>{r.id}</td>
                  <td style={{ padding: "5px 6px", color: T.textMuted }}>{r.country}</td>
                  <td style={{ padding: "5px 6px", color: T.blue500, fontVariantNumeric: "tabular-nums" }}>{isSB ? `£${r.spend.toLocaleString()}` : `R${r.spend}`}</td>
                  <td style={{ padding: "5px 6px", color: T.textMuted }}>{r.freq}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const Segmentation = ({ isSB }) => (
  <div>
    <p style={s.sectionTitle}>Segmentation</p>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
      <div style={{ ...s.card, borderTop: `3px solid ${T.textDim}` }}>
        <p style={{ ...s.h3, color: T.textMuted, marginBottom: 8 }}>Initial Model</p>
        <p style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 8 }}>K-Means Clustering</p>
        <p style={s.p}>Baseline static segmentation. Establishes initial cluster centroids for RFM space partitioning using standardised features.</p>
        <div style={{ ...s.tag(T.textDim), fontSize: 10 }}>Static • One-time</div>
      </div>
      <div style={{ ...s.card, borderTop: `3px solid ${T.blue700}` }}>
        <p style={{ ...s.h3, color: T.blue700, marginBottom: 8 }}>Dynamic Model</p>
        <p style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 8 }}>{isSB ? "CDFCM" : "MDFCM"} - Fuzzy C-Means</p>
        <p style={s.p}>Adaptive segmentation that evolves over time. New data batches trigger cluster updates, creations, and deletions.</p>
        <div style={{ ...s.tag(T.blue700), fontSize: 10 }}>Dynamic • Multi-cycle</div>
      </div>
    </div>

    <div style={{ ...s.card, marginBottom: 16 }}>
      <p style={{ ...s.sectionTitle, marginBottom: 10 }}>Objective</p>
      <p style={{ ...s.p, fontSize: 14 }}>Create adaptive customer segments that evolve over time - responding to new purchasing behaviour without requiring full model retraining.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginTop: 12 }}>
        {[
          "New data batches processed each time cycle",
          "Clusters updated using fuzzy membership functions",
          "New clusters created to handle emerging behaviour",
          "Existing clusters adjusted for behavioural drift",
        ].map((pt, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ color: T.blue700, fontSize: 14, lineHeight: 1, marginTop: 1 }}>→</span>
            <p style={{ ...s.p, margin: 0, fontSize: 12 }}>{pt}</p>
          </div>
        ))}
      </div>
    </div>

    <div style={{ ...s.card }}>
      <p style={{ ...s.sectionTitle, marginBottom: 10 }}>Evaluation Metrics</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { name: "Silhouette Score", desc: "Measures cluster separation and cohesion. Range: –1 to 1. Higher = better defined clusters.", color: T.blue700 },
          { name: "Xie-Beni Index", desc: "Fuzzy cluster validity metric. Measures compactness relative to separation. Lower = better.", color: T.blue700 },
        ].map((m, i) => (
          <div key={i} style={{ background: T.bg, borderRadius: 8, padding: "12px", borderLeft: `3px solid ${m.color}` }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: m.color, margin: "0 0 6px" }}>{m.name}</p>
            <p style={{ ...s.p, margin: 0, fontSize: 11 }}>{m.desc}</p>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const Segments = ({ data, isSB }) => {
  const [selected, setSelected] = useState(0);
  const seg = data.segments_detail[selected];

  return (
    <div>
      <p style={s.sectionTitle}>Segments</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {data.segments_detail.map((s2, i) => (
          <button key={i} style={s.btn(selected === i)} onClick={() => setSelected(i)}>
            Segment {s2.id}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={{ ...s.card, borderLeft: `3px solid ${data.distribution[selected]?.color || T.blue700}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <h3 style={{ ...s.h3, margin: 0 }}>{seg.label}</h3>
            <span style={s.tag(data.distribution[selected]?.color || T.blue700)}>Size: {seg.size}</span>
          </div>
          <p style={s.p}>{seg.desc}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
            {[["Recency", seg.recency], ["Frequency", seg.frequency], ["Monetary", seg.monetary]].map(([l, v]) => (
              <div key={l} style={{ background: T.bg, borderRadius: 6, padding: "6px 8px" }}>
                <p style={{ fontSize: 9, color: T.textDim, margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.08em" }}>{l}</p>
                <p style={{ fontSize: 11, color: T.text, margin: 0, fontWeight: 500 }}>{v}</p>
              </div>
            ))}
          </div>
        </div>

        <div style={s.card}>
          <p style={{ ...s.sectionTitle, marginBottom: 12 }}>Avg Spend by Segment ({isSB ? "£" : "R"})</p>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={data.avgSpendPerSeg.filter(d => d.spend < 50000)} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: T.textDim }} interval={0} angle={-15} textAnchor="end" height={45} />
              <YAxis tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}K` : v} tick={{ fontSize: 9, fill: T.textDim }} width={36} />
              <Tooltip content={<ChartTip prefix={isSB ? "£" : "R"} />} />
              <Bar dataKey="spend" radius={[3, 3, 0, 0]}>
                {data.avgSpendPerSeg.filter(d => d.spend < 50000).map((d, i) => (
                  <Cell key={i} fill={i === selected ? (T.blue700) : T.border} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ ...s.card }}>
        <p style={{ ...s.sectionTitle, marginBottom: 10 }}>Segment Evolution</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
          {["Time Cycle 0", "→", "Time Cycle 1", "→", "Time Cycle 2"].map((t, i) => (
            i % 2 === 0
              ? <div key={i} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 16px", fontSize: 12, color: T.textMuted }}>{t}</div>
              : <span key={i} style={{ color: T.blue900, fontSize: 16 }}>{t}</span>
          ))}
        </div>
        <p style={{ ...s.p, textAlign: "center", marginTop: 10, fontSize: 11 }}>Segment sizes and compositions shift as new transaction data is processed each cycle.</p>
      </div>
    </div>
  );
};

const Customers = ({ data, isSB }) => {
  const [selected, setSelected] = useState(null);
  return (
    <div>
      <p style={s.sectionTitle}>Customers</p>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={s.card}>
          <p style={{ ...s.sectionTitle, marginBottom: 10 }}>Customer Table</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                {["ID", isSB ? "Country" : "Age", "Segment", "Spend", "Recency", "Freq"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: T.textDim, borderBottom: `1px solid ${T.border}`, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.customers.map((c, i) => (
                <tr key={i} style={{ cursor: "pointer", background: selected === i ? T.blue100 : "transparent" }}
                  onClick={() => setSelected(selected === i ? null : i)}>
                  <td style={{ padding: "6px 8px", color: T.blue700, fontVariantNumeric: "tabular-nums" }}>{c.id}</td>
                  <td style={{ padding: "6px 8px", color: T.textMuted }}>{isSB ? c.country : c.age}</td>
                  <td style={{ padding: "6px 8px" }}><span style={{ ...s.tag(T.blue700), fontSize: 10 }}>{c.segment}</span></td>
                  <td style={{ padding: "6px 8px", color: T.text, fontVariantNumeric: "tabular-nums" }}>{c.spend}</td>
                  <td style={{ padding: "6px 8px", color: T.textMuted }}>{c.recency}</td>
                  <td style={{ padding: "6px 8px", color: T.textMuted }}>{c.freq}×</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 10, color: T.textDim, marginTop: 8, margin: "8px 0 0" }}>Showing sample records. Click a row to view profile.</p>
        </div>

        <div style={s.card}>
          <p style={{ ...s.sectionTitle, marginBottom: 10 }}>Customer Profile</p>
          {selected !== null ? (
            () => {
              const c = data.customers[selected];
              const seg = data.segments_detail.find(s2 => s2.label === c.segment);
              return (
                <div>
                  <div style={{ background: T.bg, borderRadius: 8, padding: "10px", marginBottom: 12, textAlign: "center" }}>
                    <p style={{ fontSize: 22, fontWeight: 700, color: T.blue700, margin: "0 0 2px" }}>{c.id}</p>
                    <span style={s.tag(T.blue700)}>{c.segment}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {[["Spend", c.spend], ["Recency", c.recency], ["Frequency", `${c.freq}× purchases`], [isSB ? "Country" : "Location", isSB ? c.country : c.location]].map(([l, v]) => (
                      <div key={l} style={{ display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${T.border}`, paddingBottom: 5 }}>
                        <span style={{ fontSize: 11, color: T.textDim }}>{l}</span>
                        <span style={{ fontSize: 11, color: T.text, fontWeight: 500 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  {seg && <p style={{ ...s.p, marginTop: 12, fontSize: 11, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>{seg.desc}</p>}
                </div>
              );
            })()
            : <p style={{ ...s.p, fontSize: 12, textAlign: "center", marginTop: 20 }}>Select a customer row to view their profile and segment details.</p>
          }
        </div>
      </div>
    </div>
  );
};

const InsightsActions = ({ isSB }) => {
  const insights = isSB
    ? [
        { seg: "VIP Wholesalers", insight: "Extremely high spend with near-daily frequency", actions: ["Assign dedicated account manager", "Offer exclusive volume discounts", "Priority shipping & fulfilment"], priority: "critical" },
        { seg: "Dormant", insight: "Previously active but now disengaged - high churn risk", actions: ["Re-engagement email campaign", "Time-limited discount voucher", "Survey on experience barriers"], priority: "high" },
        { seg: "Mid-tier Active", insight: "Core revenue base - consistent moderate buyers", actions: ["Cross-sell complementary products", "Loyalty points programme", "Personalised product bundles"], priority: "medium" },
      ]
    : [
        { seg: "High Value Loyal", insight: "Frequent purchases and high spending with strong loyalty", actions: ["Offer loyalty rewards programme", "Personalised product recommendations", "Early access to new ranges"], priority: "high" },
        { seg: "At-Risk / Dormant", insight: "Previously active, now showing very low purchase frequency", actions: ["In-store shopping voucher", "Re-engagement email with targeted offer", "Investigate drop-off reasons"], priority: "critical" },
        { seg: "Standard Customers", insight: "Core mid-tier - potential to upsell with right targeting", actions: ["Bundle discount promotions", "Category-specific recommendations", "Frequency-reward incentives"], priority: "medium" },
      ];

  const pColors = { critical: T.danger, high: T.gold500, medium: T.blue700 };

  return (
    <div>
      <p style={s.sectionTitle}>Insights &amp; Actions</p>
      <div style={{ ...s.card, marginBottom: 16 }}>
        <p style={{ ...s.h3 }}>Summary</p>
        <p style={s.p}>Customer segmentation reveals distinct behavioural patterns across segments, enabling targeted marketing strategies and improved customer retention.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <span style={s.tag(T.danger)}>Critical Priority: Re-engage at-risk</span>
          <span style={s.tag(T.gold500)}>High Priority: Retain high-value</span>
          <span style={s.tag(T.blue700)}>Medium: Grow mid-tier</span>
        </div>
      </div>

      {insights.map((ins, i) => (
        <div key={i} style={{ ...s.card, marginBottom: 12, borderLeft: `3px solid ${pColors[ins.priority]}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ ...s.h3, margin: 0 }}>{ins.seg}</h3>
            <span style={s.tag(pColors[ins.priority])}>{ins.priority} priority</span>
          </div>
          <p style={{ ...s.p, marginBottom: 10, fontStyle: "italic" }}>Insight: {ins.insight}</p>
          <p style={{ fontSize: 11, color: T.textDim, margin: "0 0 6px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Recommended Actions</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {ins.actions.map((a, j) => (
              <div key={j} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: pColors[ins.priority], fontSize: 12 }}>→</span>
                <p style={{ ...s.p, margin: 0, fontSize: 12 }}>{a}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const ModelEvaluation = ({ data, isSB }) => (
  <div>
    <p style={s.sectionTitle}>Model Evaluation</p>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
      <KpiCard label="Silhouette Score" value={data.silhouette} accent={T.blue700} />
      <KpiCard label="Xie-Beni Index" value={data.xbIndex} accent={T.blue700} />
    </div>

    <div style={{ ...s.card, marginBottom: 16 }}>
      <p style={{ ...s.sectionTitle, marginBottom: 12 }}>Revenue &amp; Frequency Over Time</p>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data.monthly} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revEval" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={T.blue700} stopOpacity={0.4} />
              <stop offset="95%" stopColor={T.blue700} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: T.textDim }} />
          <YAxis tickFormatter={v => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${Math.round(v / 1000)}K`} tick={{ fontSize: 10, fill: T.textDim }} width={42} />
          <Tooltip content={<ChartTip prefix={isSB ? "£" : "R"} />} />
          <Area type="monotone" dataKey="revenue" stroke={T.blue700} fill="url(#revEval)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>

    <div style={{ ...s.card, marginBottom: 16 }}>
      <p style={{ ...s.sectionTitle, marginBottom: 10 }}>Validation Summary</p>
      <p style={{ ...s.p, fontSize: 14 }}>
        Cluster validation shows clear separation between customer groups. The model effectively identifies meaningful customer segments and adapts to behavioural changes over time.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ ...s.tag(T.blue700), fontSize: 11 }}>✓ Silhouette Score: {data.silhouette} - Good separation</span>
        <span style={{ ...s.tag(T.blue700), fontSize: 11 }}>✓ XB Index: {data.xbIndex} - Valid clusters</span>
      </div>
    </div>

    <div style={{ ...s.card }}>
      <p style={{ ...s.sectionTitle, marginBottom: 10 }}>Limitations</p>
      {["Model performance depends on input feature quality", "Synthetic customer attributes may introduce bias", "Dynamic cluster updates may temporarily reduce stability", "Fuzzy membership requires careful threshold tuning"].map((lim, i) => (
        <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: i < 3 ? `1px solid ${T.border}` : "none" }}>
          <span style={{ color: T.gold500, fontSize: 12 }}>⚠</span>
          <p style={{ ...s.p, margin: 0, fontSize: 12 }}>{lim}</p>
        </div>
      ))}
    </div>
  </div>
);

// ─── SIMULATION SHELL ────────────────────────────────────────────────────────

const SimShell = ({ sim, data, isSB, isLoading, error, onRetry, isUnavailable }) => {
  if (isUnavailable) {
    return (
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <DataUnavailableMessage />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <ErrorMessage error={error} onRetry={onRetry} />
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <LoadingSpinner />
      </div>
    );
  }

  const [subPage, setSubPage] = useState("overview");
  const links = ["overview", "data", "segmentation", "segments", "customers", "insights", "evaluation"];
  const labels = { overview: "Overview", data: "Data & Features", segmentation: "Segmentation", segments: "Segments", customers: "Customers", insights: "Insights & Actions", evaluation: "Model Evaluation" };

  const renderContent = () => {
    switch (subPage) {
      case "overview": return <Overview data={data} isSB={isSB} />;
      case "data": return <DataFeatures isSB={isSB} />;
      case "segmentation": return <Segmentation isSB={isSB} />;
      case "segments": return <Segments data={data} isSB={isSB} />;
      case "customers": return <Customers data={data} isSB={isSB} />;
      case "insights": return <InsightsActions isSB={isSB} />;
      case "evaluation": return <ModelEvaluation data={data} isSB={isSB} />;
      default: return null;
    }
  };

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      <div style={{ width: 200, background: T.bgSidebar, borderRight: `1px solid ${T.border}`, padding: "1.25rem 0", flexShrink: 0, boxShadow: "inset -1px 0 0 rgba(0,0,0,0.03)" }}>
        <p style={{ fontSize: 10, color: T.blue900, letterSpacing: "0.12em", textTransform: "uppercase", padding: "0 18px", marginBottom: 12 }}>{sim}</p>
        {links.map(link => (
          <button key={link} style={s.sideLink(subPage === link)} onClick={() => setSubPage(link)}>
            {labels[link]}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem 2rem" }}>
        {renderContent()}
      </div>
    </div>
  );
};

// ─── LOADING & ERROR STATES ────────────────────────────────────────────────

const LoadingSpinner = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "400px", flexDirection: "column" }}>
    <div style={{ fontSize: 32, marginBottom: 16, animation: "spin 1s linear infinite" }}>⟳</div>
    <p style={{ color: T.textMuted, fontSize: 14 }}>Loading dashboard data...</p>
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
  </div>
);

const ErrorMessage = ({ error, onRetry }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "400px", flexDirection: "column", padding: "2rem" }}>
    <div style={{ fontSize: 32, marginBottom: 16, color: T.danger }}>⚠</div>
    <p style={{ color: T.danger, fontSize: 14, marginBottom: 8, textAlign: "center" }}>Failed to load dashboard data</p>
    <p style={{ color: T.textMuted, fontSize: 12, marginBottom: 16, textAlign: "center", maxWidth: 400 }}>{error}</p>
    {onRetry && (
      <button style={{ ...s.btn(true), padding: "8px 16px" }} onClick={onRetry}>
        Retry
      </button>
    )}
  </div>
);

const DataUnavailableMessage = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "400px", flexDirection: "column", padding: "2rem" }}>
    <div style={{ fontSize: 32, marginBottom: 16, color: T.gold500 }}>ℹ</div>
    <p style={{ color: T.textMuted, fontSize: 14, marginBottom: 8, textAlign: "center" }}>Simulation A Data Not Available</p>
    <p style={{ color: T.textMuted, fontSize: 12, textAlign: "center", maxWidth: 400 }}>
      The research data for Simulation A is not stored in the database. 
      This page contains static research results from the original analysis.
    </p>
  </div>
);

// ─── ROOT ────────────────────────────────────────────────────────────────────

export default function CSRS() {
  const [page, setPage] = useState("home");
  
  // SIM_B live data state
  const [simBData, setSimBData] = useState(null);
  const [simBLoading, setSimBLoading] = useState(false);
  const [simBError, setSimBError] = useState(null);

  // Fetch SIM_B data when page changes to simB
  useEffect(() => {
    if (page !== "simB") return;

    const loadSimBData = async () => {
      setSimBLoading(true);
      setSimBError(null);

      try {
        // Fetch all necessary data in parallel
        const [overviewResp, segmentsResp, customersResp, modelEvalResp] = await Promise.all([
          fetchOverviewData(),
          fetchSegmentsData(),
          fetchCustomersData(1, 5),
          fetchModelEvaluation(),
        ]);

        // Transform data using mappers
        const overview = mapOverviewData(overviewResp, true); // isSB = true
        const segments = mapSegmentsData(segmentsResp, true);
        const customers = mapCustomersData(customersResp, true);

        // Combine into single data object matching UI structure
        const combinedData = {
          ...overview,
          ...segments,
          ...customers,
        };

        setSimBData(combinedData);
      } catch (err) {
        console.error("Error loading SIM_B data:", err);
        setSimBError(err.message || "Failed to load dashboard data. Please check your connection.");
      } finally {
        setSimBLoading(false);
      }
    };

    loadSimBData();
  }, [page]);

  const navItems = [
    { id: "home", label: "Home" },
    { id: "model", label: "Model" },
    { id: "simA", label: "Simulation A" },
    { id: "simB", label: "Simulation B" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: T.bg, fontFamily: "'DM Sans', 'IBM Plex Sans', system-ui, sans-serif", color: T.text, fontSize: 13 }}>
      {/* NAV */}
      <nav style={{ background: T.blueNav, borderBottom: `1px solid ${T.border}`, padding: "0 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 104, flexShrink: 0, boxShadow: "0 1px 0 rgba(0,0,0,0.03)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center", padding: "16px 28px 16px 112px", borderRadius: 999, background: T.blueNav, border: `1px solid ${T.border}` }}>
            <img src={IconOnly} alt="CSRS icon" style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", width: 81, height: 81, mixBlendMode: "multiply" }} />
            <span style={{ fontSize: 24, fontWeight: 700, color: T.blue900, letterSpacing: "0.08em" }}>CSRS</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {navItems.map(item => (
            <button key={item.id} style={s.navLink(page === item.id)} onClick={() => setPage(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ fontSize: 11, color: T.textDim, padding: "4px 10px" }}>Research</span>
          <span style={{ fontSize: 11, color: T.textDim, padding: "4px 10px" }}>Documentation</span>
          <span style={{ fontSize: 11, color: T.textDim, padding: "4px 10px" }}>Accessibility</span>
        </div>
      </nav>

      {/* CONTENT */}
      <div style={{ flex: 1, overflowY: page === "simA" || page === "simB" ? "hidden" : "auto", display: "flex", flexDirection: "column" }}>
        {page === "home" && <HomePage setPage={setPage} />}
        {page === "model" && (
          <div style={{ overflowY: "auto", flex: 1 }}>
            <ModelPage />
          </div>
        )}
        {page === "simA" && (
          <SimShell sim="Simulation A" data={SIM_A} isSB={false} isUnavailable={true} />
        )}
        {page === "simB" && (
          <SimShell 
            sim="Simulation B" 
            data={simBData} 
            isSB={true} 
            isLoading={simBLoading}
            error={simBError}
            onRetry={() => setPage("simB")}
          />
        )}
      </div>
    </div>
  );
}
