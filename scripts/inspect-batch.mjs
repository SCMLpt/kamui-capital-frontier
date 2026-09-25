#!/usr/bin/env node
// Read-only adapter for Safe Transaction Builder version 1.0 exports.
// No key, signer, wallet connection, transaction or paid RPC is required.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, getAddress, isHexString } from 'ethers';

const MAX_BYTES = 1_000_000;
const MAX_CALLS = 128;
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
  && value.length <= 78;

function readJson(path) {
  const raw = readFileSync(path);
  if (raw.length > MAX_BYTES) throw new Error(`File exceeds ${MAX_BYTES} bytes: ${path}`);
  return JSON.parse(raw.toString('utf8'));
}

function address(value, label) {
  try { return getAddress(value); }
  catch { throw new Error(`${label} must be a 20-byte hex address`); }
}

export function parseBuilder(batch) {
  if (!batch || typeof batch !== 'object' || batch.version !== '1.0'
      || !uint(batch.chainId) || batch.chainId === '0') {
    throw new Error('Expected Safe Transaction Builder 1.0 and a positive decimal chainId');
  }
  const safe = address(batch.meta?.createdFromSafeAddress,
    'meta.createdFromSafeAddress');
  if (!Array.isArray(batch.transactions) || batch.transactions.length < 1
      || batch.transactions.length > MAX_CALLS) {
    throw new Error(`Batch must contain 1-${MAX_CALLS} transactions`);
  }
  const calls = batch.transactions.map((tx, i) => {
    if (!tx || typeof tx !== 'object' || !uint(tx.value)
        || typeof tx.data !== 'string' || !isHexString(tx.data)
        || tx.data.length > 131074 || (tx.operation ?? 0) !== 0
        && (tx.operation ?? 0) !== '0' && (tx.operation ?? 0) !== 1) {
      throw new Error(`Invalid transaction ${i}: raw data, value or operation`);
    }
    const operation = Number(tx.operation ?? 0);
    return {
      to: address(tx.to, `transactions[${i}].to`),
      value: BigInt(tx.value), data: tx.data, operation,
    };
  });
  return { chainId: BigInt(batch.chainId), safe, calls };
}

export function parseScenarios(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new Error('Expected 1-20 scenarios');
  }
  const names = new Set();
  return items.map((item, i) => {
    if (typeof item?.id !== 'string' || !item.id.trim() || names.has(item.id)
      || !Number.isInteger(item.outflow_multiplier_bps)
      || item.outflow_multiplier_bps < 10_000
      || item.outflow_multiplier_bps > 30_000
      || !uint(item.native_fee_reserve_wei)) {
      throw new Error(`Invalid scenario ${i}`);
    }
    names.add(item.id);
    return { id: item.id, outflowMultiplierBps: item.outflow_multiplier_bps,
      nativeFeeReserve: BigInt(item.native_fee_reserve_wei) };
  });
}

export function parseTokens(items) {
  if (!Array.isArray(items) || items.length > 20) {
    throw new Error('Expected an allowlist of 0-20 token addresses');
  }
  const tokens = items.map((item, i) => address(item, `tokens[${i}]`));
  if (new Set(tokens.map(item => item.toLowerCase())).size !== tokens.length) {
    throw new Error('Duplicate token in allowlist');
  }
  return tokens;
}

export async function inspect({ rpc, contractAddress, batch, scenarios, tokens,
  artifact, providerOverride }) {
  const { chainId, safe, calls } = parseBuilder(batch);
  const parsedScenarios = parseScenarios(scenarios);
  const allowedTokens = parseTokens(tokens);
  const provider = providerOverride ?? new JsonRpcProvider(rpc);
  const network = await provider.getNetwork();
  if (network.chainId !== chainId) {
    throw new Error(`RPC chainId ${network.chainId} differs from batch ${chainId}`);
  }
  const checkerAddress = address(contractAddress, 'contract');
  // getBlockNumber() may return an ethers cache entry from before a local
  // deployment; read the latest block itself before pinning all calls to it.
  const latestBlock = await provider.getBlock('latest');
  if (!latestBlock) throw new Error('RPC did not return a latest block');
  const blockNumber = latestBlock.number;
  const checkerCode = await provider.getCode(checkerAddress, blockNumber);
  if (checkerCode === '0x') throw new Error('No contract code at checker address');
  const checker = new Contract(checkerAddress, artifact.abi, provider);
  const [frontiers, worstCasePrefix] = await checker.inspect.staticCall(
    safe, calls, allowedTokens, parsedScenarios.map(s => ({
      outflowMultiplierBps: s.outflowMultiplierBps,
      nativeFeeReserve: s.nativeFeeReserve,
    })), { blockTag: blockNumber });
  return {
    tool: 'Kamui Arbitrum Capital Frontier — read-only prototype',
    chainId: chainId.toString(), blockNumber, checker: checkerAddress,
    safe, batchSha256: createHash('sha256').update(JSON.stringify(batch)).digest('hex'),
    callCount: calls.length, allowedTokens,
    scenarioResults: parsedScenarios.map((s, i) => ({
      id: s.id,
      outflowMultiplierBps: s.outflowMultiplierBps,
      nativeFeeReserveWei: s.nativeFeeReserve.toString(),
      fundedPrefix: Number(frontiers[i].fundedPrefix),
      firstBlocker: frontiers[i].firstBlocker === (2n ** 256n - 1n)
        ? null : Number(frontiers[i].firstBlocker),
      reason: ['fully modeled', 'unknown call', 'modeled shortfall'][Number(frontiers[i].reason)],
    })),
    worstCasePrefix: Number(worstCasePrefix),
    scope: 'Balance-only check of explicit native sends and allowlisted raw ERC-20 transfers. '
      + 'It does not simulate execution, verify authentic Safe/token code, calculate actual gas, '
      + 'or guarantee safety. Unknown calls stop the funded prefix.',
  };
}

function argsMap(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || !argv[i + 1] || flags[argv[i]]) {
      throw new Error('Usage: node scripts/inspect-batch.mjs --rpc URL --contract ADDRESS '
        + '--batch builder.json --scenarios scenarios.json --tokens tokens.json');
    }
    flags[argv[i]] = argv[i + 1];
  }
  return flags;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const flags = argsMap(process.argv.slice(2));
    for (const required of ['--rpc', '--contract', '--batch', '--scenarios', '--tokens']) {
      if (!flags[required]) throw new Error(`Missing ${required}`);
    }
    const result = await inspect({ rpc: flags['--rpc'], contractAddress: flags['--contract'],
      batch: readJson(flags['--batch']), scenarios: readJson(flags['--scenarios']),
      tokens: readJson(flags['--tokens']),
      artifact: readJson(new URL('../build/CapitalFrontierView.json', import.meta.url)) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Inspection failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
