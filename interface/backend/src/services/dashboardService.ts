import { getCached } from "../utils/cache";
import { DataRepository } from "../repositories/dataRepository";
import { AnalyticsService } from "./analyticsService";

const repository = new DataRepository();
const analyticsService = new AnalyticsService();

export class DashboardService {
  async getOverview(): Promise<Record<string, unknown>> {
    return getCached("dashboard:overview:v2", async () => {
      const totals = repository.runAggregate(`
        SELECT
          (SELECT COUNT(DISTINCT CustomerID) FROM Customer) AS totalCustomers,
          (SELECT COUNT(DISTINCT CustomerID) FROM Dynamic_Customer_Summary) AS analysedCustomers,
          (SELECT COUNT(DISTINCT Country) FROM Customer WHERE Country IS NOT NULL) AS countries,
          (SELECT COUNT(DISTINCT Description) FROM Dynamic_Product_Summary) AS products,
          (SELECT COUNT(DISTINCT InvoiceNo) FROM Dynamic_Business_Analytics) AS orders,
          (SELECT SUM(Revenue) FROM Dynamic_Business_Analytics) AS totalRevenue,
          (SELECT AVG(Average_Basket_Value) FROM Dynamic_Customer_Summary) AS averageBasketValue,
          (SELECT AVG(Average_Membership) FROM Dynamic_Customer_Summary) AS averageMembership,
          (SELECT AVG(MigrationRate) FROM Dynamic_Cycle_Summary) AS averageMigrationRate,
          (SELECT COUNT(DISTINCT Segment_Name) FROM Dynamic_Segment_Summary) AS numberOfSegments,
          (SELECT COUNT(*) + 1 FROM Dynamic_Cycle_Summary) AS numberOfCycles
      `);

      const latestCycle = repository.runAggregate(`
        SELECT *
        FROM Dynamic_Cycle_Summary
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER) DESC
        LIMIT 1
      `);

      const latestSegments = repository.runMany(`
        SELECT *
        FROM Dynamic_Segment_Summary
        WHERE CycleID = @cycleId
        ORDER BY Revenue DESC
      `, { cycleId: latestCycle.CycleID });

      const revenueByCycle = repository.runMany(`
        SELECT
          CycleID,
          SUM(Revenue) AS Revenue,
          SUM(Customers) AS Customers,
          SUM(Orders) AS Orders
        FROM Dynamic_Segment_Summary
        GROUP BY CycleID
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
      `);

      return {
        ...totals,
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
