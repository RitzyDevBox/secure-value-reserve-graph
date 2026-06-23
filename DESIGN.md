# BareBonesGraph (secure-value-reserve) — Design Spec

TheGraph workspace for the BareBones stack. The path name is legacy — it's the whole graph
workspace (SVR + DAO + deployer + MTA + cap-table subgraphs), not just SVR.

## Manifest is rendered, not hand-edited

`subgraph.yaml` is the **template**; `scripts/render-deployment.mjs` reads it, rewrites
`network` and stamps each data source's `address` + `startBlock` from
`config/deployments/<target>.json`, and writes `subgraph.<target>.yaml`. For local, the root
`scripts/graph-local-deploy.sh` regenerates `config/deployments/anvil.json` from the deploy env
(`.env.deploy.anvil.generated`) first. So: add data sources to `subgraph.yaml`, stamp them in
`render-deployment.mjs`, and feed their address through the config — never edit the rendered
`subgraph.local.yaml` by hand.

## Cap Table (ShareTokenFactory) data source

**Why:** the frontend resolves an org's deployed `ShareToken` (cap-table) address from the
`ShareTokenDeployed` event index (see partner-template `shareTokenResolver.ts`), since there's no
on-chain slug→ShareToken registry. Indexes `ShareTokenDeployed(shareToken, owner, name, symbol,
complianceSBT)` → the `ShareTokenDeployed` entity, queryable by `owner`.

**Made additive + optional on purpose.** The data source ships with a zero-address placeholder in
the template; `render-deployment.mjs` only stamps the real factory address when
`shareTokenFactoryAddress` is present and non-zero in the deployment config. When absent it stays a
zero-address no-op. Reasoning: this is the shared subgraph that also powers SVR / DAO / MTA
indexing — a cap-table mistake must not be able to break those. `graph-local-deploy.sh` injects the
address from `SHARE_TOKEN_FACTORY_ADDRESS` (emitted by the main deploy) into the local config.

## Cap Table distributions + grants/holders

**Why:** the cap-table needs to be queryable beyond just "which ShareToken does this org own?".
Two new indexing surfaces:

- **Distributions** — payouts to share holders against a funded pool, emitted by the singleton
  `DistributionManager` (CREATE3-deterministic, one per chain). Indexed as a **static data source**
  mirroring `ShareTokenFactory` (same optional/zero-address posture, stamped from
  `distributionManagerAddress`). A `Distribution` row tracks lifecycle (`Processing → Done /
  Cancelled`) and running `paid`; each `HolderPaid` spawns an immutable `DistributionPayout` derived
  back to its `Distribution`. `DistributionChunk.paid` / `DistributionDone.totalPaid` are treated as
  authoritative running totals (overwrite, not increment) so the on-chain engine stays the source of
  truth even if a `HolderPaid` is missed.
- **Grants / holders** — per-org `ShareToken` cap tables, indexed as a **dynamic template** (like
  `SecureValueReserve` / `DAOGovernor`) spawned from the `ShareTokenFactory` `handleShareTokenDeployed`
  handler via `ShareTokenTemplate.create(...)`. Tracks `ShareClass` (Active/Retired/Removed), `Grant`
  (Active/Settled/Cancelled/ClawedBack, with `forfeited` accrual), and `ShareHolding` — net shares per
  `(shareToken, classId, holder)`. Balances move on `GrantIssued` (+), `GrantTransferred` (from→to),
  and forfeitures (`GrantCancelled` / `GrantClawedBack`, −). `GrantSettled` only reclassifies (no
  balance change). `GrantTransferred` carries no `grantId`, so it moves holdings only, not `Grant` rows.

**Static vs template split** follows the on-chain shape: `DistributionManager` is a singleton with a
known address (static, optionally stamped), while each `ShareToken` is deployed per-org at a
factory-determined address (template, addressless, spawned at deploy time). `voteWeightBps` is uint32
→ graph-ts types it as `BigInt`; the schema field is `Int!`, so the handler narrows with `.toI32()`.

## ShareLendingMarket (P2P share-collateralized lending)

**Why:** the cap-table financing surface needs its peer-to-peer lending market queryable — open
listings to browse, a listing's incoming quotes, and the resulting loan lifecycle. Emitted by the
singleton `ShareLendingMarket` (CREATE3-deterministic, one per chain), keyed per-org by `slug`,
the debt sibling of `EscrowOffers`. See `BareBonesDiamond/SHARE_LENDING.md`.

