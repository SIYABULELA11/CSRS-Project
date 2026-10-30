import { profileOrderSql } from "../utils/clusterProfiles";
import { getCached } from "../utils/cache";
import { DataRepository } from "../repositories/dataRepository";
import { AnalyticsService } from "./analyticsService";
import { customerSummaryCte } from "./customerService";
import { ClusterRegistryService } from "./clusterRegistryService";

const repository = new DataRepository();
const analyticsService = new AnalyticsService();
const clusterRegistryService = new ClusterRegistryService();

export class DashboardService {
  async getOverview(): Promise<Record<string, unknown>> {
    return getCached("dashboard:overview:v3", async () => {
      const totals = repository.runAggregate(`
        ${customerSummaryCte}
        SELECT
          (SELECT COUNT(DISTINCT CustomerID) FROM Customer) AS totalCustomers,
          (SELECT COUNT(DISTINCT CustomerID) FROM Dynamic_Customer_Summary) AS analysedCustomers,
          (SELECT COUNT(DISTINCT Country) FROM Customer WHERE Country IS NOT NULL) AS countries,
          (SELECT COUNT(DISTINCT Description) FROM Dynamic_Product_Summary) AS products,
          (SELECT SUM(Orders) FROM customer_summary) AS orders,
          (SELECT SUM(Revenue) FROM customer_summary) AS totalRevenue,
          (SELECT AVG(Average_Basket_Value) FROM customer_summary) AS averageBasketValue,
          (SELECT AverageMembership
            FROM Dynamic_Cycle_Summary
            ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER) DESC
            LIMIT 1) AS averageMembership,
          (SELECT AVG(MigrationRate) FROM Dynamic_Cycle_Summary) AS averageMigrationRate,
          (SELECT COUNT(DISTINCT Segment_Name) FROM Dynamic_Customer_Summary) AS numberOfSegments,
          (SELECT COUNT(DISTINCT Segment_Name) FROM Dynamic_Customer_Summary) AS numberOfDisplayLabels,
          (SELECT COUNT(*) + 1 FROM Dynamic_Cycle_Summary) AS numberOfCycles
      `);

      const latestCycle = repository.runAggregate(`
        SELECT *
        FROM Dynamic_Cycle_Summary
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER) DESC
        LIMIT 1
      `);

      const latestSegments = repository.runMany(`
        SELECT
          CycleID,
          Segment_Name,
          SUM(Customers) AS Customers,
          SUM(Orders) AS Orders,
          SUM(Quantity) AS Quantity,
          SUM(Revenue) AS Revenue,
          SUM(Average_Membership * Customers) / NULLIF(SUM(Customers), 0) AS Average_Membership,
          SUM(Revenue) / NULLIF(SUM(Orders), 0) AS Average_Order_Value,
          SUM(Revenue) / NULLIF(SUM(Customers), 0) AS Revenue_Per_Customer
        FROM Dynamic_Segment_Summary
        WHERE CycleID = @cycleId
        GROUP BY CycleID, Segment_Name
        ORDER BY ${profileOrderSql("Segment_Name")}
      `, { cycleId: latestCycle.CycleID });

      const revenueByCycle = repository.runMany(`
        ${customerSummaryCte}
        SELECT
          summary.CycleID,
          SUM(summary.Revenue) AS Revenue,
          COUNT(*) AS Customers,
          SUM(summary.Orders) AS Orders,
          CASE WHEN summary.CycleID = 'Cycle_0' THEN 3 ELSE 1 END AS PeriodMonths
        FROM customer_summary summary
        JOIN Data_Preprocessing_Results features
          ON features.CycleID = summary.CycleID AND features.CustomerID = summary.CustomerID
        GROUP BY summary.CycleID
        ORDER BY CAST(REPLACE(summary.CycleID, 'Cycle_', '') AS INTEGER)
      `);

      return {
        ...totals,
        numberOfSegments: clusterRegistryService.getRegistry(String(latestCycle.CycleID)).length,
        fittedClusterCount: clusterRegistryService.getRegistry(String(latestCycle.CycleID)).length,
        businessGroupCount: latestSegments.length,
        clusterRegistry: clusterRegistryService.getRegistry(String(latestCycle.CycleID)),
        clusterCounts: clusterRegistryService.getCounts(),
        financialScope: 'Cycle 0 through Cycle 9: 1 December 2010 to 30 November 2011. Cycle 0 spans three months; later cycles each span one month.',
        averageBasketScope: 'Mean customer-cycle basket value across Cycles 0–9, including zero for no current orders.',
        productScope: 'Distinct product descriptions purchased in dynamic Cycles 1–9 (March–November 2011).',
        latestCycle,
        latestSegments,
        revenueByCycle,
      };
    });
  }

  async getModelEvaluation(): Promise<Record<string, unknown>> {
    return getCached("model:evaluation:v2", async () => analyticsService.getModelEvaluationDetailed());
  }
}
