# Federal Award Scope Drift — Verification

## Exact release

- Reviewed/deployed commit: `575cecb5ecad3114e4f322b8406587f0e4f8d0a7`
- Reviewed/deployed tree: `35e635d1a00fac22a986cdcd6ffb275cac7c7c84`
- Contract SHA-256: `579d4c55a86176b1989c323cdb99726aff110da54f85216e7559f52399be0746`
- Deployed source: 20,934 UTF-8 bytes, byte-exact to `contracts/FederalAwardScopeDrift.py`
- Studionet contract: [`0xEd657FCFB310519f89a3208DE0f996898A8c9d69`](https://explorer-studio.genlayer.com/address/0xEd657FCFB310519f89a3208DE0f996898A8c9d69)
- Deployment: [`0x11ccde8ea1af97f60fc712cc171adea8882647200be384bd53f998184c87b8ce`](https://explorer-studio.genlayer.com/tx/0x11ccde8ea1af97f60fc712cc171adea8882647200be384bd53f998184c87b8ce)
- Deployer/upgrader: `0x92ec8364dA5B80b3DAAb921f3fBBB5F807DaF2Fe`
- Network: GenLayer Studionet, chain ID `61999`

The deployment finalized successfully. Deployed-code, upgrader, configuration, and initial claim-count readbacks matched the reviewed package.

## Live proof matrix

| Path | Transaction | Verified result |
|---|---|---|
| Register baseline claim | [`0xd3a34062...187f`](https://explorer-studio.genlayer.com/tx/0xd3a34062cf2059ef28045930818025477f10fdc1b5d859967b3fe893a477187f) | `FINALIZED`; exact `FASD-000001` registered readback |
| Freeze baseline claim | [`0xa356e8f5...b6d4`](https://explorer-studio.genlayer.com/tx/0xa356e8f5042d83e08f062782577b33b6fcdab0b9bbb4ee85c82d8756f0e7b6d4) | `FINALIZED/MAJORITY_AGREE`; `FROZEN` |
| Assess baseline claim | [`0xcff3d490...ceaf`](https://explorer-studio.genlayer.com/tx/0xcff3d4900bb04861666f78cface6a6de458813b03c3366d9464ba485d66fceaf) | `FINALIZED/MAJORITY_AGREE`; revision 1 `STALE_CLAIM` |
| Reassess after update | [`0x1e2d59a5...9e2b`](https://explorer-studio.genlayer.com/tx/0x1e2d59a5e9056b672e85414758f5c5883021bec3d5a88679fe4deade5aef9e2b) | Revision advanced exactly 1 → 2 |
| Cooldown rejection | [`0x5785731d...d1aa`](https://explorer-studio.genlayer.com/tx/0x5785731d543bcc43ab9b8721dc1903bd843f0f61a6fc5f56d772323774d0d1aa) | Expected rollback; state unchanged |
| Malformed Award ID | [`0x23a24a8e...8de2`](https://explorer-studio.genlayer.com/tx/0x23a24a8e51e640faf97aa370468c755d623067d214a06ed864cfc539660f8de2) | Expected rollback; count unchanged |
| Freeze replay | [`0xb9914904...efa5`](https://explorer-studio.genlayer.com/tx/0xb99149049806d01e94ebef08090f621ac6b41c4c0878f3c7b9464e21e8dfefa5) | Expected rollback; state unchanged |
| Register fail-closed fixture | [`0xcc5cb36d...9d30`](https://explorer-studio.genlayer.com/tx/0xcc5cb36dab22eb6b533c51a33ca134f7e22a919b34a65b9a92e8a3d162e79d30) | Exact `FASD-000002` registered readback |
| Unauthorized fixture freeze | [`0xf1805096...f9d`](https://explorer-studio.genlayer.com/tx/0xf1805096e9a276861e1c0d986403c29337cd659add5ae0efc99d597aaa732f9d) | Expected registrant-authorization rollback |
| Registrant fixture freeze | [`0x31cf7257...3e7`](https://explorer-studio.genlayer.com/tx/0x31cf725714df007989952a54f868cbeaf72a6d78bb15487eab726ff0c039e3e7) | Exactly one successful freeze; no retry |
| Fail-closed assessment | [`0xb5e2c2d1...34e4`](https://explorer-studio.genlayer.com/tx/0xb5e2c2d1ade27dfe1dd3c17f47f4cafaf883968526d355bb2a158b2b768d34e4) | Revision 1 `UNRESOLVED`; claim remained `FROZEN` |

Every write above has terminal receipt evidence, authoritative leader classification, and method-specific readback. Release history contains no replay of a completed or ambiguous write.

## Local verification

```text
npm test
npm run build
npm audit --omit=dev
python -m pytest tests/test_contract.py -q
genvm-lint check contracts/FederalAwardScopeDrift.py
```

Current results: frontend 30/30, Direct Mode contract tests 28/28, production build passed, npm production audit reported zero vulnerabilities, Python dependency integrity passed, and GenVM AST lint passed. The unchanged contract also previously passed pinned semantic validation and subsequently compiled, deployed, executed, and read back byte-exact on Studionet.

## Recovery and upgrade evidence

An isolated deployment of the same source verified both upgrade controls without risking the release address:

- Unauthorized caller transaction [`0x01554fd0...76b8`](https://explorer-studio.genlayer.com/tx/0x01554fd0a24dea203b92aa1c9b45500d3dd560cb3a9850ba877a7ed6d4b476b8) finalized with the expected authorization rollback.
- Recorded upgrader transaction [`0xd2a53d9c...d98e`](https://explorer-studio.genlayer.com/tx/0xd2a53d9cb73f866868125cb98c437b80455835b83c63e35152f5844bbae6d98e) finalized successfully with exact post-upgrade source, upgrader, and claim-count parity.
- No upgrade was attempted against the release instance.

Losing the recorded upgrader account loses upgrade authority. A Studionet reset destroys the deployed address and state. Recovery therefore requires redeployment from the byte-identified source and rebuilding test-only state.

## Known limitations

- The product supports prime definitive contracts (`type D`) with at most 100 returned prime-award transactions.
- It excludes grants, subawards, indefinite-delivery vehicles, WalletConnect, mobile wallets, and smart accounts.
- Public evidence can change or become unavailable during consensus; the contract deliberately persists `UNRESOLVED` without promoting the claim to a resolved state.
- Verdicts are monitoring signals, not findings of fraud, payment decisions, or legal conclusions.
- The Vercel URL will be added only after the exact repository revision is deployed and passes user-executed wallet E2E.