Indexed as a **static data source** with the same **optional/zero-address posture** as
`DistributionManager` / `ShareTokenFactory` (stamped from `shareLendingMarketAddress` only when
non-zero; zero-address no-op otherwise — must not be able to break the shared SVR/DAO/MTA/cap-table
indexing). Entities: `LendingListing` (Open → Accepted → Closed), `LendingQuote` (Open → Accepted /
Rejected / Funded / Withdrawn), `LendingLoan` (Accepted → Active → Repaid / Foreclosed / Released),
and `LendingOrg` (per-slug shareToken registry from `ShareTokenSet`).

**Events alone are insufficient — handlers read getters via eth_call.** Several UI-needed fields are
not carried in the events: a listing's `maxRateBps` / `termSeconds` / `requireDeposit` /
`depositAmount` / `mediator`; a quote's `deposit`; a loan's full terms + `startedAt` / `maturity`.
The handlers bind the contract and read the public getters (`listings(slug,id)`, `quotes(slug,lid,
qid)`, `loans(slug,id)`) with `try_*` guards, skipping on revert (and defaulting the fields) so a
missed-startBlock entity can't crash the mapping. The Solidity structs carry no nested mappings, so
the getters expand to flat multi-return tuples → graph-ts generates `...Result` classes with
`getFieldName()` accessors. **uint64 getter/event outputs are typed `BigInt` by graph-ts** (not
`u64`) — assigned directly, no `BigInt.fromU64` wrapping; **uint16 → `i32`** (matches the `Int!`
rate-bps fields). `ConfigSet` (global, contract-wide) and `ReleaseApproved` (interim signal) are
intentional no-ops — the terminal `Released` event flips the loan.

## Changelog

### 2026-06-21 — ShareLendingMarket (P2P lending) indexing
Added an **optional** `ShareLendingMarket` static data source. New entities (`schema.graphql`):
`LendingListing`, `LendingQuote`, `LendingLoan`, `LendingOrg`. New ABI (`abis/ShareLendingMarket.json`,
copied from `BareBonesDiamond/out/ShareLendingMarket.sol/ShareLendingMarket.json`). Manifest
(`subgraph.yaml`): static `ShareLendingMarket` data source (14 events). Mapping:
`src/share-lending-market.ts` (new) — reads off-event listing/quote/loan fields via guarded
`try_listings` / `try_quotes` / `try_loans` eth_calls. Optional zero-address stamping in
`scripts/render-deployment.mjs` (`shareLendingMarketAddress`) + config keys
`shareLendingMarketAddress` / `shareLendingMarketStartBlock` added to all three
`config/deployments/*.json` (anvil/staging/polygon, zero address for now — the deploy stamps the real
one). Verified `render:anvil` + `graph codegen` + `graph build` pass.

### 2026-06-17 — Distributions + grants/holders indexing
Added cap-table distribution + grant/holder indexing. New entities (`schema.graphql`): `Distribution`,
`DistributionPayout`, `ShareClass`, `Grant`, `ShareHolding`. New ABIs (`abis/DistributionManager.json`,
`abis/ShareToken.json`, copied from partner-template). Manifest (`subgraph.yaml`): static
`DistributionManager` data source (5 events) + dynamic `ShareToken` template (8 events). Mappings:
`src/distribution-manager.ts` (new), `src/share-token.ts` (new), and `src/share-token-factory.ts`
edited to spawn the `ShareToken` template. Optional zero-address stamping for `DistributionManager`
in `scripts/render-deployment.mjs` (`distributionManagerAddress`) + address injection in root
`scripts/graph-local-deploy.sh` (`DISTRIBUTION_MANAGER_ADDRESS`, already emitted by
`deploy-anvil-full.sh`). Verified `graph codegen` + `graph build` pass.

### 2026-06-14 — ShareTokenFactory (cap table) data source
Added an **optional** `ShareTokenFactory` static data source: `ShareTokenDeployed` entity
(`schema.graphql`), ABI (`abis/ShareTokenFactory.json`), handler (`src/share-token-factory.ts`),
data source block in `subgraph.yaml`, optional stamping in `scripts/render-deployment.mjs`
(`shareTokenFactoryAddress`, zero-address no-op when unset), and address injection in the root
`scripts/graph-local-deploy.sh`. Verified `render:anvil` + `graph codegen` + `graph build` pass,
and the full `deploy:anvil` redeployed the local subgraph with the factory address stamped. Front
end: partner-template `DESIGN.md`. Contracts: `BareBonesDiamond/CAPTABLE.md`.
