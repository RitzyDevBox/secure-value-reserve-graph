import {
  ClassCreated,
  ClassRetired,
  ClassRemoved,
  GrantIssued,
  GrantTransferred,
  GrantSettled,
  GrantCancelled,
  GrantClawedBack
} from "../generated/templates/ShareToken/ShareToken";

import { ShareClass, Grant, ShareHolding } from "../generated/schema";
import { Address, BigInt } from "@graphprotocol/graph-ts";

// Per-org cap-table (ShareToken) indexing. Spawned as a dynamic template by the
// ShareTokenFactory handler. `event.address` is the ShareToken contract and keys
// every entity below so multiple cap tables never collide. Tracks share classes,
// grants (with forfeiture), and net per-(class, holder) balances (ShareHolding).

function classKey(shareToken: Address, classId: BigInt): string {
  return shareToken.toHexString() + "-" + classId.toString();
}

function grantKey(shareToken: Address, grantId: BigInt): string {
  return shareToken.toHexString() + "-" + grantId.toString();
}

function holdingKey(shareToken: Address, classId: BigInt, holder: Address): string {
  return (
    shareToken.toHexString() +
    "-" +
    classId.toString() +
    "-" +
    holder.toHexString()
  );
}

// Returns an existing ShareHolding or a new one with a zeroed balance and its
// immutable identity fields set. Caller mutates `balance`/`updatedAt` and saves.
function loadOrCreateHolding(
  shareToken: Address,
  classId: BigInt,
  holder: Address
): ShareHolding {
  let key = holdingKey(shareToken, classId, holder);
  let h = ShareHolding.load(key);
  if (h == null) {
    h = new ShareHolding(key);
    h.shareToken = shareToken;
    h.classId = classId;
    h.holder = holder;
    h.balance = BigInt.zero();
  }
  return h;
}

export function handleClassCreated(event: ClassCreated): void {
  let c = new ShareClass(classKey(event.address, event.params.classId));
  c.shareToken = event.address;
  c.classId = event.params.classId;
  c.name = event.params.name;
  // voteWeightBps is uint32 → graph-ts types it as BigInt; the schema field is
  // Int! (i32). bps fits comfortably in i32, so narrow it.
  c.voteWeightBps = event.params.voteWeightBps.toI32();
  c.status = "Active";
  c.createdAt = event.block.timestamp;
  c.save();
}

export function handleClassRetired(event: ClassRetired): void {
  let c = ShareClass.load(classKey(event.address, event.params.classId));
  if (c != null) {
    c.status = "Retired";
    c.save();
  }
}

export function handleClassRemoved(event: ClassRemoved): void {
  let c = ShareClass.load(classKey(event.address, event.params.classId));
  if (c != null) {
    c.status = "Removed";
    c.save();
  }
}

export function handleGrantIssued(event: GrantIssued): void {
  let g = new Grant(grantKey(event.address, event.params.grantId));
  g.shareToken = event.address;
  g.grantId = event.params.grantId;
  g.classId = event.params.classId;
  g.holder = event.params.holder;
  g.amount = event.params.amount;
  g.status = "Active";
  g.forfeited = BigInt.zero();
  g.createdAt = event.block.timestamp;
  g.updatedAt = event.block.timestamp;
  g.txHash = event.transaction.hash;
  g.save();

  let h = loadOrCreateHolding(
    event.address,
    event.params.classId,
    event.params.holder
  );
  h.balance = h.balance.plus(event.params.amount);
  h.updatedAt = event.block.timestamp;
  h.save();
}

export function handleGrantTransferred(event: GrantTransferred): void {
  // No grantId on this event — only move ShareHolding balances for (class, from/to).
  let fromH = loadOrCreateHolding(
    event.address,
    event.params.classId,
    event.params.from
  );
  fromH.balance = fromH.balance.minus(event.params.amount);
  fromH.updatedAt = event.block.timestamp;
  fromH.save();

  let toH = loadOrCreateHolding(
    event.address,
    event.params.classId,
    event.params.to
  );
  toH.balance = toH.balance.plus(event.params.amount);
  toH.updatedAt = event.block.timestamp;
  toH.save();
}

export function handleGrantSettled(event: GrantSettled): void {
  // Settlement reclassifies the grant; the holder keeps the shares (no balance change).
  let g = Grant.load(grantKey(event.address, event.params.grantId));
  if (g != null) {
    g.status = "Settled";
    g.updatedAt = event.block.timestamp;
    g.save();
  }
}

export function handleGrantCancelled(event: GrantCancelled): void {
  applyForfeiture(event.address, event.params.grantId, event.params.holder, event.params.forfeited, event.block.timestamp, "Cancelled");
}

export function handleGrantClawedBack(event: GrantClawedBack): void {
  applyForfeiture(event.address, event.params.grantId, event.params.holder, event.params.forfeited, event.block.timestamp, "ClawedBack");
}

// Shared logic for GrantCancelled / GrantClawedBack: mark the grant, accrue the
// forfeited amount, floor the remaining grant amount at zero, and decrement the
// matching ShareHolding balance.
function applyForfeiture(
  shareToken: Address,
  grantId: BigInt,
  holder: Address,
  forfeited: BigInt,
  timestamp: BigInt,
  status: string
): void {
  let g = Grant.load(grantKey(shareToken, grantId));
  if (g == null) {
    return;
  }
  g.status = status;
  g.forfeited = g.forfeited.plus(forfeited);
  let remaining = g.amount.minus(forfeited);
  g.amount = remaining.lt(BigInt.zero()) ? BigInt.zero() : remaining;
  g.updatedAt = timestamp;
  g.save();

  let h = loadOrCreateHolding(shareToken, g.classId, holder);
  h.balance = h.balance.minus(forfeited);
  h.updatedAt = timestamp;
  h.save();
}
