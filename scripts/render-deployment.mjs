#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function required(value, message) {
  if (value === undefined || value === null || value === "") {
    throw new Error(message);
  }
  return value;
}

const cwd = process.cwd();
const target = arg("--target", "anvil");

const configPath = path.join(cwd, "config", "deployments", `${target}.json`);
if (!fs.existsSync(configPath)) {
  throw new Error(`Missing deployment config: ${configPath}`);
}

const deployment = JSON.parse(fs.readFileSync(configPath, "utf8"));

const manifestOut = arg("--manifest-out", `subgraph.${target}.yaml`);
const mappingConfigOut = arg("--mapping-config-out", "src/deployment-config.ts");

const overrideFactory = arg("--factory-address");
const overrideStartBlock = arg("--start-block");
const overrideSubgraphName = arg("--subgraph-name");

const resolved = {
  ...deployment,
  factoryAddress: overrideFactory || deployment.factoryAddress,
  startBlock: overrideStartBlock !== undefined ? Number(overrideStartBlock) : Number(deployment.startBlock),
  subgraphName: overrideSubgraphName || deployment.subgraphName,
};

required(resolved.manifestNetwork, "manifestNetwork is required in deployment config");
required(resolved.factoryAddress, "factoryAddress is required in deployment config");
required(resolved.namespaces?.svr, "namespaces.svr is required in deployment config");
required(resolved.namespaces?.daoGovernor, "namespaces.daoGovernor is required in deployment config");
required(resolved.multiTenantAuthAddress, "multiTenantAuthAddress is required in deployment config");

const mtaStartBlock =
  resolved.mtaStartBlock !== undefined && resolved.mtaStartBlock !== null
    ? Number(resolved.mtaStartBlock)
    : Number(resolved.startBlock);

const templateManifestPath = path.join(cwd, "subgraph.yaml");
let manifest = fs.readFileSync(templateManifestPath, "utf8");

manifest = manifest.replace(/network:\s*[A-Za-z0-9_\-]+/g, `network: ${resolved.manifestNetwork}`);

// Per-data-source address+startBlock stamping. Each data source block in
// subgraph.yaml is identified by its `name:` line; we rewrite the immediately
// following `address:` and `startBlock:` lines (the `source:` stanza) for that
// block. Avoids the original single-replace regex that only patched the first
// match — necessary now that we have multiple non-templated data sources
// (NamespacedCreate3Factory + MultiTenantAuth).
function stampDataSource(yaml, name, address, startBlock) {
  const re = new RegExp(
    `(name:\\s*${name}\\b[\\s\\S]*?address:\\s*)"0x[a-fA-F0-9]{40}"([\\s\\S]*?startBlock:\\s*)\\d+`,
    "m",
  );
  if (!re.test(yaml)) {
    throw new Error(`Could not locate data source '${name}' in subgraph.yaml`);
  }
  return yaml.replace(re, `$1"${address}"$2${startBlock}`);
}

manifest = stampDataSource(manifest, "NamespacedCreate3Factory", resolved.factoryAddress, resolved.startBlock);
manifest = stampDataSource(manifest, "MultiTenantAuth", resolved.multiTenantAuthAddress, mtaStartBlock);

fs.writeFileSync(path.join(cwd, manifestOut), manifest);

const mappingConfig = `import { Bytes } from "@graphprotocol/graph-ts";

export const SVR_NAMESPACE = Bytes.fromHexString("${resolved.namespaces.svr}") as Bytes;
export const DAO_GOVERNOR_NAMESPACE = Bytes.fromHexString("${resolved.namespaces.daoGovernor}") as Bytes;
`;

fs.writeFileSync(path.join(cwd, mappingConfigOut), mappingConfig);

const resolvedOut = {
  target,
  manifestFile: manifestOut,
  mappingConfigFile: mappingConfigOut,
  manifestNetwork: resolved.manifestNetwork,
  factoryAddress: resolved.factoryAddress,
  startBlock: resolved.startBlock,
  multiTenantAuthAddress: resolved.multiTenantAuthAddress,
  mtaStartBlock,
  subgraphName: resolved.subgraphName,
  namespaces: resolved.namespaces,
};

fs.writeFileSync(path.join(cwd, "deployment.resolved.json"), JSON.stringify(resolvedOut, null, 2) + "\n");

console.log(`Rendered ${manifestOut} and ${mappingConfigOut} for target=${target}`);
console.log(`Subgraph name: ${resolved.subgraphName}`);
