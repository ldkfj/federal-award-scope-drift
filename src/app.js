import "./styles.css";

import {
  VERDICT_COPY,
  assessmentMatchesPendingPostcondition,
  bindPendingWrite,
  claimMatchesPendingPostcondition,
  claimMatchesIntent,
  formatCents,
  pendingMatchesDeployment,
  shortenAddress,
  validateAwardId,
  validateClaimId,
  validateClaimInput,
} from "./domain.js";
import {
  deploymentState,
  makeWriteClient,
  readAssessment,
  readClaim,
  readContract,
  submitWrite,
  waitForSuccessfulFinalization,
} from "./genlayer.js";
import { discoverWalletProviders, requestWalletAccount } from "./wallet.js";

const PENDING_KEY = "fasd.pending-write.v1";
const state = {
  award: null,
  providers: [],
  selectedProviderId: "",
  account: "",
  writeClient: null,
  claimId: "",
  claim: null,
  assessment: null,
};

const elements = {
  connect: document.querySelector("#connect-wallet"),
  walletDialog: document.querySelector("#wallet-dialog"),
  walletOptions: document.querySelector("#wallet-options"),
  confirmWallet: document.querySelector("#confirm-wallet"),
  awardForm: document.querySelector("#award-lookup-form"),
  awardInput: document.querySelector("#award-id"),
  awardPreview: document.querySelector("#award-preview"),
  claimForm: document.querySelector("#claim-form"),
  recipientId: document.querySelector("#recipient-id"),
  observedAt: document.querySelector("#observed-at"),
  claimUrl: document.querySelector("#claim-url"),
  claimText: document.querySelector("#claim-text"),
  freeze: document.querySelector("#freeze-claim"),
  assess: document.querySelector("#assess-claim"),
  recordForm: document.querySelector("#record-form"),
  claimId: document.querySelector("#claim-id"),
  record: document.querySelector("#record-output"),
  status: document.querySelector("#status-region"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function announce(message, tone = "info", timeout = 7000) {
  const item = document.createElement("div");
  item.className = "status-message";
  item.dataset.tone = tone;
  item.textContent = message;
  elements.status.replaceChildren(item);
  if (timeout) window.setTimeout(() => item.remove(), timeout);
}

function setButton(button, status, label) {
  button.dataset.state = status;
  button.disabled = status === "loading";
  button.textContent = label;
}

function setFieldError(name, message) {
  const input = elements.claimForm.elements.namedItem(name) ?? elements.awardForm.elements.namedItem(name);
  if (!input) return;
  const field = input.closest(".field");
  const helper = field.querySelector(".field__help");
  if (!field.dataset.helper) field.dataset.helper = helper.textContent;
  field.dataset.state = message ? "error" : input.value ? "success" : "";
  input.setAttribute("aria-invalid", message ? "true" : "false");
  helper.textContent = message || field.dataset.helper;
}

function clearFieldStates(form) {
  form.querySelectorAll(".field").forEach((field) => {
    const input = field.querySelector("input, textarea");
    if (input) setFieldError(input.name, "");
  });
}

function renderAward(award) {
  const recipient = award.recipient ?? {};
  const agency = award.awarding_agency?.toptier_agency?.name ?? "—";
  const period = award.period_of_performance ?? {};
  elements.awardPreview.hidden = false;
  elements.awardPreview.innerHTML = `
    <dl class="facts">
      <div><dt>Award</dt><dd>${escapeHtml(award.piid)}</dd></div>
      <div><dt>Recipient</dt><dd>${escapeHtml(recipient.recipient_name)}</dd></div>
      <div><dt>Recipient UEI</dt><dd>${escapeHtml(recipient.recipient_uei)}</dd></div>
      <div><dt>Awarding agency</dt><dd>${escapeHtml(agency)}</dd></div>
      <div><dt>Current obligation</dt><dd>${escapeHtml(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(award.total_obligation ?? 0)))}</dd></div>
      <div><dt>Performance period</dt><dd>${escapeHtml(period.start_date)} — ${escapeHtml(period.end_date)}</dd></div>
    </dl>`;
}

function renderClaim(claim, assessment = null) {
  const verdict = assessment?.verdict || claim.latest_verdict;
  const verdictCopy = VERDICT_COPY[verdict] ?? ["Not assessed", "Freeze this claim before requesting an assessment."];
  const snapshot = assessment?.award_snapshot ?? {};
  elements.record.innerHTML = `
    <dl class="facts">
      <div><dt>Claim ID</dt><dd>${escapeHtml(claim.claim_id)}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(claim.status)}</dd></div>
      <div><dt>Registrant</dt><dd>${escapeHtml(shortenAddress(claim.registrant))}</dd></div>
      <div><dt>Award ID</dt><dd>${escapeHtml(claim.award_id)}</dd></div>
      <div><dt>Recipient UEI</dt><dd>${escapeHtml(claim.recipient_id)}</dd></div>
      <div><dt>Observed</dt><dd>${escapeHtml(claim.observed_at)}</dd></div>
      <div><dt>Revisions</dt><dd>${escapeHtml(claim.revision_count)}</dd></div>
      ${snapshot.last_action_date ? `<div><dt>Latest action</dt><dd>${escapeHtml(snapshot.last_action_date)}</dd></div>` : ""}
      ${snapshot.total_obligation_cents ? `<div><dt>Current obligation</dt><dd>${escapeHtml(formatCents(snapshot.total_obligation_cents))}</dd></div>` : ""}
    </dl>
    <div class="verdict" data-verdict="${escapeHtml(verdict)}">
      <p class="verdict__name">${escapeHtml(verdictCopy[0])}</p>
      <p>${escapeHtml(verdictCopy[1])}</p>
      ${assessment?.reason_codes?.length ? `<p>Reason codes: ${assessment.reason_codes.map(escapeHtml).join(" · ")}</p>` : ""}
    </div>`;

  state.claimId = claim.claim_id;
  state.claim = claim;
  state.assessment = assessment;
  elements.claimId.value = claim.claim_id;
  elements.freeze.disabled = !state.writeClient || claim.status !== "REGISTERED";
  elements.assess.disabled = !state.writeClient || !["FROZEN", "ASSESSED"].includes(claim.status);
  elements.assess.textContent = claim.status === "ASSESSED" ? "Reassess after update" : "Assess current scope";
}

async function loadClaim(claimId) {
  const claim = await readClaim(claimId);
  const assessment = Number(claim.revision_count) > 0 ? await readAssessment(claimId, Number(claim.revision_count)) : null;
  renderClaim(claim, assessment);
  return claim;
}

function renderProviders() {
  elements.walletOptions.replaceChildren();
  if (!state.providers.length) {
    const empty = document.createElement("p");
    empty.textContent = "No compatible browser wallet announced itself. Install or enable a wallet, then reopen this chooser.";
    elements.walletOptions.append(empty);
    return;
  }
  for (const item of state.providers) {
    const button = document.createElement("button");
    button.className = "wallet-option";
    button.type = "button";
    button.textContent = item.name;
    button.dataset.providerId = item.id;
    button.setAttribute("aria-pressed", String(item.id === state.selectedProviderId));
    button.addEventListener("click", () => {
      state.selectedProviderId = item.id;
      elements.confirmWallet.disabled = false;
      renderProviders();
    });
    elements.walletOptions.append(button);
  }
}

async function readbackPending(pending, returnValue) {
  const deployment = deploymentState();
  if (!pendingMatchesDeployment(pending, deployment)) {
    throw new Error("The pending transaction belongs to a different network or contract.");
  }
  if (pending.functionName === "register_claim") {
    const claimId = validateClaimId(returnValue);
    if (!claimId.ok) throw new Error("The finalized leader return did not contain a valid claim ID.");
    const claim = await readClaim(claimId.value);
    if (!claimMatchesIntent(claim, pending.intent, pending.account)) {
      throw new Error("The returned claim ID did not match the exact submitted fields and wallet.");
    }
    renderClaim(claim);
    return claim;
  }
  const claim = await readClaim(pending.expected?.claimId);
  if (!claimMatchesPendingPostcondition(claim, pending)) {
    throw new Error("Authoritative claim state did not match the pending write postcondition.");
  }
  let assessment = null;
  if (pending.expected.kind === "assessment") {
    assessment = await readAssessment(pending.expected.claimId, pending.expected.revision);
    if (!assessmentMatchesPendingPostcondition(assessment, claim, pending)) {
      throw new Error("Authoritative assessment did not match the expected appended revision.");
    }
  }
  renderClaim(claim, assessment);
  return claim;
}

async function executeIntent(intent, label) {
  if (!state.writeClient) throw new Error("Choose and connect a wallet before sending a write.");
  const pending = bindPendingWrite(intent, deploymentState(), state.claim, state.assessment);
  localStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, phase: "prepared", createdAt: new Date().toISOString() }));
  const hash = await submitWrite(state.writeClient, intent.functionName, intent.args);
  localStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, phase: "submitted", hash, createdAt: new Date().toISOString() }));
  announce(`${label} submitted. Waiting for FINALIZED and successful leader execution…`, "info", 0);
  const finalized = await waitForSuccessfulFinalization(hash);
  const result = await readbackPending(pending, finalized.returnValue);
  localStorage.removeItem(PENDING_KEY);
  announce(`${label} finalized and matched authoritative readback.`);
  return result;
}

