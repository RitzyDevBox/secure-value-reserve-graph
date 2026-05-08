// MultiTenantAuth (MTA) — singleton subgraph mappings.
//
// Indexes the subset of MTA events that drive stable on-chain state we want
// queryable from the frontend (members, roles, permissions, org-contract
// registry, slug pause/lock state). High-frequency / read-mostly streams
// (`Executed`, `RateStateReset`, `OrgContractClaim*`) are intentionally not
// handled; see the "Deferred" section near the bottom for skeleton stubs and
// rationale.
//
// All entity ids use lowercase hex with the `0x` prefix to match the
// conventions of dao-governor.ts / namespaced-create-3-factory.ts.

import {
  Bootstrapped,
  SuperAdminTransferred,
  SlugPaused,
  SlugUnpaused,
  SlugLocked,
  SlugUnlocked,
  FallbackAuthorizerSet,
  FoundationContractSet,
  OrgContractRegistered,
  OrgContractUnregistered,
  MemberOnboarded,
  MemberAccountTypeSet,
  MemberStatusSet,
  MemberNameSlugSet,
  MemberRemoved,
  RoleAssigned,
  RoleRevoked,
  RoleCreated,
  RoleUpdated,
  RoleDeleted,
  PermissionSet,
  PermissionCleared,
  TargetGrantSet,
  TargetGrantCleared,
  PublicSigSet,
  RateLimitSet,
} from "../generated/MultiTenantAuth/MultiTenantAuth";

import {
  SlugConfig,
  Member,
  Role,
  RoleAssignment,
  Permission,
  TargetGrant,
  PublicSig,
  OrgContract,
} from "../generated/schema";

import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";

// ─── ID helpers ──────────────────────────────────────────────────────────────

function slugId(slug: Bytes): string {
  return slug.toHexString();
}

function memberId(slug: Bytes, wallet: Address): string {
  return slug.toHexString() + "-" + wallet.toHexString();
}

function roleId(slug: Bytes, roleSlug: Bytes): string {
  return slug.toHexString() + "-" + roleSlug.toHexString();
}

function roleAssignmentId(slug: Bytes, wallet: Address, roleSlug: Bytes): string {
  return slug.toHexString() + "-" + wallet.toHexString() + "-" + roleSlug.toHexString();
}

function permissionId(slug: Bytes, role: Bytes, target: Address, sig: Bytes): string {
  return slug.toHexString() + "-" + role.toHexString() + "-" + target.toHexString() + "-" + sig.toHexString();
}

function targetGrantId(slug: Bytes, role: Bytes, target: Address): string {
  return slug.toHexString() + "-" + role.toHexString() + "-" + target.toHexString();
}

function publicSigId(slug: Bytes, target: Address, sig: Bytes): string {
  return slug.toHexString() + "-" + target.toHexString() + "-" + sig.toHexString();
}

// System-role detection. MTA never emits RoleCreated for these — they're
// hardcoded constants short-circuited in `_isSystemRole`. We detect them on
// the assignment path so the UI can flag them distinctly from custom roles.
const SYSTEM_ROLE_NAMES: string[] = [
  "SuperAdmin",
  "Admin",
  "Pauser",
  "RoleManager",
  "MemberManager",
  "PermissionManager",
  "PayrollOperator",
  "TreasuryOperator",
];

// Precomputed bytes32(string) hex for each system role. bytes32(string) packs the
// ASCII bytes into the high-order bytes and zero-pads the rest. Hardcoded as
// constants to sidestep an AssemblyScript compiler crash on the dynamic
// stringToBytes32Hex helper (compileBinaryOverload assertion).
const SYSTEM_ROLE_HEXES: string[] = [
  "0x537570657241646d696e00000000000000000000000000000000000000000000", // SuperAdmin
  "0x41646d696e000000000000000000000000000000000000000000000000000000", // Admin
  "0x5061757365720000000000000000000000000000000000000000000000000000", // Pauser
  "0x526f6c654d616e61676572000000000000000000000000000000000000000000", // RoleManager
  "0x4d656d6265724d616e6167657200000000000000000000000000000000000000", // MemberManager
  "0x5065726d697373696f6e4d616e61676572000000000000000000000000000000", // PermissionManager
  "0x506179726f6c6c4f70657261746f720000000000000000000000000000000000", // PayrollOperator
  "0x54726561737572794f70657261746f7200000000000000000000000000000000", // TreasuryOperator
];

