#!/usr/bin/env node
// Deploy a clearly labeled synthetic Safe-shaped fixture using free test ETH.
// Never use a customer account or a wallet containing real assets.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { inspect } from './inspect-batch.mjs';

const ROOT = new URL('..', import.meta.url);
const OUTPUT = new URL('../../../outputs/Arbitrum-Open-House-2026-09-25/', import.meta.url);
const RPC = 'https://sepolia-rollup.arbitrum.io/rpc';
const CHECKER = '0x02b3Ee4d3E70f878308992582aF253e16a1Fe119';
const FIXTURE_ETH = parseEther('0.0009');

async function main() {
  const receiptPath = new URL('testnet-demo-deployment.json', OUTPUT);
  if (existsSync(receiptPath)) throw new Error('Demo already deployed; refusing duplicate spend');
  const env = readFileSync(new URL('.env', ROOT), 'utf8');
  const key = env.match(/^TESTNET_DEPLOYER_KEY=(0x[0-9a-fA-F]{64})$/m)?.[1];
  if (!key) throw new Error('Missing private testnet-only deployer key');
  const provider = new JsonRpcProvider(RPC);
  if ((await provider.getNetwork()).chainId !== 421614n) {
    throw new Error('Refusing non-Arbitrum-Sepolia chain');
  }
  if (await provider.getCode(CHECKER) === '0x') throw new Error('View checker not deployed');
  const wallet = new Wallet(key, provider);
  const artifact = JSON.parse(readFileSync(new URL('build/MockSafe.json', ROOT), 'utf8'));
  const checkerArtifact = JSON.parse(readFileSync(
    new URL('build/CapitalFrontierView.json', ROOT), 'utf8'));
  const deployTx = await new ContractFactory(artifact.abi, artifact.bytecode, wallet)
    .getDeployTransaction({ value: FIXTURE_ETH });
  const gas = await provider.estimateGas({ ...deployTx, from: wallet.address });
  const feeData = await provider.getFeeData();
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (feePerGas == null) throw new Error('RPC has no gas price');
  const maxCost = gas * feePerGas + FIXTURE_ETH;
  if (maxCost > parseEther('0.0012')) throw new Error('Synthetic testnet cost cap exceeded');
  if (await provider.getBalance(wallet.address) < maxCost) {
    throw new Error('Disposable wallet has insufficient free testnet ETH');
  }
  const tx = await wallet.sendTransaction({ ...deployTx, gasLimit: gas,
    maxFeePerGas: feeData.maxFeePerGas ?? undefined,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
    gasPrice: feeData.maxFeePerGas == null ? feeData.gasPrice : undefined });
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress) {
    throw new Error(`Synthetic fixture deployment failed: ${tx.hash}`);
  }
  const safe = receipt.contractAddress;
  const fixture = { chainId: '421614', checker: CHECKER, syntheticAccount: safe,
    accountFundingTestETH: '0.0009', txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    warning: 'MockSafe is a Safe-shaped synthetic fixture, NOT authentic Safe bytecode. '
      + 'All balances are valueless testnet ETH; no customer account or assets.' };
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(receiptPath, JSON.stringify(fixture, null, 2) + '\n');

  const calls = ['3', '4', '5'].map(digit => ({
    to: `0x${digit.repeat(40)}`, value: parseEther('0.00027').toString(), data: '0x',
  })).concat([{ to: `0x${'6'.repeat(40)}`, value: '0', data: '0x1234' }]);
  const batch = { version: '1.0', chainId: '421614', createdAt: 0,
    meta: { name: 'Synthetic Arbitrum treasury review',
      description: 'Invented testnet calls; no live account or transaction',
      createdFromSafeAddress: safe }, transactions: calls };
  const scenarios = [
    { id: 'nominal', outflow_multiplier_bps: 10000,
      native_fee_reserve_wei: parseEther('0.00001').toString() },
    { id: 'stress', outflow_multiplier_bps: 11000,
      native_fee_reserve_wei: parseEther('0.00005').toString() },
  ];
  const report = await inspect({ providerOverride: provider, rpc: RPC,
    contractAddress: CHECKER, batch, scenarios, tokens: [], artifact: checkerArtifact });
  for (const [name, content] of Object.entries({
    'testnet-synthetic-batch.json': batch,
    'testnet-scenarios.json': scenarios,
    'testnet-allowed-tokens.json': [],
    'testnet-demo-report.json': report,
  })) {
    writeFileSync(new URL(name, OUTPUT), JSON.stringify(content, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify({ fixture, scenarioResults: report.scenarioResults,
    worstCasePrefix: report.worstCasePrefix }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
