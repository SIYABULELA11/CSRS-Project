import { z } from "zod";
import { DataRepository } from "../repositories/dataRepository";
import { Paginated } from "../types/common";
import { ClusterRegistryService } from "./clusterRegistryService";
import { SchemaRepository } from "../repositories/schemaRepository";

const repository = new DataRepository();
const clusterRegistryService = new ClusterRegistryService();
const preprocessingColumns = new Set(new SchemaRepository().getTableColumns("Data_Preprocessing_Results"));
export const commercialFeatureSql = {
  orders: preprocessingColumns.has("Current_Period_Orders") ? "features.Current_Period_Orders" : "features.Frequency * features.Frequency_Monetary_Period_Months",
  products: preprocessingColumns.has("Current_Period_Products") ? "features.Current_Period_Products" : "features.Products * features.Frequency_Monetary_Period_Months",
  quantity: preprocessingColumns.has("Current_Period_Quantity") ? "features.Current_Period_Quantity" : "features.Quantity * features.Frequency_Monetary_Period_Months",
  revenue: preprocessingColumns.has("Current_Period_Revenue") ? "features.Current_Period_Revenue" : "features.Monetary * features.Frequency_Monetary_Period_Months",
};

export const customerSummaryCte = `
  WITH customer_summary AS (
    SELECT
      CycleID,
      CustomerID,
      Stable_Cluster_ID,
      Cluster_Local_Index,
      Segment_Name,
      Activity_Status,
      Assignment_Mode,
      Orders,
      Products,
      Quantity,
      Revenue,
      Average_Membership,
      Migration_Status,
      Transition_Status,
      Average_Basket_Value,
      Risk_Status,
      Risk_Reasons,
      Membership_Change,
      Frequency_Change_Ratio,
      Monetary_Change_Ratio
    FROM Dynamic_Customer_Summary
    UNION ALL
    SELECT
      'Cycle_0' AS CycleID,
      baseline.CustomerID,
      baseline.Stable_Cluster_ID,
      baseline.Cluster_Local_Index,
      baseline.Segment_Name,
      features.Activity_Status,
      'Cycle 0 baseline fit' AS Assignment_Mode,
      ${commercialFeatureSql.orders} AS Orders,
      ${commercialFeatureSql.products} AS Products,
      ${commercialFeatureSql.quantity} AS Quantity,
      ${commercialFeatureSql.revenue} AS Revenue,
      1.0 AS Average_Membership,
      'Baseline' AS Migration_Status,
      'Baseline' AS Transition_Status,
      CASE
        WHEN (${commercialFeatureSql.orders}) > 0 THEN (${commercialFeatureSql.revenue}) / (${commercialFeatureSql.orders})
        ELSE 0
      END AS Average_Basket_Value,
      baseline.Risk_Status,
      baseline.Risk_Reasons,
      baseline.Membership_Change,
      baseline.Frequency_Change_Ratio,
      baseline.Monetary_Change_Ratio
    FROM Time_Cycle_0_Segmentation baseline
    JOIN Data_Preprocessing_Results features
      ON features.CustomerID = baseline.CustomerID
      AND features.CycleID = 'Cycle_0'
  )
`;

const customerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().default("Revenue"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().optional(),
  segment: z.string().optional(),
  cycle: z.string().optional(),
  country: z.string().optional(),
  customerId: z.string().optional(),
  risk: z.string().optional(),
  cluster: z.string().optional(),
});

export type CustomerQuery = z.infer<typeof customerQuerySchema>;

export class CustomerService {
  parseQuery(input: unknown): CustomerQuery {
    return customerQuerySchema.parse(input);
  }