function isSystemRoleSlug(roleSlug: Bytes): boolean {
  let hex = roleSlug.toHexString();
  for (let i = 0; i < SYSTEM_ROLE_HEXES.length; i++) {
    if (hex == SYSTEM_ROLE_HEXES[i]) return true;
  }
  return false;
}

// ─── SlugConfig ──────────────────────────────────────────────────────────────

function ensureSlugConfig(slug: Bytes): SlugConfig {
  let id = slugId(slug);
  let cfg = SlugConfig.load(id);
  if (cfg == null) {
    cfg = new SlugConfig(id);
    cfg.slug = slug;
    cfg.state = "Normal";
    cfg.bootstrapped = false;
  }
  return cfg as SlugConfig;
}

export function handleBootstrapped(event: Bootstrapped): void {
  let cfg = ensureSlugConfig(event.params.slug);
  cfg.superAdmin = event.params.superAdmin;
  cfg.bootstrapped = true;
  cfg.bootstrapTime = event.block.timestamp;
  cfg.state = "Normal";

  let admins = event.params.initialAdmins;
  let copy = new Array<Bytes>(admins.length);
  for (let i = 0; i < admins.length; i++) {
    copy[i] = admins[i];
  }
  cfg.initialAdmins = copy;
  cfg.save();
}

export function handleSuperAdminTransferred(event: SuperAdminTransferred): void {
  let cfg = ensureSlugConfig(event.params.slug);
  cfg.superAdmin = event.params.current;
  cfg.save();
}

export function handleSlugPaused(event: SlugPaused): void {
  let cfg = ensureSlugConfig(event.params.slug);
  cfg.state = "Paused";
  cfg.save();
}

export function handleSlugUnpaused(event: SlugUnpaused): void {
  let cfg = ensureSlugConfig(event.params.slug);
  cfg.state = "Normal";
  cfg.save();
}

export function handleSlugLocked(event: SlugLocked): void {
  let cfg = ensureSlugConfig(event.params.slug);
  cfg.state = "Locked";
  cfg.save();
}

export function handleSlugUnlocked(event: SlugUnlocked): void {
  let cfg = ensureSlugConfig(event.params.slug);
  cfg.state = "Normal";
  cfg.save();
}

export function handleFallbackAuthorizerSet(event: FallbackAuthorizerSet): void {
  let cfg = ensureSlugConfig(event.params.slug);
  cfg.fallbackAuthorizer = event.params.current;
  cfg.save();
}

// ─── OrgContract registry ────────────────────────────────────────────────────

export function handleFoundationContractSet(event: FoundationContractSet): void {
  let id = event.params.target.toHexString();
  let row = OrgContract.load(id);
  if (row == null) {
    row = new OrgContract(id);
  }
  // target is also the entity id, idempotent. Keeping outside the if-null branch
  // sidesteps an AssemblyScript compileBinaryOverload crash on the Address→Bytes
  // setter at fresh-object init when paired with another assignment in the same
  // branch.
  row.target = event.params.target;
  row.isFoundation = true;
  row.registeredAt = event.block.timestamp;
  row.save();
}

export function handleOrgContractRegistered(event: OrgContractRegistered): void {
  let id = event.params.target.toHexString();
  let row = OrgContract.load(id);
  if (row == null) {
    row = new OrgContract(id);
    row.isFoundation = false;
  }
  row.target = event.params.target;
  row.slug = event.params.slug;
  row.registeredAt = event.block.timestamp;
  row.unregisteredAt = null;
  row.save();
}

