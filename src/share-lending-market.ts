import {
  Listed,
  ListingClosed,
  Quoted,
  Accepted,
  QuoteRejected,
  QuoteWithdrawn,
  Funded,
  Repaid,
  Foreclosed,
  DepositForfeited,
  ReleaseApproved,
  Released,
  ShareTokenSet,
  ConfigSet,
  ShareLendingMarket,
} from "../generated/ShareLendingMarket/ShareLendingMarket";

import {
  LendingListing,
  LendingQuote,
  LendingLoan,
  LendingOrg,
} from "../generated/schema";

import { BigInt } from "@graphprotocol/graph-ts";

// Indexes the singleton ShareLendingMarket (cap-table P2P collateralized
// lending). Listings/quotes/loans are keyed per-org by `slug`. Several fields the
// UI needs (maxRateBps/termSeconds/requireDeposit/depositAmount on a
// listing; deposit on a quote; startedAt/maturity on a loan) are not carried in
// the events, so handlers read them via eth_call against the public getters
// (try_listings / try_quotes / try_loans), guarded and skip-on-reverted.

function listingId(slugHex: string, id: BigInt): string {
  return slugHex + "-" + id.toString();
}

function quoteEntityId(slugHex: string, lid: BigInt, qid: BigInt): string {
  return slugHex + "-" + lid.toString() + "-" + qid.toString();
}

function loanEntityId(slugHex: string, id: BigInt): string {
  return slugHex + "-" + id.toString();
}

export function handleListed(event: Listed): void {
  let slugHex = event.params.slug.toHexString();
  let id = listingId(slugHex, event.params.listingId);
  let l = new LendingListing(id);
  l.market = event.address;
  l.slug = event.params.slug;
  l.listingId = event.params.listingId;
  l.borrower = event.params.borrower;
  l.classId = event.params.classId;
  l.shares = event.params.shares;
  l.wantAmount = event.params.wantAmount;
  l.metadataHash = event.params.metadataHash;
  l.status = "Open";

  // Defaults for the off-event fields; overwritten from the getter when readable.
  l.maxRateBps = 0;
  l.termSeconds = BigInt.zero();
  l.requireDeposit = false;
  l.depositAmount = BigInt.zero();

  let market = ShareLendingMarket.bind(event.address);
  let res = market.try_listings(event.params.slug, event.params.listingId);
  if (!res.reverted) {
    let v = res.value;
    l.maxRateBps = v.getMaxRateBps();
    l.termSeconds = v.getTermSeconds();
    l.requireDeposit = v.getRequireDeposit();
    l.depositAmount = v.getDepositAmount();
  }

  l.createdAt = event.block.timestamp;
  l.updatedAt = event.block.timestamp;
  l.txHash = event.transaction.hash;
  l.save();
}

export function handleQuoted(event: Quoted): void {
  let slugHex = event.params.slug.toHexString();
  let lId = listingId(slugHex, event.params.listingId);
  let id = quoteEntityId(slugHex, event.params.listingId, event.params.quoteId);

  let q = new LendingQuote(id);
  q.listing = lId;
  q.slug = event.params.slug;
  q.listingId = event.params.listingId;
  q.quoteId = event.params.quoteId;
  q.lender = event.params.lender;
  q.amount = event.params.amount;
  q.rateBps = event.params.rateBps;
  q.termSeconds = event.params.termSeconds;
  q.expiry = event.params.expiry;
  q.mediator = event.params.mediator;
  q.status = "Open";

  // Deposit is not in the event; read it from the getter, fall back to the
  // listing's depositAmount when requireDeposit, else 0.
  let deposit = BigInt.zero();
  let market = ShareLendingMarket.bind(event.address);
  let res = market.try_quotes(
    event.params.slug,
    event.params.listingId,
    event.params.quoteId,
  );
  if (!res.reverted) {
    deposit = res.value.getDeposit();
  } else {
    let listing = LendingListing.load(lId);
    if (listing != null && listing.requireDeposit) {
      deposit = listing.depositAmount;
    }
  }
  q.deposit = deposit;

  q.createdAt = event.block.timestamp;
  q.updatedAt = event.block.timestamp;
  q.save();
}

export function handleAccepted(event: Accepted): void {
  let slugHex = event.params.slug.toHexString();
  let lId = listingId(slugHex, event.params.listingId);
  let loanIdStr = loanEntityId(slugHex, event.params.loanId);

  let listing = LendingListing.load(lId);
  if (listing != null) {
    listing.status = "Accepted";
    listing.loanId = event.params.loanId;
    listing.loan = loanIdStr;
    listing.updatedAt = event.block.timestamp;
    listing.save();
  }

  let qId = quoteEntityId(slugHex, event.params.listingId, event.params.quoteId);
  let q = LendingQuote.load(qId);
  if (q != null) {
    q.status = "Accepted";
    q.updatedAt = event.block.timestamp;
    q.save();
  }

  // Create the (unfunded) loan from the getter.
  let loan = new LendingLoan(loanIdStr);
  loan.slug = event.params.slug;
  loan.loanId = event.params.loanId;
  loan.listing = lId;
  loan.listingId = event.params.listingId;
  loan.quoteId = event.params.quoteId;
  loan.status = "Accepted";

  // Defaults; overwritten from the getter when readable.
  loan.borrower = event.address;
  loan.lender = event.address;
  loan.classId = BigInt.zero();
  loan.shares = BigInt.zero();
  loan.principal = BigInt.zero();
  loan.rateBps = 0;
  loan.penaltyRateBps = 0;
  loan.termSeconds = BigInt.zero();
  loan.acceptedAt = event.block.timestamp;
  loan.mediator = event.address;

  let market = ShareLendingMarket.bind(event.address);
  let res = market.try_loans(event.params.slug, event.params.loanId);
  if (!res.reverted) {
    let v = res.value;
    loan.borrower = v.getBorrower();
    loan.lender = v.getLender();
    loan.classId = v.getClassId();
    loan.shares = v.getShares();
    loan.principal = v.getPrincipal();
    loan.rateBps = v.getRateBps();
    loan.penaltyRateBps = v.getPenaltyRateBps();
    loan.termSeconds = v.getTermSeconds();
    loan.acceptedAt = v.getAcceptedAt();
    loan.mediator = v.getMediator();
    let startedAt = v.getStartedAt();
    if (startedAt.gt(BigInt.zero())) {
      loan.startedAt = startedAt;
      loan.maturity = v.getMaturity();
    }
  }

  loan.updatedAt = event.block.timestamp;
  loan.save();
}

