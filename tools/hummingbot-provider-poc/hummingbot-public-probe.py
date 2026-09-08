import asyncio
import json
import os
import resource
import sys
import time

from hummingbot.connector.derivative.bitget_perpetual.bitget_perpetual_derivative import (
    BitgetPerpetualDerivative,
)


def decimal_or_none(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def main():
    if os.environ.get("ULIQ_HB_POC_ENABLED") != "true":
        raise RuntimeError("poc_disabled")
    forbidden = ["BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_API_PASSPHRASE"]
    present = [key for key in forbidden if os.environ.get(key, "").strip()]
    if present:
        raise RuntimeError("poc_credentials_forbidden:" + ",".join(present))

    options = json.loads(sys.argv[1] if len(sys.argv) > 1 else "{}")
    pair = str(options.get("pair", "BTC-USDT"))
    depth = max(1, min(50, int(options.get("depth", 25))))
    started = time.time()
    connector = BitgetPerpetualDerivative(
        bitget_perpetual_api_key=None,
        bitget_perpetual_secret_key=None,
        bitget_perpetual_passphrase=None,
        trading_pairs=[pair],
        trading_required=False,
    )
    try:
        await connector._initialize_trading_pair_symbol_map()
        rules_response = await connector._make_trading_rules_request()
        rules = await connector._format_trading_rules(rules_response)
        ticker = await connector._get_last_traded_price(pair)
        data_source = connector._create_order_book_data_source()
        snapshot = await data_source._request_order_book_snapshot(pair)
        funding = await data_source.get_funding_info(pair)
        snapshot_data = snapshot["data"]
        rule = next((candidate for candidate in rules if candidate.trading_pair == pair), None)
        completed = time.time()
        result = {
            "schemaVersion": "1.0.0",
            "providerId": "hummingbot-poc:bitget-perpetual",
            "status": "observed",
            "venue": "bitget",
            "marketType": "perpetual",
            "productType": "USDT-FUTURES",
            "symbol": pair.replace("-", ""),
            "requestAttempts": None,
            "resourceUsage": {
                "cpuSeconds": resource.getrusage(resource.RUSAGE_SELF).ru_utime + resource.getrusage(resource.RUSAGE_SELF).ru_stime,
                "maxRssPlatformUnits": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            },
            "samples": [{
                "sequence": 1,
                "fetchedAtMs": int(completed * 1000),
                "durationMs": int((completed - started) * 1000),
                "providerTimestampMs": int(snapshot_data.get("ts", 0)) or None,
                "ticker": {"last": decimal_or_none(ticker), "bid": None, "ask": None, "mark": decimal_or_none(funding.mark_price)},
                "orderbook": {
                    "bids": [[decimal_or_none(level[0]), decimal_or_none(level[1])] for level in snapshot_data.get("bids", [])[:depth]],
                    "asks": [[decimal_or_none(level[0]), decimal_or_none(level[1])] for level in snapshot_data.get("asks", [])[:depth]],
                    "quantityUnit": "base_asset",
                },
                "candles": None,
                "funding": {"rate": decimal_or_none(funding.rate), "intervalHours": None, "markPrice": decimal_or_none(funding.mark_price)},
                "openInterest": {"value": None, "unit": "unsupported"},
                "tradingRules": None if rule is None else {
                    "tickSize": decimal_or_none(rule.min_price_increment),
                    "stepSize": decimal_or_none(rule.min_base_amount_increment),
                    "minQuantity": decimal_or_none(rule.min_order_size),
                    "minNotional": decimal_or_none(rule.min_notional_size),
                },
            }],
            "limitations": [
                "public_read_only",
                "observations_are_not_atomic",
                "candles_unsupported_by_pinned_hummingbot_connector",
                "open_interest_not_exposed_by_probe_path",
                "request_attempt_instrumentation_unavailable",
            ],
        }
        print(json.dumps(result, separators=(",", ":")))
    finally:
        await connector.stop_network()


asyncio.run(main())
