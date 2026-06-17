import {
  DistributionCreated,
  HolderPaid,
  DistributionChunk,
  DistributionDone,
  DistributionCancelled
} from "../generated/DistributionManager/DistributionManager";

import { Distribution, DistributionPayout } from "../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";

// Indexes cap-table distributions (payouts to share holders) from the singleton
// DistributionManager. A Distribution row is created on DistributionCreated and
// runs through "Processing" → "Done"/"Cancelled"; each HolderPaid spawns an
// immutable DistributionPayout linked back to its Distribution.

export function handleDistributionCreated(event: DistributionCreated): void {
  let d = new Distribution(event.params.id.toString());
  d.distributionId = event.params.id;
  d.slug = event.params.slug;
  d.shareToken = event.params.shareToken;
  d.label = event.params.label;
  d.recordDate = event.params.recordDate;
  d.funded = event.params.funded;
  d.paid = BigInt.zero();
  d.status = "Processing";
  d.createdAt = event.block.timestamp;
  d.updatedAt = event.block.timestamp;
  d.txHash = event.transaction.hash;
  d.save();
}

export function handleHolderPaid(event: HolderPaid): void {
  let payout = new DistributionPayout(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  payout.distribution = event.params.id.toString();
  payout.classId = event.params.classId;
  payout.holder = event.params.holder;
  payout.amount = event.params.amount;
  payout.blockNumber = event.block.number;
  payout.timestamp = event.block.timestamp;
  payout.txHash = event.transaction.hash;
  payout.save();

  let d = Distribution.load(event.params.id.toString());
  if (d != null) {
    d.paid = d.paid.plus(event.params.amount);
    d.updatedAt = event.block.timestamp;
    d.save();
  }
}

export function handleDistributionChunk(event: DistributionChunk): void {
  let d = Distribution.load(event.params.id.toString());
  if (d != null) {
    // `paid` from the chunk event is authoritative (running total).
    d.paid = event.params.paid;
    d.updatedAt = event.block.timestamp;
    d.save();
  }
}

export function handleDistributionDone(event: DistributionDone): void {
  let d = Distribution.load(event.params.id.toString());
  if (d != null) {
    d.status = "Done";
    d.paid = event.params.totalPaid;
    d.updatedAt = event.block.timestamp;
    d.save();
  }
}

export function handleDistributionCancelled(event: DistributionCancelled): void {
  let d = Distribution.load(event.params.id.toString());
  if (d != null) {
    d.status = "Cancelled";
    d.updatedAt = event.block.timestamp;
    d.save();
  }
}