async function reconcilePending() {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return;
  let pending;
  try {
    pending = JSON.parse(raw);
  } catch {
    localStorage.removeItem(PENDING_KEY);
    return;
  }
  if (!pending.hash) {
    announce("A write was prepared but no transaction hash was recorded. Review the current contract state before retrying.", "warning", 0);
    return;
  }
  try {
    announce("Reconciling the pending transaction before any retry…", "warning", 0);
    if (!pendingMatchesDeployment(pending, deploymentState())) {
      throw new Error("The saved write belongs to a different network or contract.");
    }
    const finalized = await waitForSuccessfulFinalization(pending.hash);
    await readbackPending(pending, finalized.returnValue);
    localStorage.removeItem(PENDING_KEY);
    announce("The pending transaction finalized and its state was read back.");
  } catch (error) {
    announce(`Pending transaction is not safely reconciled. ${error.message} Do not retry yet.`, "error", 0);
  }
}

elements.connect.addEventListener("click", () => {
  state.providers = discoverWalletProviders();
  state.selectedProviderId = "";
  elements.confirmWallet.disabled = true;
  renderProviders();
  elements.walletDialog.showModal();
});

elements.confirmWallet.addEventListener("click", async () => {
  const selected = state.providers.find((item) => item.id === state.selectedProviderId);
  if (!selected) return;
  setButton(elements.confirmWallet, "loading", "Connecting…");
  try {
    state.account = await requestWalletAccount(selected.provider);
    state.writeClient = await makeWriteClient(selected.provider, state.account);
    elements.connect.textContent = shortenAddress(state.account);
    elements.walletDialog.close();
    setButton(elements.confirmWallet, "success", "Connected");
    if (state.claimId) await loadClaim(state.claimId);
  } catch (error) {
    setButton(elements.confirmWallet, "error", "Try connection again");
    announce(`Wallet connection failed. ${error.message} Confirm the selected wallet is unlocked and on Studionet.`, "error", 0);
  }
});

