from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


class ConfigurationError(RuntimeError):
    pass


def _read(env: Mapping[str, str], name: str) -> str:
    return str(env.get(name, "")).strip()


def _validate_ta_backend(value: str) -> str | None:
    if not value:
        return None
    if value.lower() in {"auto", "talib", "pandas_ta"}:
        return None
    return "PY_TA_BACKEND must be one of: auto, talib, pandas_ta."


@dataclass(frozen=True)
class AppSettings:
    auth_token: str
    ta_backend: str
    production: bool


def load_settings(env: Mapping[str, str] | None = None) -> AppSettings:
    source = env or os.environ
    issues: list[str] = []

    auth_token = _read(source, "PY_STRATEGY_AUTH_TOKEN")
    ta_backend = _read(source, "PY_TA_BACKEND") or "auto"
    node_env = _read(source, "NODE_ENV")
    production = node_env.lower() == "production"

    if not auth_token:
        issues.append("PY_STRATEGY_AUTH_TOKEN is required.")

    ta_backend_issue = _validate_ta_backend(ta_backend)
    if ta_backend_issue:
        issues.append(ta_backend_issue)

    if issues:
        raise ConfigurationError(
            "\n".join(
                [
                    "[uLiquid Desk] apps/py-strategy-service environment validation failed:",
                    *[f"- {issue}" for issue in issues],
                    "Use a local env file created from .env.example / .env.prod.example or set the variables explicitly.",
                ]
            )
        )

    return AppSettings(
        auth_token=auth_token,
        ta_backend=ta_backend.lower(),
        production=production,
    )
