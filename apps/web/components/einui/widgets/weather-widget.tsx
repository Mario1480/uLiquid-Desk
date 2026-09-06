"use client";

import { cn } from "@/components/einui/utils";
import { Cloud, CloudRain, Sun, CloudSnow, Wind, Droplets, Thermometer, Moon } from "lucide-react";
import { GlassWidgetBase } from "./base-widget";

type WeatherCondition = "sunny" | "cloudy" | "rainy" | "snowy" | "night" | "night-cloudy";

const WeatherIcon = ({
  condition,
  className,
}: {
  condition: WeatherCondition;
  className?: string;
}) => {
  switch (condition) {
    case "sunny":
      return <Sun className={cn("ein:text-amber-400", className)} />;
    case "cloudy":
      return <Cloud className={cn("ein:text-gray-400", className)} />;
    case "rainy":
      return <CloudRain className={cn("ein:text-blue-400", className)} />;
    case "snowy":
      return <CloudSnow className={cn("ein:text-blue-200", className)} />;
    case "night":
      return <Moon className={cn("ein:text-blue-300", className)} />;
    case "night-cloudy":
      return <Cloud className={cn("ein:text-gray-500", className)} />;
    default:
      return <Sun className={cn("ein:text-amber-400", className)} />;
  }
};

interface WeatherWidgetProps {
  temperature: number;
  condition: string;
  icon?: "sun" | "cloud" | "rain" | "snow" | "wind";
  location?: string;
  className?: string;
}

function WeatherWidget({
  temperature,
  condition,
  icon = "sun",
  location,
  className,
}: WeatherWidgetProps) {
  const iconMap = {
    sun: Sun,
    cloud: Cloud,
    rain: CloudRain,
    snow: CloudSnow,
    wind: Wind,
  };

  const Icon = iconMap[icon];
  const glowColors = {
    sun: "amber",
    cloud: "blue",
    rain: "cyan",
    snow: "purple",
    wind: "blue",
  } as const;

  return (
    <GlassWidgetBase className={cn("ein:min-w-48", className)} size="md" glowColor={glowColors[icon]}>
      {location && <div className="ein:text-white/60 ein:text-sm ein:mb-2">{location}</div>}
      <div className="ein:flex ein:items-center ein:justify-between">
        <div className="ein:flex ein:items-center ein:gap-3">
          <div className="ein:p-2 ein:rounded-xl ein:bg-white/10">
            <Icon className="ein:w-8 ein:h-8 ein:text-white" />
          </div>
          <div>
            <div className="ein:text-4xl ein:font-light ein:text-white">{temperature}°</div>
            <div className="ein:text-white/70 ein:text-sm">{condition}</div>
          </div>
        </div>
      </div>
    </GlassWidgetBase>
  );
}

interface CurrentWeatherWidgetProps {
  location: string;
  temperature: number;
  feelsLike?: number;
  high?: number;
  low?: number;
  condition?: WeatherCondition;
  humidity?: number;
  windSpeed?: number;
  className?: string;
}

function CurrentWeatherWidget({
  location,
  temperature,
  feelsLike,
  high,
  low,
  condition = "sunny",
  humidity,
  windSpeed,
  className,
}: CurrentWeatherWidgetProps) {
  const conditionText: Record<WeatherCondition, string> = {
    sunny: "Sunny",
    cloudy: "Cloudy",
    rainy: "Rainy",
    snowy: "Snowy",
    night: "Clear Night",
    "night-cloudy": "Partly Cloudy",
  };

  const glowColor =
    condition === "sunny"
      ? "amber"
      : condition === "rainy" || condition === "snowy"
      ? "blue"
      : "cyan";

  return (
    <GlassWidgetBase className={cn("ein:min-w-50", className)} glowColor={glowColor}>
      <div className="ein:flex ein:items-start ein:justify-between ein:mb-3">
        <div>
          <div className="ein:text-white ein:font-medium">{location}</div>
          {feelsLike !== undefined && (
            <div className="ein:text-white/70 ein:text-sm">Feels like {feelsLike}°</div>
          )}
        </div>
        <WeatherIcon condition={condition} className="ein:w-8 ein:h-8" />
      </div>

      <div className="ein:text-5xl ein:font-light ein:text-white ein:mb-2">{temperature}°</div>

      <div className="ein:text-white/60 ein:text-sm ein:mb-3">{conditionText[condition]}</div>

      <div className="ein:flex ein:items-center ein:gap-4 ein:text-sm">
        {high !== undefined && (
          <span className="ein:flex ein:items-center ein:gap-1 ein:text-white/60">
            <Thermometer className="ein:w-3 ein:h-3" /> H: {high}°
          </span>
        )}
        {low !== undefined && (
          <span className="ein:flex ein:items-center ein:gap-1 ein:text-white/60">L: {low}°</span>
        )}
      </div>

      {(humidity !== undefined || windSpeed !== undefined) && (
        <div className="ein:flex ein:items-center ein:gap-4 ein:text-sm ein:mt-2 ein:pt-2 ein:border-t ein:border-white/10">
          {humidity !== undefined && (
            <span className="ein:flex ein:items-center ein:gap-1 ein:text-white/70">
              <Droplets className="ein:w-3 ein:h-3" /> {humidity}%
            </span>
          )}
          {windSpeed !== undefined && (
            <span className="ein:flex ein:items-center ein:gap-1 ein:text-white/70">
              <Wind className="ein:w-3 ein:h-3" /> {windSpeed} km/h
            </span>
          )}
        </div>
      )}
    </GlassWidgetBase>
  );
}