export function handleOrgContractUnregistered(event: OrgContractUnregistered): void {
  let id = event.params.target.toHexString();
  let row = OrgContract.load(id);
  if (row == null) {
    // Defensive: unregister-before-register is impossible on-chain, but if the
    // start block was set after the original registration we'd see one without
    // the other. Build a minimal placeholder so the unregister timestamp isn't lost.
    row = new OrgContract(id);
    row.isFoundation = false;
  }
  row.target = event.params.target;
  row.slug = event.params.slug;
  row.unregisteredAt = event.block.timestamp;
  row.save();
}

// ─── Members ─────────────────────────────────────────────────────────────────

function ensureMember(slug: Bytes, wallet: Address, blockTime: BigInt): Member {
  let id = memberId(slug, wallet);
  let m = Member.load(id);
  if (m == null) {
    m = new Member(id);
    m.slug = slug;
    m.dateAdded = blockTime;
  }
  // wallet (Address) → m.wallet (Bytes) — kept outside if-null branch.
  m.wallet = wallet;
  return m as Member;
}

export function handleMemberOnboarded(event: MemberOnboarded): void {
  let m = ensureMember(event.params.slug, event.params.wallet, event.block.timestamp);
  m.nameSlug = event.params.nameSlug;
  m.accountType = event.params.accountType;
  // MembersContract.sol seeds new members at MemberStatus.Invited (=3). A
  // MemberStatusSet may arrive in the same tx and overwrite; that's fine.
  // We initialize unconditionally so re-onboards (after a removal) reset the
  // status alongside dateAdded.
  m.status = 3; // MemberStatus.Invited
  m.removedAt = null;
  m.save();
}

export function handleMemberAccountTypeSet(event: MemberAccountTypeSet): void {
  let m = ensureMember(event.params.slug, event.params.wallet, event.block.timestamp);
  m.accountType = event.params.accountType;
  m.save();
}

export function handleMemberStatusSet(event: MemberStatusSet): void {
  let m = ensureMember(event.params.slug, event.params.wallet, event.block.timestamp);
  m.status = event.params.status;
  m.save();
}

export function handleMemberNameSlugSet(event: MemberNameSlugSet): void {
  let m = ensureMember(event.params.slug, event.params.wallet, event.block.timestamp);
  m.nameSlug = event.params.newNameSlug;
  m.save();
}

export function handleMemberRemoved(event: MemberRemoved): void {
  let id = memberId(event.params.slug, event.params.wallet);
  let m = Member.load(id);
  if (m == null) return;
  m.removedAt = event.block.timestamp;
  m.role = null;
  m.save();
}

// ─── Roles ───────────────────────────────────────────────────────────────────

export function handleRoleAssigned(event: RoleAssigned): void {
  let m = ensureMember(event.params.slug, event.params.wallet, event.block.timestamp);
  m.role = event.params.roleSlug;
  m.save();

  let raId = roleAssignmentId(event.params.slug, event.params.wallet, event.params.roleSlug);
  let ra = RoleAssignment.load(raId);
  if (ra == null) {
    ra = new RoleAssignment(raId);
    ra.slug = event.params.slug;
    ra.roleSlug = event.params.roleSlug;
    ra.grantedAt = event.block.timestamp;
  } else {
    // Re-assignment after a prior revoke: clear revokedAt and refresh grantedAt.
    ra.grantedAt = event.block.timestamp;
    ra.revokedAt = null;
  }
  // wallet (Address) → ra.wallet (Bytes) — outside the if branch.
  ra.wallet = event.params.wallet;
  ra.save();

  // Side-effect: synthesize a Role row for system roles the first time we see
  // them assigned, so the UI can join Member.role -> Role even though
  // RoleCreated never fires for them.
  if (isSystemRoleSlug(event.params.roleSlug)) {
    let rid = roleId(event.params.slug, event.params.roleSlug);
    let r = Role.load(rid);
    if (r == null) {
      r = new Role(rid);
      r.slug = event.params.slug;
      r.roleSlug = event.params.roleSlug;
      r.isCustom = false;
      r.isSystemRole = true;
      r.save();
    }
  }
}

