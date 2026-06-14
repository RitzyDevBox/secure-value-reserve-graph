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

## Changelog

### 2026-06-14 — ShareTokenFactory (cap table) data source
Added an **optional** `ShareTokenFactory` static data source: `ShareTokenDeployed` entity
(`schema.graphql`), ABI (`abis/ShareTokenFactory.json`), handler (`src/share-token-factory.ts`),
data source block in `subgraph.yaml`, optional stamping in `scripts/render-deployment.mjs`
(`shareTokenFactoryAddress`, zero-address no-op when unset), and address injection in the root
`scripts/graph-local-deploy.sh`. Verified `render:anvil` + `graph codegen` + `graph build` pass,
and the full `deploy:anvil` redeployed the local subgraph with the factory address stamped. Front
end: partner-template `DESIGN.md`. Contracts: `BareBonesDiamond/CAPTABLE.md`.
