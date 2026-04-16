import {
  NamespacedDeployment,
  TemplateRegistered
} from "../generated/NamespacedCreate3Factory/NamespacedCreate3Factory";
import { SecureValueReserve as SVRTemplate } from "../generated/templates";

import { Deployment, Template } from "../generated/schema";
import { Bytes } from "@graphprotocol/graph-ts";
import { SecureValueReserveInstance } from "../generated/schema";

const SVR_NAMESPACE = Bytes.fromHexString("0x67e6387324ab4281578d1193a08727525866a9e7913baf234776c28044bfb556") as Bytes;

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
}

export function handleTemplateRegistered(event: TemplateRegistered): void {
  let t = new Template(event.params.namespace.toHexString());
  t.provider = event.params.provider;
  t.createdAt = event.block.timestamp;
  t.txHash = event.transaction.hash;
  t.save();
}
