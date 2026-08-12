const AWARD_ID_PATTERN = /^CONT_AWD_[A-Z0-9_-]{10,170}$/;
const CLAIM_ID_PATTERN = /^FASD-\d{6}$/;
const UEI_PATTERN = /^[A-Z0-9]{12}$/;

export const VERDICT_COPY = Object.freeze({
  CURRENTLY_ALIGNED: ["Currently aligned", "The current record supports the frozen claim."],
  QUALIFICATION_REQUIRED: ["Qualification required", "The evidence supports only a qualified reading."],
  SCOPE_DRIFT: ["Scope drift", "The claim exceeds the current scope or obligation evidence."],
  IDENTITY_MISMATCH: ["Identity mismatch", "The bound recipient does not match the authoritative award."],
  STALE_CLAIM: ["Stale claim", "A material post-observation change makes the wording outdated."],
  UNRESOLVED: ["Unresolved", "The evidence could not be verified safely. No aligned signal was issued."],
});

export function normalizeAwardId(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function validateAwardId(value) {
  const normalized = normalizeAwardId(value);
  return AWARD_ID_PATTERN.test(normalized)
    ? { ok: true, value: normalized }
    : { ok: false, message: "That is not a generated prime Award ID. Copy the CONT_AWD_… identifier from USAspending." };
}

export function validateClaimId(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return CLAIM_ID_PATTERN.test(normalized)
    ? { ok: true, value: normalized }
    : { ok: false, message: "Claim ID must match FASD-000001." };
}

export function validateClaimInput({ awardId, recipientId, claimText, claimUrl, observedAt }, today = new Date()) {
  const errors = {};
  const award = validateAwardId(awardId);
  if (!award.ok) errors.awardId = award.message;
  if (!UEI_PATTERN.test(String(recipientId ?? "").trim().toUpperCase())) {
    errors.recipientId = "The selected award must provide a 12-character recipient UEI.";
  }
  const normalizedText = String(claimText ?? "").trim().replace(/\s+/g, " ");
  if (normalizedText.length < 20 || normalizedText.length > 2000) {
    errors.claimText = "Claim text must contain 20–2,000 characters. Paste the exact public wording.";
  }
  try {
    const parsed = new URL(String(claimUrl ?? "").trim());
    const host = parsed.hostname.toLowerCase();
    const numericParts = host.split(".").map(Number);
    const isIpv4 = numericParts.length === 4 && numericParts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
    const isPrivateIpv4 = isIpv4 && (
      numericParts[0] === 10
      || numericParts[0] === 127
      || (numericParts[0] === 169 && numericParts[1] === 254)
      || (numericParts[0] === 172 && numericParts[1] >= 16 && numericParts[1] <= 31)
      || (numericParts[0] === 192 && numericParts[1] === 168)
    );
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || !host.includes(".")
      || host === "localhost"
      || host.endsWith(".localhost")
      || host.endsWith(".local")
      || isPrivateIpv4
      || host === "[::1]"
    ) {
      throw new Error("not public HTTPS");
    }
  } catch {
    errors.claimUrl = "The claim URL is not public HTTPS. Use the exact agency or recipient page.";
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(observedAt ?? "")) ? new Date(`${observedAt}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.valueOf()) || date > today) {
    errors.observedAt = "The observation date is invalid or in the future. Use the date shown by the source.";
  }
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      awardId: award.value ?? normalizeAwardId(awardId),
      recipientId: String(recipientId ?? "").trim().toUpperCase(),
      claimText: normalizedText,
      claimUrl: String(claimUrl ?? "").trim(),
      observedAt: String(observedAt ?? ""),
    },
  };
}

export function claimMatchesIntent(claim, intent, account) {
  return Boolean(
    claim
    && intent
    && String(claim.registrant ?? "").toLowerCase() === String(account ?? "").toLowerCase()
    && claim.award_id === intent.awardId
    && claim.recipient_id === intent.recipientId
    && claim.claim_text === intent.claimText
    && claim.claim_url === intent.claimUrl
    && claim.observed_at === intent.observedAt
  );
}

export function parseContractJson(value, label = "contract response") {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`The ${label} was not an object.`);
  return parsed;
}

export function formatCents(value, locale = "en-US") {
  const raw = String(value ?? "");
  if (!/^-?\d+$/.test(raw)) return "—";
  const cents = BigInt(raw);
  const absolute = cents < 0n ? -cents : cents;
  const dollars = (absolute / 100n).toLocaleString(locale);
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${cents < 0n ? "-" : ""}$${dollars}.${fraction}`;
}

export function shortenAddress(value) {
  const address = String(value ?? "");
  return /^0x[a-fA-F0-9]{40}$/.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function normalizeExecutionName(value) {
  const name = String(value ?? "").toUpperCase();
  return name === "1" ? "FINISHED_WITH_RETURN" : name;
}

export function readExecutionName(receipt) {
  const source = receipt?.consensus_data?.leader_receipt;
  const leaders = Array.isArray(source) ? source : source ? [source] : [];
  const names = [
    receipt?.txExecutionResultName,
    receipt?.txExecutionResult,
    ...leaders.flatMap((leader) => [leader.execution_result, leader.result_name]),
  ].map(normalizeExecutionName).filter(Boolean);
  return names.find((name) => name === "FINISHED_WITH_RETURN") ?? names[0] ?? "";
}

export function receiptFinalized(receipt) {
  const status = String(receipt?.statusName ?? receipt?.status_name ?? receipt?.status ?? "").toUpperCase();
  return receipt?.consensus_data?.final === true && (status === "FINALIZED" || status === "7");
}

export function receiptSucceeded(receipt) {
  return readExecutionName(receipt) === "FINISHED_WITH_RETURN";
}