  getCustomers(queryRaw: unknown): Paginated<Record<string, unknown>> & { cycle: string } {
    const query = this.parseQuery(queryRaw);
    const latestCycleRow = repository.runAggregate(`
      SELECT CycleID
      FROM Dynamic_Cycle_Summary
      ORDER BY CAST(REPLACE(CycleID, 'Cycle_', '') AS INTEGER) DESC
      LIMIT 1
    `);
    const cycle = query.cycle ?? String(latestCycleRow.CycleID ?? "Cycle_9");
    const allCycles = cycle.toLowerCase() === "all";
    const where = allCycles ? [] : ["summary.CycleID = @cycle"];
    const params: Record<string, unknown> = allCycles ? {} : { cycle };

    if (query.q) {
      where.push("(CAST(summary.CustomerID AS TEXT) LIKE @q OR customer.Country LIKE @q)");
      params.q = `%${query.q}%`;
    }
    if (query.customerId) {
      where.push("CAST(summary.CustomerID AS TEXT) = @customerId");
      params.customerId = query.customerId;
    }
    if (query.country) {
      where.push("customer.Country = @country");
      params.country = query.country;
    }
    if (query.segment) {
      where.push("summary.Segment_Name = @segment");
      params.segment = query.segment;
    }
    if (query.risk) {
      where.push("summary.Risk_Status = @risk");
      params.risk = query.risk;
    }
    if (query.cluster) {
      where.push("summary.Stable_Cluster_ID = @cluster");
      params.cluster = query.cluster;
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sortMap: Record<string, string> = {
      CustomerID: "summary.CustomerID",
      Country: "customer.Country",
      CycleID: "CAST(REPLACE(summary.CycleID, 'Cycle_', '') AS INTEGER)",
      Segment_Name: "summary.Segment_Name",
      Orders: "summary.Orders",
      Products: "summary.Products",
      Quantity: "summary.Quantity",
      Revenue: "summary.Revenue",
      Average_Membership: "summary.Average_Membership",
      Average_Basket_Value: "summary.Average_Basket_Value",
      Risk_Status: "summary.Risk_Status",
    };
    const sortBy = sortMap[query.sortBy] ?? "summary.Revenue";
    const sortOrder = query.sortOrder.toUpperCase();

    const totalRow = repository.runAggregate(`
      ${customerSummaryCte}
      SELECT COUNT(*) AS total
      FROM customer_summary summary
      LEFT JOIN Customer customer ON customer.CustomerID = summary.CustomerID
      ${whereClause}
    `, params);
    const total = Number(totalRow.total ?? 0);
    const offset = (query.page - 1) * query.pageSize;

    const data = repository.runMany(`
      ${customerSummaryCte}
      SELECT
        summary.CustomerID,
        customer.Country,
        summary.CycleID,
        summary.Segment_Name,
        summary.Stable_Cluster_ID,
        summary.Activity_Status,
        summary.Assignment_Mode,
        summary.Orders,
        summary.Products,
        summary.Quantity,
        summary.Revenue,
        summary.Average_Membership,
        summary.Migration_Status,
        summary.Average_Basket_Value,
        summary.Risk_Status,
        summary.Risk_Reasons,
        summary.Membership_Change,
        summary.Frequency_Change_Ratio,
        summary.Monetary_Change_Ratio
        ,features.Recency, features.Lifecycle_Status
      FROM customer_summary summary
      LEFT JOIN Customer customer ON customer.CustomerID = summary.CustomerID
      LEFT JOIN Data_Preprocessing_Results features
        ON features.CustomerID = summary.CustomerID AND features.CycleID = summary.CycleID
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder},
        CAST(REPLACE(summary.CycleID, 'Cycle_', '') AS INTEGER), summary.CustomerID
      LIMIT @limit OFFSET @offset
    `, { ...params, limit: query.pageSize, offset });

    return {
      cycle,
      data: clusterRegistryService.addAssignmentMetadata(data),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize) || 1,
      },
    };
  }

  getCustomerProfile(customerId: string): Record<string, unknown> | null {
    const customer = repository.findById("Customer", "CustomerID", customerId);
    if (!customer) return null;

    const history = repository.runMany(`
      ${customerSummaryCte}
      SELECT
        summary.*,
        features.Recency,
        features.Lifecycle_Status,
        features.Frequency,
        features.Monetary,
        ${commercialFeatureSql.products} AS UniqueProducts,
        ${commercialFeatureSql.quantity} AS NetQuantity,
        COALESCE(dynamic.Fuzzy_Membership_Details, baseline.Fuzzy_Membership_Details) AS Membership_Details,
        COALESCE(dynamic.All_Fuzzy_Memberships, baseline.All_Fuzzy_Memberships) AS All_Memberships,
        dynamic.Previous_Stable_Cluster_ID,
        dynamic.Previous_Segment_Name,
        dynamic.PreviousCycleID,
        transition.Migration_Cause,
        transition.Feature_Displacement
      FROM customer_summary summary
      LEFT JOIN Data_Preprocessing_Results features
        ON features.CustomerID = summary.CustomerID
        AND features.CycleID = summary.CycleID
      LEFT JOIN Dynamic_Loop_Results dynamic
        ON dynamic.CustomerID = summary.CustomerID
        AND dynamic.CycleID = summary.CycleID
      LEFT JOIN Customer_Transitions transition
        ON transition.CustomerID = summary.CustomerID
        AND transition.CycleID = summary.CycleID
      LEFT JOIN Time_Cycle_0_Segmentation baseline
        ON baseline.CustomerID = summary.CustomerID
        AND summary.CycleID = 'Cycle_0'
      WHERE summary.CustomerID = @customerId
      ORDER BY CAST(REPLACE(summary.CycleID, 'Cycle_', '') AS INTEGER)
    `, { customerId });

    const topProducts = repository.runMany(`
      SELECT
        Description AS product,
        SUM(Quantity) AS quantity,
        SUM(Revenue) AS revenue,
        COUNT(DISTINCT InvoiceNo) AS orders
      FROM Dynamic_Business_Analytics
      WHERE CustomerID = @customerId
      GROUP BY Description
      ORDER BY revenue DESC
      LIMIT 10
    `, { customerId });

    return { customer, history: clusterRegistryService.addAssignmentMetadata(history), topProducts };
  }
}
