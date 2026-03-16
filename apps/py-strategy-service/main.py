from __future__ import annotations

import hmac
import json
import os
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from grid import (
    GridPlanRequest,
    GridPlanEnvelopeRequest,
    GridPlanEnvelopeResponse,
    GridPlanResponse,
    GridPreviewEnvelopeRequest,
    GridPreviewEnvelopeResponse,
    GridPreviewRequest,
    GridPreviewResponse,
    plan as plan_grid,
    preview as preview_grid,
)
from models import (
    HealthResponse,
    StrategyEnvelopeError,
    StrategyRegistryEnvelopeResponse,
    StrategyRegistryResponse,
    StrategyRunEnvelopeRequest,
    StrategyRunEnvelopeResponse,
    StrategyRunRequest,
    StrategyRunResponse,
)
from registry import registry
from strategies import (
    regime_gate,
    signal_filter,
    smart_money_concept,
    ta_trend_vol_gate_v2,
    trend_vol_gate,
    vmc_cipher_gate,
    vmc_divergence_reversal,
)

SERVICE_VERSION = "1.0.0"
GRID_PROTOCOL_VERSION = "grid.v2"
STRATEGY_PROTOCOL_VERSION = "strategy.v2"
AUTH_TOKEN = os.getenv("PY_STRATEGY_AUTH_TOKEN", "").strip()

app = FastAPI(title="py-strategy-service", version=SERVICE_VERSION)


def build_grid_error_response(
    *,
    request_id: str | None,
    code: str,
    message: str,
    status_code: int,
    retryable: bool = False,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    payload = {
        "protocolVersion": GRID_PROTOCOL_VERSION,
        "requestId": request_id,
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable,
            "details": details or {},
        },
    }
    return JSONResponse(status_code=status_code, content=payload)


def build_strategy_error_response(
    *,
    request_id: str | None,
    code: str,
    message: str,
    status_code: int,
    retryable: bool = False,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    payload = {
        "protocolVersion": STRATEGY_PROTOCOL_VERSION,
        "requestId": request_id,
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable,
            "details": details or {},
        },
    }
    return JSONResponse(status_code=status_code, content=payload)


async def extract_request_id(request: Request) -> str | None:
    try:
      raw = await request.body()
    except Exception:
      return None
    if not raw:
      return None
    try:
      parsed = json.loads(raw)
    except Exception:
      return None
    if not isinstance(parsed, dict):
      return None
    request_id = parsed.get("requestId")
    return request_id if isinstance(request_id, str) and request_id.strip() else None


def is_token_authorized(received_token: str | None, expected_token: str) -> bool:
    if not expected_token:
        return True
    if not received_token:
        return False
    return hmac.compare_digest(received_token.strip(), expected_token)


def require_auth(x_py_strategy_token: str | None = Header(default=None)) -> None:
    if is_token_authorized(x_py_strategy_token, AUTH_TOKEN):
        return
    raise HTTPException(status_code=401, detail="strategy_auth_failed")


