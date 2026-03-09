from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

GridMode = Literal["long", "short", "neutral", "cross"]
GridPriceMode = Literal["arithmetic", "geometric"]
GridAllocationMode = Literal["EQUAL_NOTIONAL_PER_GRID", "EQUAL_BASE_QTY_PER_GRID", "WEIGHTED_NEAR_PRICE"]
GridBudgetSplitPolicy = Literal["FIXED_50_50", "FIXED_CUSTOM", "DYNAMIC_BY_PRICE_POSITION"]
GridIntentType = Literal["place_order", "cancel_order", "replace_order", "set_protection"]


class GridFeeModel(BaseModel):
    takerPct: float = 0.06


class GridVenueConstraints(BaseModel):
    minQty: Optional[float] = Field(default=None, gt=0)
    qtyStep: Optional[float] = Field(default=None, gt=0)
    priceTick: Optional[float] = Field(default=None, gt=0)
    minNotional: Optional[float] = Field(default=None, gt=0)
    feeRate: Optional[float] = Field(default=None, ge=0)


class GridVenueChecks(BaseModel):
    minQtyHit: bool = False
    minNotionalHit: bool = False
    roundedByStep: bool = False
    fallbackUsed: bool = False
    minQtyUsed: Optional[float] = None
    minNotionalUsed: Optional[float] = None


class GridPreviewRequest(BaseModel):
    mode: GridMode
    gridMode: GridPriceMode
    allocationMode: GridAllocationMode = "EQUAL_NOTIONAL_PER_GRID"
    budgetSplitPolicy: GridBudgetSplitPolicy = "FIXED_50_50"
    longBudgetPct: float = Field(default=50, ge=0, le=100)
    shortBudgetPct: float = Field(default=50, ge=0, le=100)
    lowerPrice: float = Field(gt=0)
    upperPrice: float = Field(gt=0)
    gridCount: int = Field(ge=2, le=500)
    activeOrderWindowSize: int = Field(default=100, ge=40, le=120)
    recenterDriftLevels: int = Field(default=1, ge=1, le=10)
    investUsd: float = Field(gt=0)
    leverage: float = Field(gt=0)
    markPrice: Optional[float] = Field(default=None, gt=0)
    slippagePct: float = Field(default=0.1, ge=0.0001, le=5)
    tpPct: Optional[float] = None
    slPrice: Optional[float] = Field(default=None, gt=0)
    triggerPrice: Optional[float] = None
    trailingEnabled: bool = False
    feeModel: GridFeeModel = Field(default_factory=GridFeeModel)
    venueConstraints: Optional[GridVenueConstraints] = None
    feeBufferPct: Optional[float] = Field(default=None, ge=0, le=25)
    mmrPct: Optional[float] = Field(default=None, ge=0, le=20)
    extraMarginUsd: Optional[float] = Field(default=0, ge=0)
    initialSeedEnabled: bool = True
    initialSeedPct: float = Field(default=30, ge=0, le=60)

    @field_validator("upperPrice")
    @classmethod
    def validate_upper_price(cls, value: float, info):
        lower = info.data.get("lowerPrice")
        if lower is not None and value <= lower:
            raise ValueError("upperPrice must be greater than lowerPrice")
        return value


class GridLevel(BaseModel):
    index: int
    price: float


class GridPreviewResponse(BaseModel):
    levels: List[GridLevel] = Field(default_factory=list)
    perGridQty: float
    perGridNotional: float
    profitPerGridNetPct: float
    profitPerGridNetUsd: float
    liqEstimate: Optional[float] = None
    liqEstimateLong: Optional[float] = None
    liqEstimateShort: Optional[float] = None
    worstCaseLiqPrice: Optional[float] = None
    worstCaseLiqDistancePct: Optional[float] = None
    liqDistanceMinPct: Optional[float] = None
    entryBlockedByLiq: Optional[bool] = None
    minInvestmentUSDT: float = 0
    minInvestmentBreakdown: Dict[str, float] = Field(default_factory=dict)
    initialSeed: Dict[str, Any] = Field(default_factory=dict)
    effectiveGridSlots: int = 0
    allocationBreakdown: Dict[str, Any] = Field(default_factory=dict)
    qtyModel: Dict[str, Any] = Field(default_factory=dict)
    profitPerGridEstimateUSDT: float = 0
    qtyPerOrderRounded: float = 0
    venueChecks: GridVenueChecks = Field(default_factory=GridVenueChecks)
    windowMeta: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)
    validationErrors: List[str] = Field(default_factory=list)


