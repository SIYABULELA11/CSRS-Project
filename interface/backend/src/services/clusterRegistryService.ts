import { DataRepository } from "../repositories/dataRepository";
import { SchemaRepository } from "../repositories/schemaRepository";
import { profileRank } from "../utils/clusterProfiles";

const repository = new DataRepository();
const schemaRepository = new SchemaRepository();
const cycleNumber = (cycle: unknown): number => Number(String(cycle).replace("Cycle_", ""));

export interface FittedCluster {
  [key: string]: unknown;
  CycleID: string;
  cycleId: string;
  localIndex: number;
  stableClusterId: string;
  businessProfile: string;
  displayLabel: string;
  labelOrder: number;
  PC1: number;
  PC2: number;
  PC3: number;
  hardWinnerCustomers: number;
  fuzzyMembershipMass: number;
  weightedRecency: number | null;
  weightedFrequency: number | null;
  weightedMonetary: number | null;
  retainedAssignedCustomers: number;
  isSoftOnly: boolean;
  labelRationale: string;
}

type ClusterStats = {
  winners: number;
  mass: number;
  weightMass: number;
  recency: number;
  frequency: number;
  monetary: number;
  profiles: Map<string, number>;
};

let registryCache: FittedCluster[] | undefined;

/** Fitted centres define the registry, including centres with no hard winners. */
export class ClusterRegistryService {
  getRegistry(cycleId?: string): FittedCluster[] {
    if (!registryCache) registryCache = this.buildRegistry();
    return registryCache.filter((row) => !cycleId || cycleId.toLowerCase() === "all" || row.CycleID === cycleId);
  }

