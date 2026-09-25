import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, Interface, parseEther } from 'ethers';

const root = new URL('..', import.meta.url).pathname;
const artifact = name => JSON.parse(readFileSync(join(root, 'build', `${name}.json`), 'utf8'));

async function setup() {
  const provider = new BrowserProvider(ganache.provider({ logging: { quiet: true },
    chain: { chainId: 421614 }, wallet: { totalAccounts: 3 } }));
  const signer = await provider.getSigner();
  const deploy = async (name, options = {}) => {
    const item = artifact(name);
    const contract = await new ContractFactory(item.abi, item.bytecode, signer).deploy(options);
    await contract.waitForDeployment();
    return contract;
  };
  return { provider, signer, checker: await deploy('CapitalFrontierView'),
    safe: await deploy('MockSafe', { value: parseEther('1') }),
    token: await deploy('MockERC20') };
}

function nativeBatch() {
  return [3, 4, 5].map(digit => ({
    to: `0x${String(digit).repeat(40)}`, value: parseEther('0.3'), data: '0x', operation: 0,
  })).concat([{ to: `0x${'6'.repeat(40)}`, value: 0n, data: '0x1234', operation: 0 }]);
}

test('a synthetic Safe batch exposes the nominal and stressed frontiers without state changes', async () => {
  const { provider, checker, safe } = await setup();
  const safeAddress = await safe.getAddress();
  const before = await provider.getBalance(safeAddress);
  const scenarios = [
    { outflowMultiplierBps: 10_000, nativeFeeReserve: parseEther('0.01') },
    { outflowMultiplierBps: 11_000, nativeFeeReserve: parseEther('0.05') },
  ];
  const [frontiers, worst] = await checker.inspect(safeAddress, nativeBatch(), [], scenarios);
  assert.equal(frontiers[0].fundedPrefix, 3n);
  assert.equal(frontiers[0].firstBlocker, 3n);
  assert.equal(frontiers[0].reason, 1n);
  assert.equal(frontiers[1].fundedPrefix, 2n);
  assert.equal(frontiers[1].firstBlocker, 2n);
  assert.equal(frontiers[1].reason, 2n);
  assert.equal(worst, 2n);
  assert.equal(await provider.getBalance(safeAddress), before);
});

test('allowlisted ERC-20 balance is read on chain and cumulative outflow stops at shortfall', async () => {
  const { checker, safe, token } = await setup();
  const safeAddress = await safe.getAddress();
  const tokenAddress = await token.getAddress();
  await (await token.mint(safeAddress, 1000n)).wait();
  const interface20 = new Interface(['function transfer(address,uint256)']);
  const call = amount => ({ to: tokenAddress, value: 0n,
    data: interface20.encodeFunctionData('transfer', [`0x${'7'.repeat(40)}`, amount]), operation: 0 });
  const scenario = [{ outflowMultiplierBps: 10_000, nativeFeeReserve: 1n }];
  const [frontiers] = await checker.inspect(safeAddress, [call(500n), call(600n)],
    [tokenAddress], scenario);
  assert.equal(frontiers[0].fundedPrefix, 1n);
  assert.equal(frontiers[0].reason, 2n);
  assert.equal(frontiers[0].firstBlocker, 1n);
  assert.equal(await token.balanceOf(safeAddress), 1000n);
  const [unknown] = await checker.inspect(safeAddress, [call(500n)], [], scenario);
  assert.equal(unknown[0].reason, 1n);
  assert.equal(unknown[0].fundedPrefix, 0n);
});

test('non-Safe account and duplicate allowlisted token are rejected', async () => {
  const { checker, safe, token } = await setup();
  const scenario = [{ outflowMultiplierBps: 10_000, nativeFeeReserve: 0n }];
  const oneCall = nativeBatch().slice(0, 1);
  await assert.rejects(checker.inspect(await token.getAddress(), oneCall, [], scenario));
  const tokenAddress = await token.getAddress();
  await assert.rejects(checker.inspect(await safe.getAddress(), oneCall,
    [tokenAddress, tokenAddress], scenario));
});

test('non-CALL operation and invalid scenario never produce a funded prefix', async () => {
  const { checker, safe } = await setup();
  const safeAddress = await safe.getAddress();
  const delegated = [{ ...nativeBatch()[0], operation: 1 }];
  const valid = [{ outflowMultiplierBps: 10_000, nativeFeeReserve: 0n }];
  const [frontiers] = await checker.inspect(safeAddress, delegated, [], valid);
  assert.equal(frontiers[0].reason, 1n);
  assert.equal(frontiers[0].fundedPrefix, 0n);
  await assert.rejects(checker.inspect(safeAddress, nativeBatch(), [],
    [{ outflowMultiplierBps: 9_999, nativeFeeReserve: 0n }]));
});
