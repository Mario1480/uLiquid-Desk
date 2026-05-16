from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from settings import ConfigurationError, load_settings


class SettingsTests(unittest.TestCase):
    def test_development_accepts_short_local_token(self) -> None:
        settings = load_settings({
            "NODE_ENV": "development",
            "PY_STRATEGY_AUTH_TOKEN": "test-token",
        })

        self.assertEqual(settings.auth_tokens, ("test-token",))
        self.assertFalse(settings.production)

    def test_production_rejects_placeholder_tokens(self) -> None:
        with self.assertRaises(ConfigurationError) as ctx:
            load_settings({
                "NODE_ENV": "production",
                "PY_STRATEGY_AUTH_TOKEN": "change_me",
            })

        self.assertIn("placeholder token", str(ctx.exception))

    def test_production_requires_matching_tokens_for_single_service(self) -> None:
        with self.assertRaises(ConfigurationError) as ctx:
            load_settings({
                "NODE_ENV": "production",
                "PY_STRATEGY_AUTH_TOKEN": "a" * 24,
                "PY_GRID_AUTH_TOKEN": "b" * 24,
            })

        self.assertIn("must match", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
