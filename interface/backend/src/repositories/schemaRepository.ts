import { db } from "../database/client";

export interface TableSchema {
  table: string;
  columns: string[];
}

export class SchemaRepository {
  getTables(): string[] {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;

    return rows.map((r) => r.name);
  }

  getTableColumns(table: string): string[] {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  getAllSchemas(): TableSchema[] {
    return this.getTables().map((table) => ({
      table,
      columns: this.getTableColumns(table),
    }));
  }
}
