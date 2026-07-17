import Database from "better-sqlite3";
import { env } from "../config/env";

export const db = new Database(env.databasePath, { readonly: true });
