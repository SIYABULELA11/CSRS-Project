import { DataRepository } from "../repositories/dataRepository";
import { SchemaRepository } from "../repositories/schemaRepository";

type SortOrder = "asc" | "desc";

interface TableQuery {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: SortOrder;
  filters: Record<string, string>;
}

const repo = new DataRepository();
const schemaRepo = new SchemaRepository();

const toNumber = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const mean = (arr: number[]): number => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

const variance = (arr: number[]): number => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
};

const stdDev = (arr: number[]): number => Math.sqrt(variance(arr));

const pearson = (x: number[], y: number[]): number => {
  if (x.length !== y.length || x.length < 2) return 0;

  const mx = mean(x);
  const my = mean(y);

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  if (!den) return 0;
  return num / den;
};

export class AnalyticsService {
  getSchema(): Array<{ table: string; columns: string[]; rowCount: number }> {
    const schemas = schemaRepo.getAllSchemas();

    return schemas.map((s) => ({
      ...s,
      rowCount: repo.countRows(s.table),
    }));
  }

  getFilterOptions(): Record<string, unknown> {
    return {
      cycles: repo.runMany("SELECT DISTINCT CycleID as value FROM Data_Preprocessing_Results ORDER BY CycleID"),
      segments: repo.runMany("SELECT DISTINCT Segment_Name as value FROM Dynamic_Segmentation_Results ORDER BY Segment_Name"),
      countries: repo.runMany("SELECT DISTINCT Country as value FROM Customer WHERE Country IS NOT NULL ORDER BY Country"),
      customers: repo.runMany("SELECT DISTINCT CustomerID as value FROM Customer ORDER BY CustomerID LIMIT 2000"),
    };
  }