export function handleQuoteRejected(event: QuoteRejected): void {
  let slugHex = event.params.slug.toHexString();
  let qId = quoteEntityId(slugHex, event.params.listingId, event.params.quoteId);
  let q = LendingQuote.load(qId);
  if (q != null) {
    q.status = "Rejected";
    q.updatedAt = event.block.timestamp;
    q.save();
  }
}

export function handleQuoteWithdrawn(event: QuoteWithdrawn): void {
  let slugHex = event.params.slug.toHexString();
  let qId = quoteEntityId(slugHex, event.params.listingId, event.params.quoteId);
  let q = LendingQuote.load(qId);
  if (q != null) {
    q.status = "Withdrawn";
    q.updatedAt = event.block.timestamp;
    q.save();
  }
}

export function handleFunded(event: Funded): void {
  let slugHex = event.params.slug.toHexString();
  let loanIdStr = loanEntityId(slugHex, event.params.loanId);

  let loan = LendingLoan.load(loanIdStr);
  if (loan != null) {
    loan.status = "Active";

    let market = ShareLendingMarket.bind(event.address);
    let res = market.try_loans(event.params.slug, event.params.loanId);
    if (!res.reverted) {
      let v = res.value;
      loan.startedAt = v.getStartedAt();
      loan.maturity = v.getMaturity();
    }
    loan.updatedAt = event.block.timestamp;
    loan.save();

    // Close the listing and mark the funded quote.
    let lId = listingId(slugHex, loan.listingId);
    let listing = LendingListing.load(lId);
    if (listing != null) {
      listing.status = "Closed";
      listing.updatedAt = event.block.timestamp;
      listing.save();
    }

    let qId = quoteEntityId(slugHex, loan.listingId, loan.quoteId);
    let q = LendingQuote.load(qId);
    if (q != null) {
      q.status = "Funded";
      q.updatedAt = event.block.timestamp;
      q.save();
    }
  }
}

export function handleRepaid(event: Repaid): void {
  let slugHex = event.params.slug.toHexString();
  let loan = LendingLoan.load(loanEntityId(slugHex, event.params.loanId));
  if (loan != null) {
    loan.status = "Repaid";
    loan.updatedAt = event.block.timestamp;
    loan.save();
  }
}

export function handleForeclosed(event: Foreclosed): void {
  let slugHex = event.params.slug.toHexString();
  let loan = LendingLoan.load(loanEntityId(slugHex, event.params.loanId));
  if (loan != null) {
    loan.status = "Foreclosed";
    loan.updatedAt = event.block.timestamp;
    loan.save();
  }
}

export function handleDepositForfeited(event: DepositForfeited): void {
  let slugHex = event.params.slug.toHexString();
  let lId = listingId(slugHex, event.params.listingId);

  let listing = LendingListing.load(lId);
  if (listing != null) {
    listing.status = "Closed";
    listing.updatedAt = event.block.timestamp;
    listing.save();

    // The unfunded loan attached to this listing is voided (Released).
    if (listing.loanId !== null) {
      let loanIdVal = listing.loanId as BigInt;
      let loan = LendingLoan.load(loanEntityId(slugHex, loanIdVal));
      if (loan != null) {
        loan.status = "Released";
        loan.updatedAt = event.block.timestamp;
        loan.save();
      }
    }
  }
}

export function handleReleaseApproved(event: ReleaseApproved): void {
  // Mutual-release approval — no entity state change (the Released event flips
  // the loan terminal). Intentionally a no-op beyond on-chain provenance.
}

export function handleReleased(event: Released): void {
  let slugHex = event.params.slug.toHexString();
  let loan = LendingLoan.load(loanEntityId(slugHex, event.params.loanId));
  if (loan != null) {
    loan.status = "Released";
    loan.updatedAt = event.block.timestamp;
    loan.save();
  }
}

export function handleListingClosed(event: ListingClosed): void {
  let slugHex = event.params.slug.toHexString();
  let listing = LendingListing.load(listingId(slugHex, event.params.listingId));
  if (listing != null) {
    // Only flip if not already terminal — Funded/Forfeited already closed it.
    if (listing.status != "Closed") {
      listing.status = "Closed";
      listing.updatedAt = event.block.timestamp;
      listing.save();
    }
  }
}

export function handleShareTokenSet(event: ShareTokenSet): void {
  let slugHex = event.params.slug.toHexString();
  let org = LendingOrg.load(slugHex);
  if (org == null) {
    org = new LendingOrg(slugHex);
    org.slug = event.params.slug;
  }
  org.shareToken = event.params.shareToken;
  org.market = event.address;
  org.updatedAt = event.block.timestamp;
  org.save();
}

export function handleConfigSet(event: ConfigSet): void {
  // Global, contract-wide config (gracePeriod/penaltyRateBps/fundWindow/feeSink).
  // Not slug-scoped, no entity to mutate — intentionally a no-op.
}