elements.awardForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = validateAwardId(elements.awardInput.value);
  setFieldError("awardId", result.ok ? "" : result.message);
  if (!result.ok) return elements.awardInput.focus();
  const button = elements.awardForm.querySelector("button[type=submit]");
  setButton(button, "loading", "Reading…");
  try {
    const response = await fetch(`https://api.usaspending.gov/api/v2/awards/${encodeURIComponent(result.value)}/`);
    if (!response.ok) throw new Error(`USAspending returned HTTP ${response.status}.`);
    const award = await response.json();
    if (award.generated_unique_award_id !== result.value || award.type !== "D") {
      throw new Error("The exact record is not a definitive contract supported by this MVP.");
    }
    const transactionResponse = await fetch(`https://api.usaspending.gov/api/v2/awards/count/transaction/${encodeURIComponent(result.value)}/`);
    if (!transactionResponse.ok) throw new Error(`Transaction count returned HTTP ${transactionResponse.status}.`);
    const { transactions } = await transactionResponse.json();
    if (!Number.isInteger(transactions) || transactions < 1 || transactions > 100) {
      throw new Error("This award does not have 1–100 transactions and cannot be assessed by this MVP.");
    }
    state.award = award;
    elements.awardInput.value = result.value;
    elements.recipientId.value = award.recipient?.recipient_uei ?? "";
    renderAward(award);
    setButton(button, "success", "Award selected");
  } catch (error) {
    state.award = null;
    elements.awardPreview.hidden = true;
    setButton(button, "error", "Read award again");
    announce(`Award lookup failed. ${error.message} Verify the exact generated Award ID and retry.`, "error", 0);
  }
});

