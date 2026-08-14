import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { parseContractJson, receiptFinalized, receiptSucceeded } from "./domain.js";
import { decodeSuccessfulLeaderReturn } from "./receipt.js";

const runtimeEnv = import.meta.env ?? {};
const contractAddress = String(runtimeEnv.VITE_CONTRACT_ADDRESS ?? "").trim();
const configuredNetwork = String(runtimeEnv.VITE_GENLAYER_NETWORK ?? "studionet").trim();
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

export const readClient = createClient({ chain: studionet });

export function deploymentState() {
  if (configuredNetwork !== "studionet") return { ready: false, message: "This release is locked to Studionet." };
  if (!addressPattern.test(contractAddress)) return { ready: false, message: "No Studionet contract address is configured yet." };
  return { ready: true, address: contractAddress };
}

function requireDeployment() {
  const state = deploymentState();
  if (!state.ready) throw new Error(state.message);
  return state.address;
}

export async function readContract(functionName, args = []) {
  return readClient.readContract({
    address: requireDeployment(),
    functionName,
    args,
    stateStatus: "accepted",
  });
}

export async function makeWriteClient(provider, account, clientFactory = createClient) {
  const client = clientFactory({ chain: studionet, account, provider });
  await client.connect("studionet");
  return client;
}

export async function submitWrite(client, functionName, args) {
  return client.writeContract({
    address: requireDeployment(),
    functionName,
    args,
    value: 0n,
  });
}

export async function waitForSuccessfulFinalization(hash) {
  const receipt = await readClient.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    fullTransaction: true,
  });
  if (!receiptFinalized(receipt)) {
    throw new Error("The transaction is not explicitly FINALIZED.");
  }
  if (!receiptSucceeded(receipt)) {
    throw new Error("The transaction finalized, but leader execution did not finish successfully.");
  }
  return {
    receipt,
    returnValue: decodeSuccessfulLeaderReturn(receipt),
  };
}

export async function readClaim(claimId) {
  return parseContractJson(await readContract("get_claim", [claimId]), "claim readback");
}

export async function readAssessment(claimId, revision) {
  return parseContractJson(await readContract("get_assessment", [claimId, revision]), "assessment readback");
}
