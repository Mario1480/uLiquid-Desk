import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWatchErc20AssetRequest,
  isWalletWatchAssetProvider,
  requestWalletWatchAsset,
  ULIQ_TOKEN_DECIMALS,
  ULIQ_TOKEN_SYMBOL
} from "./watchAsset.js";

const TOKEN_ADDRESS = "0xc60B2509000Ea87b985FB44E6504881cb234c213";
const IMAGE_URL = "https://staging.desk.uliquid.vip/images/tokens/uliq-token-512.png";

test("ULIQ wallet-watch request contains checksummed identity and the hosted token image", () => {
  assert.deepEqual(buildWatchErc20AssetRequest({ tokenAddress: TOKEN_ADDRESS, imageUrl: IMAGE_URL }), {
    method: "wallet_watchAsset",
    params: {
      type: "ERC20",
      options: {
        address: TOKEN_ADDRESS,
        symbol: ULIQ_TOKEN_SYMBOL,
        decimals: ULIQ_TOKEN_DECIMALS,
        image: IMAGE_URL
      }
    }
  });
});

test("wallet-watch request rejects an invalid token address or insecure remote image", () => {
  assert.throws(
    () => buildWatchErc20AssetRequest({ tokenAddress: "0xinvalid", imageUrl: IMAGE_URL }),
    /invalid_token_address/
  );
  assert.throws(
    () => buildWatchErc20AssetRequest({ tokenAddress: TOKEN_ADDRESS, imageUrl: "http://example.com/uliq.png" }),
    /invalid_token_image_url/
  );
});

test("wallet-watch provider guard rejects connectors without an EIP-1193 request function", () => {
  assert.equal(isWalletWatchAssetProvider(null), false);
  assert.equal(isWalletWatchAssetProvider({}), false);
  assert.equal(isWalletWatchAssetProvider({ request: async () => true }), true);
});

test("wallet-watch returns the wallet decision without treating a prompt as token settlement", async () => {
  let requestedMethod = "";
  const accepted = await requestWalletWatchAsset({
    async request(request) {
      requestedMethod = request.method;
      return true;
    }
  }, { tokenAddress: TOKEN_ADDRESS, imageUrl: IMAGE_URL });
  assert.equal(requestedMethod, "wallet_watchAsset");
  assert.equal(accepted, true);

  const rejected = await requestWalletWatchAsset({ request: async () => false }, {
    tokenAddress: TOKEN_ADDRESS,
    imageUrl: IMAGE_URL
  });
  assert.equal(rejected, false);
});