interface DetailedWeatherWidgetProps {
  temperature: number;
  condition: string;
  icon?: "sun" | "cloud" | "rain" | "snow" | "wind";
  location?: string;
  humidity?: number;
  windSpeed?: number;
  feelsLike?: number;
  className?: string;
}

function DetailedWeatherWidget({
  temperature,
  condition,
  icon = "sun",
  location,
  humidity,
  windSpeed,
  feelsLike,
  className,
}: DetailedWeatherWidgetProps) {
  const iconMap = {
    sun: Sun,
    cloud: Cloud,
    rain: CloudRain,
    snow: CloudSnow,
    wind: Wind,
  };

  const Icon = iconMap[icon];
  const glowColors = {
    sun: "amber",
    cloud: "blue",
    rain: "cyan",
    snow: "purple",
    wind: "blue",
  } as const;

  return (
    <GlassWidgetBase className={cn("ein:min-w-64", className)} size="lg" glowColor={glowColors[icon]}>
      {location && <div className="ein:text-white/60 ein:text-sm ein:mb-3">{location}</div>}
      <div className="ein:flex ein:items-stretch ein:justify-between ein:mb-4">
        <div className="ein:flex ein:items-center ein:gap-4">
          <div className="ein:p-3 ein:rounded-xl ein:bg-white/10">
            <Icon className="ein:size-10 ein:text-white" />
          </div>
          <div>
            <div className="ein:text-5xl ein:font-light ein:text-white ein:mb-1">{temperature}°</div>
            <div className="ein:text-white/70 ein:text-base">{condition}</div>
            {feelsLike && <div className="ein:text-white/70 ein:text-xs ein:mt-1">Feels like {feelsLike}°</div>}
          </div>
        </div>
      </div>
      <div className="ein:grid ein:grid-cols-2 ein:gap-3 ein:pt-3 ein:border-t ein:border-white/10">
        {humidity !== undefined && (
          <div className="ein:flex ein:items-center ein:gap-2">
            <Droplets className="ein:w-4 ein:h-4 ein:text-cyan-400" />
            <div>
              <div className="ein:text-white/70 ein:text-xs">Humidity</div>
              <div className="ein:text-white ein:text-sm ein:font-medium">{humidity}%</div>
            </div>
          </div>
        )}
        {windSpeed !== undefined && (
          <div className="ein:flex ein:items-center ein:gap-2">
            <Wind className="ein:w-4 ein:h-4 ein:text-blue-400" />
            <div>
              <div className="ein:text-white/70 ein:text-xs">Wind</div>
              <div className="ein:text-white ein:text-sm ein:font-medium">{windSpeed} km/h</div>
            </div>
          </div>
        )}
      </div>
    </GlassWidgetBase>
  );
}

interface ForecastDay {
  day: string;
  high: number;
  low: number;
  icon?: "sun" | "cloud" | "rain" | "snow" | "wind";
  condition: WeatherCondition;
}

interface ForecastWeatherWidgetProps {
  current: {
    temperature: number;
    condition: string;
    icon?: "sun" | "cloud" | "rain" | "snow" | "wind";
  };
  forecast: ForecastDay[];
  location?: string;
  className?: string;
}

