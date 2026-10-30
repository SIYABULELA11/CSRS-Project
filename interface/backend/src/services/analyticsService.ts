import { profileOrderSql } from "../utils/clusterProfiles";
import { DataRepository } from "../repositories/dataRepository";
import { SchemaRepository } from "../repositories/schemaRepository";
import { customerSummaryCte, commercialFeatureSql } from "./customerService";
import { ClusterRegistryService } from "./clusterRegistryService";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

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
const clusterRegistryService = new ClusterRegistryService();

const semanticConsistencyAudit = (): Record<string, unknown> => {
  const auditPath = path.join(path.dirname(env.databasePath), "semantic_cluster_audit.json");
  if (!fs.existsSync(auditPath)) return { available: false, reason: "The current run has no semantic consistency audit yet." };
  try {
    const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    if (!audit || typeof audit !== "object" || Array.isArray(audit)) throw new Error("Expected an audit object");
    return { available: true, ...audit };
  } catch {
    return { available: false, reason: "The current run's semantic consistency audit could not be read." };
  }
};

const populationQualityDiagnostics = (): Record<string, unknown> => {
  const filename = path.join(path.dirname(env.databasePath), "population_quality_diagnostics.json");
  if (!fs.existsSync(filename)) return { available: false };
  try {
    const report = JSON.parse(fs.readFileSync(filename, "utf8"));
    return report && typeof report === "object" && Array.isArray(report.rows) ? report : { available: false };
  } catch { return { available: false }; }
};

const evaluationReport = (): Record<string, unknown> => {
  const filename = path.join(path.dirname(env.databasePath), "evaluation_report.json");
  if (!fs.existsSync(filename)) return { available: false };
  try {
    const report = JSON.parse(fs.readFileSync(filename, "utf8"));
    return report && typeof report === "object" && Array.isArray(report.dynamicCycles) && report.geographic
      ? report : { available: false };
  } catch { return { available: false }; }
};

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

