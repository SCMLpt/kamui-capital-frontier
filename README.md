# Kamui Arbitrum Capital Frontier — research prototype

This project reads a Safe Transaction Builder 1.0 batch and checks a narrow
capital-buffer frontier on an Arbitrum chain. Its Solidity contract reads the
account balance and explicitly allowlisted token balances at one block. The
adapter performs an `eth_call` at that block. It never connects a user wallet,
signs, proposes, executes, or moves an asset.

## What is actually checked

- The target account has contract code and responds to `getThreshold()` and
  `getOwners()` with a plausible threshold and owner set. This **does not
  authenticate Safe bytecode**.
- An ordered prefix of explicit native-value sends or raw ERC-20 `transfer`
  calls on tokens the reviewer allowlists. Unknown calls, including approvals,
  swaps, delegate calls, and arbitrary contract interactions, stop the prefix.
- A native fee reserve and 100–300% multiplier under each chosen scenario.
  The model reports the first unknown call or modeled shortfall, not a claim
  that the batch will execute or is secure.

Contract reads cannot verify token semantics, side effects, pending balance
changes, actual Safe gas payment, future order flow, oracle accuracy, or
authentic Safe/token bytecode. Use a fixed block for reproducibility; rerun
against a newer block before making any operational decision. Do not use this
prototype to authorize real transactions or handle customer funds.

## Local verification

```sh
npm ci
npm run compile
npm test
```

Tests use Ganache's in-process local blockchain with an invented 1 ETH account
and synthetic calls. They do not require a network, wallet, faucet, or real ETH.

## Free Arbitrum Sepolia deployment

The deploy script refuses every chain except Arbitrum Sepolia (`421614`),
estimates gas, caps the estimate at **0.01 testnet ETH**, and checks the
disposable wallet balance before sending. Keep a testnet-only key in a private,
gitignored `.env` line named `TESTNET_DEPLOYER_KEY`. Never use a wallet that
holds real assets or put the key in a public repository.

```sh
npm run compile
node scripts/deploy-testnet.mjs
```

The default RPC is Arbitrum's public Sepolia endpoint. `ARB_SEPOLIA_RPC` can
override it, but the chain ID guard remains. Record the returned contract
address and transaction hash only after an explorer or RPC confirms the code.

## Read-only call against a deployed contract

```sh
node scripts/inspect-batch.mjs \
  --rpc https://sepolia-rollup.arbitrum.io/rpc \
  --contract DEPLOYED_VIEW_CONTRACT \
  --batch builder.json \
  --scenarios scenarios.json \
  --tokens tokens.json > report.json
```

The batch must name the real deployed account in
`meta.createdFromSafeAddress` and its `chainId` must match the RPC. `tokens.json`
is an array of at most 20 explicit ERC-20 contract addresses, or `[]`. Example
scenario input:

```json
[
  {"id":"nominal","outflow_multiplier_bps":10000,"native_fee_reserve_wei":"10000000000000000"},
  {"id":"stress","outflow_multiplier_bps":11000,"native_fee_reserve_wei":"50000000000000000"}
]
```

Publishing this source or deploying the read-only contract does not by itself
constitute an award, a security audit, or a financial-service approval.

## Verified testnet instance (2026-09-25)

- [CapitalFrontierView](https://sepolia.arbiscan.io/address/0x02b3Ee4d3E70f878308992582aF253e16a1Fe119),
  deployed in [transaction](https://sepolia.arbiscan.io/tx/0xebd004db4d97330d0dae909a47f0659900e1f2778b96319c07dffc2b20fbf7e0).
- A deliberately synthetic [MockSafe-shaped fixture](https://sepolia.arbiscan.io/address/0x66b9F0b640B8aFa0819C16eb455356E20b382154)
  holds only `0.0009` **testnet** ETH. It is not an authentic Safe. Its
  [deployment transaction](https://sepolia.arbiscan.io/tx/0xd7cc7fe653b138c0eacf3a05d450fb2aa136ab01410288ec74f1fd46460151ee)
  and a fixed-block `eth_call` demonstrate the nominal 3/4 and stressed 2/4
  prefixes. Both contracts and the report use no customer data.
- Public RPC returned 2691 bytes of checker runtime code matching the local
  Solidity 0.8.37 compile. Transaction receipts had success status. The CLI
  report and input JSON are in `evidence/`; a 58-second captioned illustration
  of those real results is in
  [`Kamui-Arbitrum-Capital-Frontier-58s-demo.mp4`](Kamui-Arbitrum-Capital-Frontier-58s-demo.mp4).

Run the same read-only query against the synthetic onchain fixture:

```sh
node scripts/inspect-batch.mjs \
  --rpc https://sepolia-rollup.arbitrum.io/rpc \
  --contract 0x02b3Ee4d3E70f878308992582aF253e16a1Fe119 \
  --batch evidence/testnet-synthetic-batch.json \
  --scenarios evidence/testnet-scenarios.json \
  --tokens evidence/testnet-allowed-tokens.json
```

The output block number will advance; the fixture balance is unchanged unless
someone sends it valueless testnet ETH. The bundled report preserves a
specific observed block and should be treated as evidence of that state only.