function ForecastWeatherWidget({
  current,
  forecast,
  location,
  className,
}: ForecastWeatherWidgetProps) {
  const iconMap = {
    sun: Sun,
    cloud: Cloud,
    rain: CloudRain,
    snow: CloudSnow,
    wind: Wind,
  };

  const CurrentIcon = iconMap[current.icon || "sun"];

  return (
    <GlassWidgetBase className={cn("ein:min-w-72", className)} size="lg" glowColor="cyan">
      {location && <div className="ein:text-white/60 ein:text-sm ein:mb-3">{location}</div>}
      <div className="ein:flex ein:items-center ein:gap-4 ein:mb-4 ein:pb-4 ein:border-b ein:border-white/10">
        <div className="ein:p-3 ein:rounded-xl ein:bg-white/10">
          <CurrentIcon className="ein:w-10 ein:h-10 ein:text-white" />
        </div>
        <div>
          <div className="ein:text-4xl ein:font-light ein:text-white ein:mb-1">{current.temperature}°</div>
          <div className="ein:text-white/70 ein:text-sm">{current.condition}</div>
        </div>
      </div>
      <div className="ein:space-y-2">
        {forecast.map((day, i) => {
          const DayIcon = iconMap[day.icon || "sun"];
          return (
            <div
              key={i}
              className="ein:flex ein:items-center ein:justify-between ein:p-2 ein:rounded-lg ein:bg-white/5 ein:hover:bg-white/10 ein:transition-colors"
            >
              <div className="ein:flex ein:items-center ein:gap-3 ein:flex-1 ein:min-w-0">
                <DayIcon className="ein:w-5 ein:h-5 ein:text-white/70 ein:shrink-0" />
                <span className="ein:text-white/70 ein:text-sm ein:truncate">{day.day}</span>
              </div>
              <div className="ein:flex ein:items-center ein:gap-3 ein:shrink-0">
                <span className="ein:text-white/70 ein:text-xs">{day.condition}</span>
                <div className="ein:flex ein:items-center ein:gap-2">
                  <span className="ein:text-white ein:text-sm ein:font-medium">{day.high}°</span>
                  <span className="ein:text-white/70 ein:text-sm">{day.low}°</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </GlassWidgetBase>
  );
}

interface HourlyWeatherWidgetProps {
  hours: Array<{
    time: string;
    temperature: number;
    icon?: "sun" | "cloud" | "rain" | "snow" | "wind";
  }>;
  className?: string;
}

function HourlyWeatherWidget({ hours, className }: HourlyWeatherWidgetProps) {
  const iconMap = {
    sun: Sun,
    cloud: Cloud,
    rain: CloudRain,
    snow: CloudSnow,
    wind: Wind,
  };

  // Guard clause: handle empty hours array
  if (!hours || hours.length === 0) {
    return (
      <GlassWidgetBase className={cn("ein:min-w-80", className)} size="lg" glowColor="blue">
        <div className="ein:text-white/60 ein:text-sm ein:mb-4">24 Hour Forecast</div>
        <div className="ein:text-center ein:py-8 ein:text-white/70 ein:text-sm">No hourly data available</div>
      </GlassWidgetBase>
    );
  }

  const maxTemp = Math.max(...hours.map((h) => h.temperature));
  const minTemp = Math.min(...hours.map((h) => h.temperature));
  const tempRange = maxTemp - minTemp || 1;

  return (
    <GlassWidgetBase className={cn("ein:min-w-80", className)} size="lg" glowColor="blue">
      <div className="ein:text-white/60 ein:text-sm ein:mb-8">24 Hour Forecast</div>
      <div className="ein:flex ein:items-end ein:justify-between ein:gap-2">
        {hours.map((hour, i) => {
          const Icon = iconMap[hour.icon || "sun"];
          const height = ((hour.temperature - minTemp) / tempRange) * 100;
          return (
            <div key={i} className="ein:flex ein:flex-col ein:items-center ein:gap-2 ein:flex-1">
              <div className="ein:relative ein:w-full ein:h-24 ein:flex ein:items-end ein:justify-center">
                <div
                  className="ein:w-full ein:rounded-t-lg ein:bg-linear-to-t ein:from-cyan-500/40 ein:to-blue-500/40 ein:transition-all"
                  style={{ height: `${Math.max(height, 10)}%` }}
                />
                <div className="ein:absolute ein:-top-6 ein:text-white ein:text-xs ein:font-medium">
                  {hour.temperature}°
                </div>
              </div>
              <Icon className="ein:w-4 ein:h-4 ein:text-white/70" />
              <div className="ein:text-white/70 ein:text-[10px] ein:text-center">{hour.time}</div>
            </div>
          );
        })}
      </div>
    </GlassWidgetBase>
  );
}

// ForecastDay interface is declared earlier with WeatherCondition for `condition`

interface ForecastWidgetProps {
  forecast?: ForecastDay[];
  className?: string;
}

function ForecastWidget({ forecast = [], className }: ForecastWidgetProps) {
  return (
    <GlassWidgetBase className={cn("ein:min-w-45", className)} glowColor="amber">
      <h3 className="ein:text-white/60 ein:text-sm ein:mb-3">5-Day Forecast</h3>
      <div className="ein:space-y-2.5">
        {forecast.map((day, i) => (
          <div key={i} className="ein:flex ein:items-center ein:justify-between">
            <span className="ein:text-white/70 ein:text-sm ein:w-10">{day.day}</span>
            <WeatherIcon condition={day.condition} className="ein:w-5 ein:h-5" />
            <div className="ein:flex ein:items-center ein:gap-2 ein:text-sm">
              <span className="ein:text-white/70 ein:tabular-nums">{day.low}°</span>
              <div className="ein:w-12 ein:h-1 ein:bg-white/10 ein:rounded-full ein:overflow-hidden">
                <div
                  className="ein:h-full ein:bg-linear-to-r ein:from-blue-400 ein:to-amber-400 ein:rounded-full"
                  style={{ width: `${((day.high - day.low) / 20) * 100}%` }}
                />
              </div>
              <span className="ein:text-white ein:tabular-nums">{day.high}°</span>
            </div>
          </div>
        ))}
      </div>
    </GlassWidgetBase>
  );
}

export {
  WeatherWidget,
  DetailedWeatherWidget,
  ForecastWeatherWidget,
  HourlyWeatherWidget,
  CurrentWeatherWidget,
  ForecastWidget,
};
