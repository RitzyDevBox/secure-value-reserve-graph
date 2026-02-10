import {
  NamespacedDeployment,
  TemplateRegistered
} from "../generated/NamespacedCreate3Factory/NamespacedCreate3Factory";
import { SecureValueReserve as SVRTemplate } from "../generated/templates";

import { Deployment, Template } from "../generated/schema";
const SECURE_VALUE_RESERVER_NAMESPACE = "0xeece374668638a20fc64b121b39407ec17c2a6572e4bce749a16bff9c1996579";

export function handleNamespacedDeployment(event: NamespacedDeployment): void {
  let d = new Deployment(event.params.deployed.toHexString());
  d.deployer = event.params.deployer;
  d.namespace = event.params.namespace;
  d.index = event.params.index;
  d.createdAt = event.block.timestamp;
  d.txHash = event.transaction.hash;
  d.save();

  if (event.params.namespace.toHexString() == SECURE_VALUE_RESERVER_NAMESPACE) {
    SVRTemplate.create(event.params.deployed);
  }
}

export function handleTemplateRegistered(event: TemplateRegistered): void {
  let t = new Template(event.params.namespace.toHexString());
  t.provider = event.params.provider;
  t.createdAt = event.block.timestamp;
  t.txHash = event.transaction.hash;
  t.save();
}
