from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, TypedDict


class StrategyManifestItem(TypedDict):
    key: str
    type: str
    engine: str
    name: str
    version: str
    status: str
    description: str | None
    inputSchema: Dict[str, Any]
    outputContract: Dict[str, Any]
    defaultConfig: Dict[str, Any]
    uiSchema: Dict[str, Any]


class StrategyManifestDocument(TypedDict):
    registryVersion: str
    outputContract: Dict[str, Any]
    items: List[StrategyManifestItem]


def load_strategy_manifest() -> StrategyManifestDocument:
    root = Path(__file__).resolve().parents[2]
    file_path = root / "config" / "local-strategy-registry.json"
    parsed = json.loads(file_path.read_text(encoding="utf-8"))
    default_output_contract = parsed.get("outputContract", {})
    items: List[StrategyManifestItem] = []

    for raw in parsed.get("items", []):
        if not isinstance(raw, dict):
            continue
        key = str(raw.get("key", "")).strip()
        strategy_type = str(raw.get("type", "")).strip()
        name = str(raw.get("name", "")).strip()
        version = str(raw.get("version", "")).strip()
        if not key or not strategy_type or not name or not version:
            continue
        items.append({
            "key": key,
            "type": strategy_type,
            "engine": "python" if str(raw.get("engine", "")).strip() == "python" else "ts",
            "name": name,
            "version": version,
            "status": str(raw.get("status", "active")).strip() or "active",
            "description": str(raw.get("description")).strip() if raw.get("description") else None,
            "inputSchema": dict(raw.get("inputSchema", {})),
            "outputContract": {
                **dict(default_output_contract),
                **dict(raw.get("outputContract", {})),
            },
            "defaultConfig": dict(raw.get("defaultConfig", {})),
            "uiSchema": dict(raw.get("uiSchema", {})),
        })

    return {
        "registryVersion": str(parsed.get("registryVersion", "unknown")).strip() or "unknown",
        "outputContract": dict(default_output_contract),
        "items": items,
    }


def list_python_strategy_manifest_items() -> List[StrategyManifestItem]:
    return [
        item
        for item in load_strategy_manifest()["items"]
        if item["engine"] == "python"
    ]


def get_strategy_manifest_item(strategy_type: str) -> StrategyManifestItem | None:
    normalized = strategy_type.strip()
    if not normalized:
        return None
    for item in load_strategy_manifest()["items"]:
        if item["type"] == normalized or item["key"] == normalized:
            return item
    return None
