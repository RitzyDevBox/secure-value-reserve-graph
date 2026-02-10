import {
  ProposePolicyEvent,
  ExecutePolicyEvent,
  CancelPolicyEvent
} from "../generated/templates/SecureValueReserve/SecureValueReserve";

import {
  SVRPolicyProposed,
  SVRPolicyExecuted,
  SVRPolicyCancelled
} from "../generated/schema";
import { ethereum } from "@graphprotocol/graph-ts";


function id(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

export function handleProposePolicy(event: ProposePolicyEvent): void {
  let e = new SVRPolicyProposed(id(event));
  e.svr = event.address;
  e.scopeKind = event.params.scope.kind;
  e.assetType = event.params.scope.assetType;
  e.asset = event.params.scope.asset;
  e.assetId = event.params.scope.id;
  e.kind = event.params.newPolicy.kind;
  e.windowSeconds = event.params.newPolicy.windowSeconds;
  e.proposalDelaySeconds = event.params.newPolicy.proposalDelaySeconds;
  e.value = event.params.newPolicy.value;
  e.delay = event.params.delay;
  e.createdAt = event.block.timestamp;
  e.save();
}

export function handleExecutePolicy(event: ExecutePolicyEvent): void {
  let e = new SVRPolicyExecuted(id(event));
  e.svr = event.address;
  e.scopeKind = event.params.scope.kind;
  e.assetType = event.params.scope.assetType;
  e.asset = event.params.scope.asset;
  e.assetId = event.params.scope.id;
  e.kind = event.params.newPolicy.kind;
  e.windowSeconds = event.params.newPolicy.windowSeconds;
  e.proposalDelaySeconds = event.params.newPolicy.proposalDelaySeconds;
  e.value = event.params.newPolicy.value;
  e.executedAt = event.block.timestamp;
  e.save();
}

export function handleCancelPolicy(event: CancelPolicyEvent): void {
  let e = new SVRPolicyCancelled(id(event));
  e.svr = event.address;
  e.scopeKind = event.params.scope.kind;
  e.assetType = event.params.scope.assetType;
  e.asset = event.params.scope.asset;
  e.assetId = event.params.scope.id;
  e.cancelledAt = event.block.timestamp;
  e.save();
}
