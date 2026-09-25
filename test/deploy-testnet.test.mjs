import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ganache from 'ganache';
import { BrowserProvider } from 'ethers';
import { deployReadOnly } from '../scripts/deploy-testnet.mjs';

const artifact = JSON.parse(readFileSync(
  new URL('../build/CapitalFrontierView.json', import.meta.url), 'utf8'));

test('deployment guard rejects every chain except Arbitrum Sepolia', async () => {
  const provider = new BrowserProvider(ganache.provider({ logging: { quiet: true },
    chain: { chainId: 42161 } }));
  await assert.rejects(deployReadOnly({ provider, privateKey: '0x' + '1'.repeat(64),
    artifact }), /only 421614 is allowed/);
});

test('local Arbitrum Sepolia-shaped chain deploys only view-contract code', async () => {
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 421614 } });
  const [accountAddress, first] = Object.entries(rpc.getInitialAccounts())[0];
  const provider = new BrowserProvider(rpc);
  const result = await deployReadOnly({ provider, privateKey: first.secretKey,
    artifact });
  assert.equal(result.chainId, '421614');
  assert.equal(result.deployer.toLowerCase(), accountAddress.toLowerCase());
  assert.match(result.contract, /^0x[0-9a-fA-F]{40}$/);
  assert.notEqual(await provider.getCode(result.contract), '0x');
});
