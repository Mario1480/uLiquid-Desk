"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MotionConfig } from "motion/react";
import registry from "../registry.upstream.json";
import { EinThemeContext, type EinTheme } from "../portal-theme";
import { GlassButton } from "../liquid-glass/glass-button";
const Primitives=dynamic(()=>import("./Primitives"));
const Overlays=dynamic(()=>import("./Overlays"));
const Effects=dynamic(()=>import("./Effects"));
const Widgets=dynamic(()=>import("./Widgets"));
const AdapterContract=dynamic(()=>import("./AdapterContract"));
const Templates=dynamic(()=>import("./Templates"));
const overlays=new Set(["glass-dialog","glass-alert-dialog","glass-sheet","glass-tooltip","glass-popover"]);
const effects=new Set(["glass-command-palette","glass-dock","glass-gauge","glass-morph-card","glass-notification","glass-orb","glass-ripple","glass-spotlight","glass-timeline","glass-waveform"]);
const templateNames=new Set(["admin-panel","login-page","signup-page","forgot-password-page","pricing-page","dashboard-page"]);
const entries=[...registry.items.map(({name,title})=>({name,title})),{name:"dashboard-page",title:"Dashboard template"},{name:"desk-contract",title:"Desk native contract"}];

export default function Gallery() {
 const t=useTranslations("admin.uiGallery");
 const [selected,setSelected]=useState("glass-button");
 const [theme,setTheme]=useState<EinTheme>("ocean");
 const [active,setActive]=useState(false);
 const [paused,setPaused]=useState(false);
 const [message,setMessage]=useState("");
 const preview=useRef<HTMLDivElement>(null);
 useEffect(()=>{
   let visible=false;
   const update=()=>setActive(visible && document.visibilityState==="visible");
   const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update();});
   if(preview.current) observer.observe(preview.current);
   document.addEventListener("visibilitychange",update);
   return ()=>{observer.disconnect();document.removeEventListener("visibilitychange",update);};
 },[]);
 const Component=overlays.has(selected)?Overlays:effects.has(selected)?Effects:selected.endsWith("widget")?Widgets:templateNames.has(selected)?Templates:Primitives;
 return <section className="ein-gallery uiPage">
  <h1>{t("title")}</h1><p>{t("description")}</p>
  <div className="ein-demo-row"><label>{t("component")}<select className="input" value={selected} onChange={e=>{setSelected(e.target.value);setMessage("");requestAnimationFrame(()=>preview.current?.scrollIntoView({block:"start",behavior:"instant"}));}}>{entries.map(item=><option value={item.name} key={item.name}>{item.title} — {item.name}</option>)}</select></label><label>{t("theme")}<select className="input" value={theme} onChange={e=>setTheme(e.target.value as EinTheme)}><option value="ocean">Ocean</option><option value="aurora">Aurora</option><option value="forest">Forest</option></select></label><GlassButton onClick={()=>setPaused(v=>!v)}>{paused?t("resume"):t("pause")}</GlassButton></div>
  <p>{t("samples")}</p>
  <div ref={preview} id="preview" className="ein-gallery-preview" data-ein-preview-theme={theme}>
   <EinThemeContext.Provider value={theme}><MotionConfig reducedMotion="user">
    {active&&!paused?<div key={selected} onClickCapture={e=>{if((e.target as Element).closest("a")){e.preventDefault();e.stopPropagation();setMessage(t("localAction"));}}} onSubmitCapture={e=>{if(selected==="desk-contract") return; e.preventDefault();e.stopPropagation();setMessage(t("localAction"));}}>{selected==="desk-contract"?<AdapterContract/>:<Component name={selected}/>}</div>:<p>{t("paused")}</p>}
   </MotionConfig></EinThemeContext.Provider>
  </div>
  <output aria-live="polite">{message}</output>
  <p>{t("coverage",{count:entries.length})}</p>
 </section>;
}
