import { parseAbi } from "viem";

export const masterVaultAbi = parseAbi([
  "function deposit(address token, uint256 amount)",
  "function requestWithdraw(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function freeBalance() view returns (uint256)",
  "function reservedBalance() view returns (uint256)"
]);
