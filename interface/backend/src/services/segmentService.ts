import { baseProfile, profileOrderSql } from "../utils/clusterProfiles";
import { getCached } from "../utils/cache";
import { DataRepository } from "../repositories/dataRepository";
import { ClusterRegistryService } from "./clusterRegistryService";
import { commercialFeatureSql } from "./customerService";

const repository = new DataRepository();
const clusterRegistryService = new ClusterRegistryService();

const segmentDescriptions: Record<string, string> = {
  Champions: "The freshest high-value repeat-purchase profile.",
  "High-Value Regulars": "Strong repeat purchasing and spending with a slightly longer purchase gap than the freshest Champions profile.",
  Loyalists: "A recent, moderate-value repeat-purchase profile.",
  "Valuable Customers at Risk": "Meaningful rolling-window purchasing value with a longer purchase gap. The name does not establish a previous Loyalists assignment.",
  "Mid-Tier Occasionals": "Recent purchasers with moderate spending and less frequent ordering than the strongest repeat-purchase profiles.",
  "Occasional Buyers at Risk": "Infrequent purchasing with a substantial purchase gap.",
  "Light Buyers": "Relatively low-frequency, lower-spending customers who purchased recently. Growth is not assumed.",
  "Light Buyers at Risk": "A light purchasing profile with a longer purchase gap.",
  "Hibernating / Lost": "Predominantly customers without purchases for more than 90 days. Individual purchase-gap status remains visible separately.",
};

const segmentRecommendations: Record<string, string[]> = {
  Champions: [
    "Protect value with recognition-led loyalty benefits.",
    "Use early access and premium bundles instead of broad discounts.",
    "Monitor confidence declines for early signs of migration.",
  ],
  Loyalists: [
    "Reward purchase consistency with milestone-based offers.",
    "Cross-sell adjacent products using segment affinity data.",
    "Encourage progression into the Champions segment.",
  ],
  "Mid-Tier Occasionals": [
    "Use replenishment reminders and time-sensitive bundles.",
    "Target the most responsive categories by customer history.",
    "Increase order frequency before increasing discount depth.",
  ],
  "Light Buyers": [
    "Help customers establish a repeat purchasing habit with relevant follow-up offers.",
    "Compare their purchase history before selecting replenishment reminders.",
    "Review the separate risk label when purchasing activity declines.",
  ],
  "Hibernating / Lost": [
    "Prioritise customers with historically high revenue.",
    "Run low-cost win-back tests before expensive incentives.",
    "Suppress consistently unresponsive customers from high-frequency campaigns.",
  ],
};

