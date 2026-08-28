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

const repository = new DataRepository();
const schemaRepository = new SchemaRepository();

const toNumber = (value: unknown): number => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const mean = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0) / (values.length || 1);

const standardDeviation = (values: number[]): number => {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce(
    (total, value) => total + (value - average) ** 2,
    0,
  ) / (values.length - 1);
  return Math.sqrt(variance);
};

const pearson = (left: number[], right: number[]): number => {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftDenominator = 0;
  let rightDenominator = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftDenominator += leftDelta ** 2;
    rightDenominator += rightDelta ** 2;
  }

  const denominator = Math.sqrt(leftDenominator * rightDenominator);
  return denominator ? numerator / denominator : 0;
};

const squaredDistance = (left: number[], right: number[]): number =>
  left.reduce((total, value, index) => total + (value - right[index]) ** 2, 0);

const segmentNameForCluster = (cluster: number): string => [
  "Champions",
  "Core Loyalists",
  "Mid-Tier Occasionals",
  "Hibernating / Lost",
][cluster] ?? `Cluster ${cluster}`;

const getBaselineEvaluation = (): Record<string, unknown> => {
  const points = repository.runMany(`
    SELECT
      KMeans_Cluster_Number AS cluster,
      PC1,
      PC2,
      PC3,
      Silhouette_Score AS silhouette,
      Elbow_Inertia_Value AS inertia,
      Initial_Centroids AS centroids
    FROM Time_Cycle_0_Segmentation
  `);
  if (!points.length) return {};

  let centroids: number[][] = [];
  try {
    centroids = JSON.parse(String(points[0].centroids ?? "[]")) as number[][];
  } catch {
    centroids = [];
  }
  if (!centroids.length) return {};

  const vectors = points.map((row) => [toNumber(row.PC1), toNumber(row.PC2), toNumber(row.PC3)]);
  const labels = points.map((row) => toNumber(row.cluster));
  const sampleSize = vectors.length;
  const clusterCount = centroids.length;
  const overallCentroid = [0, 1, 2].map((dimension) =>
    mean(vectors.map((vector) => vector[dimension])),
  );
  const withinCluster = vectors.reduce(
    (total, vector, index) => total + squaredDistance(vector, centroids[labels[index]]),
    0,
  );
  const clusterSizes = centroids.map((_, cluster) =>
    labels.filter((label) => label === cluster).length,
  );
  const betweenCluster = centroids.reduce(
    (total, centroid, cluster) =>
      total + clusterSizes[cluster] * squaredDistance(centroid, overallCentroid),
    0,
  );
  const clusterScatter = centroids.map((centroid, cluster) => {
    const clusterVectors = vectors.filter((_, index) => labels[index] === cluster);
    return mean(clusterVectors.map((vector) => Math.sqrt(squaredDistance(vector, centroid))));
  });
  const daviesBouldin = mean(centroids.map((centroid, cluster) =>
    Math.max(...centroids
      .map((otherCentroid, otherCluster) => {
        if (cluster === otherCluster) return 0;
        const separation = Math.sqrt(squaredDistance(centroid, otherCentroid));
        return separation ? (clusterScatter[cluster] + clusterScatter[otherCluster]) / separation : 0;
      })),
  ));
  const centroidSeparations = centroids.flatMap((centroid, cluster) =>
    centroids.slice(cluster + 1).map((otherCentroid) => squaredDistance(centroid, otherCentroid)),
  );
  const minimumSeparation = Math.min(...centroidSeparations.filter((value) => value > 0));
  const calinskiHarabasz = clusterCount > 1 && sampleSize > clusterCount
    ? (betweenCluster / (clusterCount - 1)) / (withinCluster / (sampleSize - clusterCount))
    : 0;
  const xieBeni = minimumSeparation ? withinCluster / (sampleSize * minimumSeparation) : 0;

  return {
    CycleID: "Cycle_0",
    CustomersProcessed: sampleSize,
    ActiveCustomers: sampleSize,
    InactiveCustomers: 0,
    NewCustomers: sampleSize,
    ReactivatedCustomers: 0,
    StableCustomers: 0,
    MigratedCustomers: 0,
    ComparableCustomers: 0,
    MigrationRate: null,
    CentroidShift: 0,
    Iterations: 1,
    SilhouetteScore: toNumber(points[0].silhouette),
    DaviesBouldinScore: daviesBouldin,
    CalinskiHarabaszScore: calinskiHarabasz,
    XieBeniIndex: xieBeni,
    FuzzyObjective: toNumber(points[0].inertia) || withinCluster,
    AverageMembership: 1,
    ProcessingTime: null,
    Converged: 1,
    Method: "K-Means baseline",
  };
};