  parseTableQuery(query: Record<string, unknown>, columns: string[]): TableQuery {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize ?? 50)));
    const sortBy = String(query.sortBy ?? columns[0] ?? "");
    const sortOrder = String(query.sortOrder ?? "asc").toLowerCase() === "desc" ? "desc" : "asc";

    const filters: Record<string, string> = {};
    if (typeof query.filters === "string" && query.filters.trim()) {
      try {
        const parsed = JSON.parse(query.filters) as Record<string, string>;
        Object.entries(parsed).forEach(([key, value]) => {
          if (value != null && String(value).trim()) {
            filters[key] = String(value).trim();
          }
        });
      } catch {
        // Ignore malformed filters and continue with no filters.
      }
    }

    return { page, pageSize, sortBy, sortOrder, filters };
  }

  getTableRows(table: string, queryRaw: Record<string, unknown>): Record<string, unknown> {
    const columns = schemaRepo.getTableColumns(table);
    if (!columns.length) {
      throw new Error(`Table not found: ${table}`);
    }

    const query = this.parseTableQuery(queryRaw, columns);

    const where: string[] = [];
    const params: Record<string, unknown> = {};
    Object.entries(query.filters).forEach(([key, value], idx) => {
      if (!columns.includes(key)) return;
      const paramKey = `f${idx}`;
      where.push(`${key} LIKE @${paramKey}`);
      params[paramKey] = `%${value}%`;
    });

    const safeSortBy = columns.includes(query.sortBy) ? query.sortBy : columns[0];
    const total = repo.countRows(table, { where, params });
    const data = repo.queryRows(table, {
      where,
      params,
      orderBy: `${safeSortBy} ${query.sortOrder.toUpperCase()}`,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });

    return {
      table,
      columns,
      data,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize) || 1,
      },
    };
  }

  getCycleOverview(cycleId: string): Record<string, unknown> {
    const kpis = repo.runAggregate(
      `
      SELECT
        COUNT(DISTINCT d.CustomerID) as customers,
        SUM(d.Monetary) as revenue,
        AVG(d.Recency) as avgRecency,
        AVG(d.Frequency) as avgFrequency,
        AVG(d.Monetary) as avgMonetary,
        AVG(s.Membership_Confidence) as avgMembership
      FROM Data_Preprocessing_Results d
      LEFT JOIN Dynamic_Segmentation_Results s
        ON s.CustomerID = d.CustomerID AND s.CycleID = d.CycleID
      WHERE d.CycleID = @cycleId
      `,
      { cycleId },
    );

    const segments = cycleId === "Cycle_0"
      ? repo.runMany(
          `
          SELECT
            COALESCE(Baseline_Segment_Name, 'Baseline Cluster') as segment,
            COUNT(*) as customerCount
          FROM Time_Cycle_0_Segmentation
          GROUP BY COALESCE(Baseline_Segment_Name, 'Baseline Cluster')
          ORDER BY customerCount DESC
          `,
        )
      : repo.runMany(
          `
          SELECT Segment_Name as segment, COUNT(*) as customerCount
          FROM Dynamic_Segmentation_Results
          WHERE CycleID = @cycleId
          GROUP BY Segment_Name
          ORDER BY customerCount DESC
          `,
          { cycleId },
        );

    return {
      cycleId,
      kpis,
      segments,
    };
  }

  getFeatureSummary(cycleId?: string): Record<string, unknown> {
    const where = cycleId ? "WHERE CycleID = @cycleId" : "";
    const params = cycleId ? { cycleId } : {};

    const rows = repo.runMany(
      `SELECT Recency, Frequency, Monetary, RF_Score, RM_Score, FM_Score FROM Data_Preprocessing_Results ${where}`,
      params,
    );

    const fields = ["Recency", "Frequency", "Monetary", "RF_Score", "RM_Score", "FM_Score"] as const;

    const summary = fields.map((field) => {
      const values = rows.map((r) => toNumber(r[field])).filter((v) => Number.isFinite(v));
      const sorted = [...values].sort((a, b) => a - b);

      const q = (p: number): number => {
        if (!sorted.length) return 0;
        const idx = Math.floor((sorted.length - 1) * p);
        return sorted[idx];
      };

      return {
        field,
        count: values.length,
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        mean: mean(values),
        stdDev: stdDev(values),
        median: q(0.5),
        q1: q(0.25),
        q3: q(0.75),
      };
    });

    const missing = repo.runAggregate(
      `
      SELECT
        SUM(CASE WHEN Recency IS NULL THEN 1 ELSE 0 END) as Recency,
        SUM(CASE WHEN Frequency IS NULL THEN 1 ELSE 0 END) as Frequency,
        SUM(CASE WHEN Monetary IS NULL THEN 1 ELSE 0 END) as Monetary,
        SUM(CASE WHEN RF_Score IS NULL THEN 1 ELSE 0 END) as RF_Score,
        SUM(CASE WHEN RM_Score IS NULL THEN 1 ELSE 0 END) as RM_Score,
        SUM(CASE WHEN FM_Score IS NULL THEN 1 ELSE 0 END) as FM_Score
      FROM Data_Preprocessing_Results ${where}
      `,
      params,
    );

    return {
      cycleId: cycleId ?? null,
      summary,
      missing,
      sampleSize: rows.length,
    };
  }

  getFeatureCorrelation(cycleId?: string): Record<string, unknown> {
    const where = cycleId ? "WHERE CycleID = @cycleId" : "";
    const params = cycleId ? { cycleId } : {};
    const rows = repo.runMany(
      `SELECT Recency, Frequency, Monetary, RF_Score, RM_Score, FM_Score FROM Data_Preprocessing_Results ${where}`,
      params,
    );

    const fields = ["Recency", "Frequency", "Monetary", "RF_Score", "RM_Score", "FM_Score"] as const;
    const vectors = fields.reduce<Record<string, number[]>>((acc, field) => {
      acc[field] = rows.map((r) => toNumber(r[field]));
      return acc;
    }, {});

    const matrix = fields.map((f1) =>
      fields.map((f2) => Number(pearson(vectors[f1], vectors[f2]).toFixed(4))),
    );

    return {
      cycleId: cycleId ?? null,
      fields,
      matrix,
      sampleSize: rows.length,
    };
  }

  getModelEvaluationDetailed(includePoints = false): Record<string, unknown> {
    const rows = repo.runMany(
      `
      SELECT
        PC1,
        PC2,
        PC3,
        KMeans_Cluster_Number as label,
        Elbow_Inertia_Value as elbow,
        Silhouette_Score as silhouette
      FROM Time_Cycle_0_Segmentation
      WHERE PC1 IS NOT NULL AND PC2 IS NOT NULL AND PC3 IS NOT NULL
      `,
    );

    const points = rows.map((r) => ({
      x: toNumber(r.PC1),
      y: toNumber(r.PC2),
      z: toNumber(r.PC3),
      label: toNumber(r.label),
    }));

    const byCluster = new Map<number, Array<{ x: number; y: number; z: number }>>();
    points.forEach((p) => {
      if (!byCluster.has(p.label)) byCluster.set(p.label, []);
      byCluster.get(p.label)?.push({ x: p.x, y: p.y, z: p.z });
    });

    const clusters = [...byCluster.entries()].map(([label, pts]) => {
      const cx = mean(pts.map((p) => p.x));
      const cy = mean(pts.map((p) => p.y));
      const cz = mean(pts.map((p) => p.z));
      return { label, pts, centroid: { x: cx, y: cy, z: cz } };
    });

    const distance = (
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number },
    ): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

    // Calinski-Harabasz
    const overallCentroid = {
      x: mean(points.map((p) => p.x)),
      y: mean(points.map((p) => p.y)),
      z: mean(points.map((p) => p.z)),
    };

    let between = 0;
    let within = 0;

    clusters.forEach((c) => {
      between += c.pts.length * distance(c.centroid, overallCentroid) ** 2;
      within += c.pts.reduce((sum, p) => sum + distance(p, c.centroid) ** 2, 0);
    });

    const n = points.length;
    const k = clusters.length;
    const calinskiHarabasz = k > 1 && n > k ? (between / (k - 1)) / (within / (n - k)) : 0;

    // Davies-Bouldin
    const s = clusters.map((c) =>
      c.pts.length ? c.pts.reduce((sum, p) => sum + distance(p, c.centroid), 0) / c.pts.length : 0,
    );
    const dbTerms = clusters.map((ci, i) => {
      let maxR = 0;
      clusters.forEach((cj, j) => {
        if (i === j) return;
        const d = distance(ci.centroid, cj.centroid);
        if (!d) return;
        const r = (s[i] + s[j]) / d;
        if (r > maxR) maxR = r;
      });
      return maxR;
    });
    const daviesBouldin = dbTerms.length ? mean(dbTerms) : 0;

    // Xie-Beni (crisp approximation)
    const minCentroidDistSq = (() => {
      let minVal = Number.POSITIVE_INFINITY;
      clusters.forEach((ci, i) => {
        clusters.forEach((cj, j) => {
          if (i >= j) return;
          const d2 = distance(ci.centroid, cj.centroid) ** 2;
          if (d2 > 0 && d2 < minVal) minVal = d2;
        });
      });
      return Number.isFinite(minVal) ? minVal : 0;
    })();

    const compactness = clusters.reduce(
      (sum, c) => sum + c.pts.reduce((acc, p) => acc + distance(p, c.centroid) ** 2, 0),
      0,
    );
    const xbIndex = n > 0 && minCentroidDistSq > 0 ? compactness / (n * minCentroidDistSq) : 0;

    const silhouetteAvg = mean(rows.map((r) => toNumber(r.silhouette)).filter((v) => v !== 0));
    const elbow = mean(rows.map((r) => toNumber(r.elbow)).filter((v) => v !== 0));

    const clusterStats = clusters
      .map((c) => ({
        cluster: c.label,
        size: c.pts.length,
        centroid: c.centroid,
      }))
      .sort((a, b) => b.size - a.size);

    return {
      sampleSize: n,
      clusterCount: k,
      silhouette: Number(silhouetteAvg.toFixed(4)),
      daviesBouldin: Number(daviesBouldin.toFixed(4)),
      calinskiHarabasz: Number(calinskiHarabasz.toFixed(4)),
      xbIndex: Number(xbIndex.toFixed(6)),
      wcss: Number(within.toFixed(4)),
      elbowInertia: Number(elbow.toFixed(4)),
      clusterStats,
      pcaPoints: includePoints ? points : undefined,
    };
  }
}
