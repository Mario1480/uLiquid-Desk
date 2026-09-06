"use client";

import * as React from "react";
import { cn } from "@/components/einui/utils";
import {
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import { GlassWidgetBase } from "./base-widget";

interface StatCardProps {
  title: string;
  value: string | number;
  change?: {
    value: number;
    type: "increase" | "decrease" | "neutral";
  };
  icon?: React.ReactNode;
  glowColor?: "cyan" | "purple" | "blue" | "pink" | "green" | "amber" | "red";
  className?: string;
}

function StatCard({
  title,
  value,
  change,
  icon,
  glowColor = "cyan",
  className,
}: StatCardProps) {
  const changeColors = {
    increase: "ein:text-emerald-400",
    decrease: "ein:text-red-400",
    neutral: "ein:text-white/70",
  };

  const ChangeIcon = change?.type === "increase" ? ArrowUp : change?.type === "decrease" ? ArrowDown : Minus;

  return (
    <GlassWidgetBase
      className={cn("ein:min-w-48", className)}
      size="md"
      glowColor={glowColor}
    >
      <div className="ein:flex ein:items-start ein:justify-between ein:mb-3">
        <div className="ein:text-white/60 ein:text-sm">{title}</div>
        {icon && <div className="ein:text-white/70">{icon}</div>}
      </div>
      <div className="ein:text-3xl ein:font-light ein:text-white ein:mb-2">{value}</div>
      {change && (
        <div className={cn("ein:flex ein:items-center ein:gap-1 ein:text-xs", changeColors[change.type])}>
          <ChangeIcon className="ein:w-3 ein:h-3" />
          <span>{Math.abs(change.value)}%</span>
          <span className="ein:text-white/70">vs last period</span>
        </div>
      )}
    </GlassWidgetBase>
  );
}

interface MetricStatProps {
  label: string;
  value: number;
  max?: number;
  unit?: string;
  icon?: React.ReactNode;
  glowColor?: "cyan" | "purple" | "blue" | "pink" | "green" | "amber" | "red";
  className?: string;
}

function MetricStat({
  label,
  value,
  max = 100,
  unit = "",
  icon,
  glowColor = "blue",
  className,
}: MetricStatProps) {
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <GlassWidgetBase
      className={cn("ein:min-w-56", className)}
      size="md"
      glowColor={glowColor}
    >
      <div className="ein:flex ein:items-center ein:justify-between ein:mb-3">
        <div className="ein:flex ein:items-center ein:gap-2">
          {icon && <div className="ein:text-white/60">{icon}</div>}
          <div className="ein:text-white/60 ein:text-sm">{label}</div>
        </div>
        <div className="ein:text-white ein:font-medium">
          {value}
          {unit && <span className="ein:text-white/60 ein:text-sm ein:ml-1">{unit}</span>}
        </div>
      </div>
      <div className="ein:relative ein:h-2 ein:bg-white/10 ein:rounded-full ein:overflow-hidden">
        <div
          className={cn(
            "ein:h-full ein:rounded-full ein:transition-all ein:duration-500",
            glowColor === "cyan" && "ein:bg-linear-to-r ein:from-cyan-500 ein:to-blue-500",
            glowColor === "purple" && "ein:bg-linear-to-r ein:from-purple-500 ein:to-pink-500",
            glowColor === "blue" && "ein:bg-linear-to-r ein:from-blue-500 ein:to-indigo-500",
            glowColor === "pink" && "ein:bg-linear-to-r ein:from-pink-500 ein:to-rose-500",
            glowColor === "green" && "ein:bg-linear-to-r ein:from-emerald-500 ein:to-teal-500",
            glowColor === "amber" && "ein:bg-linear-to-r ein:from-amber-500 ein:to-orange-500",
            glowColor === "red" && "ein:bg-linear-to-r ein:from-red-500 ein:to-rose-500"
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="ein:text-white/70 ein:text-xs ein:mt-2">
        {percentage.toFixed(0)}% of {max}
        {unit}
      </div>
    </GlassWidgetBase>
  );
}

interface ComparisonStatProps {
  title: string;
  current: number;
  previous: number;
  format?: (value: number) => string;
  icon?: React.ReactNode;
  glowColor?: "cyan" | "purple" | "blue" | "pink" | "green" | "amber" | "red";
  className?: string;
}

function ComparisonStat({
  title,
  current,
  previous,
  format = (v) => v.toString(),
  icon,
  glowColor = "green",
  className,
}: ComparisonStatProps) {
  // Handle division by zero: if previous is 0, calculate change differently
  let change: number;
  let isNew = false;
  let isZero = false;

  if (previous === 0) {
    if (current === 0) {
      change = 0;
      isZero = true;
    } else if (current > 0) {
      // Going from 0 to positive value - treat as "new"
      change = 0;
      isNew = true;
    } else {
      // Going from 0 to negative value - treat as decrease
      change = -100;
    }
  } else {
    change = ((current - previous) / previous) * 100;
  }

  const isIncrease = change > 0;
  const isDecrease = change < 0;

  return (
    <GlassWidgetBase
      className={cn("ein:min-w-52", className)}
      size="md"
      glowColor={glowColor}
    >
      <div className="ein:flex ein:items-center ein:justify-between ein:mb-4">
        <div className="ein:text-white/60 ein:text-sm">{title}</div>
        {icon && <div className="ein:text-white/70">{icon}</div>}
      </div>
      <div className="ein:text-4xl ein:font-light ein:text-white ein:mb-2">{format(current)}</div>
      <div className="ein:flex ein:items-center ein:gap-2">
        {isIncrease ? (
          <TrendingUp className="ein:w-4 ein:h-4 ein:text-emerald-400" />
        ) : isDecrease ? (
          <TrendingDown className="ein:w-4 ein:h-4 ein:text-red-400" />
        ) : (
          <Minus className="ein:w-4 ein:h-4 ein:text-white/70" />
        )}
        <span
          className={cn(
            "ein:text-sm",
            isIncrease && "ein:text-emerald-400",
            isDecrease && "ein:text-red-400",
            !isIncrease && !isDecrease && "ein:text-white/70"
          )}
        >
          {isNew ? (
            "New"
          ) : isZero ? (
            "0%"
          ) : (
            <>
              {isIncrease ? "+" : ""}
              {change.toFixed(1)}%
            </>
          )}
        </span>
        <span className="ein:text-white/70 ein:text-xs">from {format(previous)}</span>
      </div>
    </GlassWidgetBase>
  );
}

interface StatsGridProps {
  stats: Array<{
    title: string;
    value: string | number;
    change?: {
      value: number;
      type: "increase" | "decrease" | "neutral";
    };
    icon?: React.ReactNode;
    glowColor?: "cyan" | "purple" | "blue" | "pink" | "green" | "amber" | "red";
  }>;
  className?: string;
}

function StatsGrid({ stats, className }: StatsGridProps) {
  return (
    <div className={cn("ein:grid ein:grid-cols-1 ein:md:grid-cols-2 ein:lg:grid-cols-3 ein:gap-4", className)}>
      {stats.map((stat, i) => (
        <StatCard key={i} {...stat} />
      ))}
    </div>
  );
}

interface CircularProgressStatProps {
  label: string;
  value: number;
  max?: number;
  unit?: string;
  icon?: React.ReactNode;
  glowColor?: "cyan" | "purple" | "blue" | "pink" | "green" | "amber" | "red";
  size?: "sm" | "md" | "lg";
  className?: string;
}

function CircularProgressStat({
  label,
  value,
  max = 100,
  unit = "",
  icon,
  glowColor = "cyan",
  size = "md",
  className,
}: CircularProgressStatProps) {
  const percentage = Math.min((value / max) * 100, 100);
  const radius = size === "lg" ? 50 : size === "md" ? 42 : 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const sizeConfig = {
    sm: { container: "ein:w-32 ein:h-32", text: "ein:text-2xl", label: "ein:text-xs" },
    md: { container: "ein:w-40 ein:h-40", text: "ein:text-3xl", label: "ein:text-sm" },
    lg: { container: "ein:w-48 ein:h-48", text: "ein:text-4xl", label: "ein:text-base" },
  };

  const config = sizeConfig[size];

  const strokeColors = {
    cyan: "#06b6d4",
    purple: "#a855f7",
    blue: "#3b82f6",
    pink: "#ec4899",
    green: "#10b981",
    amber: "#f59e0b",
    red: "#ef4444",
  };

  return (
    <GlassWidgetBase
      className={cn("ein:flex ein:flex-col ein:items-center ein:justify-center", className)}
      size="md"
      glowColor={glowColor}
    >
      <div className={cn("ein:relative", config.container)}>
        <svg className="ein:w-full ein:h-full ein:-rotate-90">
          <circle
            cx="50%"
            cy="50%"
            r={radius}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="6"
            fill="none"
          />
          <circle
            cx="50%"
            cy="50%"
            r={radius}
            stroke={strokeColors[glowColor]}
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="ein:transition-all ein:duration-1000"
          />
        </svg>
        <div className="ein:absolute ein:inset-0 ein:flex ein:flex-col ein:items-center ein:justify-center">
          {icon && <div className="ein:text-white/60 ein:mb-1">{icon}</div>}
          <div className={cn("ein:font-light ein:text-white", config.text)}>
            {value}
            {unit && <span className="ein:text-white/60 ein:text-lg ein:ml-1">{unit}</span>}
          </div>
          <div className={cn("ein:text-white/70 ein:mt-1", config.label)}>{label}</div>
        </div>
      </div>
    </GlassWidgetBase>
  );
}

export {
  StatCard,
  MetricStat,
  ComparisonStat,
  StatsGrid,
  CircularProgressStat,
};