elements.claimForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFieldStates(elements.claimForm);
  const result = validateClaimInput({
    awardId: elements.awardInput.value,
    recipientId: elements.recipientId.value,
    claimText: elements.claimText.value,
    claimUrl: elements.claimUrl.value,
    observedAt: elements.observedAt.value,
  });
  for (const [name, message] of Object.entries(result.errors)) setFieldError(name, message);
  if (!result.ok) {
    const first = elements.claimForm.querySelector('[aria-invalid="true"]');
    first?.focus();
    return;
  }
  if (!state.award || state.award.generated_unique_award_id !== result.value.awardId) {
    setFieldError("awardId", "Read and explicitly select this exact award before registering the claim.");
    elements.awardInput.focus();
    return;
  }
  const button = elements.claimForm.querySelector("button[type=submit]");
  setButton(button, "loading", "Registering…");
  try {
    const claim = await executeIntent(
      {
        functionName: "register_claim",
        args: Object.values(result.value),
        intent: result.value,
        account: state.account,
      },
      "Claim registration",
    );
    setButton(button, "success", "Claim registered");
  } catch (error) {
    setButton(button, "error", "Register again");
    announce(`Claim registration was not confirmed. ${error.message} Reconcile any pending hash before retrying.`, "error", 0);
  }
});

elements.freeze.addEventListener("click", async () => {
  setButton(elements.freeze, "loading", "Freezing…");
  try {
    const claim = await executeIntent(
      { functionName: "freeze_claim", args: [state.claimId], claimId: state.claimId },
      `Freeze ${state.claimId}`,
    );
    setButton(elements.freeze, "success", "Claim frozen");
    elements.freeze.disabled = true;
  } catch (error) {
    setButton(elements.freeze, "error", "Freeze again");
    announce(`Freeze was not confirmed. ${error.message} Read contract state before retrying.`, "error", 0);
  }
});

elements.assess.addEventListener("click", async () => {
  const reassessing = state.claim?.status === "ASSESSED";
  const lastActionDate = state.assessment?.award_snapshot?.last_action_date ?? "";
  setButton(elements.assess, "loading", reassessing ? "Reassessing…" : "Assessing…");
  try {
    await executeIntent(
      {
        functionName: reassessing ? "reassess_after_update" : "assess_current_scope",
        args: reassessing ? [state.claimId, lastActionDate] : [state.claimId],
        claimId: state.claimId,
      },
      `${reassessing ? "Reassessment" : "Assessment"} ${state.claimId}`,
    );
    elements.assess.dataset.state = "success";
  } catch (error) {
    setButton(elements.assess, "error", reassessing ? "Reassess again" : "Assess again");
    announce(`Assessment was not confirmed. ${error.message} Read contract state before retrying.`, "error", 0);
  }
});

elements.recordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = validateClaimId(elements.claimId.value);
  if (!result.ok) return announce(`${result.message} Correct the ID and read again.`, "error");
  elements.record.setAttribute("aria-busy", "true");
  try {
    await loadClaim(result.value);
  } catch (error) {
    announce(`Claim read failed. ${error.message} Verify the exact ID and Studionet deployment.`, "error", 0);
  } finally {
    elements.record.removeAttribute("aria-busy");
  }
});

for (const input of elements.claimForm.querySelectorAll("input, textarea")) {
  input.addEventListener("blur", () => {
    input.dataset.touched = "true";
  });
  input.addEventListener("input", () => {
    if (input.dataset.touched) setFieldError(input.name, "");
  });
}

const deployment = deploymentState();
if (!deployment.ready) announce(`${deployment.message} Read-only award preview remains available; contract writes are disabled.`, "warning", 0);
void reconcilePending();
