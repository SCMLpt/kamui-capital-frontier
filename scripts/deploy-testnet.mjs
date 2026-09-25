#!/usr/bin/env node
// Deploy only to Arbitrum Sepolia with valueless testnet ETH.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, Wallet, parseEther } from 'ethers';

export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614n;
const MAX_TESTNET_GAS_COST = parseEther('0.01');
const DEFAULT_RPC = 'https://sepolia-rollup.arbitrum.io/rpc';

export async function deployReadOnly({ provider, privateKey, artifact,
  maxTestnetGasCost = MAX_TESTNET_GAS_COST }) {
  const network = await provider.getNetwork();
  if (network.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new Error(`Refusing deployment to chainId ${network.chainId}; only 421614 is allowed`);
  }
  if (!artifact?.bytecode?.startsWith('0x') || !Array.isArray(artifact.abi)) {
    throw new Error('Missing compiled contract artifact');
  }
  const wallet = new Wallet(privateKey, provider);
  const deployTx = await new ContractFactory(artifact.abi, artifact.bytecode, wallet)
    .getDeployTransaction();
  const gasLimit = await provider.estimateGas({ ...deployTx, from: wallet.address });
  const fee = await provider.getFeeData();
  const feePerGas = fee.maxFeePerGas ?? fee.gasPrice;
  if (feePerGas == null) throw new Error('RPC did not return a gas price');
  const estimate = gasLimit * feePerGas;
  if (estimate > maxTestnetGasCost) {
    throw new Error('Estimated testnet gas cost exceeds the configured cap');
  }
  const balance = await provider.getBalance(wallet.address);
  if (balance < estimate) {
    throw new Error('Disposable Arbitrum Sepolia wallet lacks free testnet ETH');
  }
  const sent = await wallet.sendTransaction({ ...deployTx, gasLimit,
    maxFeePerGas: fee.maxFeePerGas ?? undefined,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? undefined,
    gasPrice: fee.maxFeePerGas == null ? fee.gasPrice : undefined });
  const receipt = await sent.wait();
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress) {
    throw new Error(`Testnet deployment failed; transaction ${sent.hash}`);
  }
  const code = await provider.getCode(receipt.contractAddress);
  if (code === '0x') throw new Error('No contract code after confirmed deployment');
  return { chainId: network.chainId.toString(),
    deployer: wallet.address, contract: receipt.contractAddress,
    txHash: sent.hash, blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    estimatedGasCostWei: estimate.toString() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const key = env.match(/^TESTNET_DEPLOYER_KEY=(0x[0-9a-fA-F]{64})$/m)?.[1];
    if (!key) throw new Error('Missing TESTNET_DEPLOYER_KEY in private .env');
    const artifact = JSON.parse(readFileSync(
      new URL('../build/CapitalFrontierView.json', import.meta.url), 'utf8'));
    const provider = new JsonRpcProvider(process.env.ARB_SEPOLIA_RPC || DEFAULT_RPC);
    const result = await deployReadOnly({ provider, privateKey: key, artifact });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Testnet deployment stopped: ${error.message}\n`);
    process.exitCode = 1;
  }
}
