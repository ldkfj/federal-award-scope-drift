import test from "node:test";
import assert from "node:assert/strict";
import { abi } from "genlayer-js";
import { decodeSuccessfulLeaderReturn } from "../../src/receipt.js";

function returned(value) {
  return {
    status: "return",
    payload: { raw: Array.from(abi.calldata.encode(value)) },
  };
}

test("decodes the exact claim ID returned by a finalized leader", () => {
  const transaction = {
    consensus_data: {
      final: true,
      leader_receipt: [{ result: returned("FASD-000042") }],
    },
  };
  assert.equal(decodeSuccessfulLeaderReturn(transaction), "FASD-000042");
});

test("rejects non-final, absent, and conflicting leader returns", () => {
  assert.throws(() => decodeSuccessfulLeaderReturn({ consensus_data: { final: false } }), /FINALIZED/);
  assert.throws(() => decodeSuccessfulLeaderReturn({ consensus_data: { final: true } }), /No successful/);
  assert.throws(
    () => decodeSuccessfulLeaderReturn({
      consensus_data: {
        final: true,
        leader_receipt: [
          { result: returned("FASD-000001") },
          { result: returned("FASD-000002") },
        ],
      },
    }),
    /conflicting/,
  );
});
