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


async def wait_for(predicate, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        await asyncio.sleep(0.05)
    raise TimeoutError("condition_timeout")


async def observe_websocket_reconnect(data_source):
    started = time.monotonic()
    listener = asyncio.create_task(data_source.listen_for_subscriptions())
    result = {
        "attempted": True,
        "initialMessageObserved": False,
        "reconnected": False,
        "messageAfterReconnect": False,
        "durationMs": None,
        "error": None,
    }
    try:
        await wait_for(lambda: data_source._ws_assistant, 15)
        message_queue = data_source._message_queue[data_source._diff_messages_queue_key]
        await asyncio.wait_for(message_queue.get(), timeout=15)
        result["initialMessageObserved"] = True
        while not message_queue.empty():
            message_queue.get_nowait()
        first_assistant = data_source._ws_assistant
        await first_assistant.disconnect()
        await wait_for(
            lambda: data_source._ws_assistant
            if data_source._ws_assistant is not None and data_source._ws_assistant is not first_assistant
            else None,
            15,
        )
        result["reconnected"] = True
        await asyncio.wait_for(message_queue.get(), timeout=15)
        result["messageAfterReconnect"] = True
    except Exception as error:
        result["error"] = type(error).__name__
    finally:
        listener.cancel()
        try:
            await listener
        except asyncio.CancelledError:
            pass
        result["durationMs"] = int((time.monotonic() - started) * 1000)
    return result


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
    reconnect_check = bool(options.get("reconnectCheck", False))
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
        websocket_reconnect = (
            await observe_websocket_reconnect(data_source)
            if reconnect_check
            else {"attempted": False}
        )
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
                "maxRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
            },
            "websocketReconnect": websocket_reconnect,
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
