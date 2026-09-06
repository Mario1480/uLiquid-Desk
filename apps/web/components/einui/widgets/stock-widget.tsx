"use client";
import { cn } from "@/components/einui/utils";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { GlassWidgetBase } from "./base-widget";

interface StockTickerWidgetProps {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePercent: number;
  chartData?: number[];
  className?: string;
}

function StockTickerWidget({
  symbol,
  name,
  price,
  change,
  changePercent,
  chartData,
  className,
}: StockTickerWidgetProps) {
  const isPositive = change >= 0;
  const color = isPositive ? "ein:text-emerald-500" : "ein:text-red-500";

  return (
    <GlassWidgetBase className={cn("ein:min-w-45", className)} glowColor={isPositive ? "green" : "red"}>
      <div className="ein:flex ein:items-start ein:justify-between ein:mb-2">
        <div className="ein:flex ein:items-center ein:gap-2">
          {isPositive ? (
            <TrendingUp className="ein:w-4 ein:h-4 ein:text-emerald-500" />
          ) : (
            <TrendingDown className="ein:w-4 ein:h-4 ein:text-red-500" />
          )}
          <span className="ein:text-white ein:font-medium">{symbol}</span>
        </div>
        <span className={cn("ein:text-sm ein:tabular-nums", color)}>
          {isPositive ? "+" : ""}
          {change.toFixed(2)}
        </span>
      </div>

      {chartData && chartData.length > 0 && (
        <div className="ein:h-12 ein:flex ein:items-end ein:gap-px ein:my-3">
          {chartData.map((value, i) => {
            const max = Math.max(...chartData);
            const min = Math.min(...chartData);
            const height = ((value - min) / (max - min || 1)) * 100;
            return (
              <div
                key={i}
                className={cn(
                  "ein:flex-1 ein:rounded-t ein:transition-all",
                  isPositive ? "ein:bg-emerald-500/60" : "ein:bg-red-500/60"
                )}
                style={{ height: `${Math.max(height, 10)}%` }}
              />
            );
          })}
        </div>
      )}

      <div className="ein:flex ein:items-end ein:justify-between">
        <div>
          <div className="ein:text-2xl ein:font-light ein:text-white ein:tabular-nums">{price.toFixed(2)}</div>
          {name && <div className="ein:text-sm ein:text-white/70 ein:truncate ein:max-w-30">{name}</div>}
        </div>
        <span className={cn("ein:text-sm ein:tabular-nums", color)}>
          {isPositive ? "+" : ""}
          {changePercent.toFixed(2)}%
        </span>
      </div>
    </GlassWidgetBase>
  );
}

interface CompactStockWidgetProps {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  className?: string;
}

function CompactStockWidget({
  symbol,
  price,
  change,
  changePercent,
  className,
}: CompactStockWidgetProps) {
  const isPositive = change >= 0;

  return (
    <GlassWidgetBase
      className={cn("ein:min-w-35", className)}
      size="sm"
      glowColor={isPositive ? "green" : "red"}
    >
      <div className="ein:flex ein:items-center ein:justify-between">
        <span className="ein:text-white ein:font-medium">{symbol}</span>
        <span
          className={cn(
            "ein:flex ein:items-center ein:gap-0.5 ein:text-sm",
            isPositive ? "ein:text-emerald-500" : "ein:text-red-500"
          )}
        >
          {isPositive ? (
            <ArrowUpRight className="ein:w-3 ein:h-3" />
          ) : (
            <ArrowDownRight className="ein:w-3 ein:h-3" />
          )}
          {Math.abs(changePercent).toFixed(2)}%
        </span>
      </div>
      <div className="ein:text-xl ein:font-light ein:text-white ein:mt-1 ein:tabular-nums">${price.toFixed(2)}</div>
    </GlassWidgetBase>
  );
}

interface PortfolioItem {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
}

interface PortfolioWidgetProps {
  title?: string;
  totalValue?: number;
  totalChange?: number;
  holdings?: PortfolioItem[];
  className?: string;
}

