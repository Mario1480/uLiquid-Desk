from __future__ import annotations

import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.responses import JSONResponse

import main
from models import StrategyRunEnvelopeRequest, StrategyRunRequest


class RegistryTests(unittest.TestCase):
    def test_registry_items_expose_formal_manifest_fields(self) -> None:
        items = main.registry.list_public()
        item = next((entry for entry in items if entry.type == "ta_trend_vol_gate_v2"), None)
        self.assertIsNotNone(item)
        assert item is not None
        self.assertEqual(item.key, "ta_trend_vol_gate_v2")
        self.assertEqual(item.status, "active")
        self.assertEqual(item.outputContract.get("version"), "local_strategy_result_v1")
        self.assertIsInstance(item.inputSchema, dict)

    def test_run_strategy_v2_rejects_version_mismatch(self) -> None:
        response = main.run_strategy_v2(
            StrategyRunEnvelopeRequest(
                protocolVersion=main.STRATEGY_PROTOCOL_VERSION,
                requestId="req_1",
                payload=StrategyRunRequest(
                    strategyType="regime_gate",
                    strategyVersion="9.9.9",
                    featureSnapshot={},
                    config={},
                    context={},
                ),
            ),
            None,
        )

        self.assertIsInstance(response, JSONResponse)
        assert isinstance(response, JSONResponse)
        self.assertEqual(response.status_code, 409)
        parsed = json.loads(response.body.decode("utf-8"))
        self.assertEqual(parsed["error"]["code"], "strategy_version_mismatch")
        self.assertEqual(parsed["error"]["details"]["requestedVersion"], "9.9.9")


if __name__ == "__main__":
    unittest.main()