const getBaselineEvaluation = (): Record<string, unknown> => {
  const points = repository.runMany(`
    SELECT
      KMeans_Cluster_Number AS cluster,
      PC1,
      PC2,
      PC3,
      Silhouette_Score AS silhouette,
      Davies_Bouldin_Score AS daviesBouldin,
      Calinski_Harabasz_Score AS calinskiHarabasz,
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

  const sampleSize = points.length;
  const clusterCount = centroids.length;
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
    DaviesBouldinScore: toNumber(points[0].daviesBouldin),
    CalinskiHarabaszScore: toNumber(points[0].calinskiHarabasz),
    XieBeniIndex: null,
    FuzzyObjective: null,
    Inertia: toNumber(points[0].inertia),
    SelectedK: clusterCount,
    AverageMembership: null,
    ProcessingTime: null,
    Converged: 1,
    Method: "Static K-means baseline",
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
        SELECT Segment_Name AS value FROM (
          SELECT DISTINCT Segment_Name FROM Dynamic_Customer_Summary
          UNION SELECT DISTINCT Segment_Name FROM Time_Cycle_0_Segmentation
        )
        ORDER BY ${profileOrderSql("Segment_Name")}
      `),
      countries: repository.runMany(`
        SELECT DISTINCT Country AS value
        FROM Customer
        WHERE Country IS NOT NULL
        ORDER BY Country
      `),
      clusters: clusterRegistryService.getRegistry().map((cluster) => ({
        value: cluster.stableClusterId, label: cluster.displayLabel, CycleID: cluster.CycleID,
        localIndex: cluster.localIndex, businessProfile: cluster.businessProfile,
      })),
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
          SUM(${commercialFeatureSql.revenue}) AS revenue,
          AVG(Recency) AS avgRecency,
          AVG(Frequency) AS avgFrequency,
          AVG(Monetary) AS avgMonetary
        FROM Data_Preprocessing_Results features
        WHERE CycleID = 'Cycle_0'
      `);
      const segments = repository.runMany(`
        SELECT Segment_Name AS segment, COUNT(*) AS customerCount
        FROM Time_Cycle_0_Segmentation
        GROUP BY Segment_Name
        ORDER BY ${profileOrderSql("Segment_Name")}
      `);
      return {
        cycleId, kpis, segments, model: null,
        clusterRegistry: clusterRegistryService.getRegistry(cycleId),
        clusterCounts: clusterRegistryService.getCounts(cycleId),
        fittedClusterCount: clusterRegistryService.getRegistry(cycleId).length,
        businessGroupCount: segments.length,
      };
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
        SUM(Customers) AS customerCount,
        SUM(Revenue) AS revenue,
        SUM(Average_Membership * Customers) / NULLIF(SUM(Customers), 0) AS averageMembership
      FROM Dynamic_Segment_Summary
      WHERE CycleID = @cycleId
      GROUP BY Segment_Name
      ORDER BY ${profileOrderSql("Segment_Name")}
    `, { cycleId });
    const model = repository.runAggregate(`
      SELECT *
      FROM Dynamic_Cycle_Summary
      WHERE CycleID = @cycleId
    `, { cycleId });
    return {
      cycleId, kpis, segments, model,
      clusterRegistry: clusterRegistryService.getRegistry(cycleId),
      clusterCounts: clusterRegistryService.getCounts(cycleId),
      fittedClusterCount: clusterRegistryService.getRegistry(cycleId).length,
      businessGroupCount: segments.length,
    };
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
    const baselineProfiles = repository.runMany(`
      SELECT
        KMeans_Cluster_Number AS clusterNumber,
        Stable_Cluster_ID AS stableClusterId,
        Segment_Name AS segment,
        COUNT(*) AS customers,
        AVG(Recency) AS recency,
        AVG(Frequency) AS frequency,
        AVG(Monetary) AS monetary,
        NULL AS averageMembership
      FROM Time_Cycle_0_Segmentation
      GROUP BY KMeans_Cluster_Number, Stable_Cluster_ID, Segment_Name
      ORDER BY ${profileOrderSql("Segment_Name")}, KMeans_Cluster_Number
    `);
    const baselineCycle = getBaselineEvaluation();
    const dynamicCycles = repository.runMany(`
      SELECT
        CycleID,
        CustomersProcessed,
        ModelFitCustomers,
        RetainedInactiveCustomers,
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
        SelectedK,
        Condition1Met,
        Condition2Met,
        Condition1ObservationCount,
        Condition2ObservationCount,
        MDFCMDecision,
        SelectedOperation,
        SelectedSourceLocalClusters,
        SelectedSourceStableClusterIDs,
        SelectedResultLocalClusters,
        SelectedResultStableClusterIDs,
        CandidateXB,
        MDFCMAlpha,
        Fuzziness,
        ConvergenceTolerance,
        ConvergenceCriterion,
        SilhouetteScore,
        DaviesBouldinScore,
        CalinskiHarabaszScore,
        XieBeniIndex,
        FuzzyObjective,
        NetGrossMonetaryRankCorrelation,
        MonetaryRankQuartileChangedCustomers,
        MonetaryRankQuartileChangedShare,
        AverageMembership,
        ProcessingTime,
        Converged
      FROM Dynamic_Cycle_Summary
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
    `);
    const activeMembershipRows = repository.runMany(`
      SELECT CycleID, Cluster_Local_Index, All_Fuzzy_Memberships
      FROM Dynamic_Loop_Results
      WHERE Assignment_Mode = 'Current-cycle fuzzy fit'
    `);
    const occupancyByCycle = new Map<string, {
      winners: Set<number>;
      fuzzyMass: number[];
    }>();
    activeMembershipRows.forEach((row) => {
      const cycleId = String(row.CycleID ?? '');
      let memberships: number[] = [];
      try {
        const parsed = JSON.parse(String(row.All_Fuzzy_Memberships ?? '[]')) as unknown[];
        memberships = parsed.map(toNumber);
      } catch {
        memberships = [];
      }
      if (!cycleId || !memberships.length) return;
      const occupancy = occupancyByCycle.get(cycleId) ?? { winners: new Set<number>(), fuzzyMass: [] };
      const hardWinner = Number(row.Cluster_Local_Index);
      if (Number.isInteger(hardWinner) && hardWinner >= 0) occupancy.winners.add(hardWinner);
      memberships.forEach((membership, index) => {
        occupancy.fuzzyMass[index] = (occupancy.fuzzyMass[index] ?? 0) + membership;
      });
      occupancyByCycle.set(cycleId, occupancy);
    });
    const dynamicCyclesWithOccupancy = dynamicCycles.map((cycle) => {
      const cycleId = String(cycle.CycleID ?? '');
      const occupancy = occupancyByCycle.get(cycleId) ?? { winners: new Set<number>(), fuzzyMass: [] };
      const softOnlyCentres = occupancy.fuzzyMass
        .map((mass, index) => ({ mass, index }))
        .filter(({ mass, index }) => mass > 1e-8 && !occupancy.winners.has(index))
        .map(({ index }) => index);
      return {
        ...cycle,
        HardWinningClusterCount: occupancy.winners.size,
        SoftOnlyCentreLocalIndexes: softOnlyCentres,
        FuzzyMembershipMassByLocalCluster: occupancy.fuzzyMass,
      };
    });
    const candidateEvaluations = repository.runMany(`
      SELECT
        CycleID,
        PreviousK,
        CandidateK,
        InitializationAction,
        SourceLocalClusters,
        SourceStableClusterIDs,
        ResultLocalClusters,
        ResultStableClusterIDs,
        XieBeniIndex,
        FuzzyObjective,
        Iterations,
        Converged,
        FinalMembershipChange,
        FinalObjectiveChange,
        ConvergenceTolerance,
        Selected
      FROM MDFCM_Candidate_Evaluations
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), CandidateK
    `);
    const cycles = [baselineCycle, ...dynamicCyclesWithOccupancy];
    const averages = repository.runAggregate(`
      SELECT
        AVG(SilhouetteScore) AS silhouette,
        AVG(DaviesBouldinScore) AS daviesBouldin,
        AVG(CalinskiHarabaszScore) AS calinskiHarabasz,
        AVG(XieBeniIndex) AS xieBeni,
        AVG(FuzzyObjective) AS fuzzyObjective,
        AVG(NetGrossMonetaryRankCorrelation) AS netGrossMonetaryRankCorrelation,
        AVG(MonetaryRankQuartileChangedShare) AS monetaryRankQuartileChangedShare,
        AVG(AverageMembership) AS averageMembership,
        AVG(MigrationRate) AS migrationRate,
        AVG(Iterations) AS iterations,
        SUM(Converged) AS convergedCycles,
        COUNT(*) AS dynamicCycles
      FROM Dynamic_Cycle_Summary
    `);
    const baseline = { ...baselineSummary, ...baselineCycle };
    return {
      baseline,
      baselineProfiles,
      cycles,
      dynamicCycles: dynamicCyclesWithOccupancy,
      candidateEvaluations,
      clusterRegistry: clusterRegistryService.getRegistry(),
      clusterCounts: clusterRegistryService.getCounts(),
      fittedClusterCount: clusterRegistryService.getRegistry(getLatestCycle()).length,
      semanticConsistency: semanticConsistencyAudit(),
      populationQualityDiagnostics: populationQualityDiagnostics(),
      evaluationReport: evaluationReport(),
      averages,
      latest: cycles.at(-1) ?? null,
      geographicMethod: {
        algorithm: 'K-means',
        clusterCount: toNumber(repository.runAggregate(`
          SELECT COUNT(DISTINCT Geographic_Cluster_Number) AS clusters
          FROM Geographic_Segmentation WHERE CycleID = 'Cycle_0'
        `).clusters),
        unit: 'country market',
        fitCycle: 'Cycle_0',
        preprocessing: 'Log1p for customer count, paid sales, orders per customer, revenue per customer and product diversity; RobustScaler fitted on Cycle 0.',
        features: [
          'Log_Customer_Count', 'Log_Revenue', 'Log_Orders_Per_Customer',
          'Log_Revenue_Per_Customer', 'Log_Product_Diversity', 'Repeat_Purchase_Rate',
          'Champions_Share', 'Loyalists_Share', 'Mid_Tier_Occasionals_Share',
          'Developing_Share', 'Hibernating_Lost_Share', 'Other_Customer_Segment_Share',
        ],
        nInit: 50,
        randomState: 42,
        laterCycles: 'Apply the fixed Cycle 0 scaler and K-means centres to each later country snapshot.',
        selection: 'Three descriptive market groups specified for this analysis; the behavioural elbow selection is separate.',
        groups: ['Largest Revenue Market', 'Highest Revenue-per-Customer Market', 'Other Markets'],
        risk: 'At-risk share is reported as customer context and is not a geographic clustering feature.',
        interpretation: 'Market groups summarize country-level commercial activity and customer mix. They do not establish company size, industry or other company attributes.',
      },
    };
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
          NULL AS membership
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
        SUM(${commercialFeatureSql.revenue}) AS revenue,
        AVG(CASE WHEN labels.CycleID <> 'Cycle_0' THEN labels.membership END) AS averageMembership
      FROM labels
      JOIN Data_Preprocessing_Results features
        ON features.CustomerID = labels.CustomerID
        AND features.CycleID = labels.CycleID
      GROUP BY labels.CycleID, labels.segment
      ORDER BY CAST(REPLACE(labels.CycleID, 'Cycle_', '') AS INTEGER), ${profileOrderSql("labels.segment")}
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
      defaultTo: String((evaluation.latest as Record<string, unknown> | null)?.CycleID ?? "Cycle_9"),
    };
  }

  getPcaAnalytics(cycleId?: string, includePoints = true): Record<string, unknown> {
    const points = includePoints ? repository.runMany(`
      SELECT *
      FROM (
        SELECT
          features.CycleID,
          features.CustomerID,
          baseline.Segment_Name AS segment,
          baseline.Stable_Cluster_ID AS stableClusterId,
          'Active' AS activityStatus,
          'Cycle 0 baseline fit' AS assignmentMode,
          1.0 AS membership,
          features.PC1,
          features.PC2,
          features.PC3
        FROM Data_Preprocessing_Results features
        JOIN Time_Cycle_0_Segmentation baseline
          ON baseline.CustomerID = features.CustomerID
          AND features.CycleID = 'Cycle_0'
        UNION ALL
        SELECT
          features.CycleID,
          features.CustomerID,
          dynamic.Segment_Name AS segment,
          dynamic.Stable_Cluster_ID AS stableClusterId,
          dynamic.Activity_Status AS activityStatus,
          dynamic.Assignment_Mode AS assignmentMode,
          dynamic.Highest_Membership_Score AS membership,
          features.PC1,
          features.PC2,
          features.PC3
        FROM Data_Preprocessing_Results features
        JOIN Dynamic_Loop_Results dynamic
          ON dynamic.CustomerID = features.CustomerID
          AND dynamic.CycleID = features.CycleID
      ) all_points
      ${cycleId ? 'WHERE CycleID = @cycleId' : ''}
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), segment, CustomerID
    `, cycleId ? { cycleId } : {}) : [];

    const clusterRegistry = clusterRegistryService.getRegistry();
    const clusterCounts = clusterRegistryService.getCounts();
    const centroids = clusterRegistry.map((cluster) => ({
      ...cluster, cluster: cluster.localIndex, segment: cluster.businessProfile,
    }));
    const varianceRow = repository.runAggregate(`
      SELECT
        AVG(PC1 * PC1) - AVG(PC1) * AVG(PC1) AS pc1,
        AVG(PC2 * PC2) - AVG(PC2) * AVG(PC2) AS pc2,
        AVG(PC3 * PC3) - AVG(PC3) * AVG(PC3) AS pc3,
        AVG(Scaled_Log_R * Scaled_Log_R) - AVG(Scaled_Log_R) * AVG(Scaled_Log_R)
          + AVG(Scaled_Log_F * Scaled_Log_F) - AVG(Scaled_Log_F) * AVG(Scaled_Log_F)
          + AVG(Scaled_Log_M * Scaled_Log_M) - AVG(Scaled_Log_M) * AVG(Scaled_Log_M)
          + AVG(Scaled_RF_Score * Scaled_RF_Score) - AVG(Scaled_RF_Score) * AVG(Scaled_RF_Score)
          + AVG(Scaled_RM_Score * Scaled_RM_Score) - AVG(Scaled_RM_Score) * AVG(Scaled_RM_Score)
          + AVG(Scaled_FM_Score * Scaled_FM_Score) - AVG(Scaled_FM_Score) * AVG(Scaled_FM_Score)
          AS totalFeatureVariance
      FROM Data_Preprocessing_Results
      WHERE CycleID = 'Cycle_0'
    `) as Record<string, unknown>;
    const totalFeatureVariance = toNumber(varianceRow.totalFeatureVariance);
    const featureProfiles = (this.getCycleComparisonAnalytics().profiles ?? []) as Record<string, unknown>[];
    // These are observed business-group means, rather than fitted MDFCM centres.
    // A group with no customers in a cycle has no point and is never interpolated.
    const familyCentroids = repository.runMany(`
      ${customerSummaryCte}
      SELECT summary.CycleID, summary.Segment_Name AS segment,
        COUNT(*) AS customers,
        AVG(features.PC1) AS PC1, AVG(features.PC2) AS PC2, AVG(features.PC3) AS PC3,
        AVG(features.Recency) AS recency, AVG(features.Frequency) AS frequency,
        AVG(features.Monetary) AS monetary,
        AVG(CASE WHEN summary.CycleID <> 'Cycle_0' THEN summary.Average_Membership END) AS averageMembership
      FROM customer_summary summary
      JOIN Data_Preprocessing_Results features
        ON features.CycleID = summary.CycleID AND features.CustomerID = summary.CustomerID
      GROUP BY summary.CycleID, summary.Segment_Name
      ORDER BY CAST(REPLACE(summary.CycleID, 'Cycle_', '') AS INTEGER), ${profileOrderSql("summary.Segment_Name")}
    `);
    return {
      points: clusterRegistryService.addAssignmentMetadata(points.map((point) => ({
        ...point, Stable_Cluster_ID: point.stableClusterId,
        Segment_Name: point.segment, Activity_Status: point.activityStatus, Assignment_Mode: point.assignmentMode,
      }))),
      centroids,
      clusterRegistry,
      clusterCounts,
      familyCentroids,
      familyCentroidMethod: "Arithmetic mean of the observed PCA coordinates for each business group in each cycle. Missing groups have no point; these means are separate from fitted K-means/MDFCM centres.",
      featureProfiles,
      explainedVariance: ["pc1", "pc2", "pc3"].map((key, index) => ({
        component: `PC${index + 1}`,
        percentage: totalFeatureVariance > 0
          ? (100 * toNumber(varianceRow[key]) / totalFeatureVariance)
          : 0,
      })),
      method: "PCA was fitted on Cycle 0 and the same transformation is applied to later cycles.",
    };
  }

  getCustomerAnalytics(cycleId?: string): Record<string, unknown> {
    const latestCycle = getLatestCycle();
    const cycle = cycleId || latestCycle;
    const allCycles = cycle.toLowerCase() === 'all';
    const whereClause = allCycles ? '' : 'WHERE summary.CycleID = @cycle';
    const params = allCycles ? {} : { cycle };
    const summary = repository.runAggregate(`
      ${customerSummaryCte}
      SELECT
        COUNT(*) AS customers,
        COUNT(DISTINCT CustomerID) AS uniqueCustomers,
        COUNT(DISTINCT CycleID) AS cycles,
        AVG(Orders) AS averageOrders,
        AVG(Products) AS averageProducts,
        AVG(Quantity) AS averageQuantity,
        AVG(Revenue) AS averageRevenue,
        AVG(Average_Basket_Value) AS averageBasketValue,
        AVG(CASE WHEN CycleID <> 'Cycle_0' THEN Average_Membership END) AS averageMembership,
        MAX(Revenue) AS highestRevenue
      FROM customer_summary summary
      ${whereClause}
    `, params);
    const valueBands = repository.runMany(`
      ${customerSummaryCte}
      SELECT
        CASE
          WHEN Revenue < 250 THEN 'Under £250'
          WHEN Revenue < 750 THEN '£250-£749'
          WHEN Revenue < 2000 THEN '£750-£1,999'
          ELSE '£2,000+'
        END AS band,
        COUNT(*) AS customers,
        SUM(Revenue) AS revenue
      FROM customer_summary summary
      ${whereClause}
      GROUP BY band
      ORDER BY MIN(Revenue)
    `, params);
    const confidenceBands = repository.runMany(`
      ${customerSummaryCte}
      SELECT
        CASE
          WHEN CycleID = 'Cycle_0' THEN 'K-means assignment'
          WHEN Average_Membership < 0.55 THEN 'Low confidence'
          WHEN Average_Membership < 0.75 THEN 'Moderate confidence'
          ELSE 'High confidence'
        END AS band,
        COUNT(*) AS customers
      FROM customer_summary summary
      ${whereClause}
      GROUP BY band
      ORDER BY MIN(Average_Membership)
    `, params);
    const topCustomers = repository.runMany(`
      ${customerSummaryCte}
      SELECT
        summary.CustomerID,
        summary.CycleID,
        customer.Country,
        summary.Segment_Name,
        summary.Orders,
        summary.Products,
        summary.Revenue,
        summary.Average_Basket_Value,
        summary.Average_Membership,
        summary.Migration_Status,
        summary.Risk_Status,
        summary.Risk_Reasons
      FROM customer_summary summary
      LEFT JOIN Customer customer ON customer.CustomerID = summary.CustomerID
      ${whereClause}
      ORDER BY summary.Revenue DESC
      LIMIT 12
    `, params);
    const segmentValue = repository.runMany(`
      ${customerSummaryCte}
      SELECT
        Segment_Name AS segment,
        COUNT(*) AS customers,
        AVG(Revenue) AS averageRevenue,
        AVG(Orders) AS averageOrders,
        AVG(Products) AS averageProducts,
        AVG(Average_Basket_Value) AS averageBasketValue,
        AVG(CASE WHEN CycleID <> 'Cycle_0' THEN Average_Membership END) AS averageMembership
      FROM customer_summary summary
      ${whereClause}
      GROUP BY Segment_Name
      ORDER BY ${profileOrderSql("Segment_Name")}
    `, params);
    const riskBySegment = repository.runMany(`
      ${customerSummaryCte}
      SELECT Segment_Name AS segment, COUNT(*) AS customers,
        SUM(CASE WHEN Risk_Status IN ('At risk', 'Slipping', 'No risk flag') THEN 1 ELSE 0 END) AS assessedCustomers,
        SUM(CASE WHEN Risk_Status IN ('At risk', 'Slipping') THEN 1 ELSE 0 END) AS atRiskCustomers,
        SUM(CASE WHEN Risk_Status = 'Slipping' THEN 1 ELSE 0 END) AS slippingCustomers,
        SUM(CASE WHEN Risk_Status = 'Lost' THEN 1 ELSE 0 END) AS lostCustomers,
        1.0 * SUM(CASE WHEN Risk_Status IN ('At risk', 'Slipping') THEN 1 ELSE 0 END)
          / NULLIF(SUM(CASE WHEN Risk_Status IN ('At risk', 'Slipping', 'No risk flag') THEN 1 ELSE 0 END), 0) AS atRiskRate
      FROM customer_summary summary
      ${whereClause}
      GROUP BY Segment_Name
      ORDER BY ${profileOrderSql("Segment_Name")}
    `, params);
    const assignmentRows = clusterRegistryService.addAssignmentMetadata(repository.runMany(`
      ${customerSummaryCte}
      SELECT CustomerID, CycleID, Stable_Cluster_ID, Segment_Name, Activity_Status,
        Assignment_Mode, Risk_Status
      FROM customer_summary summary
      ${whereClause}
    `, params));
    const registryByKey = new Map(clusterRegistryService.getRegistry().map((row) => [`${row.CycleID}:${row.stableClusterId}`, row]));
    const riskGroups = new Map<string, {
      segment: string; stableClusterId: string; labelOrder: number;
      customers: number; assessedCustomers: number; atRiskCustomers: number;
      slippingCustomers: number; lostCustomers: number;
      retainedHistoricalCustomers: number; currentStatuses: Set<boolean>;
    }>();
    assignmentRows.forEach((row) => {
      const id = String(row.Stable_Cluster_ID);
      const label = String(row.assignedClusterLabel);
      const key = `${id}:${label}`;
      const group = riskGroups.get(key) ?? {
        segment: label, stableClusterId: id,
        labelOrder: registryByKey.get(`${row.lastFittedCycle}:${id}`)?.labelOrder ?? 99,
        customers: 0, assessedCustomers: 0, atRiskCustomers: 0,
        slippingCustomers: 0, lostCustomers: 0,
        retainedHistoricalCustomers: 0, currentStatuses: new Set<boolean>(),
      };
      group.customers += 1;
      if (['At risk', 'Slipping', 'No risk flag'].includes(String(row.Risk_Status))) group.assessedCustomers += 1;
      if (row.Risk_Status === 'At risk' || row.Risk_Status === 'Slipping') group.atRiskCustomers += 1;
      if (row.Risk_Status === 'Slipping') group.slippingCustomers += 1;
      if (row.Risk_Status === 'Lost') group.lostCustomers += 1;
      if (row.assignmentType === 'retained historical') group.retainedHistoricalCustomers += 1;
      group.currentStatuses.add(Boolean(row.currentPrimaryStillFitted));
      riskGroups.set(key, group);
    });
    // An unoccupied fuzzy centre still belongs in the current cycle's K.
    if (!allCycles) clusterRegistryService.getRegistry(cycle).forEach((cluster) => {
      const key = `${cluster.stableClusterId}:${cluster.displayLabel}`;
      if (!riskGroups.has(key)) riskGroups.set(key, {
        segment: cluster.displayLabel, stableClusterId: cluster.stableClusterId,
        labelOrder: cluster.labelOrder, customers: 0, assessedCustomers: 0,
        atRiskCustomers: 0, slippingCustomers: 0, lostCustomers: 0,
        retainedHistoricalCustomers: 0, currentStatuses: new Set([true]),
      });
    });
    const riskByCluster = [...riskGroups.values()].map((group, _, groups) => {
      const { currentStatuses, ...values } = group;
      const repeatedLabel = groups.some((other) => other !== group && other.segment === group.segment);
      return {
        ...values,
        segment: repeatedLabel ? `${group.segment} (${group.stableClusterId})` : group.segment,
        currentPrimaryStillFitted: currentStatuses.size === 1 ? [...currentStatuses][0] : null,
        atRiskRate: group.assessedCustomers ? group.atRiskCustomers / group.assessedCustomers : null,
      };
    }).sort((left, right) => left.labelOrder - right.labelOrder || left.stableClusterId.localeCompare(right.stableClusterId));
    return {
      latestCycle, cycle, observationUnit: allCycles ? 'customer-cycle observations' : 'customers',
      summary, valueBands, confidenceBands, topCustomers, segmentValue, riskBySegment, riskByCluster,
      fittedClusterCount: allCycles ? null : clusterRegistryService.getRegistry(cycle).length,
      clusterCounts: clusterRegistryService.getCounts(allCycles ? undefined : cycle),
      riskMethod: String(repository.runAggregate(`
        SELECT MetadataValue FROM Model_Metadata WHERE MetadataKey = 'CustomerRiskPolicy'
      `).MetadataValue ?? "Risk labels use observed purchasing and membership changes. Rates use assessed observations only; they are not churn probabilities."),
    };
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
      ORDER BY ${profileOrderSql("Segment_Name")}
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
      ORDER BY ${profileOrderSql("segment")}, rank
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
        Loyalists_Share AS loyalistsShare,
        Mid_Tier_Occasionals_Share AS midTierOccasionalsShare,
        Developing_Share AS developingShare,
        Hibernating_Lost_Share AS hibernatingLostShare,
        At_Risk_Share AS atRiskShare
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
        Loyalists_Share * 100 AS Loyalists,
        Mid_Tier_Occasionals_Share * 100 AS 'Mid-Tier Occasionals',
        Developing_Share * 100 AS "Light Buyers",
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
      clusterCount: toNumber(repository.runAggregate(`
        SELECT COUNT(DISTINCT Geographic_Cluster_Number) AS clusters
        FROM Geographic_Segmentation WHERE CycleID = @latestCycle
      `, { latestCycle }).clusters),
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
      ORDER BY ${profileOrderSql("Segment_Name")}, customers DESC
    `, { latestCycle });
    const matrix = repository.runMany(`
      SELECT
        Geographic_Segment_Name AS geographicSegment,
        Segment_Name AS behaviouralSegment,
        COUNT(*) AS customers
      FROM Firmographic_Customer_Segmentation
      WHERE CycleID = @latestCycle
      GROUP BY Geographic_Segment_Name, Segment_Name
      ORDER BY Geographic_Segment_Name, ${profileOrderSql("Segment_Name")}
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

}
