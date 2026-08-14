# Federal Award Scope Drift

Federal Award Scope Drift freezes a public statement about one U.S. federal definitive contract and records a validator-consensed monitoring verdict when the award's current scope, amount, or timeframe no longer supports that statement.

## Verified links

- Live app: pending the governed Vercel release gate.
- Studionet contract: [`0xEd657FCFB310519f89a3208DE0f996898A8c9d69`](https://explorer-studio.genlayer.com/address/0xEd657FCFB310519f89a3208DE0f996898A8c9d69)
- Deployment transaction: [`0x11ccde8ea1af97f60fc712cc171adea8882647200be384bd53f998184c87b8ce`](https://explorer-studio.genlayer.com/tx/0x11ccde8ea1af97f60fc712cc171adea8882647200be384bd53f998184c87b8ce)
- Reproducible evidence: [`docs/VERIFICATION.md`](docs/VERIFICATION.md)

## Trust problem

A claimant can omit later award modifications, while a challenger can selectively frame those modifications. A centralized monitor can also choose which evidence or interpretation to publish. The frozen claim, award identity, public sources, and append-only revisions prevent either side from silently changing the decision boundary.

## Why GenLayer is essential

Literal lookup is insufficient: a claim may remain online while later modifications change whether its scope, amount, or timeframe is still supported. GenLayer validators independently refetch the frozen claim source and canonical USAspending records, rederive the consequence-bearing fields, and agree before the contract appends one of six verdicts. Missing or conflicting evidence fails closed instead of producing a conclusive accusation.

## How it works

1. A user looks up a definitive contract by PIID, selects the canonical USAspending Award ID, and enters the exact claim text, recipient UEI, public HTTPS source, and observation date.
2. The connected wallet registers the claim and receives the exact returned claim ID only after transaction finality, successful execution, and authoritative readback.
3. The registrant freezes the claim. Its identity and wording can no longer change.
4. Any user can request an assessment. Validators compare the frozen statement with current award detail and the complete, award-specific history of up to 100 prime-award transactions.
5. Later reassessments append revisions after a contract-enforced 24-hour cooldown; history is never overwritten.

## Architecture

- `contracts/FederalAwardScopeDrift.py` owns claim identity, authorization, lifecycle, evidence retrieval, consensus, verdicts, history, cooldown, and upgrade authority.
- `src/` owns input validation, USAspending preview, explicit EIP-6963 wallet selection, GenLayer calls, pending-intent persistence, receipt checks, and readback presentation.
- USAspending and the claimant-provided public page are evidence sources, not authorities that can write verdicts.
- There is no backend, relayer, administrator verdict, or off-chain source of truth.

## Intelligent Contract

Lifecycle: `REGISTERED → FROZEN → ASSESSED`.

The contract supports `register_claim`, `freeze_claim`, `assess_current_scope`, `reassess_after_update`, five read/operational views, and `upgrade`. Verdicts are `CURRENTLY_ALIGNED`, `QUALIFICATION_REQUIRED`, `SCOPE_DRIFT`, `IDENTITY_MISMATCH`, `STALE_CLAIM`, and `UNRESOLVED`. Deterministic checks bind the generated Award ID, type `D`, UEI, transaction count, dates, and obligations; the LLM is limited to semantic scope/time/amount relations. The custom validator independently reruns retrieval and compares all consequence-bearing decision fields.

This is a non-economic project: no GEN, escrow, payout, bond, stake, or payment right is represented.

## Transaction lifecycle

The browser requires explicit selection of an announced EIP-6963/EIP-1193 provider before requesting an account, binds writes to that exact provider and account, and revalidates GenLayer Studionet. Each pending write stores its Studionet contract binding, authoritative pre-state, and method-specific expected postcondition across reloads. A retry remains blocked until the original transaction is reconciled. A write is displayed as successful only when its transaction is `FINALIZED`, a leader execution completed successfully, and contract readback matches the intended registration, freeze transition, or exact appended assessment revision. Pending, disagreement, execution failure, decode failure, and readback mismatch remain visible recoverable errors.

## Run locally

Prerequisites: Node.js 22+ and Python 3.12+.

```text
npm install
npm run dev
```

After a real Studionet deployment, copy `.env.example` to `.env` and set only the real address:

```text
VITE_CONTRACT_ADDRESS=<real Studionet contract address>
VITE_GENLAYER_NETWORK=studionet
```

No placeholder contract address is valid.

## Tests and verification

```text
npm test
npm run build
python -m pip install -r requirements-dev.txt
python -m pytest tests/test_contract.py -q
genvm-lint check contracts/FederalAwardScopeDrift.py
```

Current local result: 33/33 frontend tests, 28/28 Direct Mode contract tests, production build pass, semantic lint/validation pass, `pip check` pass, and npm audit with zero known vulnerabilities.

Direct Mode in `genlayer-test` currently has a Windows temporary-file cleanup incompatibility. On Windows, use WSL or an isolated wrapper that only tolerates `WinError 32` for its own temporary directory. The pytest assertions and exit status must still pass; a cleanup workaround alone is not evidence.

## Deployment

Network: GenLayer Studionet, chain ID `61999`, RPC `https://studio.genlayer.com/api`. Deployment classification: `UPGRADABLE`. The deployed contract source is 20,934 UTF-8 bytes with SHA-256 `579d4c55a86176b1989c323cdb99726aff110da54f85216e7559f52399be0746`, matching [`contracts/FederalAwardScopeDrift.py`](contracts/FederalAwardScopeDrift.py). The deployer/upgrader is `0x92ec8364dA5B80b3DAAb921f3fBBB5F807DaF2Fe`.

Deployment, the complete live matrix, and an isolated exact-source upgrade rehearsal passed anonymous `POST_DEPLOY_TEST` review. See [`docs/VERIFICATION.md`](docs/VERIFICATION.md) for transaction-bound evidence and recovery limitations.

## Security and trust boundaries

- Claim URLs must use public HTTPS and reject lexical loopback/private-network targets.
- The claim page is claimant-selected evidence; it is not proof that a government agency endorses the statement.
- Identity mismatch takes precedence over semantic scope results.
- More than 100 returned transactions, inaccessible evidence, malformed responses, or inconsistent validator results stay `UNRESOLVED` and retryable.
- Losing the recorded Studio account loses upgrade authority. A Studionet reset destroys the old address and state; neither case is recoverable from this repository alone.
- Secrets, wallet exports, private keys, and seed phrases must never enter the repository.

## Known limitations

- MVP scope is prime definitive contracts (`type D`) with at most 100 returned transactions; it excludes grants, subawards, and indefinite-delivery vehicles.
- USAspending obligations are not expenditures, and verdicts are monitoring signals—not findings of fraud, performance ratings, proof of delivery, or legal/payment decisions.
- Public web content and USAspending data can change during consensus, producing `UNRESOLVED` until a later reassessment.
- Wallet support is limited to injected browser EIP-1193 providers. This release does not claim WalletConnect, mobile, hardware-wallet, or smart-account support.
- Studionet is temporary; a network reset destroys the address and state. The public repository and final Vercel URL remain gated release artifacts until published.
