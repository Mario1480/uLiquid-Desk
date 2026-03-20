from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict

from models import StrategyRegistryItem, StrategyRunRequest, StrategyRunResponse
from registry_manifest import StrategyManifestItem

StrategyHandler = Callable[[StrategyRunRequest], StrategyRunResponse]


@dataclass
class StrategyRegistration:
    key: str
    type: str
    name: str
    version: str
    status: str
    input_schema: Dict[str, Any]
    output_contract: Dict[str, Any]
    default_config: Dict[str, Any]
    ui_schema: Dict[str, Any]
    handler: StrategyHandler


class StrategyRegistry:
    def __init__(self) -> None:
        self._items: dict[str, StrategyRegistration] = {}

    def register(
        self,
        manifest: StrategyManifestItem,
        *,
        handler: StrategyHandler,
    ) -> None:
        normalized = manifest["type"].strip()
        if not normalized:
            raise ValueError("strategy_type_required")
        if normalized in self._items:
            raise ValueError(f"strategy_already_registered:{normalized}")
        self._items[normalized] = StrategyRegistration(
            key=manifest["key"].strip() or normalized,
            type=normalized,
            name=manifest["name"].strip() or normalized,
            version=manifest["version"].strip() or "1.0.0",
            status=manifest["status"].strip() or "active",
            input_schema=dict(manifest.get("inputSchema", {})),
            output_contract=dict(manifest.get("outputContract", {})),
            default_config=dict(manifest.get("defaultConfig", {})),
            ui_schema=dict(manifest.get("uiSchema", {})),
            handler=handler,
        )

    def get(self, strategy_type: str) -> StrategyRegistration | None:
        return self._items.get(strategy_type.strip())

    def list_public(self) -> list[StrategyRegistryItem]:
        return [
            StrategyRegistryItem(
                key=item.key,
                type=item.type,
                name=item.name,
                version=item.version,
                status=item.status,  # type: ignore[arg-type]
                inputSchema=item.input_schema,
                outputContract=item.output_contract,
                defaultConfig=item.default_config,
                uiSchema=item.ui_schema,
            )
            for item in self._items.values()
        ]


registry = StrategyRegistry()
