import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, erc20Abi, parseAbi, type Address } from "viem";
import { assertMainnetLockingTransaction, type MainnetLockingTx } from "./mainnetLocking";
import { ULIQ_ARBITRUM_ONE_TOKEN } from "../../lib/uliqDeployments";

const wallet: Address = "0x1111111111111111111111111111111111111111";
const locker: Address = "0x2222222222222222222222222222222222222222";
const approval: MainnetLockingTx = { chainId: 42161, expectedSender: wallet, to: ULIQ_ARBITRUM_ONE_TOKEN.address, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [locker, BigInt(7)] }) };

test("wallet rejects substituted chain, sender, recipient, approval spender, amount and native value", () => {
  const action = { kind: "approve" as const, amount: BigInt(7), days: 32 };
  assert.doesNotThrow(() => assertMainnetLockingTransaction(approval, wallet, locker, action));
  for (const change of [
    { chainId: 421614 }, { expectedSender: locker }, { to: locker }, { value: "1" },
    { data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [wallet, BigInt(7)] }) },
    { data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [locker, BigInt(8)] }) }
  ]) assert.throws(() => assertMainnetLockingTransaction({ ...approval, ...change }, wallet, locker, action), /transaction_mismatch/);
});

test("lock, extension and withdrawal must match the exact action the user selected", () => {
  const abi = parseAbi(["function lock(uint256,uint64)", "function unlock(uint256)", "function extendLock(uint256,uint64)"]);
  const cases = [
    { action: { kind: "lock" as const, amount: BigInt(7), days: 32 }, data: encodeFunctionData({ abi, functionName: "lock", args: [BigInt(7), BigInt(32 * 86400)] }) },
    { action: { kind: "unlock" as const, id: BigInt(1) }, data: encodeFunctionData({ abi, functionName: "unlock", args: [BigInt(1)] }) },
    { action: { kind: "extend" as const, id: BigInt(1), expiry: BigInt(1000) }, data: encodeFunctionData({ abi, functionName: "extendLock", args: [BigInt(1), BigInt(1000)] }) }
  ];
  for (const c of cases) {
    const tx = { ...approval, to: locker, data: c.data };
    assert.doesNotThrow(() => assertMainnetLockingTransaction(tx, wallet, locker, c.action));
    assert.throws(() => assertMainnetLockingTransaction({ ...tx, data: approval.data }, wallet, locker, c.action), /transaction_mismatch/);
  }
});
