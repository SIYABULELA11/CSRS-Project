import { getCached } from "../utils/cache";
import { DataRepository } from "../repositories/dataRepository";

const repo = new DataRepository();

export class SegmentService {
  async getSegments(): Promise<Record<string, unknown>[]> {
    return getCached("segments:all", async () => {
      return repo.runMany(`
        SELECT
          Segment_Name as segment,
          COUNT(*) as customerCount,
          AVG(Recency) as avgRecency,
          AVG(Frequency) as avgFrequency,
          AVG(Monetary) as avgMonetary,
          AVG(Recency * Frequency) as avgRF,
          AVG(Recency * Monetary) as avgRM,
          AVG(Frequency * Monetary) as avgFM
        FROM Dynamic_Segmentation_Results
        GROUP BY Segment_Name
        ORDER BY customerCount DESC
      `);
    });
  }

  async getSegmentByName(segment: string): Promise<Record<string, unknown> | null> {
    const key = `segments:${segment}`;
    return getCached(key, async () => {
      const summary = repo.runAggregate(
        `
        SELECT
          Segment_Name as segment,
          COUNT(*) as customerCount,
          AVG(Recency) as avgRecency,
          AVG(Frequency) as avgFrequency,
          AVG(Monetary) as avgMonetary,
          AVG(Recency * Frequency) as avgRF,
          AVG(Recency * Monetary) as avgRM,
          AVG(Frequency * Monetary) as avgFM
        FROM Dynamic_Segmentation_Results
        WHERE Segment_Name = @segment
        GROUP BY Segment_Name
      `,
        { segment },
      );

      if (!summary.segment) {
        return null;
      }

      const cycles = repo.runMany(
        `
        SELECT
          CycleID,
          SUM(count) as count
        FROM (
          SELECT
            d.CycleID as CycleID,
            COUNT(*) as count
          FROM Dynamic_Segmentation_Results d
          WHERE d.Segment_Name = @segment
          GROUP BY d.CycleID

          UNION ALL

          SELECT
            'Cycle_0' as CycleID,
            COUNT(*) as count
          FROM Time_Cycle_0_Segmentation t
          WHERE COALESCE(t.Baseline_Segment_Name, 'Baseline Cluster') = @segment
        ) x
        GROUP BY CycleID
        ORDER BY CycleID
        `,
        { segment },
      );

      return {
        ...summary,
        description: `Data-derived segment summary for ${segment}`,
        recommendedActions: [
          "Retarget based on recent purchase behavior",
          "Use cycle-based migration data to personalize campaigns",
          "Prioritize retention for low-frequency subsets",
        ],
        charts: cycles,
      };
    });
  }

  async getRecommendations(segment: string): Promise<Record<string, unknown>> {
    const base = await this.getSegmentByName(segment);
    return {
      segment,
      marketingRecommendations: [
        "Run segment-specific email campaigns",
        "A/B test discount depth by cycle",
      ],
      businessInsights: [
        "Monitor migration in and out of this segment each cycle",
        "Track confidence scores to identify unstable members",
      ],
      retentionStrategy: [
        "Trigger win-back journeys on negative migration",
        "Offer loyalty incentives for high-value customers",
      ],
      crossSellingIdeas: [
        "Promote adjacent product categories from similar customers",
        "Bundle high-frequency items for repeat buyers",
      ],
      metrics: base,
    };
  }
}