function PortfolioWidget({
  title = "Portfolio",
  totalValue = 0,
  totalChange = 0,
  holdings = [],
  className,
}: PortfolioWidgetProps) {
  const isPositive = totalChange >= 0;

  return (
    <GlassWidgetBase
      className={cn("ein:min-w-70", className)}
      size="lg"
      glowColor={isPositive ? "green" : "red"}
    >
      <div className="ein:flex ein:items-start ein:justify-between ein:mb-4">
        <div>
          <h3 className="ein:text-white/60 ein:text-sm">{title}</h3>
          <div className="ein:text-2xl ein:font-light ein:text-white ein:tabular-nums">
            ${totalValue.toLocaleString()}
          </div>
        </div>
        <span
          className={cn(
            "ein:flex ein:items-center ein:gap-1 ein:text-sm",
            isPositive ? "ein:text-emerald-500" : "ein:text-red-500"
          )}
        >
          {isPositive ? <TrendingUp className="ein:w-4 ein:h-4" /> : <TrendingDown className="ein:w-4 ein:h-4" />}
          {isPositive ? "+" : ""}
          {totalChange.toFixed(2)}%
        </span>
      </div>

      <div className="ein:space-y-2">
        {holdings.map((item) => {
          const value = item.shares * item.currentPrice;
          const gain = ((item.currentPrice - item.avgCost) / item.avgCost) * 100;
          const isGain = gain >= 0;

          return (
            <div
              key={item.symbol}
              className="ein:flex ein:items-center ein:justify-between ein:p-2 ein:rounded-lg ein:bg-white/5 ein:border ein:border-white/5"
            >
              <div>
                <div className="ein:text-white ein:font-medium">{item.symbol}</div>
                <div className="ein:text-white/70 ein:text-xs">{item.shares} shares</div>
              </div>
              <div className="ein:text-right">
                <div className="ein:text-white ein:tabular-nums">${value.toFixed(2)}</div>
                <div
                  className={cn(
                    "ein:text-xs ein:tabular-nums",
                    isGain ? "ein:text-emerald-500" : "ein:text-red-500"
                  )}
                >
                  {isGain ? "+" : ""}
                  {gain.toFixed(2)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </GlassWidgetBase>
  );
}

interface MarketIndex {
  name: string;
  value: number;
  change: number;
  changePercent: number;
}

interface MarketOverviewWidgetProps {
  indices?: MarketIndex[];
  className?: string;
}

function MarketOverviewWidget({ indices = [], className }: MarketOverviewWidgetProps) {
  return (
    <GlassWidgetBase className={cn("ein:min-w-60", className)} glowColor="cyan">
      <h3 className="ein:text-white/60 ein:text-sm ein:mb-4">Market Overview</h3>
      <div className="ein:space-y-3">
        {indices.map((index) => {
          const isPositive = index.change >= 0;
          return (
            <div key={index.name} className="ein:flex ein:items-center ein:justify-between">
              <span className="ein:text-white/80">{index.name}</span>
              <div className="ein:flex ein:items-center ein:gap-3">
                <span className="ein:text-white ein:tabular-nums">{index.value.toLocaleString()}</span>
                <span
                  className={cn(
                    "ein:flex ein:items-center ein:gap-0.5 ein:text-sm ein:tabular-nums",
                    isPositive ? "ein:text-emerald-500" : "ein:text-red-500"
                  )}
                >
                  {isPositive ? (
                    <ArrowUpRight className="ein:w-3 ein:h-3" />
                  ) : (
                    <ArrowDownRight className="ein:w-3 ein:h-3" />
                  )}
                  {Math.abs(index.changePercent).toFixed(2)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </GlassWidgetBase>
  );
}

interface CryptoWidgetProps {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap?: string;
  volume24h?: string;
  sparkline?: number[];
  className?: string;
}

function CryptoWidget({
  symbol,
  name,
  price,
  change24h,
  marketCap,
  volume24h,
  sparkline,
  className,
}: CryptoWidgetProps) {
  const isPositive = change24h >= 0;

  return (
    <GlassWidgetBase className={cn("ein:min-w-50", className)} glowColor={isPositive ? "green" : "red"}>
      <div className="ein:flex ein:items-start ein:justify-between ein:mb-3">
        <div>
          <div className="ein:text-white ein:font-medium">{symbol}</div>
          <div className="ein:text-white/70 ein:text-sm">{name}</div>
        </div>
        <span
          className={cn("ein:text-sm ein:tabular-nums", isPositive ? "ein:text-emerald-500" : "ein:text-red-500")}
        >
          {isPositive ? "+" : ""}
          {change24h.toFixed(2)}%
        </span>
      </div>

      {sparkline && sparkline.length > 0 && (
        <div className="ein:h-10 ein:flex ein:items-end ein:gap-px ein:mb-3">
          {sparkline.map((value, i) => {
            const max = Math.max(...sparkline);
            const min = Math.min(...sparkline);
            const height = ((value - min) / (max - min || 1)) * 100;
            return (
              <div
                key={i}
                className={cn(
                  "ein:flex-1 ein:rounded-t",
                  isPositive ? "ein:bg-emerald-500/50" : "ein:bg-red-500/50"
                )}
                style={{ height: `${Math.max(height, 5)}%` }}
              />
            );
          })}
        </div>
      )}

      <div className="ein:text-2xl ein:font-light ein:text-white ein:mb-2 ein:tabular-nums">
        ${price.toLocaleString()}
      </div>

      {(marketCap || volume24h) && (
        <div className="ein:flex ein:items-center ein:gap-4 ein:text-xs ein:text-white/70">
          {marketCap && <span>MCap: {marketCap}</span>}
          {volume24h && <span>Vol: {volume24h}</span>}
        </div>
      )}
    </GlassWidgetBase>
  );
}

export {
  StockTickerWidget,
  CompactStockWidget,
  PortfolioWidget,
  MarketOverviewWidget,
  CryptoWidget,
};
