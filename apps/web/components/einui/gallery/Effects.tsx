"use client";
import { useState } from "react";
import { GlassButton } from "../liquid-glass/glass-button";
import { GlassCommandPalette } from "../innovative/glass-command-palette";
import { GlassDock } from "../innovative/glass-dock";
import { GlassGauge } from "../innovative/glass-gauge";
import { GlassMorphCard } from "../innovative/glass-morph-card";
import { GlassNotification } from "../innovative/glass-notification";
import { GlassOrb } from "../innovative/glass-orb";
import { GlassRipple } from "../innovative/glass-ripple";
import { GlassSpotlight } from "../innovative/glass-spotlight";
import { GlassTimeline } from "../innovative/glass-timeline";
import { GlassWaveform } from "../innovative/glass-waveform";
import { AppIcon } from "@/app/components/AppIcon";
export default function Effects({name}: {name:string}) {
 const [open,setOpen]=useState(false);
 const [value,setValue]=useState(50);
 const [result,setResult]=useState("");
 const action=()=>setResult("Local action / Lokale Aktion");
 switch(name) {
  case "glass-command-palette": return <><GlassButton onClick={()=>setOpen(true)}>Search / Suchen</GlassButton><GlassCommandPalette open={open} onOpenChange={setOpen} groups={[{label:"Local samples",items:[{id:"sample",label:"Select sample",action}]}]}/><output>{result}</output></>;
  case "glass-dock": return <><GlassDock magnification={1} maxSize={48} items={[{id:"one",icon:<AppIcon name="settings"/>,label:"Local settings",onClick:action},{id:"two",icon:<AppIcon name="check"/>,label:"Local selection",onClick:action}]}/><output>{result}</output></>;
  case "glass-gauge": return <div className="ein-demo-stack"><GlassGauge value={value} label="Sample value"/><label>Value / Wert<input type="range" min="0" max="100" value={value} onChange={e=>setValue(Number(e.target.value))}/></label></div>;
  case "glass-morph-card": return <GlassMorphCard className="ein:p-8"><p>Move the pointer / Maus bewegen</p><GlassButton onClick={action}>Local action</GlassButton><output>{result}</output></GlassMorphCard>;
  case "glass-notification": return <div className="ein-demo-stack"><GlassButton onClick={()=>setOpen(v=>!v)}>Toggle / Umschalten</GlassButton>{open && <GlassNotification type="success" title="Local sample" description="No transaction was submitted."/>}</div>;
  case "glass-orb": return <div className="ein-demo-stack"><GlassOrb label="Sample status" followCursor={false}/><p>Decorative local status / Lokaler Beispielstatus</p></div>;
  case "glass-ripple": return <GlassRipple className="ein:p-12 ein:bg-white/10" aria-label="Decorative ripple sample"><p>Touch or click this decorative surface. Product buttons remain solid.</p></GlassRipple>;
  case "glass-spotlight": return <><GlassButton id="ein-spotlight-sample" onClick={()=>setOpen(true)}>Start local tour / Lokale Tour</GlassButton><GlassSpotlight open={open} onOpenChange={setOpen} steps={[{target:"#ein-spotlight-sample",title:"Local tour",description:"This is an isolated sample."}]} onComplete={()=>setOpen(false)}/></>;
  case "glass-timeline": return <GlassTimeline items={[{id:"one",title:"Completed / Abgeschlossen",status:"completed"},{id:"two",title:"Current / Aktuell",status:"current",description:<GlassButton onClick={action}>Local action</GlassButton>},{id:"three",title:"Upcoming / Geplant",status:"upcoming",description:result}]}/>;
  case "glass-waveform": return <div className="ein-demo-stack"><GlassWaveform amplitude={value/100} paused={!open}/><GlassButton onClick={()=>setOpen(v=>!v)}>{open?"Pause":"Play / Start"}</GlassButton><label>Amplitude<input type="range" value={value} onChange={e=>setValue(Number(e.target.value))}/></label></div>;
  default: throw new Error(`Missing effect example: ${name}`);
 }
}