export class SegmentService {
  async getSegments(): Promise<Record<string, unknown>> {
    return getCached("segments:all:v3", async () => {
      const latestCycleRow = repository.runAggregate(`
        SELECT CycleID
        FROM Dynamic_Cycle_Summary
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER) DESC
        LIMIT 1
      `);
      const latestCycle = String(latestCycleRow.CycleID ?? "Cycle_9");

      const summaries = repository.runMany(`
        SELECT
          totals.Segment_Name AS segment,
          totals.customerCount,
          totals.orders,
          totals.quantity,
          totals.revenue,
          totals.averageOrderValue,
          totals.averageMembership,
          totals.revenuePerCustomer,
          profiles.avgRecency,
          profiles.avgFrequency,
          profiles.avgMonetary
        FROM (
          SELECT
            CycleID,
            Segment_Name,
            SUM(Customers) AS customerCount,
            SUM(Orders) AS orders,
            SUM(Quantity) AS quantity,
            SUM(Revenue) AS revenue,
            SUM(Revenue) / NULLIF(SUM(Orders), 0) AS averageOrderValue,
            SUM(Average_Membership * Customers) / NULLIF(SUM(Customers), 0) AS averageMembership,
            SUM(Revenue) / NULLIF(SUM(Customers), 0) AS revenuePerCustomer
          FROM Dynamic_Segment_Summary
          WHERE CycleID = @latestCycle
          GROUP BY CycleID, Segment_Name
        ) totals
        LEFT JOIN (
          SELECT
            results.CycleID,
            results.Segment_Name,
            AVG(features.Recency) AS avgRecency,
            AVG(features.Frequency) AS avgFrequency,
            AVG(features.Monetary) AS avgMonetary
          FROM Dynamic_Loop_Results results
          JOIN Data_Preprocessing_Results features
            ON features.CustomerID = results.CustomerID
            AND features.CycleID = results.CycleID
          WHERE results.CycleID = @latestCycle
          GROUP BY results.CycleID, results.Segment_Name
        ) profiles
          ON profiles.CycleID = @latestCycle
          AND profiles.Segment_Name = totals.Segment_Name
        ORDER BY ${profileOrderSql("totals.Segment_Name")}
      `, { latestCycle });

      const lifetimeRows = repository.runMany(`
        SELECT
          Segment_Name AS segment,
          COUNT(DISTINCT CustomerID) AS uniqueCustomers,
          SUM(Revenue) AS totalRevenue,
          SUM(Orders) AS totalOrders
        FROM Dynamic_Customer_Summary
        GROUP BY Segment_Name
      `);
      const lifetimeBySegment = new Map(
        lifetimeRows.map((row) => [String(row.segment), row]),
      );

      const segments = summaries.map((summary) => ({
        ...summary,
        ...lifetimeBySegment.get(String(summary.segment)),
        description: segmentDescriptions[String(summary.segment)] ?? "Customer group summarized from its observed recency, purchase frequency, paid-sales value, and fuzzy membership in this cycle.",
        recommendations: segmentRecommendations[String(summary.segment)] ?? [],
      }));

      const trends = repository.runMany(`
        SELECT * FROM (
          SELECT
            'Cycle_0' AS CycleID,
            baseline.Segment_Name AS segment,
            COUNT(*) AS customers,
            SUM(${commercialFeatureSql.revenue}) AS revenue,
            NULL AS averageMembership,
            AVG(${commercialFeatureSql.revenue}) AS revenuePerCustomer
          FROM Time_Cycle_0_Segmentation baseline
          JOIN Data_Preprocessing_Results features
            ON features.CustomerID = baseline.CustomerID
            AND features.CycleID = 'Cycle_0'
          GROUP BY baseline.Segment_Name
          UNION ALL
          SELECT
            CycleID,
            Segment_Name AS segment,
            SUM(Customers) AS customers,
            SUM(Revenue) AS revenue,
            SUM(Average_Membership * Customers) / NULLIF(SUM(Customers), 0) AS averageMembership,
            SUM(Revenue) / NULLIF(SUM(Customers), 0) AS revenuePerCustomer
          FROM Dynamic_Segment_Summary
          GROUP BY CycleID, Segment_Name
        )
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), ${profileOrderSql("segment")}
      `);

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
          COUNT(*) AS customerCount,
          AVG(features.Recency) AS avgRecency,
          AVG(features.Frequency) AS avgFrequency,
          AVG(features.Monetary) AS avgMonetary,
          AVG(features.RF_Score) AS avgRF,
          AVG(features.RM_Score) AS avgRM,
          AVG(features.FM_Score) AS avgFM,
          SUM(${commercialFeatureSql.revenue}) AS revenue,
          AVG(${commercialFeatureSql.revenue}) AS revenuePerCustomer,
          AVG(CASE WHEN labels.CycleID <> 'Cycle_0' THEN labels.membership END) AS averageMembership
        FROM labels
        JOIN Data_Preprocessing_Results features
          ON features.CustomerID = labels.CustomerID
          AND features.CycleID = labels.CycleID
        GROUP BY labels.CycleID, labels.segment
        ORDER BY CAST(REPLACE(labels.CycleID, 'Cycle_', '') AS INTEGER), ${profileOrderSql("labels.segment")}
      `);

      return {
        latestCycle, segments, trends, profiles,
        clusterRegistry: clusterRegistryService.getRegistry(latestCycle),
        clusterCounts: clusterRegistryService.getCounts(),
        fittedClusterCount: clusterRegistryService.getRegistry(latestCycle).length,
        businessGroupCount: segments.length,
      };
    });
  }

  async getSegmentByName(segment: string): Promise<Record<string, unknown> | null> {
    const payload = await this.getSegments();
    const segments = payload.segments as Record<string, unknown>[];
    const selected = segments.find((row) => String(row.segment) === segment);
    if (!selected) return null;

    const history = (payload.trends as Record<string, unknown>[])
      .filter((row) => String(row.segment) === segment);

    const topProducts = repository.runMany(`
      SELECT
        Description AS product,
        SUM(Revenue) AS revenue,
        SUM(Quantity_Sold) AS quantity,
        SUM(Customer_Count) AS customerCount
      FROM Dynamic_Product_Summary
      WHERE Segment_Name = @segment
      GROUP BY Description
      ORDER BY revenue DESC
      LIMIT 10
    `, { segment });

    const countries = repository.runMany(`
      SELECT
        Country AS country,
        COUNT(DISTINCT CustomerID) AS customers,
        SUM(Revenue) AS revenue
      FROM Dynamic_Business_Analytics
      WHERE Segment_Name = @segment
      GROUP BY Country
      ORDER BY revenue DESC
      LIMIT 10
    `, { segment });

    return { ...selected, history, topProducts, countries };
  }

  async getRecommendations(segment: string): Promise<Record<string, unknown>> {
    const metrics = await this.getSegmentByName(segment);
    return {
      segment,
      description: segmentDescriptions[segment] ?? "Dynamic customer segment.",
      recommendedActions: segmentRecommendations[segment] ?? [],
      metrics,
    };
  }
}
