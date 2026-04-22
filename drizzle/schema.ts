import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, boolean, decimal } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Products table for storing Jumia product data
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  sku: varchar("sku", { length: 255 }).notNull().unique(),
  name: text("name"),
  brand: varchar("brand", { length: 255 }),
  category: text("category"),
  price: decimal("price", { precision: 12, scale: 2 }),
  oldPrice: decimal("oldPrice", { precision: 12, scale: 2 }),
  discount: varchar("discount", { length: 50 }),
  rating: decimal("rating", { precision: 3, scale: 2 }),
  totalRatings: int("totalRatings"),
  image: text("image"),
  url: text("url"),
  seller: varchar("seller", { length: 255 }),
  isJumiaExpress: boolean("isJumiaExpress").default(false),
  isShopGlobal: boolean("isShopGlobal").default(false),
  stock: varchar("stock", { length: 50 }),
  tags: json("tags"),
  country: varchar("country", { length: 10 }).default("NG"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

// Searches table for tracking user searches
export const searches = mysqlTable("searches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  query: text("query"),
  country: varchar("country", { length: 10 }).default("NG"),
  resultsCount: int("resultsCount").default(0),
  filters: json("filters"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Search = typeof searches.$inferSelect;
export type InsertSearch = typeof searches.$inferInsert;