  private buildRegistry(): FittedCluster[] {
    if (schemaRepository.getTables().includes("Current_Cluster_Profiles")) {
      return repository.runMany("SELECT * FROM Current_Cluster_Profiles").map((row) => ({
        ...row, CycleID: String(row.CycleID), cycleId: String(row.CycleID),
        cycleNumber: cycleNumber(row.CycleID), isSoftOnly: Boolean(Number(row.isSoftOnly)),
        localIndex: Number(row.localIndex), stableClusterId: String(row.stableClusterId),
        businessProfile: String(row.businessProfile), displayLabel: String(row.displayLabel),
        labelOrder: Number(row.labelOrder), PC1: Number(row.PC1), PC2: Number(row.PC2), PC3: Number(row.PC3),
        hardWinnerCustomers: Number(row.hardWinnerCustomers), fuzzyMembershipMass: Number(row.fuzzyMembershipMass),
        weightedRecency: row.weightedRecency == null ? null : Number(row.weightedRecency),
        weightedFrequency: row.weightedFrequency == null ? null : Number(row.weightedFrequency),
        weightedMonetary: row.weightedMonetary == null ? null : Number(row.weightedMonetary),
        retainedAssignedCustomers: Number(row.retainedAssignedCustomers), labelRationale: String(row.labelRationale),
      })).sort((a, b) => cycleNumber(a.CycleID) - cycleNumber(b.CycleID) || a.labelOrder - b.labelOrder || a.localIndex - b.localIndex);
    }
    const baseline = repository.runMany(`
      SELECT 'Cycle_0' AS CycleID, CustomerID, Cluster_Local_Index, Stable_Cluster_ID,
        Segment_Name, 'Active' AS Activity_Status, Fuzzy_Membership_Details,
        Recency, Frequency, Monetary, Initial_Centroids
      FROM Time_Cycle_0_Segmentation
    `);
    if (!baseline.length) return [];
    const baselineCentres = JSON.parse(String(baseline[0].Initial_Centroids)) as number[][];
    const baselineIdentity = new Map<number, string>();
    baseline.forEach((row) => baselineIdentity.set(Number(row.Cluster_Local_Index), String(row.Stable_Cluster_ID)));
    const centreRows = [
      ...baselineCentres.map((centre, localIndex) => ({
        CycleID: "Cycle_0", localIndex, stableClusterId: baselineIdentity.get(localIndex),
        PC1: centre[0], PC2: centre[1], PC3: centre[2],
      })),
      ...repository.runMany(`
        SELECT centre.CycleID, centre.ClusterID AS localIndex,
          identity.stableClusterId, centre.PC1, centre.PC2, centre.PC3
        FROM Dynamic_Centroids centre
        LEFT JOIN (
          SELECT CycleID, CurrentLocalCluster, MIN(CurrentStableClusterID) AS stableClusterId
          FROM Cluster_Lineage
          WHERE CurrentLocalCluster IS NOT NULL AND CurrentStableClusterID IS NOT NULL
            AND (IsPrimaryMatch = 1 OR LineageEvent = 'created')
          GROUP BY CycleID, CurrentLocalCluster
        ) identity ON identity.CycleID = centre.CycleID
          AND identity.CurrentLocalCluster = centre.ClusterID
      `),
    ];
    const observations = [
      ...baseline,
      ...repository.runMany(`
        SELECT result.CycleID, result.CustomerID, result.Cluster_Local_Index, result.Stable_Cluster_ID,
          result.Segment_Name, result.Activity_Status, result.Assignment_Mode, result.Fuzzy_Membership_Details,
          features.Recency, features.Frequency, features.Monetary
        FROM Dynamic_Loop_Results result
        JOIN Data_Preprocessing_Results features
          ON features.CycleID = result.CycleID AND features.CustomerID = result.CustomerID
      `),
    ];
    const stats = new Map<string, ClusterStats>();
    const retained = new Map<string, number>();
    observations.forEach((row) => {
      const primaryKey = `${row.CycleID}:${row.Stable_Cluster_ID}`;
      if (row.CycleID !== "Cycle_0" && row.Assignment_Mode !== "Current-cycle fuzzy fit") {
        retained.set(primaryKey, (retained.get(primaryKey) ?? 0) + 1);
        return;
      }
      const details = JSON.parse(String(row.Fuzzy_Membership_Details)) as Record<string, unknown>[];
      details.forEach((detail) => {
        const key = `${row.CycleID}:${detail.stable_cluster_id}`;
        const current = stats.get(key) ?? { winners: 0, mass: 0, weightMass: 0, recency: 0, frequency: 0, monetary: 0, profiles: new Map<string, number>() };
        const weight = Number(detail.membership);
        if (!Number.isFinite(weight) || weight < 0) throw new Error(`Invalid fitted membership for ${key}`);
        current.mass += weight;
        current.weightMass += weight ** 2;
        current.recency += weight ** 2 * Number(row.Recency);
        current.frequency += weight ** 2 * Number(row.Frequency);
        current.monetary += weight ** 2 * Number(row.Monetary);
        const profile = String(detail.segment_name ?? "");
        current.profiles.set(profile, (current.profiles.get(profile) ?? 0) + weight);
        if (String(detail.stable_cluster_id) === String(row.Stable_Cluster_ID)) current.winners += 1;
        stats.set(key, current);
      });
    });
    const registry: FittedCluster[] = centreRows.map((centre) => {
      const cycle = String(centre.CycleID);
      const id = String(centre.stableClusterId ?? "");
      if (!id) throw new Error(`Fitted centre ${cycle}:${centre.localIndex} has no lineage identity`);
      const current = stats.get(`${cycle}:${id}`);
      const profile = current ? [...current.profiles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : "";
      const rank = profileRank(profile);
      return {
        CycleID: cycle, cycleId: cycle, localIndex: Number(centre.localIndex), stableClusterId: id,
        businessProfile: profile || "Unlabelled", displayLabel: profile || id,
        labelOrder: rank,
        PC1: Number(centre.PC1), PC2: Number(centre.PC2), PC3: Number(centre.PC3),
        hardWinnerCustomers: current?.winners ?? 0, fuzzyMembershipMass: current?.mass ?? 0,
        weightedRecency: current?.weightMass ? current.recency / current.weightMass : null,
        weightedFrequency: current?.weightMass ? current.frequency / current.weightMass : null,
        weightedMonetary: current?.weightMass ? current.monetary / current.weightMass : null,
        retainedAssignedCustomers: retained.get(`${cycle}:${id}`) ?? 0,
        isSoftOnly: (current?.winners ?? 0) === 0 && (current?.mass ?? 0) > 0,
        labelRationale: "Current fitted RFM profile. Weighted RFM uses squared fuzzy membership (m=2); Frequency and Monetary are monthly-equivalent rates from the purchase window. Individual purchase-gap and risk fields can differ from the group profile.",
      };
    });
    registry.forEach((row) => {
      if (registry.filter((other) => other.CycleID === row.CycleID && other.businessProfile === row.businessProfile).length > 1) {
        row.displayLabel = `${row.businessProfile} (${row.stableClusterId})`;
        row.labelRationale += " The tracking ID distinguishes separate fitted centres sharing the same current business profile.";
      }
    });
    const expected = repository.runMany(`SELECT CycleID, SelectedK FROM Dynamic_Cycle_Summary`);
    expected.push({ CycleID: "Cycle_0", SelectedK: baselineCentres.length });
    expected.forEach((cycle) => {
      const entries = registry.filter((row) => row.CycleID === cycle.CycleID);
      if (entries.length !== Number(cycle.SelectedK) || new Set(entries.map((row) => row.displayLabel)).size !== entries.length) {
        throw new Error(`Fitted-cluster registry count or labels disagree with ${cycle.CycleID} K=${cycle.SelectedK}`);
      }
    });
    return registry.sort((a, b) => cycleNumber(a.CycleID) - cycleNumber(b.CycleID) || a.labelOrder - b.labelOrder || a.localIndex - b.localIndex);
  }

  getCounts(cycleId?: string): Record<string, unknown>[] {
    const registry = this.getRegistry(cycleId);
    const totals = repository.runMany(`
      SELECT CycleID, SUM(CASE WHEN Activity_Status <> 'Active' THEN 1 ELSE 0 END) AS inactive,
        SUM(CASE WHEN Assignment_Mode LIKE 'Retained%' THEN 1 ELSE 0 END) AS retained
      FROM Dynamic_Loop_Results GROUP BY CycleID
    `);
    return [...new Set(registry.map((row) => row.CycleID))].map((cycle) => {
      const fitted = registry.filter((row) => row.CycleID === cycle);
      const total = totals.find((row) => row.CycleID === cycle);
      const inactive = Number(total?.retained ?? 0);
      return {
        CycleID: cycle, cycleId: cycle, fittedClusterCount: fitted.length,
        occupiedFittedClusterCount: fitted.filter((row) => row.hardWinnerCustomers > 0).length,
        softOnlyClusterCount: fitted.filter((row) => row.isSoftOnly).length,
        businessProfileCount: new Set(fitted.map((row) => row.businessProfile)).size,
        modelFitCustomers: fitted.reduce((sum, row) => sum + row.hardWinnerCustomers, 0),
        retainedInactiveCustomers: inactive,
        purchaseInactiveCustomers: Number(total?.inactive ?? 0),
        retainedWithRetiredPrimaryCustomers: inactive - fitted.reduce((sum, row) => sum + row.retainedAssignedCustomers, 0),
      };
    });
  }

  addAssignmentMetadata(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((row) => String(row.CustomerID)))];
    const params = Object.fromEntries(ids.map((id, index) => [`customer${index}`, id]));
    const placeholders = ids.map((_, index) => `@customer${index}`).join(",");
    const history = repository.runMany(`
      SELECT * FROM (
        SELECT CycleID, CustomerID, Assignment_Mode FROM Dynamic_Loop_Results WHERE CustomerID IN (${placeholders})
        UNION ALL SELECT 'Cycle_0', CustomerID, 'Cycle 0 baseline fit' FROM Time_Cycle_0_Segmentation WHERE CustomerID IN (${placeholders})
      ) history
      ORDER BY CustomerID, CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER)
    `, params);
    const lastFitByCustomer = new Map<string, string>();
    const lastFitByObservation = new Map<string, string | undefined>();
    history.forEach((row) => {
      const id = String(row.CustomerID);
      if (row.CycleID === "Cycle_0" || row.Assignment_Mode === "Current-cycle fuzzy fit") lastFitByCustomer.set(id, String(row.CycleID));
      lastFitByObservation.set(`${row.CycleID}:${id}`, lastFitByCustomer.get(id));
    });
    const registry = new Map(this.getRegistry().map((row) => [`${row.CycleID}:${row.stableClusterId}`, row]));
    return rows.map((row) => {
      const lastFittedCycle = lastFitByObservation.get(`${row.CycleID}:${row.CustomerID}`) ?? null;
      const current = registry.get(`${row.CycleID}:${row.Stable_Cluster_ID}`);
      const assigned = lastFittedCycle ? registry.get(`${lastFittedCycle}:${row.Stable_Cluster_ID}`) : undefined;
      return {
        ...row, lastFittedCycle, assignmentCycle: lastFittedCycle,
        assignmentType: row.CycleID === "Cycle_0" ? "static baseline fit" : row.Assignment_Mode === "Current-cycle fuzzy fit" ? "current fit" : "retained historical",
        currentModelFit: row.CycleID === "Cycle_0" || row.Assignment_Mode === "Current-cycle fuzzy fit",
        currentPrimaryStillFitted: Boolean(current), currentFittedClusterLabel: current?.displayLabel ?? null,
        assignedClusterLabel: assigned?.displayLabel ?? `${String(row.Segment_Name)} (${String(row.Stable_Cluster_ID)})`,
      };
    });
  }
}
