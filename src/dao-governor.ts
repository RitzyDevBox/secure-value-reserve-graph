import {
	ProposalCanceled,
	ProposalCreated,
	ProposalExecuted,
	ProposalQueued,
	VoteCast,
	VoteCastWithParams,
	DAOGovernor as DAOGovernorContract
} from "../generated/templates/DAOGovernor/DAOGovernor";

import {
	DAOGovernorInstance,
	DAOProposal,
	DAOVote
} from "../generated/schema";

import { Address, BigInt, ByteArray, Bytes, crypto, ethereum } from "@graphprotocol/graph-ts";

const ZERO_BYTES32 = Bytes.fromHexString(
	"0x0000000000000000000000000000000000000000000000000000000000000000"
) as Bytes;

function eventId(event: ethereum.Event): string {
	return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

function proposalEntityId(dao: Address, proposalId: BigInt): string {
	return dao.toHexString() + "-" + proposalId.toString();
}

function toBytesArray(values: Address[]): Bytes[] {
	let out = new Array<Bytes>(values.length);
	for (let i = 0; i < values.length; i++) {
		out[i] = values[i];
	}
	return out;
}

function proposalStateLabel(value: i32): string {
	if (value == 0) return "PENDING";
	if (value == 1) return "ACTIVE";
	if (value == 2) return "CANCELED";
	if (value == 3) return "DEFEATED";
	if (value == 4) return "SUCCEEDED";
	if (value == 5) return "QUEUED";
	if (value == 6) return "EXPIRED";
	if (value == 7) return "EXECUTED";
	return "UNKNOWN";
}

function readProposalState(daoAddress: Address, proposalId: BigInt): string {
	let governor = DAOGovernorContract.bind(daoAddress);
	let stateResult = governor.try_state(proposalId);
	if (stateResult.reverted) {
		return "UNKNOWN";
	}

	return proposalStateLabel(stateResult.value);
}

function ensureGovernor(daoAddress: Address): DAOGovernorInstance {
	let id = daoAddress.toHexString();
	let dao = DAOGovernorInstance.load(id);
	if (dao == null) {
		dao = new DAOGovernorInstance(id);
		dao.namespace = Bytes.empty();
		dao.deployer = Address.zero();
		dao.createdAt = BigInt.zero();
		dao.txHash = Bytes.empty();
		dao.proposalCount = BigInt.zero();

		let governor = DAOGovernorContract.bind(daoAddress);
		let nameResult = governor.try_name();
		if (!nameResult.reverted) {
			dao.name = nameResult.value;
		}

		dao.save();
	}

	return dao;
}

export function handleProposalCreated(event: ProposalCreated): void {
	let dao = ensureGovernor(event.address);
	let id = proposalEntityId(event.address, event.params.proposalId);

	let proposal = new DAOProposal(id);
	proposal.dao = event.address;
	proposal.daoEntity = event.address.toHexString();
	proposal.proposalId = event.params.proposalId;
	proposal.proposer = event.params.proposer;
	proposal.targets = toBytesArray(event.params.targets);
	proposal.values = event.params.values;
	proposal.signatures = event.params.signatures;
	proposal.calldatas = event.params.calldatas;
	proposal.description = event.params.description;
	proposal.descriptionHash = Bytes.fromByteArray(
		crypto.keccak256(ByteArray.fromUTF8(event.params.description))
	);
	proposal.voteStart = event.params.voteStart;
	proposal.voteEnd = event.params.voteEnd;
	proposal.status = readProposalState(event.address, event.params.proposalId);
	proposal.createdAt = event.block.timestamp;
	proposal.createdTxHash = event.transaction.hash;
	proposal.save();

	dao.proposalCount = dao.proposalCount.plus(BigInt.fromI32(1));
	dao.save();
}

export function handleProposalCanceled(event: ProposalCanceled): void {
	let id = proposalEntityId(event.address, event.params.proposalId);
	let proposal = DAOProposal.load(id);
	if (proposal == null) {
		proposal = new DAOProposal(id);
		proposal.dao = event.address;
		proposal.daoEntity = event.address.toHexString();
		proposal.proposalId = event.params.proposalId;
		proposal.proposer = Address.zero();
		proposal.targets = [];
		proposal.values = [];
		proposal.signatures = [];
		proposal.calldatas = [];
		proposal.description = "";
		proposal.descriptionHash = ZERO_BYTES32;
		proposal.voteStart = BigInt.zero();
		proposal.voteEnd = BigInt.zero();
		proposal.createdAt = event.block.timestamp;
		proposal.createdTxHash = event.transaction.hash;
	}

	proposal.status = "CANCELED";
	proposal.canceledAt = event.block.timestamp;
	proposal.canceledTxHash = event.transaction.hash;
	proposal.save();
}

export function handleProposalQueued(event: ProposalQueued): void {
	let id = proposalEntityId(event.address, event.params.proposalId);
	let proposal = DAOProposal.load(id);
	if (proposal == null) {
		proposal = new DAOProposal(id);
		proposal.dao = event.address;
		proposal.daoEntity = event.address.toHexString();
		proposal.proposalId = event.params.proposalId;
		proposal.proposer = Address.zero();
		proposal.targets = [];
		proposal.values = [];
		proposal.signatures = [];
		proposal.calldatas = [];
		proposal.description = "";
		proposal.descriptionHash = ZERO_BYTES32;
		proposal.voteStart = BigInt.zero();
		proposal.voteEnd = BigInt.zero();
		proposal.createdAt = event.block.timestamp;
		proposal.createdTxHash = event.transaction.hash;
	}

	proposal.status = "QUEUED";
	proposal.etaSeconds = event.params.etaSeconds;
	proposal.queuedAt = event.block.timestamp;
	proposal.queuedTxHash = event.transaction.hash;
	proposal.save();
}

export function handleProposalExecuted(event: ProposalExecuted): void {
	let id = proposalEntityId(event.address, event.params.proposalId);
	let proposal = DAOProposal.load(id);
	if (proposal == null) {
		proposal = new DAOProposal(id);
		proposal.dao = event.address;
		proposal.daoEntity = event.address.toHexString();
		proposal.proposalId = event.params.proposalId;
		proposal.proposer = Address.zero();
		proposal.targets = [];
		proposal.values = [];
		proposal.signatures = [];
		proposal.calldatas = [];
		proposal.description = "";
		proposal.descriptionHash = ZERO_BYTES32;
		proposal.voteStart = BigInt.zero();
		proposal.voteEnd = BigInt.zero();
		proposal.createdAt = event.block.timestamp;
		proposal.createdTxHash = event.transaction.hash;
	}

	proposal.status = "EXECUTED";
	proposal.executedAt = event.block.timestamp;
	proposal.executedTxHash = event.transaction.hash;
	proposal.save();
}

export function handleVoteCast(event: VoteCast): void {
	let proposalId = proposalEntityId(event.address, event.params.proposalId);
	let vote = new DAOVote(eventId(event));
	vote.dao = event.address;
	vote.proposal = proposalId;
	vote.proposalId = event.params.proposalId;
	vote.voter = event.params.voter;
	vote.support = event.params.support;
	vote.weight = event.params.weight;
	vote.reason = event.params.reason;
	vote.createdAt = event.block.timestamp;
	vote.txHash = event.transaction.hash;
	vote.save();

	let proposal = DAOProposal.load(proposalId);
	if (proposal != null) {
		proposal.status = readProposalState(event.address, event.params.proposalId);
		proposal.save();
	}
}

export function handleVoteCastWithParams(event: VoteCastWithParams): void {
	let proposalId = proposalEntityId(event.address, event.params.proposalId);
	let vote = new DAOVote(eventId(event));
	vote.dao = event.address;
	vote.proposal = proposalId;
	vote.proposalId = event.params.proposalId;
	vote.voter = event.params.voter;
	vote.support = event.params.support;
	vote.weight = event.params.weight;
	vote.reason = event.params.reason;
	vote.params = event.params.params;
	vote.createdAt = event.block.timestamp;
	vote.txHash = event.transaction.hash;
	vote.save();

	let proposal = DAOProposal.load(proposalId);
	if (proposal != null) {
		proposal.status = readProposalState(event.address, event.params.proposalId);
		proposal.save();
	}
}
