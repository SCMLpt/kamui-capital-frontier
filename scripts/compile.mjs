import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import solc from 'solc';

const root = new URL('..', import.meta.url).pathname;
const sources = Object.fromEntries(
  ['CapitalFrontierView.sol', 'MockSafe.sol'].map(name => [
    name, { content: readFileSync(join(root, 'contracts', name), 'utf8') },
  ]),
);
const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors ?? []).filter(x => x.severity === 'error');
if (errors.length) {
  for (const error of errors) process.stderr.write(`${error.formattedMessage}\n`);
  process.exit(1);
}
mkdirSync(join(root, 'build'), { recursive: true });
for (const [source, contracts] of Object.entries(output.contracts)) {
  for (const [name, compiled] of Object.entries(contracts)) {
    writeFileSync(join(root, 'build', `${name}.json`), JSON.stringify({
      source,
      contractName: name,
      compilerVersion: solc.version(),
      abi: compiled.abi,
      bytecode: `0x${compiled.evm.bytecode.object}`,
      runtimeBytecode: `0x${compiled.evm.deployedBytecode.object}`,
    }, null, 2) + '\n');
    process.stdout.write(`${name}: ${compiled.evm.deployedBytecode.object.length / 2} bytes runtime\n`);
  }
}
