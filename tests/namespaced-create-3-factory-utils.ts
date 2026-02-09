import { newMockEvent } from "matchstick-as"
import { ethereum, Address, Bytes, BigInt } from "@graphprotocol/graph-ts"
import {
  NamespacedDeployment,
  TemplateRegistered
} from "../generated/NamespacedCreate3Factory/NamespacedCreate3Factory"

export function createNamespacedDeploymentEvent(
  deployer: Address,
  namespace: Bytes,
  index: BigInt,
  deployed: Address
): NamespacedDeployment {
  let namespacedDeploymentEvent =
    changetype<NamespacedDeployment>(newMockEvent())

  namespacedDeploymentEvent.parameters = new Array()

  namespacedDeploymentEvent.parameters.push(
    new ethereum.EventParam("deployer", ethereum.Value.fromAddress(deployer))
  )
  namespacedDeploymentEvent.parameters.push(
    new ethereum.EventParam(
      "namespace",
      ethereum.Value.fromFixedBytes(namespace)
    )
  )
  namespacedDeploymentEvent.parameters.push(
    new ethereum.EventParam("index", ethereum.Value.fromUnsignedBigInt(index))
  )
  namespacedDeploymentEvent.parameters.push(
    new ethereum.EventParam("deployed", ethereum.Value.fromAddress(deployed))
  )

  return namespacedDeploymentEvent
}

export function createTemplateRegisteredEvent(
  namespace: Bytes,
  provider: Address
): TemplateRegistered {
  let templateRegisteredEvent = changetype<TemplateRegistered>(newMockEvent())

  templateRegisteredEvent.parameters = new Array()

  templateRegisteredEvent.parameters.push(
    new ethereum.EventParam(
      "namespace",
      ethereum.Value.fromFixedBytes(namespace)
    )
  )
  templateRegisteredEvent.parameters.push(
    new ethereum.EventParam("provider", ethereum.Value.fromAddress(provider))
  )

  return templateRegisteredEvent
}
