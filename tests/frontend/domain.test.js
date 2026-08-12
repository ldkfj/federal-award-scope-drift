import test from "node:test";
import assert from "node:assert/strict";

import {
  claimMatchesIntent,
  formatCents,
  parseContractJson,
  receiptSucceeded,
  validateAwardId,
  validateClaimInput,
} from "../../src/domain.js";

const awardId = "CONT_AWD_47PF0021C0003_4740_-NONE-_-NONE-";

test("award IDs normalize without accepting a PIID", () => {
  assert.deepEqual(validateAwardId(` ${awardId.toLowerCase()} `), { ok: true, value: awardId });
  assert.equal(validateAwardId("47PF0021C0003").ok, false);
});

test("claim input fails closed for insecure URL and future observation", () => {
  const result = validateClaimInput(
    {
      awardId,
      recipientId: "VEP4UN7LDMK5",
      claimText: "A sufficiently long exact public award claim.",
      claimUrl: "http://localhost/claim",
      observedAt: "2030-01-01",
    },
    new Date("2026-08-13T00:00:00Z"),
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.claimUrl, /public HTTPS/);
  assert.match(result.errors.observedAt, /future/);
});

test("claim input rejects private network URLs", () => {
  for (const claimUrl of ["https://127.0.0.1/claim", "https://192.168.1.20/claim", "https://service.local/claim"]) {
    const result = validateClaimInput(
      {
        awardId,
        recipientId: "VEP4UN7LDMK5",
        claimText: "A sufficiently long exact public award claim.",
        claimUrl,
        observedAt: "2020-10-26",
      },
      new Date("2026-08-13T00:00:00Z"),
    );
    assert.equal(result.ok, false);
  }
});

test("claim input returns normalized calldata in contract order", () => {
  const result = validateClaimInput(
    {
      awardId: awardId.toLowerCase(),
      recipientId: "vep4un7ldmk5",
      claimText: "  GSA awarded $85,535,000   for the courthouse project. ",
      claimUrl: "https://www.gsa.gov/example",
      observedAt: "2020-10-26",
    },
    new Date("2026-08-13T00:00:00Z"),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(Object.values(result.value), [
    awardId,
    "VEP4UN7LDMK5",
    "GSA awarded $85,535,000 for the courthouse project.",
    "https://www.gsa.gov/example",
    "2020-10-26",
  ]);
});

test("registration readback binds wallet and all immutable fields", () => {
  const intent = {
    awardId,
    recipientId: "VEP4UN7LDMK5",
    claimText: "GSA awarded $85,535,000 for the courthouse project.",
    claimUrl: "https://www.gsa.gov/example",
    observedAt: "2020-10-26",
  };
  const claim = {
    registrant: "0x1111111111111111111111111111111111111111",
    award_id: intent.awardId,
    recipient_id: intent.recipientId,
    claim_text: intent.claimText,
    claim_url: intent.claimUrl,
    observed_at: intent.observedAt,
  };
  assert.equal(claimMatchesIntent(claim, intent, claim.registrant.toUpperCase()), true);
  assert.equal(claimMatchesIntent({ ...claim, claim_text: "different" }, intent, claim.registrant), false);
});

test("execution success requires successful leader return", () => {
  assert.equal(receiptSucceeded({ txExecutionResultName: "FINISHED_WITH_RETURN" }), true);
  assert.equal(receiptSucceeded({ txExecutionResultName: "FINISHED_WITH_ERROR" }), false);
  assert.equal(receiptSucceeded({}), false);
});

test("contract JSON and cents format safely", () => {
  assert.deepEqual(parseContractJson('{"claim_id":"FASD-000001"}'), { claim_id: "FASD-000001" });
  assert.equal(formatCents("9908031438"), "$99,080,314.38");
  assert.equal(formatCents("900719925474099312"), "$9,007,199,254,740,993.12");
  assert.equal(formatCents("not-cents"), "—");
  assert.throws(() => parseContractJson("[]"), /not an object/);
});