def register_strategies() -> None:
    registry.register(
        "regime_gate",
        name="Regime Gate",
        version="1.0.0",
        default_config={
            "allowStates": ["trend_up", "trend_down", "transition"],
            "minRegimeConfidencePct": 45,
            "requireStackAlignment": True,
            "allowUnknownRegime": False,
        },
        ui_schema={
            "title": "Regime Gate",
            "description": "Uses historyContext.reg and historyContext.ema.stk to allow/block deterministic setups.",
            "fields": {
                "allowStates": {"type": "multiselect", "options": ["trend_up", "trend_down", "range", "transition", "unknown"]},
                "minRegimeConfidencePct": {"type": "number", "min": 0, "max": 100, "step": 1},
                "requireStackAlignment": {"type": "boolean"},
                "allowUnknownRegime": {"type": "boolean"},
            },
        },
        handler=regime_gate.run,
    )

    registry.register(
        "signal_filter",
        name="Signal Filter",
        version="1.0.0",
        default_config={
            "blockedTags": ["data_gap", "news_risk"],
            "requiredTags": [],
            "maxVolZ": 2.5,
            "blockRangeStates": ["range"],
            "allowRangeWhenTrendTag": False,
        },
        ui_schema={
            "title": "Signal Filter",
            "description": "Blocks setups by tags, volatility pressure, and range-state constraints.",
            "fields": {
                "blockedTags": {"type": "string_array"},
                "requiredTags": {"type": "string_array"},
                "maxVolZ": {"type": "number", "min": 0, "max": 10, "step": 0.1},
                "blockRangeStates": {"type": "multiselect", "options": ["range", "transition", "unknown"]},
                "allowRangeWhenTrendTag": {"type": "boolean"},
            },
        },
        handler=signal_filter.run,
    )

    registry.register(
        "trend_vol_gate",
        name="Trend+Vol Gate",
        version="1.0.0",
        default_config={
            "allowedStates": ["trend_up", "trend_down"],
            "minRegimeConf": 55,
            "requireStackAlignment": True,
            "requireSlopeAlignment": True,
            "minAbsD50Pct": 0.12,
            "minAbsD200Pct": 0.20,
            "maxVolZ": 2.5,
            "maxRelVol": 1.8,
            "minVolZ": -1.2,
            "minRelVol": 0.6,
            "minPassScore": 70,
            "allowNeutralSignal": False,
        },
        ui_schema={
            "title": "Trend+Vol Gate",
            "description": "Deterministic gate on regime, EMA alignment, distance and volume pressure.",
            "fields": {
                "allowedStates": {"type": "multiselect", "options": ["trend_up", "trend_down", "range", "transition", "unknown"]},
                "minRegimeConf": {"type": "number", "min": 0, "max": 100, "step": 1},
                "requireStackAlignment": {"type": "boolean"},
                "requireSlopeAlignment": {"type": "boolean"},
                "minAbsD50Pct": {"type": "number", "min": 0, "max": 5, "step": 0.01},
                "minAbsD200Pct": {"type": "number", "min": 0, "max": 5, "step": 0.01},
                "maxVolZ": {"type": "number", "min": 0, "max": 10, "step": 0.1},
                "maxRelVol": {"type": "number", "min": 0, "max": 5, "step": 0.1},
                "minVolZ": {"type": "number", "min": -10, "max": 0, "step": 0.1},
                "minRelVol": {"type": "number", "min": 0, "max": 2, "step": 0.1},
                "minPassScore": {"type": "number", "min": 0, "max": 100, "step": 1},
                "allowNeutralSignal": {"type": "boolean"},
            },
        },
        handler=trend_vol_gate.run,
    )

    registry.register(
        "ta_trend_vol_gate_v2",
        name="TA Trend+Vol Gate v2",
        version="1.0.0",
        default_config={
            "allowedStates": ["trend_up", "trend_down"],
            "minRegimeConf": 50,
            "minAdx": 18,
            "maxAtrPct": 2.0,
            "rsiLongMin": 52,
            "rsiShortMax": 48,
            "requireEmaAlignment": True,
            "minPassScore": 65,
            "allowNeutralSignal": False,
        },
        ui_schema={
            "title": "TA Trend+Vol Gate v2",
            "description": "Trend/volume gate with TA backend (TA-Lib or pandas-ta) on OHLCV series.",
            "fields": {
                "allowedStates": {"type": "multiselect", "options": ["trend_up", "trend_down", "range", "transition", "unknown"]},
                "minRegimeConf": {"type": "number", "min": 0, "max": 100, "step": 1},
                "minAdx": {"type": "number", "min": 0, "max": 100, "step": 1},
                "maxAtrPct": {"type": "number", "min": 0, "max": 20, "step": 0.1},
                "rsiLongMin": {"type": "number", "min": 0, "max": 100, "step": 1},
                "rsiShortMax": {"type": "number", "min": 0, "max": 100, "step": 1},
                "requireEmaAlignment": {"type": "boolean"},
                "minPassScore": {"type": "number", "min": 0, "max": 100, "step": 1},
                "allowNeutralSignal": {"type": "boolean"},
            },
        },
        handler=ta_trend_vol_gate_v2.run,
    )

    registry.register(
        "smart_money_concept",
        name="Smart Money Concept",
        version="1.0.0",
        default_config={
            "requireNonNeutralSignal": True,
            "blockOnDataGap": True,
            "requireTrendAlignment": True,
            "requireStructureAlignment": True,
            "requireZoneAlignment": True,
            "allowEquilibriumZone": True,
            "maxEventAgeBars": 120,
            "minPassScore": 65,
        },
        ui_schema={
            "title": "Smart Money Concept",
            "description": "Deterministic SMC gate using structure, trend and premium/discount zones.",
            "fields": {
                "requireNonNeutralSignal": {"type": "boolean"},
                "blockOnDataGap": {"type": "boolean"},
                "requireTrendAlignment": {"type": "boolean"},
                "requireStructureAlignment": {"type": "boolean"},
                "requireZoneAlignment": {"type": "boolean"},
                "allowEquilibriumZone": {"type": "boolean"},
                "maxEventAgeBars": {"type": "number", "min": 1, "max": 1000, "step": 1},
                "minPassScore": {"type": "number", "min": 0, "max": 100, "step": 1},
            },
        },
        handler=smart_money_concept.run,
    )

    registry.register(
        "vmc_cipher_gate",
        name="VMC Cipher Gate",
        version="1.0.0",
        default_config={
            "requireNonNeutralSignal": True,
            "blockOnDataGap": True,
            "maxSignalAgeBars": 4,
            "allowDivSignalAsPrimary": True,
            "minPassScore": 60,
        },
        ui_schema={
            "title": "VMC Cipher Gate",
            "description": "Deterministic gate using VuManChu Cipher signals with gold-dot long block.",
            "fields": {
                "requireNonNeutralSignal": {"type": "boolean"},
                "blockOnDataGap": {"type": "boolean"},
                "maxSignalAgeBars": {"type": "number", "min": 1, "max": 100, "step": 1},
                "allowDivSignalAsPrimary": {"type": "boolean"},
                "minPassScore": {"type": "number", "min": 0, "max": 100, "step": 1},
            },
        },
        handler=vmc_cipher_gate.run,
    )

    registry.register(
        "vmc_divergence_reversal",
        name="VMC Divergence Reversal",
        version="1.0.0",
        default_config={
            "requireNonNeutralSignal": True,
            "blockOnDataGap": True,
            "requireRegularDiv": True,
            "allowHiddenDiv": False,
            "requireCrossAlignment": True,
            "requireExtremeZone": True,
            "maxDivergenceAgeBars": 8,
            "minPassScore": 65,
        },
        ui_schema={
            "title": "VMC Divergence Reversal",
            "description": "Deterministic divergence reversal gate using VuManChu divergence/cross/zone context.",
            "fields": {
                "requireNonNeutralSignal": {"type": "boolean"},
                "blockOnDataGap": {"type": "boolean"},
                "requireRegularDiv": {"type": "boolean"},
                "allowHiddenDiv": {"type": "boolean"},
                "requireCrossAlignment": {"type": "boolean"},
                "requireExtremeZone": {"type": "boolean"},
                "maxDivergenceAgeBars": {"type": "number", "min": 1, "max": 100, "step": 1},
                "minPassScore": {"type": "number", "min": 0, "max": 100, "step": 1},
            },
        },
        handler=vmc_divergence_reversal.run,
    )


