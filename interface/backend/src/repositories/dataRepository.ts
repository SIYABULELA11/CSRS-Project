import { db } from "../database/client";
import { SchemaRepository } from "./schemaRepository";

type QueryFilter = {
  where?: string[];
  params?: Record<string, unknown>;
  orderBy?: string;
  limit?: number;
  offset?: number;
};

export class DataRepository {
  constructor(private readonly schemaRepo = new SchemaRepository()) {}

  private assertTableExists(table: string): void {
    const tableSet = new Set(this.schemaRepo.getTables());
    if (!tableSet.has(table)) {
      throw new Error(`Table not found: ${table}`);
    }
  }

  queryRows(table: string, filter: QueryFilter = {}): Record<string, unknown>[] {
    this.assertTableExists(table);

    const whereClause = filter.where?.length ? `WHERE ${filter.where.join(" AND ")}` : "";
    const orderClause = filter.orderBy ? `ORDER BY ${filter.orderBy}` : "";
    const limitClause = typeof filter.limit === "number" ? "LIMIT @__limit" : "";
    const offsetClause = typeof filter.offset === "number" ? "OFFSET @__offset" : "";

    const sql = `SELECT * FROM ${table} ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`.trim();

    const params = {
      ...(filter.params ?? {}),
      ...(typeof filter.limit === "number" ? { __limit: filter.limit } : {}),
      ...(typeof filter.offset === "number" ? { __offset: filter.offset } : {}),
    };

    return db.prepare(sql).all(params) as Record<string, unknown>[];
  }

  countRows(table: string, filter: QueryFilter = {}): number {
    this.assertTableExists(table);

    const whereClause = filter.where?.length ? `WHERE ${filter.where.join(" AND ")}` : "";
    const sql = `SELECT COUNT(*) as count FROM ${table} ${whereClause}`;
    const row = db.prepare(sql).get(filter.params ?? {}) as { count: number };
    return row.count;
  }

  runAggregate(sql: string, params: Record<string, unknown> = {}): Record<string, unknown> {
    return (db.prepare(sql).get(params) as Record<string, unknown>) ?? {};
  }

  runMany(sql: string, params: Record<string, unknown> = {}): Record<string, unknown>[] {
    return db.prepare(sql).all(params) as Record<string, unknown>[];
  }

  findById(table: string, idColumn: string, id: string): Record<string, unknown> | null {
    this.assertTableExists(table);
    const sql = `SELECT * FROM ${table} WHERE ${idColumn} = @id LIMIT 1`;
    const row = db.prepare(sql).get({ id }) as Record<string, unknown> | undefined;
    return row ?? null;
  }
}