const getLatestCycle = (): string => {
  const row = repository.runAggregate(`
    SELECT CycleID
    FROM Dynamic_Cycle_Summary
    ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER) DESC
    LIMIT 1
  `);
  return String(row.CycleID ?? "Cycle_9");
};

export class AnalyticsService {
  getSchema(): Array<{ table: string; columns: string[]; rowCount: number }> {
    return schemaRepository.getAllSchemas().map((schema) => ({
      ...schema,
      rowCount: repository.countRows(schema.table),
    }));
  }

  getFilterOptions(): Record<string, unknown> {
    return {
      cycles: repository.runMany(`
        SELECT DISTINCT CycleID AS value
        FROM Data_Preprocessing_Results
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
      `),
      segments: repository.runMany(`
        SELECT DISTINCT Segment_Name AS value
        FROM Dynamic_Customer_Summary
        ORDER BY Segment_Name
      `),
      countries: repository.runMany(`
        SELECT DISTINCT Country AS value
        FROM Customer
        WHERE Country IS NOT NULL
        ORDER BY Country
      `),
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
          if (value != null && String(value).trim()) filters[key] = String(value).trim();
        });
      } catch {
        return { page, pageSize, sortBy, sortOrder, filters };
      }
    }

    return { page, pageSize, sortBy, sortOrder, filters };
  }

  getTableRows(table: string, queryRaw: Record<string, unknown>): Record<string, unknown> {
    const columns = schemaRepository.getTableColumns(table);
    if (!columns.length) throw new Error(`Table not found: ${table}`);

    const query = this.parseTableQuery(queryRaw, columns);
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    Object.entries(query.filters).forEach(([key, value], index) => {
      if (!columns.includes(key)) return;
      const paramKey = `filter${index}`;
      where.push(`CAST(${key} AS TEXT) LIKE @${paramKey}`);
      params[paramKey] = `%${value}%`;
    });

    const safeSortBy = columns.includes(query.sortBy) ? query.sortBy : columns[0];
    const total = repository.countRows(table, { where, params });
    const data = repository.queryRows(table, {
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
    if (cycleId === "Cycle_0") {
      const kpis = repository.runAggregate(`
        SELECT
          COUNT(DISTINCT CustomerID) AS customers,
          SUM(Monetary) AS revenue,
          AVG(Recency) AS avgRecency,
          AVG(Frequency) AS avgFrequency,
          AVG(Monetary) AS avgMonetary
        FROM Data_Preprocessing_Results
        WHERE CycleID = 'Cycle_0'
      `);
      const segments = repository.runMany(`
        SELECT Segment_Name AS segment, COUNT(*) AS customerCount
        FROM Time_Cycle_0_Segmentation
        GROUP BY Segment_Name
        ORDER BY customerCount DESC
      `);
      return { cycleId, kpis, segments, model: null };
    }

    const kpis = repository.runAggregate(`
      SELECT
        COUNT(DISTINCT CustomerID) AS customers,
        SUM(Revenue) AS revenue,
        AVG(Orders) AS avgOrders,
        AVG(Products) AS avgProducts,
        AVG(Average_Basket_Value) AS avgBasketValue,
        AVG(Average_Membership) AS avgMembership
      FROM Dynamic_Customer_Summary
      WHERE CycleID = @cycleId
    `, { cycleId });
    const segments = repository.runMany(`
      SELECT
        Segment_Name AS segment,
        Customers AS customerCount,
        Revenue AS revenue,
        Average_Membership AS averageMembership
      FROM Dynamic_Segment_Summary
      WHERE CycleID = @cycleId
      ORDER BY Revenue DESC
    `, { cycleId });
    const model = repository.runAggregate(`
      SELECT *
      FROM Dynamic_Cycle_Summary
      WHERE CycleID = @cycleId
    `, { cycleId });
    return { cycleId, kpis, segments, model };
  }

  getFeatureSummary(cycleId?: string): Record<string, unknown> {
    const whereClause = cycleId ? "WHERE CycleID = @cycleId" : "";
    const params = cycleId ? { cycleId } : {};
    const rows = repository.runMany(`
      SELECT Recency, Frequency, Monetary, RF_Score, RM_Score, FM_Score
      FROM Data_Preprocessing_Results
      ${whereClause}
    `, params);
    const fields = ["Recency", "Frequency", "Monetary", "RF_Score", "RM_Score", "FM_Score"];

    const summary = fields.map((field) => {
      const values = rows.map((row) => toNumber(row[field])).sort((left, right) => left - right);
      const quantile = (position: number): number => {
        if (!values.length) return 0;
        return values[Math.floor((values.length - 1) * position)];
      };
      return {
        field,
        count: values.length,
        min: values[0] ?? 0,
        max: values[values.length - 1] ?? 0,
        mean: mean(values),
        stdDev: standardDeviation(values),
        median: quantile(0.5),
        q1: quantile(0.25),
        q3: quantile(0.75),
      };
    });

    return { cycleId: cycleId ?? null, summary, sampleSize: rows.length };
  }

  getFeatureCorrelation(cycleId?: string): Record<string, unknown> {
    const whereClause = cycleId ? "WHERE CycleID = @cycleId" : "";
    const params = cycleId ? { cycleId } : {};
    const rows = repository.runMany(`
      SELECT Recency, Frequency, Monetary, RF_Score, RM_Score, FM_Score
      FROM Data_Preprocessing_Results
      ${whereClause}
    `, params);
    const fields = ["Recency", "Frequency", "Monetary", "RF_Score", "RM_Score", "FM_Score"];
    const vectors = Object.fromEntries(
      fields.map((field) => [field, rows.map((row) => toNumber(row[field]))]),
    ) as Record<string, number[]>;
    const matrix = fields.map((leftField) =>
      fields.map((rightField) =>
        Number(pearson(vectors[leftField], vectors[rightField]).toFixed(4)),
      ),
    );
    return { cycleId: cycleId ?? null, fields, matrix, sampleSize: rows.length };
  }

  getModelEvaluationDetailed(): Record<string, unknown> {
    const baselineSummary = repository.runAggregate(`
      SELECT
        COUNT(*) AS sampleSize,
        COUNT(DISTINCT KMeans_Cluster_Number) AS clusterCount,
        AVG(Silhouette_Score) AS silhouette,
        AVG(Elbow_Inertia_Value) AS elbowInertia
      FROM Time_Cycle_0_Segmentation
    `);
    const baselineCycle = getBaselineEvaluation();
    const dynamicCycles = repository.runMany(`
      SELECT
        CycleID,
        CustomersProcessed,
        ActiveCustomers,
        InactiveCustomers,
        NewCustomers,
        ReactivatedCustomers,
        StableCustomers,
        MigratedCustomers,
        ComparableCustomers,
        MigrationRate,
        CentroidShift,
        Iterations,
        SilhouetteScore,
        DaviesBouldinScore,
        CalinskiHarabaszScore,
        XieBeniIndex,
        FuzzyObjective,
        AverageMembership,
        ProcessingTime,
        Converged
      FROM Dynamic_Cycle_Summary
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
    `);
    const cycles = [baselineCycle, ...dynamicCycles];
    const averages = repository.runAggregate(`
      SELECT
        AVG(SilhouetteScore) AS silhouette,
        AVG(DaviesBouldinScore) AS daviesBouldin,
        AVG(CalinskiHarabaszScore) AS calinskiHarabasz,
        AVG(XieBeniIndex) AS xieBeni,
        AVG(FuzzyObjective) AS fuzzyObjective,
        AVG(AverageMembership) AS averageMembership,
        AVG(MigrationRate) AS migrationRate,
        AVG(Iterations) AS iterations,
        SUM(Converged) AS convergedCycles,
        COUNT(*) AS dynamicCycles
      FROM Dynamic_Cycle_Summary
    `);
    const baseline = { ...baselineSummary, ...baselineCycle };
    return { baseline, cycles, dynamicCycles, averages, latest: cycles.at(-1) ?? null };
  }

  getCycleComparisonAnalytics(): Record<string, unknown> {
    const evaluation = this.getModelEvaluationDetailed();
    const profiles = repository.runMany(`
      WITH labels AS (
        SELECT
          CycleID,
          CustomerID,
          Segment_Name AS segment,
          Highest_Membership_Score AS membership
        FROM Dynamic_Loop_Results
        UNION ALL
        SELECT
          'Cycle_0' AS CycleID,
          CustomerID,
          Segment_Name AS segment,
          1.0 AS membership
        FROM Time_Cycle_0_Segmentation
      )
      SELECT
        labels.CycleID,
        labels.segment,
        COUNT(*) AS customers,
        AVG(features.Recency) AS recency,
        AVG(features.Frequency) AS frequency,
        AVG(features.Monetary) AS monetary,
        AVG(features.RF_Score) AS rf,
        AVG(features.RM_Score) AS rm,
        AVG(features.FM_Score) AS fm,
        SUM(features.Monetary) AS revenue,
        AVG(labels.membership) AS averageMembership
      FROM labels
      JOIN Data_Preprocessing_Results features
        ON features.CustomerID = labels.CustomerID
        AND features.CycleID = labels.CycleID
      GROUP BY labels.CycleID, labels.segment
      ORDER BY CAST(REPLACE(labels.CycleID, 'Cycle_', '') AS INTEGER), labels.segment
    `);
    const definitions = repository.runMany(`
      SELECT CycleID, CycleNumber, PeriodStart, PeriodEnd, WindowStart, SnapshotDate, Phase
      FROM Cycle_Definitions
      ORDER BY CycleNumber
    `);
    return {
      cycles: evaluation.cycles,
      profiles,
      definitions,
      defaultFrom: "Cycle_0",
      defaultTo: String((evaluation.latest as Record<string, unknown> | null)?.CycleID ?? "Cycle_10"),
    };
  }

  getPcaAnalytics(): Record<string, unknown> {
    const points = repository.runMany(`
      WITH labels AS (
        SELECT CycleID, CustomerID, Segment_Name AS segment
        FROM Dynamic_Loop_Results
        UNION ALL
        SELECT 'Cycle_0' AS CycleID, CustomerID, Segment_Name AS segment
        FROM Time_Cycle_0_Segmentation
      ), ranked AS (
        SELECT
          features.CycleID,
          features.CustomerID,
          labels.segment,
          features.PC1,
          features.PC2,
          features.PC3,
          ROW_NUMBER() OVER (
            PARTITION BY features.CycleID, labels.segment
            ORDER BY features.CustomerID
          ) AS sampleRank
        FROM Data_Preprocessing_Results features
        JOIN labels
          ON labels.CycleID = features.CycleID
          AND labels.CustomerID = features.CustomerID
      )
      SELECT CycleID, CustomerID, segment, PC1, PC2, PC3
      FROM ranked
      WHERE sampleRank <= 90
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), segment, CustomerID
    `);

    const baselineRow = repository.runAggregate(`
      SELECT Initial_Centroids AS centroids
      FROM Time_Cycle_0_Segmentation
      LIMIT 1
    `);
    let baselineCentroids: number[][] = [];
    try {
      baselineCentroids = JSON.parse(String(baselineRow.centroids ?? "[]")) as number[][];
    } catch {
      baselineCentroids = [];
    }
    const centroids = [
      ...baselineCentroids.map((centroid, cluster) => ({
        CycleID: "Cycle_0",
        cluster,
        segment: segmentNameForCluster(cluster),
        PC1: centroid[0],
        PC2: centroid[1],
        PC3: centroid[2],
      })),
      ...repository.runMany(`
        SELECT
          CycleID,
          ClusterID AS cluster,
          CASE ClusterID
            WHEN 0 THEN 'Champions'
            WHEN 1 THEN 'Core Loyalists'
            WHEN 2 THEN 'Mid-Tier Occasionals'
            WHEN 3 THEN 'Hibernating / Lost'
          END AS segment,
          PC1,
          PC2,
          PC3
        FROM Dynamic_Centroids
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), ClusterID
      `),
    ];
    const featureProfiles = (this.getCycleComparisonAnalytics().profiles ?? []) as Record<string, unknown>[];
    return {
      points,
      centroids,
      featureProfiles,
      explainedVariance: [
        { component: "PC1", percentage: 64.30 },
        { component: "PC2", percentage: 29.85 },
        { component: "PC3", percentage: 4.98 },
      ],
      method: "Cycle 0 PCA transformation reused for every cycle",
    };
  }

  getCustomerAnalytics(): Record<string, unknown> {
    const latestCycle = getLatestCycle();
    const summary = repository.runAggregate(`
      SELECT
        COUNT(*) AS customers,
        AVG(Orders) AS averageOrders,
        AVG(Products) AS averageProducts,
        AVG(Quantity) AS averageQuantity,
        AVG(Revenue) AS averageRevenue,
        AVG(Average_Basket_Value) AS averageBasketValue,
        AVG(Average_Membership) AS averageMembership,
        MAX(Revenue) AS highestRevenue
      FROM Dynamic_Customer_Summary
      WHERE CycleID = @latestCycle
    `, { latestCycle });
    const valueBands = repository.runMany(`
      SELECT
        CASE
          WHEN Revenue < 250 THEN 'Under £250'
          WHEN Revenue < 750 THEN '£250-£749'
          WHEN Revenue < 2000 THEN '£750-£1,999'
          ELSE '£2,000+'
        END AS band,
        COUNT(*) AS customers,
        SUM(Revenue) AS revenue
      FROM Dynamic_Customer_Summary
      WHERE CycleID = @latestCycle
      GROUP BY band
      ORDER BY MIN(Revenue)
    `, { latestCycle });
    const confidenceBands = repository.runMany(`
      SELECT
        CASE
          WHEN Average_Membership < 0.55 THEN 'Low confidence'
          WHEN Average_Membership < 0.75 THEN 'Moderate confidence'
          ELSE 'High confidence'
        END AS band,
        COUNT(*) AS customers
      FROM Dynamic_Customer_Summary
      WHERE CycleID = @latestCycle
      GROUP BY band
      ORDER BY MIN(Average_Membership)
    `, { latestCycle });
    const topCustomers = repository.runMany(`
      SELECT
        summary.CustomerID,
        customer.Country,
        summary.Segment_Name,
        summary.Orders,
        summary.Products,
        summary.Revenue,
        summary.Average_Basket_Value,
        summary.Average_Membership,
        summary.Migration_Status
      FROM Dynamic_Customer_Summary summary
      LEFT JOIN Customer customer ON customer.CustomerID = summary.CustomerID
      WHERE summary.CycleID = @latestCycle
      ORDER BY summary.Revenue DESC
      LIMIT 12
    `, { latestCycle });
    const segmentValue = repository.runMany(`
      SELECT
        Segment_Name AS segment,
        COUNT(*) AS customers,
        AVG(Revenue) AS averageRevenue,
        AVG(Orders) AS averageOrders,
        AVG(Products) AS averageProducts,
        AVG(Average_Basket_Value) AS averageBasketValue,
        AVG(Average_Membership) AS averageMembership
      FROM Dynamic_Customer_Summary
      WHERE CycleID = @latestCycle
      GROUP BY Segment_Name
      ORDER BY averageRevenue DESC
    `, { latestCycle });
    return { latestCycle, summary, valueBands, confidenceBands, topCustomers, segmentValue };
  }

  getProductAnalytics(): Record<string, unknown> {
    const topProducts = repository.runMany(`
      SELECT
        Description AS product,
        SUM(Revenue) AS revenue,
        SUM(Quantity_Sold) AS quantity,
        SUM(Orders) AS orders,
        SUM(Customer_Count) AS customerInteractions,
        AVG(Average_Price) AS averagePrice
      FROM Dynamic_Product_Summary
      GROUP BY Description
      ORDER BY revenue DESC
      LIMIT 20
    `);
    const portfolio = repository.runMany(`
      SELECT
        Segment_Name AS segment,
        COUNT(DISTINCT Description) AS products,
        SUM(Revenue) AS revenue,
        SUM(Quantity_Sold) AS quantity,
        SUM(Orders) AS orders
      FROM Dynamic_Product_Summary
      GROUP BY Segment_Name
      ORDER BY revenue DESC
    `);
    const segmentProducts = repository.runMany(`
      WITH ranked AS (
        SELECT
          Segment_Name AS segment,
          Description AS product,
          SUM(Revenue) AS revenue,
          SUM(Quantity_Sold) AS quantity,
          ROW_NUMBER() OVER (
            PARTITION BY Segment_Name
            ORDER BY SUM(Revenue) DESC
          ) AS rank
        FROM Dynamic_Product_Summary
        GROUP BY Segment_Name, Description
      )
      SELECT segment, product, revenue, quantity, rank
      FROM ranked
      WHERE rank <= 5
      ORDER BY segment, rank
    `);
    const revenueByCycle = repository.runMany(`
      SELECT CycleID, SUM(Revenue) AS revenue, SUM(Quantity_Sold) AS quantity
      FROM Dynamic_Product_Summary
      GROUP BY CycleID
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
    `);
    const productQuadrant = repository.runMany(`
      SELECT
        Description AS product,
        SUM(Revenue) AS revenue,
        SUM(Quantity_Sold) AS quantity,
        SUM(Orders) AS orders,
        SUM(Customer_Count) AS customerInteractions
      FROM Dynamic_Product_Summary
      GROUP BY Description
      ORDER BY revenue DESC
      LIMIT 40
    `);
    return { topProducts, portfolio, segmentProducts, revenueByCycle, productQuadrant };
  }

  getGeographicAnalytics(): Record<string, unknown> {
    const latestCycle = getLatestCycle();
    const markets = repository.runMany(`
      SELECT
        Country AS country,
        Geographic_Cluster_Number AS clusterNumber,
        Geographic_Segment_Name AS geographicSegment,
        Customer_Count AS customers,
        Active_Customer_Count AS activeCustomers,
        Revenue AS revenue,
        Orders AS orders,
        Product_Diversity AS products,
        Orders_Per_Customer AS ordersPerCustomer,
        Revenue_Per_Customer AS revenuePerCustomer,
        Repeat_Purchase_Rate AS repeatPurchaseRate,
        Champions_Share AS championsShare,
        Core_Loyalists_Share AS coreLoyalistsShare,
        Mid_Tier_Occasionals_Share AS midTierOccasionalsShare,
        Hibernating_Lost_Share AS hibernatingLostShare
      FROM Geographic_Segmentation
      WHERE CycleID = @latestCycle
      ORDER BY Revenue DESC, Country
    `, { latestCycle });
    const segmentSummary = repository.runMany(`
      SELECT
        Geographic_Segment_Name AS segment,
        COUNT(*) AS markets,
        SUM(Customer_Count) AS customers,
        SUM(Active_Customer_Count) AS activeCustomers,
        SUM(Revenue) AS revenue,
        AVG(Revenue_Per_Customer) AS averageRevenuePerCustomer,
        AVG(Repeat_Purchase_Rate) AS repeatPurchaseRate
      FROM Geographic_Segmentation
      WHERE CycleID = @latestCycle
      GROUP BY Geographic_Segment_Name
      ORDER BY revenue DESC
    `, { latestCycle });
    const evolution = repository.runMany(`
      SELECT
        CycleID,
        Geographic_Segment_Name AS segment,
        COUNT(*) AS markets,
        SUM(Customer_Count) AS customers,
        SUM(Revenue) AS revenue
      FROM Geographic_Segmentation
      GROUP BY CycleID, Geographic_Segment_Name
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), Geographic_Segment_Name
    `);
    const quality = repository.runMany(`
      SELECT CycleID, Markets, SilhouetteScore, DaviesBouldinScore, CalinskiHarabaszScore
      FROM Geographic_Cycle_Summary
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
    `);
    const behaviouralEvolution = repository.runMany(`
      SELECT
        CycleID,
        Country AS country,
        Customer_Count AS customers,
        Champions_Share * 100 AS Champions,
        Core_Loyalists_Share * 100 AS 'Core Loyalists',
        Mid_Tier_Occasionals_Share * 100 AS 'Mid-Tier Occasionals',
        Hibernating_Lost_Share * 100 AS 'Hibernating / Lost'
      FROM Geographic_Segmentation
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), Revenue DESC, Country
    `);
    return {
      latestCycle,
      markets,
      countries: markets,
      segmentSummary,
      evolution,
      quality,
      behaviouralEvolution,
    };
  }

  getFirmographicAnalytics(): Record<string, unknown> {
    const latestCycle = getLatestCycle();
    const summary = repository.runAggregate(`
      SELECT
        COUNT(*) AS customers,
        COUNT(DISTINCT Country) AS markets,
        COUNT(DISTINCT Geographic_Segment_Name) AS geographicSegments,
        COUNT(DISTINCT Segment_Name) AS behaviouralSegments,
        COUNT(DISTINCT Firmographic_Segment_Name) AS firmographicSegments,
        AVG(Highest_Membership_Score) AS averageMembership,
        SUM(CASE WHEN Activity_Status = 'Active' THEN 1 ELSE 0 END) AS activeCustomers,
        SUM(CASE WHEN Activity_Status = 'Inactive' THEN 1 ELSE 0 END) AS inactiveCustomers
      FROM Firmographic_Customer_Segmentation
      WHERE CycleID = @latestCycle
    `, { latestCycle });
    const combinations = repository.runMany(`
      SELECT
        Firmographic_Segment_Name AS firmographicSegment,
        Geographic_Segment_Name AS geographicSegment,
        Segment_Name AS behaviouralSegment,
        COUNT(*) AS customers,
        SUM(CASE WHEN Activity_Status = 'Active' THEN 1 ELSE 0 END) AS activeCustomers,
        SUM(CASE WHEN Activity_Status = 'Inactive' THEN 1 ELSE 0 END) AS inactiveCustomers,
        AVG(Highest_Membership_Score) AS averageMembership,
        COUNT(DISTINCT Country) AS markets
      FROM Firmographic_Customer_Segmentation
      WHERE CycleID = @latestCycle
      GROUP BY Firmographic_Segment_Name, Geographic_Segment_Name, Segment_Name
      ORDER BY customers DESC
    `, { latestCycle });
    const matrix = repository.runMany(`
      SELECT
        Geographic_Segment_Name AS geographicSegment,
        Segment_Name AS behaviouralSegment,
        COUNT(*) AS customers
      FROM Firmographic_Customer_Segmentation
      WHERE CycleID = @latestCycle
      GROUP BY Geographic_Segment_Name, Segment_Name
      ORDER BY Geographic_Segment_Name, Segment_Name
    `, { latestCycle });
    const evolution = repository.runMany(`
      SELECT
        CycleID,
        Geographic_Segment_Name AS geographicSegment,
        COUNT(*) AS customers
      FROM Firmographic_Customer_Segmentation
      GROUP BY CycleID, Geographic_Segment_Name
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), Geographic_Segment_Name
    `);
    const marketMix = repository.runMany(`
      SELECT
        Country AS country,
        Geographic_Segment_Name AS geographicSegment,
        COUNT(*) AS customers,
        COUNT(DISTINCT Firmographic_Segment_Name) AS firmographicSegments
      FROM Firmographic_Customer_Segmentation
      WHERE CycleID = @latestCycle
      GROUP BY Country, Geographic_Segment_Name
      ORDER BY customers DESC, Country
    `, { latestCycle });
    return { latestCycle, summary, combinations, matrix, evolution, marketMix };
  }

  getCycle10Simulation(): Record<string, unknown> {
    const cycleId = "Cycle_10";
    const previousCycleId = "Cycle_9";
    const definition = repository.runAggregate(`
      SELECT * FROM Cycle_Definitions WHERE CycleID = @cycleId
    `, { cycleId });
    const model = repository.runAggregate(`
      SELECT * FROM Dynamic_Cycle_Summary WHERE CycleID = @cycleId
    `, { cycleId });
    const previousModel = repository.runAggregate(`
      SELECT * FROM Dynamic_Cycle_Summary WHERE CycleID = @previousCycleId
    `, { previousCycleId });
    const transitionStates = repository.runMany(`
      SELECT Transition_Status AS state, COUNT(*) AS customers
      FROM Customer_Transitions
      WHERE CycleID = @cycleId
      GROUP BY Transition_Status
      ORDER BY customers DESC
    `, { cycleId });
    const transitionMatrix = repository.runMany(`
      SELECT
        Previous_Segment_Name AS fromSegment,
        Segment_Name AS toSegment,
        COUNT(*) AS customers
      FROM Customer_Transitions
      WHERE CycleID = @cycleId
        AND Transition_Status IN ('Existing Stable', 'Existing Migrated')
      GROUP BY Previous_Segment_Name, Segment_Name
      ORDER BY customers DESC
    `, { cycleId });
    const segmentComparison = repository.runMany(`
      WITH current_cycle AS (
        SELECT Segment_Name, Customers, Revenue, Average_Membership
        FROM Dynamic_Segment_Summary
        WHERE CycleID = @cycleId
      ), previous_cycle AS (
        SELECT Segment_Name, Customers, Revenue, Average_Membership
        FROM Dynamic_Segment_Summary
        WHERE CycleID = @previousCycleId
      )
      SELECT
        current_cycle.Segment_Name AS segment,
        previous_cycle.Customers AS previousCustomers,
        current_cycle.Customers AS currentCustomers,
        current_cycle.Customers - previous_cycle.Customers AS customerChange,
        previous_cycle.Revenue AS previousRevenue,
        current_cycle.Revenue AS currentRevenue,
        current_cycle.Revenue - previous_cycle.Revenue AS revenueChange,
        current_cycle.Average_Membership AS averageMembership
      FROM current_cycle
      JOIN previous_cycle USING (Segment_Name)
      ORDER BY currentCustomers DESC
    `, { cycleId, previousCycleId });
    const geographicSegments = repository.runMany(`
      SELECT
        Geographic_Segment_Name AS segment,
        COUNT(*) AS markets,
        SUM(Customer_Count) AS customers,
        SUM(Revenue) AS revenue
      FROM Geographic_Segmentation
      WHERE CycleID = @cycleId
      GROUP BY Geographic_Segment_Name
      ORDER BY revenue DESC
    `, { cycleId });
    const firmographicSegments = repository.runMany(`
      SELECT
        Firmographic_Segment_Name AS segment,
        COUNT(*) AS customers,
        AVG(Highest_Membership_Score) AS averageMembership
      FROM Firmographic_Customer_Segmentation
      WHERE CycleID = @cycleId
      GROUP BY Firmographic_Segment_Name
      ORDER BY customers DESC
    `, { cycleId });
    const topCustomers = repository.runMany(`
      SELECT
        summary.CustomerID,
        customer.Country,
        firmographic.Firmographic_Segment_Name AS firmographicSegment,
        summary.Segment_Name AS behaviouralSegment,
        summary.Revenue,
        summary.Orders,
        summary.Average_Membership AS averageMembership,
        summary.Transition_Status AS transitionState
      FROM Dynamic_Customer_Summary summary
      LEFT JOIN Customer customer ON customer.CustomerID = summary.CustomerID
      LEFT JOIN Firmographic_Customer_Segmentation firmographic
        ON firmographic.CustomerID = summary.CustomerID
        AND firmographic.CycleID = summary.CycleID
      WHERE summary.CycleID = @cycleId
      ORDER BY summary.Revenue DESC, summary.CustomerID
      LIMIT 12
    `, { cycleId });
    return {
      mode: "precomputed",
      status: "ready",
      cycleId,
      previousCycleId,
      definition,
      model,
      previousModel,
      transitionStates,
      transitionMatrix,
      segmentComparison,
      geographicSegments,
      firmographicSegments,
      topCustomers,
    };
  }
}