register_strategies()


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    if request.url.path.startswith("/v2/grid/"):
        return build_grid_error_response(
            request_id=await extract_request_id(request),
            code="grid_payload_invalid",
            message="grid payload validation failed",
            status_code=422,
            retryable=False,
            details={"errors": exc.errors()},
        )
    if request.url.path.startswith("/v2/strategies"):
        return build_strategy_error_response(
            request_id=await extract_request_id(request),
            code="strategy_invalid_payload",
            message="strategy payload validation failed",
            status_code=422,
            retryable=False,
            details={"errors": exc.errors()},
        )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if request.url.path.startswith("/v2/grid/"):
        return build_grid_error_response(
            request_id=await extract_request_id(request),
            code="grid_http_error",
            message=str(exc.detail),
            status_code=exc.status_code,
            retryable=False,
        )
    if request.url.path.startswith("/v2/strategies"):
        detail = str(exc.detail)
        code = (
            "strategy_auth_failed"
            if exc.status_code == 401
            else "strategy_degraded"
            if exc.status_code == 503
            else
            "strategy_not_found"
            if detail.startswith("strategy_not_found:")
            else "strategy_http_error"
        )
        return build_strategy_error_response(
            request_id=await extract_request_id(request),
            code=code,
            message=detail,
            status_code=exc.status_code,
            retryable=False,
        )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=SERVICE_VERSION, gridPlanner=True)


