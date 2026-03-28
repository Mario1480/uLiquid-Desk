// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library HyperCoreActionEncoder {
  uint8 internal constant ENCODING_VERSION = 1;
  uint24 internal constant ACTION_LIMIT_ORDER = 1;
  uint24 internal constant ACTION_USD_CLASS_TRANSFER = 7;
  uint24 internal constant ACTION_CANCEL_BY_OID = 10;
  uint24 internal constant ACTION_CANCEL_BY_CLOID = 11;

  function encodeLimitOrder(
    uint32 asset,
    bool isBuy,
    uint64 limitPx,
    uint64 sz,
    bool reduceOnly,
    uint8 encodedTif,
    uint128 cloid
  ) internal pure returns (bytes memory) {
    return _wrap(
      ACTION_LIMIT_ORDER,
      abi.encode(asset, isBuy, limitPx, sz, reduceOnly, encodedTif, cloid)
    );
  }

  function encodeUsdClassTransfer(uint64 ntl, bool toPerp) internal pure returns (bytes memory) {
    return _wrap(ACTION_USD_CLASS_TRANSFER, abi.encode(ntl, toPerp));
  }

  function encodeCancelByOid(uint32 asset, uint64 oid) internal pure returns (bytes memory) {
    return _wrap(ACTION_CANCEL_BY_OID, abi.encode(asset, oid));
  }

  function encodeCancelByCloid(uint32 asset, uint128 cloid) internal pure returns (bytes memory) {
    return _wrap(ACTION_CANCEL_BY_CLOID, abi.encode(asset, cloid));
  }

  function _wrap(uint24 actionId, bytes memory encodedAction) private pure returns (bytes memory) {
    return abi.encodePacked(bytes1(ENCODING_VERSION), bytes3(actionId), encodedAction);
  }
}
