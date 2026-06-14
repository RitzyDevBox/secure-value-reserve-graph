import { ShareTokenDeployed as ShareTokenDeployedEvent } from "../generated/ShareTokenFactory/ShareTokenFactory";
import { ShareTokenDeployed } from "../generated/schema";

// Indexes per-org cap-table (ShareToken) deployments so the frontend can resolve an
// org's cap-table address by owner. See BareBonesDiamond/CAPTABLE.md and the
// partner-template shareTokenResolver (which queries `shareTokenDeployeds`).
export function handleShareTokenDeployed(event: ShareTokenDeployedEvent): void {
  let entity = new ShareTokenDeployed(event.params.shareToken.toHexString());
  entity.shareToken = event.params.shareToken;
  entity.owner = event.params.owner;
  entity.name = event.params.name;
  entity.symbol = event.params.symbol;
  entity.complianceSBT = event.params.complianceSBT;
  entity.blockNumber = event.block.number;
  entity.createdAt = event.block.timestamp;
  entity.txHash = event.transaction.hash;
  entity.save();
}