@app.get("/v1/strategies", response_model=StrategyRegistryResponse)
def list_strategies(_: None = Depends(require_auth)) -> StrategyRegistryResponse:
    return StrategyRegistryResponse(items=registry.list_public())


@app.post("/v1/strategies/run", response_model=StrategyRunResponse)
def run_strategy(payload: StrategyRunRequest, _: None = Depends(require_auth)) -> StrategyRunResponse:
    registration = registry.get(payload.strategyType)
    if not registration:
        raise HTTPException(status_code=404, detail=f"strategy_not_found:{payload.strategyType}")

    result = registration.handler(payload)
    merged_meta = {
        **(result.meta or {}),
        "engine": "python",
        "strategyType": registration.type,
        "strategyVersion": registration.version,
    }
    return StrategyRunResponse(
        allow=result.allow,
        score=result.score,
        reasonCodes=result.reasonCodes,
        tags=result.tags,
        explanation=result.explanation,
        meta=merged_meta,
    )


@app.get("/v2/strategies", response_model=StrategyRegistryEnvelopeResponse)
def list_strategies_v2(_: None = Depends(require_auth)) -> StrategyRegistryEnvelopeResponse | JSONResponse:
    try:
        return StrategyRegistryEnvelopeResponse(
            protocolVersion=STRATEGY_PROTOCOL_VERSION,
            requestId=None,
            ok=True,
            payload=StrategyRegistryResponse(items=registry.list_public()),
        )
    except HTTPException as exc:
        return build_strategy_error_response(
            request_id=None,
            code="strategy_degraded" if exc.status_code == 503 else "strategy_http_error",
            message=str(exc.detail),
            status_code=exc.status_code,
            retryable=exc.status_code >= 500,
        )
    except Exception as exc:
        return build_strategy_error_response(
            request_id=None,
            code="strategy_degraded",
            message=str(exc),
            status_code=503,
            retryable=True,
        )


