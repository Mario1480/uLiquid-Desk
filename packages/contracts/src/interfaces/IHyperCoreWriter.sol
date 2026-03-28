// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHyperCoreWriter {
  function sendRawAction(bytes calldata data) external payable;
}
