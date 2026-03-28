// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IHyperCoreWriter {
  function sendRawAction(bytes calldata data) external payable;
}
