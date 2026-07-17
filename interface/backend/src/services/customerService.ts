import { z } from "zod";
import { DataRepository } from "../repositories/dataRepository";
import { Paginated } from "../types/common";

const repo = new DataRepository();

const customerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().default("CustomerID"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
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

  getCustomers(queryRaw: unknown): Paginated<Record<string, unknown>> {
    const query = this.parseQuery(queryRaw);

    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.q) {
      where.push("c.CustomerID LIKE @q");
      params.q = `%${query.q}%`;
    }

    if (query.customerId) {
      where.push("c.CustomerID = @customerId");
      params.customerId = query.customerId;
    }

    if (query.country) {
      where.push("c.Country = @country");
      params.country = query.country;
    }

    if (query.segment) {
      where.push("d.Segment_Name = @segment");
      params.segment = query.segment;
    }

    if (query.cycle) {
      where.push("d.CycleID = @cycle");
      params.cycle = query.cycle;
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sortMap: Record<string, string> = {
      CustomerID: "c.CustomerID",
      Country: "c.Country",
      CycleID: "d.CycleID",
      Segment_Name: "d.Segment_Name",
      Membership_Confidence: "d.Membership_Confidence",
      Recency: "d.Recency",
      Frequency: "d.Frequency",
      Monetary: "d.Monetary",
    };

    const sortBy = sortMap[query.sortBy] ?? "c.CustomerID";
    const sortOrder = query.sortOrder.toUpperCase();

    const totalRow = repo.runAggregate(
      `
      SELECT COUNT(*) as total
      FROM Customer c
      LEFT JOIN Dynamic_Segmentation_Results d ON d.CustomerID = c.CustomerID
      ${whereClause}
      `,
      params,
    );

    const total = Number(totalRow.total ?? 0);
    const offset = (query.page - 1) * query.pageSize;

    const data = repo.runMany(
      `
      SELECT
        c.CustomerID,
        c.Country,
        d.CycleID,
        d.Segment_Name,
        d.Membership_Confidence,
        d.Recency,
        d.Frequency,
        d.Monetary
      FROM Customer c
      LEFT JOIN Dynamic_Segmentation_Results d ON d.CustomerID = c.CustomerID
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT @limit OFFSET @offset
      `,
      {
        ...params,
        limit: query.pageSize,
        offset,
      },
    );

    return {
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
    const customer = repo.findById("Customer", "CustomerID", customerId);
    if (!customer) {
      return null;
    }

    const rfmHistory = repo.runMany(
      "SELECT * FROM Data_Preprocessing_Results WHERE CustomerID = @id ORDER BY CycleID",
      { id: customerId },
    );

    const segmentHistory = repo.runMany(
      "SELECT * FROM Dynamic_Segmentation_Results WHERE CustomerID = @id ORDER BY CycleID",
      { id: customerId },
    );

    const migrationHistory = repo.runMany(
      "SELECT * FROM Segment_Transitions WHERE CustomerID = @id ORDER BY Transition_ID",
      { id: customerId },
    );

    return {
      customer,
      rfmHistory,
      segmentHistory,
      migrationHistory,
      membershipScores: segmentHistory.map((row) => ({
        cycle: row.CycleID,
        confidence: row.Membership_Confidence,
      })),
      availableFields: {
        customer: Object.keys(customer),
        rfmHistory: rfmHistory[0] ? Object.keys(rfmHistory[0]) : [],
        segmentHistory: segmentHistory[0] ? Object.keys(segmentHistory[0]) : [],
        migrationHistory: migrationHistory[0] ? Object.keys(migrationHistory[0]) : [],
      },
    };
  }
}
