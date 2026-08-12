import { abi } from "genlayer-js";

function decodePayload(result) {
  if (!result || result.status !== "return") return undefined;

  if (Array.isArray(result.payload?.raw)) {
    return abi.calldata.decode(Uint8Array.from(result.payload.raw));
  }

  if (typeof result.raw === "string") {
    const binary = atob(result.raw);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes[0] !== 0) return undefined;
    return abi.calldata.decode(bytes.slice(1));
  }

  return undefined;
}

export function decodeSuccessfulLeaderReturn(transaction) {
  if (transaction?.consensus_data?.final !== true) {
    throw new Error("Transaction consensus is not explicitly FINALIZED.");
  }

  const source = transaction.consensus_data.leader_receipt;
  const receipts = Array.isArray(source) ? source : source ? [source] : [];
  const values = receipts
    .map((receipt) => decodePayload(receipt.result))
    .filter((value) => value !== undefined);

  if (!values.length) {
    throw new Error("No successful leader return could be decoded from the transaction receipt.");
  }

  const canonical = JSON.stringify(values[0]);
  if (values.some((value) => JSON.stringify(value) !== canonical)) {
    throw new Error("Leader receipts contain conflicting return values.");
  }

  return values[0];
}
