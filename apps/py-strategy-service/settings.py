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


def _validate_production_token(name: str, value: str) -> str | None:
    normalized = value.strip().lower()
    if normalized in {"change_me", "changeme", "secret", "token", "dev-local-token", "test-token"}:
        return f"{name} must not use a placeholder token in production."
    if len(value) < 24:
        return f"{name} must be at least 24 characters in production."
    return None


@dataclass(frozen=True)
class AppSettings:
    auth_tokens: tuple[str, ...]
    ta_backend: str
    production: bool


def load_settings(env: Mapping[str, str] | None = None) -> AppSettings:
    source = env or os.environ
    issues: list[str] = []

    strategy_auth_token = _read(source, "PY_STRATEGY_AUTH_TOKEN")
    grid_auth_token = _read(source, "PY_GRID_AUTH_TOKEN")
    ta_backend = _read(source, "PY_TA_BACKEND") or "auto"
    node_env = _read(source, "NODE_ENV")
    production = node_env.lower() == "production"

    auth_tokens = tuple(
        dict.fromkeys(
            token
            for token in (strategy_auth_token, grid_auth_token)
            if token
        )
    )

    if not auth_tokens:
        issues.append("PY_STRATEGY_AUTH_TOKEN or PY_GRID_AUTH_TOKEN is required.")

    if production:
        for name, token in (
            ("PY_STRATEGY_AUTH_TOKEN", strategy_auth_token),
            ("PY_GRID_AUTH_TOKEN", grid_auth_token),
        ):
            if not token:
                continue
            token_issue = _validate_production_token(name, token)
            if token_issue:
                issues.append(token_issue)
        if strategy_auth_token and grid_auth_token and strategy_auth_token != grid_auth_token:
            issues.append(
                "PY_STRATEGY_AUTH_TOKEN and PY_GRID_AUTH_TOKEN must match in the single py-strategy-service deployment."
            )

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
        auth_tokens=auth_tokens,
        ta_backend=ta_backend.lower(),
        production=production,
    )
