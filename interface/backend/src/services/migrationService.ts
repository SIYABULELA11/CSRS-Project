import { getCached } from "../utils/cache";
import { DataRepository } from "../repositories/dataRepository";

const repository = new DataRepository();

const segmentRank = (segment: string): number => {
  if (segment === "Champions") return 4;
  if (segment === "Core Loyalists") return 3;
  if (segment === "Mid-Tier Occasionals") return 2;
  if (segment === "Hibernating / Lost") return 1;
  return 0;
};

export class MigrationService {
  async getMigration(): Promise<Record<string, unknown>> {
    return getCached("migration:summary:v4", async () => {
      const transitionMatrix = repository.runMany(`
        SELECT
          Previous_Segment_Name AS fromSegment,
          Segment_Name AS toSegment,
          COUNT(*) AS count
        FROM Customer_Transitions
        WHERE Transition_Status IN ('Existing Stable', 'Existing Migrated')
        GROUP BY Previous_Segment_Name, Segment_Name
        ORDER BY count DESC
      `);

      const migrationStatistics = repository.runAggregate(`
        SELECT
          SUM(CASE WHEN Transition_Status = 'Existing Migrated' THEN 1 ELSE 0 END) AS migrated,
          SUM(CASE WHEN Transition_Status = 'Existing Stable' THEN 1 ELSE 0 END) AS stable,
          COUNT(*) AS total,
          AVG(CASE WHEN Transition_Status = 'Existing Migrated' THEN 1.0 ELSE 0.0 END) AS migrationRate
        FROM Customer_Transitions
        WHERE Transition_Status IN ('Existing Stable', 'Existing Migrated')
      `);

      const transitionStateTotals = repository.runMany(`
        SELECT Transition_Status AS state, COUNT(*) AS customers
        FROM Customer_Transitions
        GROUP BY Transition_Status
        ORDER BY customers DESC
      `);

      const dynamicTransitionStateEvolution = repository.runMany(`
        SELECT CycleID, Transition_Status AS state, COUNT(*) AS customers
        FROM Customer_Transitions
        GROUP BY CycleID, Transition_Status
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), Transition_Status
      `);
      const baselineCount = Number(repository.runAggregate(`
        SELECT COUNT(*) AS customers FROM Time_Cycle_0_Segmentation
      `).customers ?? 0);
      const transitionStateEvolution = [
        { CycleID: "Cycle_0", state: "New", customers: baselineCount },
        ...dynamicTransitionStateEvolution,
      ];

      const directional = transitionMatrix.reduce<{ positive: number; negative: number }>(
        (totals, row) => {
          const fromSegment = String(row.fromSegment);
          const toSegment = String(row.toSegment);
          const count = Number(row.count ?? 0);
          const fromRank = segmentRank(fromSegment);
          const toRank = segmentRank(toSegment);
          if (fromRank > 0 && toRank > fromRank) totals.positive += count;
          if (fromRank > 0 && toRank < fromRank) totals.negative += count;
          return totals;
        },
        { positive: 0, negative: 0 },
      );

      const dynamicCycleMigration = repository.runMany(`
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
          AverageMembership
        FROM Dynamic_Cycle_Summary
        ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
      `);
      const cycleMigration = [
        {
          CycleID: "Cycle_0",
          CustomersProcessed: baselineCount,
          ActiveCustomers: baselineCount,
          InactiveCustomers: 0,
          NewCustomers: baselineCount,
          ReactivatedCustomers: 0,
          StableCustomers: 0,
          MigratedCustomers: 0,
          ComparableCustomers: 0,
          MigrationRate: null,
          AverageMembership: 1,
        },
        ...dynamicCycleMigration,
      ];

      return {
        transitionMatrix,
        topFlows: transitionMatrix.slice(0, 10),
        migrationStatistics,
        transitionStateTotals,
        transitionStateEvolution,
        positiveMigrationCount: directional.positive,
        negativeMigrationCount: directional.negative,
        cycleMigration,
      };
    });
  }

  getCycles(): Record<string, unknown> {
    const cycles = repository.runMany(`
      SELECT *
      FROM Dynamic_Cycle_Summary
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
    `);

    const segments = repository.runMany(`
      SELECT *
      FROM Dynamic_Segment_Summary
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER), Segment_Name
    `);

    const baseline = repository.runMany(`
      SELECT
        'Cycle_0' AS CycleID,
        Segment_Name,
        COUNT(*) AS Customers
      FROM Time_Cycle_0_Segmentation
      GROUP BY Segment_Name
      ORDER BY Segment_Name
    `);

    return { cycles, segments: [...baseline, ...segments] };
  }
}
