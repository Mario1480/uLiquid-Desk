import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  databaseUint256Decimal,
  parseDatabaseUint256Decimal,
  parseUint256Decimal
} from "./uint256.js";

test("database uint256 conversion expands Prisma Decimal scientific notation exactly", () => {
  const value = new Prisma.Decimal("1e27");
  const expected = "1000000000000000000000000000";

  assert.equal(value.toString(), "1e+27");
  assert.equal(parseDatabaseUint256Decimal(value), 10n ** 27n);
  assert.equal(databaseUint256Decimal(value), expected);
});

test("public uint256 parsing continues to reject scientific notation", () => {
  assert.throws(() => parseUint256Decimal("1e+27"), /invalid_uint256/);
});

test("database uint256 conversion rejects fractional Decimal values", () => {
  assert.throws(
    () => parseDatabaseUint256Decimal(new Prisma.Decimal("1.5"), "database_raw"),
    /invalid_database_raw/
  );
});
