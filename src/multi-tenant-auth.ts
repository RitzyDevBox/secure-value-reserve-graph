// MultiTenantAuth (MTA) — singleton subgraph mappings.
//
// Indexes the subset of MTA events that drive stable on-chain state we want
// queryable from the frontend (members, roles, permissions, org-contract
// registry, slug pause/lock state). High-frequency / read-mostly streams
// (`Executed`, `RateStateReset`, `OrgContractClaim*`) are intentionally not
// handled; see the "Deferred" section near the bottom for skeleton stubs and
// rationale.
//
// Identity model: every member-touching event carries the global `memberId`
// (uint256). Entities key on memberId — not on (slug, wallet) — so the audit
// trail survives wallet rotations. The Member.wallet field tracks the *current*
// wallet and is refreshed by handleWalletRotated; historical wallet snapshots
// land in the WalletRotation entity.

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
  WalletRotated,
  RoleAssigned,
  RoleRevoked,
  RoleCreated,
  RoleUpdated,
  RoleDeleted,
  PermissionCreated,
  PermissionUpdated,
  PermissionDeleted,
  PermissionAttached,
  PermissionDetached,
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
  RolePermission,
  TargetGrant,
  PublicSig,
  OrgContract,
  WalletRotation,
} from "../generated/schema";

import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";

// ─── ID helpers ──────────────────────────────────────────────────────────────

function slugId(slug: Bytes): string {
  return slug.toHexString();
}

function memberEntityId(memberId: BigInt): string {
  return memberId.toString();
}

function roleId(slug: Bytes, roleSlug: Bytes): string {
  return slug.toHexString() + "-" + roleSlug.toHexString();
}

function roleAssignmentId(memberId: BigInt, roleSlug: Bytes): string {
  return memberId.toString() + "-" + roleSlug.toHexString();
}

function permissionId(slug: Bytes, permId: BigInt): string {
  return slug.toHexString() + "-" + permId.toString();
}

function rolePermissionId(slug: Bytes, roleSlug: Bytes, permId: BigInt): string {
  return slug.toHexString() + "-" + roleSlug.toHexString() + "-" + permId.toString();
}

function targetGrantId(slug: Bytes, role: Bytes, target: Address): string {
  return slug.toHexString() + "-" + role.toHexString() + "-" + target.toHexString();
}

function publicSigId(slug: Bytes, target: Address, sig: Bytes): string {
  return slug.toHexString() + "-" + target.toHexString() + "-" + sig.toHexString();
}

