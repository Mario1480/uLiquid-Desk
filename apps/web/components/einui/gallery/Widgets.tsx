"use client";
import { useState } from "react";
import { GlassWidgetBase } from "../widgets/base-widget";
import { CalendarWidget } from "../widgets/calendar-widget";
import { DigitalClockWidget, StopwatchWidget, TimerWidget } from "../widgets/clock-widget";
import { WeatherWidget } from "../widgets/weather-widget";
import { StockTickerWidget } from "../widgets/stock-widget";
import { StatCard, MetricStat, CircularProgressStat } from "../widgets/stats-widget";
import { GlassButton } from "../liquid-glass/glass-button";
const sampleDate=new Date("2026-09-06T12:00:00Z");
export default function Widgets({name}: {name:string}) {
 const [date,setDate]=useState(sampleDate);
 const [value,setValue]=useState(25);
 switch(name) {
  case "base-widget": return <GlassWidgetBase glowEffect={false} hoverScale={false}><p>Base widget / Basis-Widget</p><GlassButton onClick={()=>setValue(v=>v+1)}>Local action {value}</GlassButton></GlassWidgetBase>;
  case "calendar-widget": return <><CalendarWidget date={sampleDate} selectedDate={date} onDateSelect={setDate}/><output>{date.toLocaleDateString("en-GB")}</output></>;
  case "clock-widget": return <div className="ein-demo-stack"><DigitalClockWidget time={sampleDate}/><StopwatchWidget/><TimerWidget initialMinutes={1}/></div>;
  case "weather-widget": return <WeatherWidget temperature={22} condition="Sample sunshine" location="Local example / Lokales Beispiel" icon="sun"/>;
  case "stock-widget": return <StockTickerWidget symbol="DEMO" name="Illustrative only" price={100} change={2} changePercent={2} chartData={[90,95,92,100]}/>;
  case "stats-widget": return <div className="ein-demo-stack"><StatCard title="Local sample" value={value}/><MetricStat label="Sample capacity" value={value}/><CircularProgressStat label="Sample progress" value={value}/><GlassButton onClick={()=>setValue(v=>(v+10)%101)}>Advance / Weiter</GlassButton></div>;
  default: throw new Error(`Missing widget example: ${name}`);
 }
}
