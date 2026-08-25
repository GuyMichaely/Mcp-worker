import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateRelayDatabase, RELAY_MIGRATIONS } from "../src/remote/migrations.js";
import { RelayStore } from "../src/remote/store.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

function databasePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-migration-"));
  directories.push(directory);
  return path.join(directory, "relay.sqlite");
}

function versions(db: DatabaseSync): number[] {
  return (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>)
    .map((row) => Number(row.version));
}

describe("relay database migrations", () => {
  it("creates the current schema in order on a fresh database", () => {
    const db = new DatabaseSync(":memory:");
    try {
      migrateRelayDatabase(db, 123);
      expect(versions(db)).toEqual([1, 2]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get()).toBeDefined();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transfers'").get()).toBeDefined();
      expect(db.prepare("SELECT applied_at FROM schema_migrations WHERE version=1").get()).toEqual({ applied_at: 123 });
    } finally {
      db.close();
    }
  });

  it("upgrades a version-1 database without losing existing rows", () => {
    const file = databasePath();
    const oldDb = new DatabaseSync(file);
    oldDb.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      ${RELAY_MIGRATIONS[0]!.sql}
    `);
    oldDb.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)").run(1);
    oldDb.prepare("INSERT INTO workers(worker_id,last_seen,version) VALUES(?,?,?)").run("existing-worker", 100, "old");
    oldDb.close();

    const store = new RelayStore(file);
    try {
      expect(versions(store.db)).toEqual([1, 2]);
      expect(store.db.prepare("SELECT * FROM workers WHERE worker_id='existing-worker'").get()).toEqual({
        worker_id: "existing-worker",
        last_seen: 100,
        version: "old"
      });
      expect(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transfers'").get()).toBeDefined();
    } finally {
      store.close();
    }
  });

  it("refuses a database created by a newer relay version", () => {
    const file = databasePath();
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
    db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(999,0)").run();
    db.close();
    expect(() => new RelayStore(file)).toThrow("DB_SCHEMA_TOO_NEW");
  });

  it("refuses a migration history with missing earlier versions", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
      db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(2,0)").run();
      expect(() => migrateRelayDatabase(db)).toThrow("DB_SCHEMA_MIGRATION_GAP");
    } finally {
      db.close();
    }
  });
});
