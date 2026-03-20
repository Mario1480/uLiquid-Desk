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
from registry_manifest import list_python_strategy_manifest_items
from settings import load_settings
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
SETTINGS = load_settings()
AUTH_TOKEN = SETTINGS.auth_token

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
    handler_by_type = {
        "regime_gate": regime_gate.run,
        "signal_filter": signal_filter.run,
        "trend_vol_gate": trend_vol_gate.run,
        "ta_trend_vol_gate_v2": ta_trend_vol_gate_v2.run,
        "smart_money_concept": smart_money_concept.run,
        "vmc_cipher_gate": vmc_cipher_gate.run,
        "vmc_divergence_reversal": vmc_divergence_reversal.run,
    }

    for manifest in list_python_strategy_manifest_items():
        handler = handler_by_type.get(manifest["type"])
        if handler is None:
            raise RuntimeError(f"strategy_handler_missing:{manifest['type']}")
        registry.register(manifest, handler=handler)


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
            else "strategy_version_mismatch"
            if detail.startswith("strategy_version_mismatch:")
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
    if payload.strategyVersion and payload.strategyVersion.strip() != registration.version:
        raise HTTPException(
            status_code=409,
            detail=(
                f"strategy_version_mismatch:{payload.strategyType}:"
                f"{payload.strategyVersion.strip()}!={registration.version}"
            ),
        )

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
    if payload.strategyVersion and payload.strategyVersion.strip() != registration.version:
        return build_strategy_error_response(
            request_id=request_id,
            code="strategy_version_mismatch",
            message=(
                f"strategy_version_mismatch:{payload.strategyType}:"
                f"{payload.strategyVersion.strip()}!={registration.version}"
            ),
            status_code=409,
            retryable=False,
            details={
                "strategyType": payload.strategyType,
                "requestedVersion": payload.strategyVersion.strip(),
                "registeredVersion": registration.version,
            },
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