export function handleRoleRevoked(event: RoleRevoked): void {
  // MembersContract.sol enforces single-role-per-member, so the revoked role is
  // always the current one. Clear unconditionally rather than match-and-clear —
  // the latter requires nesting `(currentRole as Bytes).toHexString() == ...`
  // inside a nullness if, which trips an AssemblyScript compileBinaryOverload
  // crash even when split across locals.
  let id = memberId(event.params.slug, event.params.wallet);
  let m = Member.load(id);
  if (m != null) {
    m.role = null;
    m.save();
  }

  let raId = roleAssignmentId(event.params.slug, event.params.wallet, event.params.previousRoleSlug);
  let ra = RoleAssignment.load(raId);
  if (ra == null) return;
  ra.revokedAt = event.block.timestamp;
  ra.save();
}

export function handleRoleCreated(event: RoleCreated): void {
  let id = roleId(event.params.slug, event.params.roleSlug);
  let r = Role.load(id);
  if (r == null) {
    r = new Role(id);
    r.slug = event.params.slug;
    r.roleSlug = event.params.roleSlug;
  }
  r.appliesTo = event.params.appliesTo;
  r.isDefault = event.params.isDefault;
  r.isCustom = true;
  r.isSystemRole = false;
  r.createdAt = event.block.timestamp;
  r.deletedAt = null;
  r.save();
}

export function handleRoleUpdated(event: RoleUpdated): void {
  let id = roleId(event.params.slug, event.params.roleSlug);
  let r = Role.load(id);
  if (r == null) {
    r = new Role(id);
    r.slug = event.params.slug;
    r.roleSlug = event.params.roleSlug;
    r.isCustom = true;
    r.isSystemRole = false;
    r.createdAt = event.block.timestamp;
  }
  r.appliesTo = event.params.appliesTo;
  r.isDefault = event.params.isDefault;
  r.save();
}

export function handleRoleDeleted(event: RoleDeleted): void {
  let id = roleId(event.params.slug, event.params.roleSlug);
  let r = Role.load(id);
  if (r == null) return;
  r.deletedAt = event.block.timestamp;
  r.save();
}

// ─── Permissions ─────────────────────────────────────────────────────────────

export function handlePermissionSet(event: PermissionSet): void {
  let id = permissionId(event.params.slug, event.params.roleSlug, event.params.target, event.params.sig);
  let p = Permission.load(id);
  if (p == null) {
    p = new Permission(id);
    p.slug = event.params.slug;
    p.role = event.params.roleSlug;
    p.sig = event.params.sig;
    p.createdAt = event.block.timestamp;
  }
  // target (Address) → p.target (Bytes) — kept outside the if-null branch.
  p.target = event.params.target;
  // mode / customAuthorizer / validity / constraints / rate-limit fields are
  // NOT carried on PermissionSet — see "Deferred" notes. Rate-limit details
  // arrive separately via RateLimitSet (fired in the same tx) and are merged
  // there. The remaining fields require a contract read (PermissionsContract
  // does not expose a getter today) and stay null until that's added.
  p.updatedAt = event.block.timestamp;
  p.deletedAt = null;
  p.save();
}

export function handlePermissionCleared(event: PermissionCleared): void {
  let id = permissionId(event.params.slug, event.params.roleSlug, event.params.target, event.params.sig);
  let p = Permission.load(id);
  if (p == null) return;
  p.deletedAt = event.block.timestamp;
  p.updatedAt = event.block.timestamp;
  p.save();
}

