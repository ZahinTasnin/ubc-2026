import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDepositDeadline, latestDepositDeadline } from "./deadline";

const NOW = Math.floor(Date.parse("2026-11-21T15:00:00Z") / 1000);
const solWindow = {
  marketKind: "UP_DOWN" as const,
  marketState: "open",
  opensAt: "2026-11-21T15:20:00.000Z",
  expiresAt: "2026-11-21T15:25:00.000Z",
};
const texasGame = {
  marketKind: "STANDARD" as const,
  marketState: "open",
  opensAt: "2026-11-13T00:00:00.000Z",
  expiresAt: "2026-11-22T20:30:00.000Z",
};

test("Up/Down windows: deposits must stop 5 minutes before the window opens", () => {
  const latest = Math.floor(Date.parse("2026-11-21T15:15:00Z") / 1000);
  assert.equal(latestDepositDeadline(solWindow), latest);
  assert.deepEqual(checkDepositDeadline(solWindow, latest, NOW), { ok: true, latest });
  const late = checkDepositDeadline(solWindow, latest + 1, NOW);
  assert.equal(late.ok, false);
  assert.equal(!late.ok && late.reason, "DEADLINE_AFTER_LAST_HEDGEABLE_TIME");
});

test("standard markets: deadline up to the market's expiry", () => {
  const expiry = Math.floor(Date.parse(texasGame.expiresAt) / 1000);
  assert.equal(checkDepositDeadline(texasGame, expiry, NOW).ok, true);
  assert.equal(checkDepositDeadline(texasGame, expiry + 1, NOW).ok, false);
});

test("rejects deadlines too soon, closed markets, and unknown timing", () => {
  const tooSoon = checkDepositDeadline(texasGame, NOW + 30, NOW);
  assert.equal(!tooSoon.ok && tooSoon.reason, "DEADLINE_TOO_SOON");
  const closed = checkDepositDeadline({ ...texasGame, marketState: "closed" }, NOW + 600, NOW);
  assert.equal(!closed.ok && closed.reason, "MARKET_NOT_OPEN");
  const unknown = checkDepositDeadline({ ...solWindow, opensAt: null }, NOW + 600, NOW);
  assert.equal(!unknown.ok && unknown.reason, "MARKET_TIMING_UNKNOWN");
});