function walletRotationId(txHash: Bytes, logIndex: BigInt): string {
  return txHash.toHexString() + "-" + logIndex.toString();
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
  cfg.superAdminId = event.params.superAdminId;
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
  cfg.superAdminId = event.params.currentId;
  // Look up the new super admin's current wallet from the Member entity so
  // the wallet snapshot stays in sync.
  let newSa = Member.load(memberEntityId(event.params.currentId));
  if (newSa != null) {
    cfg.superAdmin = newSa.wallet;
  }
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
//
// Identity is the contract's `memberId` (BigInt). Entities key on it; the
// wallet field is mutable and refreshed by handleWalletRotated.

function loadMemberById(memberId: BigInt): Member | null {
  return Member.load(memberEntityId(memberId));
}

export function handleMemberOnboarded(event: MemberOnboarded): void {
  let id = memberEntityId(event.params.memberId);
  let m = Member.load(id);
  if (m == null) {
    m = new Member(id);
    m.memberId = event.params.memberId;
    m.slug = event.params.slug;
    m.dateAdded = event.block.timestamp;
  }
  // wallet (Address) → m.wallet (Bytes) — kept outside the if-null branch to
  // sidestep an AssemblyScript compileBinaryOverload assertion seen on
  // Address→Bytes assignment paired with other writes in the same branch.
  m.wallet = event.params.wallet;
  m.nameSlug = event.params.nameSlug;
  m.accountType = event.params.accountType;
  // Contract seeds new members at MemberStatus.Active (=0). RoleAssigned may
  // arrive in the same tx (when MemberInit.roleSlug is non-zero) and update
  // m.role; that handler doesn't touch status so the Active default holds.
  m.status = 0; // MemberStatus.Active
  m.removedAt = null;
  m.save();
}

export function handleMemberAccountTypeSet(event: MemberAccountTypeSet): void {
  let m = loadMemberById(event.params.memberId);
  if (m == null) return;
  m.accountType = event.params.accountType;
  m.save();
}

export function handleMemberStatusSet(event: MemberStatusSet): void {
  let m = loadMemberById(event.params.memberId);
  if (m == null) return;
  m.status = event.params.status;
  m.save();
}

export function handleMemberNameSlugSet(event: MemberNameSlugSet): void {
  let m = loadMemberById(event.params.memberId);
  if (m == null) return;
  m.nameSlug = event.params.newNameSlug;
  m.save();
}

export function handleMemberRemoved(event: MemberRemoved): void {
  let m = loadMemberById(event.params.memberId);
  if (m == null) return;
  m.removedAt = event.block.timestamp;
  m.role = null;
  m.save();
}

export function handleWalletRotated(event: WalletRotated): void {
  // Update the Member record's mutable wallet field — memberId stays the
  // same, role / status / pay history stay attached.
  let m = loadMemberById(event.params.memberId);
  if (m != null) {
    m.wallet = event.params.newWallet;
    m.save();
  }

  // If the rotated member is the slug's super admin, refresh the snapshot
  // on SlugConfig so consumers reading SlugConfig.superAdmin see the new
  // address without having to join through Member.
  let cfg = SlugConfig.load(slugId(event.params.slug));
  if (cfg != null && cfg.superAdminId !== null && (cfg.superAdminId as BigInt).equals(event.params.memberId)) {
    cfg.superAdmin = event.params.newWallet;
    cfg.save();
  }

  // Append-only audit row.
  let id = walletRotationId(event.transaction.hash, event.logIndex);
  let row = new WalletRotation(id);
  row.memberId = event.params.memberId;
  row.slug = event.params.slug;
  row.previousWallet = event.params.previousWallet;
  row.newWallet = event.params.newWallet;
  row.rotatedAt = event.block.timestamp;
  row.save();
}

// ─── Roles ───────────────────────────────────────────────────────────────────

export function handleRoleAssigned(event: RoleAssigned): void {
  let m = loadMemberById(event.params.memberId);
  if (m != null) {
    m.role = event.params.roleSlug;
    m.save();
  }

  let raId = roleAssignmentId(event.params.memberId, event.params.roleSlug);
  let ra = RoleAssignment.load(raId);
  if (ra == null) {
    ra = new RoleAssignment(raId);
    ra.memberId = event.params.memberId;
    ra.slug = event.params.slug;
    ra.roleSlug = event.params.roleSlug;
    ra.grantedAt = event.block.timestamp;
  } else {
    // Re-assignment after a prior revoke: clear revokedAt and refresh grantedAt.
    ra.grantedAt = event.block.timestamp;
    ra.revokedAt = null;
  }
  // Snapshot the wallet at grant time. Historical reads of this row keep
  // the wallet that held the role when it was granted, even if the member
  // has rotated keys since.
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
  // MembersContract enforces single-role-per-member, so the revoked role is
  // always the current one. Clear unconditionally rather than match-and-clear —
  // the latter requires nesting `(currentRole as Bytes).toHexString() == ...`
  // inside a nullness if, which trips an AssemblyScript compileBinaryOverload
  // crash even when split across locals.
  let m = loadMemberById(event.params.memberId);
  if (m != null) {
    m.role = null;
    m.save();
  }

  let raId = roleAssignmentId(event.params.memberId, event.params.previousRoleSlug);
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
//
// Permissions are slug-scoped first-class entities (no role component). The
// `Permission` row is keyed by (slug, permId). Role membership lives in the
// `RolePermission` junction, written by the Attached/Detached handlers.

export function handlePermissionCreated(event: PermissionCreated): void {
  let id = permissionId(event.params.slug, event.params.permId);
  let p = Permission.load(id);
  if (p == null) {
    p = new Permission(id);
    p.slug = event.params.slug;
    p.permId = event.params.permId;
    p.sig = event.params.sig;
    p.createdAt = event.block.timestamp;
  }
  // target (Address) → p.target (Bytes) — kept outside the if-null branch
  // to sidestep the AssemblyScript compileBinaryOverload assertion (see
  // skills/graph-indexing/SKILL.md).
  p.target = event.params.target;
  // mode / customAuthorizer / validity / constraints fields are NOT carried
  // on PermissionCreated — they require a future cross-event reconciler.
  // Rate-limit details DO arrive via the same-tx RateLimitSet event and are
  // merged in handleRateLimitSet.
  p.updatedAt = event.block.timestamp;
  p.deletedAt = null;
  p.save();
}

export function handlePermissionUpdated(event: PermissionUpdated): void {
  let id = permissionId(event.params.slug, event.params.permId);
  let p = Permission.load(id);
  if (p == null) return;
  // Spec fields aren't on the event — bump updatedAt and clear any prior
  // soft-delete; the reconciler will fill in mode/validity/etc. later.
  p.updatedAt = event.block.timestamp;
  p.deletedAt = null;
  p.save();
}

export function handlePermissionDeleted(event: PermissionDeleted): void {
  let id = permissionId(event.params.slug, event.params.permId);
  let p = Permission.load(id);
  if (p == null) return;
  p.deletedAt = event.block.timestamp;
  p.updatedAt = event.block.timestamp;
  p.save();
  // The contract cascade-detaches before deleting; PermissionDetached events
  // fire alongside for each role and are handled by handlePermissionDetached,
  // so we don't need to enumerate junction rows here.
}

export function handlePermissionAttached(event: PermissionAttached): void {
  let id = rolePermissionId(event.params.slug, event.params.roleSlug, event.params.permId);
  let rp = RolePermission.load(id);
  if (rp == null) {
    rp = new RolePermission(id);
    rp.slug = event.params.slug;
    rp.permId = event.params.permId;
    rp.attachedAt = event.block.timestamp;
  } else {
    // Re-attach after a prior detach: refresh attachedAt + clear detachedAt.
    rp.attachedAt = event.block.timestamp;
    rp.detachedAt = null;
  }
  rp.roleSlug = event.params.roleSlug;
  rp.save();
}

export function handlePermissionDetached(event: PermissionDetached): void {
  let id = rolePermissionId(event.params.slug, event.params.roleSlug, event.params.permId);
  let rp = RolePermission.load(id);
  if (rp == null) return;
  rp.detachedAt = event.block.timestamp;
  rp.save();
}

export function handleRateLimitSet(event: RateLimitSet): void {
  // RateLimitSet fires in the same tx as a preceding PermissionCreated /
  // PermissionUpdated for the same permId — merge into the existing
  // Permission row so the UI can read rate config without a separate join.
  let id = permissionId(event.params.slug, event.params.permId);
  let p = Permission.load(id);
  if (p == null) {
    // Defensive: if start-block ordering split the two events, materialize a
    // sparse Permission row. createdAt becomes the rate-limit timestamp.
    p = new Permission(id);
    p.slug = event.params.slug;
    p.permId = event.params.permId;
    p.createdAt = event.block.timestamp;
  }
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
