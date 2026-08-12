import test from "node:test";
import assert from "node:assert/strict";

import {
  assessmentMatchesPendingPostcondition,
  bindPendingWrite,
  claimMatchesPendingPostcondition,
  claimMatchesIntent,
  formatCents,
  parseContractJson,
  pendingMatchesDeployment,
  receiptFinalized,
  receiptSucceeded,
  validateAwardId,
  validateClaimInput,
} from "../../src/domain.js";

const awardId = "CONT_AWD_47PF0021C0003_4740_-NONE-_-NONE-";
const deployment = { ready: true, address: "0x1111111111111111111111111111111111111111" };

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

test("pending writes bind the exact Studionet contract and freeze pre-state", () => {
  const pending = bindPendingWrite(
    { functionName: "freeze_claim", args: ["FASD-000001"], claimId: "FASD-000001" },
    deployment,
    { claim_id: "FASD-000001", status: "REGISTERED", revision_count: 0 },
  );
  const restored = JSON.parse(JSON.stringify(pending));
  assert.equal(pendingMatchesDeployment(restored, deployment), true);
  assert.equal(pendingMatchesDeployment(restored, { ...deployment, address: "0x2222222222222222222222222222222222222222" }), false);
  assert.equal(pendingMatchesDeployment({ ...restored, network: "localnet" }, deployment), false);
  assert.equal(claimMatchesPendingPostcondition({ claim_id: "FASD-000001", status: "FROZEN", revision_count: 0 }, restored), true);
  assert.equal(claimMatchesPendingPostcondition({ claim_id: "FASD-000001", status: "REGISTERED", revision_count: 0 }, restored), false);
});

test("assessment reconciliation requires the exact next revision and matching assessment", () => {
  const pending = bindPendingWrite(
    { functionName: "assess_current_scope", args: ["FASD-000001"], claimId: "FASD-000001" },
    deployment,
    { claim_id: "FASD-000001", status: "FROZEN", revision_count: 2 },
  );
  const claim = { claim_id: "FASD-000001", status: "ASSESSED", revision_count: 3, latest_verdict: "CURRENTLY_ALIGNED" };
  assert.equal(claimMatchesPendingPostcondition({ ...claim, revision_count: 2 }, pending), false);
  assert.equal(claimMatchesPendingPostcondition(claim, pending), true);
  assert.equal(assessmentMatchesPendingPostcondition({ claim_id: "FASD-000001", revision: 3, verdict: "CURRENTLY_ALIGNED" }, claim, pending), true);
  assert.equal(assessmentMatchesPendingPostcondition({ claim_id: "FASD-000001", revision: 2, verdict: "CURRENTLY_ALIGNED" }, claim, pending), false);
});

test("reassessment binding rejects stale last-action pre-state", () => {
  assert.throws(
    () => bindPendingWrite(
      { functionName: "reassess_after_update", args: ["FASD-000001", "2020-10-25"], claimId: "FASD-000001" },
      deployment,
      { claim_id: "FASD-000001", status: "ASSESSED", revision_count: 1 },
      { award_snapshot: { last_action_date: "2020-10-26" } },
    ),
    /last action date/,
  );
});

test("execution success requires successful leader return", () => {
  assert.equal(receiptSucceeded({ txExecutionResultName: "FINISHED_WITH_RETURN" }), true);
  assert.equal(receiptSucceeded({ consensus_data: { leader_receipt: [{ execution_result: "1" }] } }), true);
  assert.equal(receiptSucceeded({ consensus_data: { leader_receipt: [{ execution_result: "FINISHED_WITH_RETURN" }] } }), true);
  assert.equal(receiptSucceeded({ txExecutionResultName: "FINISHED_WITH_ERROR" }), false);
  assert.equal(receiptSucceeded({}), false);
});

test("finality requires explicit final status and consensus final flag", () => {
  assert.equal(receiptFinalized({ status_name: "FINALIZED", consensus_data: { final: true } }), true);
  assert.equal(receiptFinalized({ status: 7, consensus_data: { final: true } }), true);
  assert.equal(receiptFinalized({ statusName: "FINALIZED", consensus_data: { final: false } }), false);
  assert.equal(receiptFinalized({ consensus_data: { final: true } }), false);
});

test("contract JSON and cents format safely", () => {
  assert.deepEqual(parseContractJson('{"claim_id":"FASD-000001"}'), { claim_id: "FASD-000001" });
  assert.equal(formatCents("9908031438"), "$99,080,314.38");
  assert.equal(formatCents("900719925474099312"), "$9,007,199,254,740,993.12");
  assert.equal(formatCents("not-cents"), "—");
  assert.throws(() => parseContractJson("[]"), /not an object/);
});