export function handleRateLimitSet(event: RateLimitSet): void {
  // RateLimitSet always fires in the same tx as a preceding PermissionSet for
  // the same key — merge into the existing Permission row when present so the
  // UI can read rate config without a separate join.
  let id = permissionId(event.params.slug, event.params.roleSlug, event.params.target, event.params.sig);
  let p = Permission.load(id);
  if (p == null) {
    // Defensive: if start-block ordering split the two events, materialize a
    // sparse Permission row. createdAt becomes the rate-limit timestamp; the
    // future reconciler can backfill from PermissionSet logs.
    p = new Permission(id);
    p.slug = event.params.slug;
    p.role = event.params.roleSlug;
    p.sig = event.params.sig;
    p.createdAt = event.block.timestamp;
  }
  // target (Address) → p.target (Bytes) — kept outside the if-null branch.
  p.target = event.params.target;
  // graph-cli maps uint32 → BigInt for event params (see generated bindings).
  p.rateMaxCalls = event.params.maxCalls;
  p.rateWindowSeconds = event.params.windowSeconds;
  p.updatedAt = event.block.timestamp;
  p.save();
}

// ─── Target grants & public sigs ─────────────────────────────────────────────

export function handleTargetGrantSet(event: TargetGrantSet): void {
  let id = targetGrantId(event.params.slug, event.params.roleSlug, event.params.target);
  let g = TargetGrant.load(id);
  if (g == null) {
    g = new TargetGrant(id);
    g.slug = event.params.slug;
    g.role = event.params.roleSlug;
  }
  // target (Address) → g.target (Bytes) — kept outside the if-null branch.
  g.target = event.params.target;
  g.mode = event.params.mode;
  g.customAddr = event.params.customAddr;
  g.updatedAt = event.block.timestamp;
  g.clearedAt = null;
  g.save();
}

export function handleTargetGrantCleared(event: TargetGrantCleared): void {
  let id = targetGrantId(event.params.slug, event.params.roleSlug, event.params.target);
  let g = TargetGrant.load(id);
  if (g == null) return;
  g.clearedAt = event.block.timestamp;
  g.updatedAt = event.block.timestamp;
  g.save();
}

export function handlePublicSigSet(event: PublicSigSet): void {
  let id = publicSigId(event.params.slug, event.params.target, event.params.sig);
  let p = PublicSig.load(id);
  if (p == null) {
    p = new PublicSig(id);
    p.slug = event.params.slug;
    p.sig = event.params.sig;
  }
  // target (Address) → p.target (Bytes) — kept outside the if-null branch.
  p.target = event.params.target;
  p.isPublic = event.params.isPublic;
  p.updatedAt = event.block.timestamp;
  p.save();
}

// ─── Deferred ────────────────────────────────────────────────────────────────
//
// The following events are intentionally NOT wired up. Rationale captured here
// so the next pass doesn't have to re-derive it:
//
//   - Executed: high-frequency (every privileged call). Storing it would bloat
//     the index with little query value beyond what tx logs already give. Add
//     a dedicated `AuthExecution` entity if the UI needs an activity feed.
//
//   - RateStateReset: bookkeeping ping. The current rate-limit state itself
//     isn't indexed (would require per-block window evaluation); without that,
//     a reset event carries no actionable information.
//
//   - OrgContractClaimed / OrgContractClaimCancelled: these are intermediate
//     states in the 3-step claim → register flow. The terminal states
//     (Registered / Unregistered) are what consumers want; intermediate
//     claims would only matter if we were surfacing a "pending claims"
//     dashboard.
//
//   - AdminTransferred / LauncherSet: global (non-per-slug) admin events.
//     Useful for a system-wide audit log; not needed for org-scoped UI today.
//
//   - RolePurged: emitted as the bulk side-effect of RoleDeleted. The
//     individual RoleRevoked events for each member fire alongside it and
//     already update Member.role / RoleAssignment.revokedAt, so the bulk
//     summary is redundant for query purposes.
//
//   - Permission detail fields (mode, customAuthorizer, validFrom, validUntil,
//     hasConstraints, constraints): not on the PermissionSet event signature.
//     Capturing them requires either (a) a contract read in handlePermissionSet
//     using `MultiTenantAuth.bind(event.address)` plus a not-yet-existing
//     getter on PermissionsContract, or (b) ABI-decoding the originating
//     calldata. Chose (b) for a future reconciler — needs PermissionsContract
//     to expose `getPermissionHeader(slug, role, target, sig)` first.