class GridOrderSnapshot(BaseModel):
    exchangeOrderId: Optional[str] = None
    clientOrderId: Optional[str] = None
    side: Optional[str] = None
    price: Optional[float] = None
    qty: Optional[float] = None
    reduceOnly: Optional[bool] = None
    status: Optional[str] = None


class GridPositionSnapshot(BaseModel):
    side: Optional[Literal["long", "short"]] = None
    qty: Optional[float] = None
    entryPrice: Optional[float] = None
    markPrice: Optional[float] = None


class GridPlanRequest(BaseModel):
    instanceId: str = Field(min_length=1)
    mode: GridMode
    gridMode: GridPriceMode
    allocationMode: GridAllocationMode = "EQUAL_NOTIONAL_PER_GRID"
    budgetSplitPolicy: GridBudgetSplitPolicy = "FIXED_50_50"
    longBudgetPct: float = Field(default=50, ge=0, le=100)
    shortBudgetPct: float = Field(default=50, ge=0, le=100)
    lowerPrice: float = Field(gt=0)
    upperPrice: float = Field(gt=0)
    gridCount: int = Field(ge=2, le=500)
    activeOrderWindowSize: int = Field(default=100, ge=40, le=120)
    recenterDriftLevels: int = Field(default=1, ge=1, le=10)
    investUsd: float = Field(gt=0)
    leverage: float = Field(gt=0)
    slippagePct: float = Field(default=0.1, ge=0.0001, le=5)
    triggerPrice: Optional[float] = None
    tpPct: Optional[float] = None
    slPrice: Optional[float] = Field(default=None, gt=0)
    trailingEnabled: bool = False
    markPrice: float = Field(gt=0)
    openOrders: List[GridOrderSnapshot] = Field(default_factory=list)
    position: Optional[GridPositionSnapshot] = None
    stateJson: Dict[str, Any] = Field(default_factory=dict)
    fillEvents: List[Dict[str, Any]] = Field(default_factory=list)
    feeModel: GridFeeModel = Field(default_factory=GridFeeModel)
    venueConstraints: Optional[GridVenueConstraints] = None
    feeBufferPct: Optional[float] = Field(default=None, ge=0, le=25)
    mmrPct: Optional[float] = Field(default=None, ge=0, le=20)
    extraMarginUsd: Optional[float] = Field(default=0, ge=0)
    liqDistanceMinPct: Optional[float] = Field(default=None, ge=0, le=100)
    initialSeedEnabled: bool = True
    initialSeedPct: float = Field(default=30, ge=0, le=60)

    @field_validator("upperPrice")
    @classmethod
    def validate_upper_price(cls, value: float, info):
        lower = info.data.get("lowerPrice")
        if lower is not None and value <= lower:
            raise ValueError("upperPrice must be greater than lowerPrice")
        return value


class GridIntent(BaseModel):
    type: GridIntentType
    side: Optional[str] = None
    price: Optional[float] = None
    qty: Optional[float] = None
    reduceOnly: Optional[bool] = None
    clientOrderId: Optional[str] = None
    exchangeOrderId: Optional[str] = None
    limitOffsetBps: Optional[float] = None
    gridLeg: Optional[str] = None
    gridIndex: Optional[int] = None
    tpPrice: Optional[float] = None
    slPrice: Optional[float] = None


class GridPlanResponse(BaseModel):
    intents: List[GridIntent] = Field(default_factory=list)
    nextStateJson: Dict[str, Any] = Field(default_factory=dict)
    metricsDelta: Dict[str, Any] = Field(default_factory=dict)
    windowMeta: Dict[str, Any] = Field(default_factory=dict)
    risk: Dict[str, Any] = Field(default_factory=dict)
    reasonCodes: List[str] = Field(default_factory=list)
