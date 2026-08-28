import { z } from "zod";
import { DataRepository } from "../repositories/dataRepository";
import { Paginated } from "../types/common";

const repository = new DataRepository();

const customerSummaryCte = `
  WITH customer_summary AS (
    SELECT
      CycleID,
      CustomerID,
      Segment_Name,
      Orders,
      Products,
      Quantity,
      Revenue,
      Average_Membership,
      Migration_Status,
      Transition_Status,
      Average_Basket_Value
    FROM Dynamic_Customer_Summary
    UNION ALL
    SELECT
      'Cycle_0' AS CycleID,
      baseline.CustomerID,
      baseline.Segment_Name,
      features.Frequency AS Orders,
      features.Products,
      features.Quantity,
      features.Monetary AS Revenue,
      1.0 AS Average_Membership,
      'Baseline' AS Migration_Status,
      'Baseline' AS Transition_Status,
      CASE
        WHEN features.Frequency > 0 THEN features.Monetary / features.Frequency
        ELSE 0
      END AS Average_Basket_Value
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
    const where = ["summary.CycleID = @cycle"];
    const params: Record<string, unknown> = { cycle };

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

    const whereClause = `WHERE ${where.join(" AND ")}`;
    const sortMap: Record<string, string> = {
      CustomerID: "summary.CustomerID",
      Country: "customer.Country",
      CycleID: "summary.CycleID",
      Segment_Name: "summary.Segment_Name",
      Orders: "summary.Orders",
      Products: "summary.Products",
      Quantity: "summary.Quantity",
      Revenue: "summary.Revenue",
      Average_Membership: "summary.Average_Membership",
      Average_Basket_Value: "summary.Average_Basket_Value",
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
        summary.Orders,
        summary.Products,
        summary.Quantity,
        summary.Revenue,
        summary.Average_Membership,
        summary.Migration_Status,
        summary.Average_Basket_Value
      FROM customer_summary summary
      LEFT JOIN Customer customer ON customer.CustomerID = summary.CustomerID
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT @limit OFFSET @offset
    `, { ...params, limit: query.pageSize, offset });

    return {
      cycle,
      data,
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
        features.Frequency,
        features.Monetary
      FROM customer_summary summary
      LEFT JOIN Data_Preprocessing_Results features
        ON features.CustomerID = summary.CustomerID
        AND features.CycleID = summary.CycleID
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

    return { customer, history, topProducts };
  }
}