@app.post("/v2/strategies/run", response_model=StrategyRunEnvelopeResponse)
def run_strategy_v2(
    envelope: StrategyRunEnvelopeRequest,
    _: None = Depends(require_auth),
) -> StrategyRunEnvelopeResponse | JSONResponse:
    request_id = envelope.requestId
    payload = envelope.payload
    registration = registry.get(payload.strategyType)
    if not registration:
        return build_strategy_error_response(
            request_id=request_id,
            code="strategy_not_found",
            message=f"strategy_not_found:{payload.strategyType}",
            status_code=404,
            retryable=False,
        )

    try:
        result = registration.handler(payload)
        merged_meta = {
            **(result.meta or {}),
            "engine": "python",
            "strategyType": registration.type,
            "strategyVersion": registration.version,
        }
        return StrategyRunEnvelopeResponse(
            protocolVersion=STRATEGY_PROTOCOL_VERSION,
            requestId=request_id,
            ok=True,
            payload=StrategyRunResponse(
                allow=result.allow,
                score=result.score,
                reasonCodes=result.reasonCodes,
                tags=result.tags,
                explanation=result.explanation,
                meta=merged_meta,
            ),
        )
    except HTTPException as exc:
        return build_strategy_error_response(
            request_id=request_id,
            code="strategy_http_error",
            message=str(exc.detail),
            status_code=exc.status_code,
            retryable=False,
        )
    except RequestValidationError as exc:
        return build_strategy_error_response(
            request_id=request_id,
            code="strategy_invalid_payload",
            message="strategy payload validation failed",
            status_code=422,
            retryable=False,
            details={"errors": exc.errors()},
        )
    except Exception as exc:
        return build_strategy_error_response(
            request_id=request_id,
            code="strategy_execution_failed",
            message=str(exc),
            status_code=500,
            retryable=False,
        )


@app.post("/v1/grid/preview", response_model=GridPreviewResponse)
def grid_preview(payload: GridPreviewRequest, _: None = Depends(require_auth)) -> GridPreviewResponse:
    return preview_grid(payload)


@app.post("/v1/grid/plan", response_model=GridPlanResponse)
def grid_plan(payload: GridPlanRequest, _: None = Depends(require_auth)) -> GridPlanResponse:
    return plan_grid(payload)


@app.post("/v2/grid/preview", response_model=GridPreviewEnvelopeResponse)
def grid_preview_v2(payload: GridPreviewEnvelopeRequest, _: None = Depends(require_auth)) -> GridPreviewEnvelopeResponse | JSONResponse:
    request_id = payload.requestId
    try:
        preview = preview_grid(payload.payload)
        return GridPreviewEnvelopeResponse(
            protocolVersion=GRID_PROTOCOL_VERSION,
            requestId=request_id,
            ok=True,
            payload=preview,
        )
    except HTTPException as exc:
        return build_grid_error_response(
            request_id=request_id,
            code="grid_http_error",
            message=str(exc.detail),
            status_code=exc.status_code,
            retryable=False,
        )
    except RequestValidationError as exc:
        return build_grid_error_response(
            request_id=request_id,
            code="grid_payload_invalid",
            message="grid preview payload validation failed",
            status_code=422,
            retryable=False,
            details={"errors": exc.errors()},
        )
    except Exception as exc:
        return build_grid_error_response(
            request_id=request_id,
            code="grid_preview_failed",
            message=str(exc),
            status_code=500,
            retryable=False,
        )


@app.post("/v2/grid/plan", response_model=GridPlanEnvelopeResponse)
def grid_plan_v2(payload: GridPlanEnvelopeRequest, _: None = Depends(require_auth)) -> GridPlanEnvelopeResponse | JSONResponse:
    request_id = payload.requestId
    try:
        plan = plan_grid(payload.payload)
        return GridPlanEnvelopeResponse(
            protocolVersion=GRID_PROTOCOL_VERSION,
            requestId=request_id,
            ok=True,
            payload=plan,
        )
    except HTTPException as exc:
        return build_grid_error_response(
            request_id=request_id,
            code="grid_http_error",
            message=str(exc.detail),
            status_code=exc.status_code,
            retryable=False,
        )
    except RequestValidationError as exc:
        return build_grid_error_response(
            request_id=request_id,
            code="grid_payload_invalid",
            message="grid plan payload validation failed",
            status_code=422,
            retryable=False,
            details={"errors": exc.errors()},
        )
    except Exception as exc:
        return build_grid_error_response(
            request_id=request_id,
            code="grid_plan_failed",
            message=str(exc),
            status_code=500,
            retryable=False,
        )
