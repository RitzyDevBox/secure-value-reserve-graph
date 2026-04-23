import {
  NamespacedDeployment,
  TemplateRegistered
} from "../generated/NamespacedCreate3Factory/NamespacedCreate3Factory";
import {
  SecureValueReserve as SVRTemplate,
  DAOGovernor as DAOGovernorTemplate
} from "../generated/templates";
import { DAOGovernor } from "../generated/templates/DAOGovernor/DAOGovernor";

import { Deployment, Template } from "../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";
import {
  SecureValueReserveInstance,
  DAOGovernorInstance
} from "../generated/schema";
import {
  SVR_NAMESPACE,
  DAO_GOVERNOR_NAMESPACE
} from "./deployment-config";

export function handleNamespacedDeployment(event: NamespacedDeployment): void {
  // existing Deployment entity
  let d = new Deployment(event.params.deployed.toHexString());
  d.deployer = event.params.deployer;
  d.namespace = event.params.namespace;
  d.index = event.params.index;
  d.createdAt = event.block.timestamp;
  d.txHash = event.transaction.hash;
  d.save();

  // 👇 THIS IS THE MISSING PART
  if (event.params.namespace.equals(SVR_NAMESPACE)) {
    let svr = new SecureValueReserveInstance(
      event.params.deployed.toHexString()
    );

    svr.namespace = event.params.namespace;
    svr.deployer = event.params.deployer;
    svr.createdAt = event.block.timestamp;
    svr.txHash = event.transaction.hash;
    svr.save(); // ← THIS creates the “SVR table row”

    SVRTemplate.create(event.params.deployed);
  }

  if (event.params.namespace.equals(DAO_GOVERNOR_NAMESPACE)) {
    let dao = new DAOGovernorInstance(event.params.deployed.toHexString());
    dao.namespace = event.params.namespace;
    dao.deployer = event.params.deployer;
    dao.createdAt = event.block.timestamp;
    dao.txHash = event.transaction.hash;
    dao.proposalCount = BigInt.zero();

    // Only resolve name() for DAO namespace deployments. The namespaced factory
    // can deploy many template types, so this call must stay scoped to the DAO
    // namespace. We use `try_name()` because Graph mappings do not support
    // exception handling and this keeps the call best-effort for EVM reverts.
    let governor = DAOGovernor.bind(event.params.deployed);
    let nameResult = governor.try_name();
    if (!nameResult.reverted) {
      dao.name = nameResult.value;
    }

    dao.save();
    DAOGovernorTemplate.create(event.params.deployed);
  }
}

export function handleTemplateRegistered(event: TemplateRegistered): void {
  let t = new Template(event.params.namespace.toHexString());
  t.provider = event.params.provider;
  t.createdAt = event.block.timestamp;
  t.txHash = event.transaction.hash;
  t.save();
}
