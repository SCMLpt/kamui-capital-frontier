import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, parseEther } from 'ethers';
import { inspect, parseBuilder, parseScenarios, parseTokens } from '../scripts/inspect-batch.mjs';

const artifact = name => JSON.parse(readFileSync(
  new URL(`../build/${name}.json`, import.meta.url), 'utf8'));
const scenarios = [
  { id: 'nominal', outflow_multiplier_bps: 10_000,
    native_fee_reserve_wei: parseEther('0.01').toString() },
  { id: 'stress', outflow_multiplier_bps: 11_000,
    native_fee_reserve_wei: parseEther('0.05').toString() },
];

test('read-only adapter checks the chosen chain and produces a fixed-block frontier', async () => {
  const provider = new BrowserProvider(ganache.provider({ logging: { quiet: true },
    chain: { chainId: 421614 } }));
  const signer = await provider.getSigner();
  const deploy = async (name, options = {}) => {
    const item = artifact(name);
    const contract = await new ContractFactory(item.abi, item.bytecode, signer).deploy(options);
    await contract.waitForDeployment();
    return contract;
  };
  const checker = await deploy('CapitalFrontierView');
  const safe = await deploy('MockSafe', { value: parseEther('1') });
  const safeAddress = await safe.getAddress();
  const batch = { version: '1.0', chainId: '421614',
    meta: { createdFromSafeAddress: safeAddress },
    transactions: ['3', '4', '5'].map(x => ({
      to: `0x${x.repeat(40)}`, value: parseEther('0.3').toString(), data: '0x',
    })).concat([{ to: `0x${'6'.repeat(40)}`, value: '0', data: '0x1234' }]) };
  const before = await provider.getBalance(safeAddress);
  const result = await inspect({ rpc: null, providerOverride: provider,
    contractAddress: await checker.getAddress(), batch, scenarios, tokens: [],
    artifact: artifact('CapitalFrontierView') });
  assert.equal(result.chainId, '421614');
  assert.equal(result.callCount, 4);
  assert.equal(result.scenarioResults[0].fundedPrefix, 3);
  assert.equal(result.scenarioResults[0].reason, 'unknown call');
  assert.equal(result.scenarioResults[1].fundedPrefix, 2);
  assert.equal(result.scenarioResults[1].reason, 'modeled shortfall');
  assert.equal(result.worstCasePrefix, 2);
  assert.equal(await provider.getBalance(safeAddress), before);
  await assert.rejects(inspect({ rpc: null, providerOverride: provider,
    contractAddress: await checker.getAddress(),
    batch: { ...batch, chainId: '1' }, scenarios, tokens: [],
    artifact: artifact('CapitalFrontierView') }), /chainId/);
});

test('adapter rejects malformed inputs before any RPC', () => {
  const base = { version: '1.0', chainId: '421614',
    meta: { createdFromSafeAddress: `0x${'1'.repeat(40)}` },
    transactions: [{ to: `0x${'2'.repeat(40)}`, value: '1', data: '0x' }] };
  assert.equal(parseBuilder(base).calls.length, 1);
  assert.throws(() => parseBuilder({ ...base, chainId: '1e3' }), /chainId/);
  assert.throws(() => parseBuilder({ ...base, transactions: [
    { ...base.transactions[0], data: null } ] }), /Invalid transaction/);
  assert.throws(() => parseBuilder({ ...base, transactions: [
    { ...base.transactions[0], value: '-1' } ] }), /Invalid transaction/);
  assert.throws(() => parseScenarios([{ ...scenarios[0],
    outflow_multiplier_bps: 9000 }]), /Invalid scenario/);
  assert.throws(() => parseTokens([`0x${'3'.repeat(40)}`, `0x${'3'.repeat(40)}`]),
    /Duplicate token/);
});
