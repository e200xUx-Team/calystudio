'use strict';

const fs = require('fs');
const initSqlJs = require('sql.js');

class ShimDatabase {
  constructor(db, dbPath) {
    this._db = db;
    this._dbPath = dbPath;
  }

  pragma(sql) {
    try {
      this._db.run(`PRAGMA ${sql};`);
    } catch (e) {
      // Ignore unsupported pragmas in sql.js
    }
  }

  exec(sql) {
    this._db.run(sql);
    this._save();
  }

  prepare(sql) {
    return new ShimStatement(this, sql);
  }

  _save() {
    if (this._dbPath) {
      const data = this._db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this._dbPath, buffer);
    }
  }
}

class ShimStatement {
  constructor(dbWrapper, sql) {
    this.dbWrapper = dbWrapper;
    this.sql = sql;
  }

  _bindAndRun(args) {
    let params = args;
    if (args.length === 1 && Array.isArray(args[0])) {
      params = args[0];
    }
    const stmt = this.dbWrapper._db.prepare(this.sql);
    if (params && params.length > 0) {
      // sql.js bind can accept arrays or objects
      stmt.bind(params);
    }
    return stmt;
  }

  run(...args) {
    const stmt = this._bindAndRun(args);
    stmt.step();
    stmt.free();

    // Fetch changes and lastInsertRowid
    const resId = this.dbWrapper._db.exec("SELECT last_insert_rowid() AS id;");
    const resChanges = this.dbWrapper._db.exec("SELECT changes() AS changes;");

    const lastInsertRowid = resId[0]?.values[0][0] ?? 0;
    const changes = resChanges[0]?.values[0][0] ?? 0;

    this.dbWrapper._save();

    return { lastInsertRowid, changes };
  }

  get(...args) {
    const stmt = this._bindAndRun(args);
    let row = undefined;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    return row;
  }

  all(...args) {
    const stmt = this._bindAndRun(args);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
}

async function createDatabase(dbPath) {
  const SQL = await initSqlJs();
  let fileBuffer = undefined;
  if (dbPath && fs.existsSync(dbPath)) {
    fileBuffer = fs.readFileSync(dbPath);
  }
  const db = new SQL.Database(fileBuffer);
  return new ShimDatabase(db, dbPath);
}

module.exports = { createDatabase };
