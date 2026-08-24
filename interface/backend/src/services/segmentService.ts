import { getCached } from "../utils/cache";
import { DataRepository } from "../repositories/dataRepository";

const repository = new DataRepository();

const segmentDescriptions: Record<string, string> = {
  Champions: "Highest-value customers with strong purchase frequency and revenue contribution.",
  "Core Loyalists": "Dependable repeat customers with consistent engagement and strong retention potential.",
  "Mid-Tier Occasionals": "The largest growth pool: intermittent shoppers with clear cross-sell potential.",
  "Hibernating / Lost": "Low-engagement customers requiring carefully targeted reactivation journeys.",
};

const segmentRecommendations: Record<string, string[]> = {
  Champions: [
    "Protect value with recognition-led loyalty benefits.",
    "Use early access and premium bundles instead of broad discounts.",
    "Monitor confidence declines for early signs of migration.",
  ],
  "Core Loyalists": [
    "Reward purchase consistency with milestone-based offers.",
    "Cross-sell adjacent products using segment affinity data.",
    "Encourage progression into the Champions segment.",
  ],
  "Mid-Tier Occasionals": [
    "Use replenishment reminders and time-sensitive bundles.",
    "Target the most responsive categories by customer history.",
    "Increase order frequency before increasing discount depth.",
  ],
  "Hibernating / Lost": [
    "Prioritise customers with historically high revenue.",
    "Run low-cost win-back tests before expensive incentives.",
    "Suppress consistently unresponsive customers from high-frequency campaigns.",
  ],
};

export class SegmentService {
  async getSegments(): Promise<Record<string, unknown>> {
    return getCached("segments:all:v2", async () => {
      const latestCycleRow = repository.runAggregate(`
        SELECT CycleID
        FROM Dynamic_Cycle_Summary
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER) DESC
        LIMIT 1
      `);
      const latestCycle = String(latestCycleRow.CycleID ?? "Cycle_9");

      const summaries = repository.runMany(`
        SELECT
          summary.Segment_Name AS segment,
          summary.Customers AS customerCount,
          summary.Orders AS orders,
          summary.Quantity AS quantity,
          summary.Revenue AS revenue,
          summary.Average_Order_Value AS averageOrderValue,
          summary.Average_Membership AS averageMembership,
          summary.Revenue_Per_Customer AS revenuePerCustomer,
          AVG(features.Recency) AS avgRecency,
          AVG(features.Frequency) AS avgFrequency,
          AVG(features.Monetary) AS avgMonetary
        FROM Dynamic_Segment_Summary summary
        LEFT JOIN Dynamic_Loop_Results results
          ON results.CycleID = summary.CycleID
          AND results.Segment_Name = summary.Segment_Name
        LEFT JOIN Data_Preprocessing_Results features
          ON features.CustomerID = results.CustomerID
          AND features.CycleID = results.CycleID
        WHERE summary.CycleID = @latestCycle
        GROUP BY summary.CycleID, summary.Segment_Name
        ORDER BY summary.Revenue DESC
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
        description: segmentDescriptions[String(summary.segment)] ?? "Customer segment derived from dynamic RFM behaviour.",
        recommendations: segmentRecommendations[String(summary.segment)] ?? [],
      }));

      const trends = repository.runMany(`
        SELECT
          CycleID,
          Segment_Name AS segment,
          Customers AS customers,
          Revenue AS revenue,
          Average_Membership AS averageMembership,
          Revenue_Per_Customer AS revenuePerCustomer
        FROM Dynamic_Segment_Summary
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), Segment_Name
      `);

      return { latestCycle, segments, trends };
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
