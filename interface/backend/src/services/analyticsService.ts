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
        FROM Dynamic_Customer_Summary
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
    const baseline = repository.runAggregate(`
      SELECT
        COUNT(*) AS sampleSize,
        COUNT(DISTINCT KMeans_Cluster_Number) AS clusterCount,
        AVG(Silhouette_Score) AS silhouette,
        AVG(Elbow_Inertia_Value) AS elbowInertia
      FROM Time_Cycle_0_Segmentation
    `);
    const cycles = repository.runMany(`
      SELECT
        CycleID,
        CustomersProcessed,
        StableCustomers,
        MigratedCustomers,
        MigrationRate,
        CentroidShift,
        Iterations,
        SilhouetteScore,
        DaviesBouldinScore,
        CalinskiHarabaszScore,
        AverageMembership,
        ProcessingTime,
        Converged
      FROM Dynamic_Cycle_Summary
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
    `);
    const averages = repository.runAggregate(`
      SELECT
        AVG(SilhouetteScore) AS silhouette,
        AVG(DaviesBouldinScore) AS daviesBouldin,
        AVG(CalinskiHarabaszScore) AS calinskiHarabasz,
        AVG(AverageMembership) AS averageMembership,
        AVG(MigrationRate) AS migrationRate,
        AVG(Iterations) AS iterations,
        SUM(Converged) AS convergedCycles,
        COUNT(*) AS dynamicCycles
      FROM Dynamic_Cycle_Summary
    `);
    return { baseline, cycles, averages, latest: cycles.at(-1) ?? null };
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
          WHEN Revenue < 750 THEN '£250–£749'
          WHEN Revenue < 2000 THEN '£750–£1,999'
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
    return { topProducts, portfolio, segmentProducts, revenueByCycle };
  }

  getGeographicAnalytics(): Record<string, unknown> {
    const latestCycle = getLatestCycle();
    const countries = repository.runMany(`
      SELECT
        Country AS country,
        COUNT(DISTINCT CustomerID) AS customers,
        COUNT(DISTINCT InvoiceNo) AS orders,
        COUNT(DISTINCT Description) AS products,
        SUM(Quantity) AS quantity,
        SUM(Revenue) AS revenue,
        SUM(Revenue) / NULLIF(COUNT(DISTINCT CustomerID), 0) AS revenuePerCustomer
      FROM Dynamic_Business_Analytics
      GROUP BY Country
      ORDER BY revenue DESC
    `);
    const segmentComposition = repository.runMany(`
      SELECT
        Country AS country,
        Segment_Name AS segment,
        COUNT(DISTINCT CustomerID) AS customers,
        SUM(Revenue) AS revenue
      FROM Dynamic_Business_Analytics
      WHERE CycleID = @latestCycle
      GROUP BY Country, Segment_Name
      ORDER BY revenue DESC
    `, { latestCycle });
    const countryTrends = repository.runMany(`
      WITH top_countries AS (
        SELECT Country
        FROM Dynamic_Business_Analytics
        GROUP BY Country
        ORDER BY SUM(Revenue) DESC
        LIMIT 8
      )
      SELECT
        CycleID,
        Country AS country,
        COUNT(DISTINCT CustomerID) AS customers,
        SUM(Revenue) AS revenue
      FROM Dynamic_Business_Analytics
      WHERE Country IN (SELECT Country FROM top_countries)
      GROUP BY CycleID, Country
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), revenue DESC
    `);
    return { latestCycle, countries, segmentComposition, countryTrends };
  }
}
