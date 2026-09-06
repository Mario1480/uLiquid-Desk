"use client";
import { useState } from "react";
import { GlassButton } from "../liquid-glass/glass-button";
import { GlassCard, GlassCardHeader, GlassCardTitle, GlassCardContent } from "../liquid-glass/glass-card";
import { GlassInput } from "../liquid-glass/glass-input";
import { GlassTextarea } from "../liquid-glass/glass-textarea";
import { GlassCheckbox } from "../liquid-glass/glass-checkbox";
import { GlassRadioGroup, GlassRadioGroupItem } from "../liquid-glass/glass-radio";
import { GlassSwitch } from "../liquid-glass/glass-switch";
import { GlassSlider } from "../liquid-glass/glass-slider";
import { GlassTabs, GlassTabsList, GlassTabsTrigger, GlassTabsContent } from "../liquid-glass/glass-tabs";
import { GlassAvatar, GlassAvatarFallback } from "../liquid-glass/glass-avatar";
import { GlassBadge } from "../liquid-glass/glass-badge";
import { GlassProgress } from "../liquid-glass/glass-progress";
import { GlassSkeleton } from "../liquid-glass/glass-skeleton";
import { GlassTable, GlassTableHeader, GlassTableBody, GlassTableRow, GlassTableHead, GlassTableCell } from "../liquid-glass/glass-table";
import { GlassBreadcrumb, GlassBreadcrumbList, GlassBreadcrumbItem, GlassBreadcrumbLink, GlassBreadcrumbSeparator, GlassBreadcrumbPage } from "../liquid-glass/glass-breadcrumb";
import { GlassSeparator } from "../liquid-glass/glass-separator";
import { GlassScrollArea } from "../liquid-glass/glass-scroll-area";
import { GlassSelect, GlassSelectTrigger, GlassSelectValue, GlassSelectContent, GlassSelectItem } from "../liquid-glass/glass-select";

export default function Primitives({name}: {name: string}) {
  const [value,setValue] = useState(35);
  const [checked,setChecked] = useState(false);
  const [text,setText] = useState("");
  const [choice,setChoice] = useState("one");
  const [reverse,setReverse] = useState(false);
  switch(name) {
    case "glass-button": return <div className="ein-demo-stack"><div className="ein-demo-row">{(["default","primary","outline","ghost","destructive"] as const).map(variant => <GlassButton key={variant} variant={variant} onClick={() => setValue(v=>v+1)}>{variant}</GlassButton>)}</div><GlassButton disabled>Disabled / Deaktiviert</GlassButton><GlassButton disabled aria-busy="true">Loading / Lädt…</GlassButton><output aria-live="polite">{value-35} local clicks</output></div>;
    case "glass-card": return <GlassCard glowEffect={false}><GlassCardHeader><GlassCardTitle>Ocean card</GlassCardTitle></GlassCardHeader><GlassCardContent><p>Local sample / Lokales Beispiel</p><GlassButton onClick={()=>setChecked(v=>!v)}>{checked ? "Selected" : "Select"}</GlassButton></GlassCardContent></GlassCard>;
    case "glass-input": return <div className="ein-demo-stack"><label>Controlled decimal / Dezimalwert<GlassInput value={text} inputMode="decimal" onChange={e=>setText(e.target.value)} /></label><GlassInput aria-label="Disabled" disabled value="Disabled"/><GlassInput aria-label="Invalid" aria-invalid="true" defaultValue="Invalid"/><output>{text || "Empty / Leer"}</output></div>;
    case "glass-textarea": return <div className="ein-demo-stack"><GlassTextarea label="Local notes / Lokale Notizen" value={text} onChange={e=>setText(e.target.value)} /><GlassTextarea label="Error example" error="Sample validation error"/><GlassTextarea label="Disabled" disabled /></div>;
    case "glass-checkbox": return <div className="ein-demo-row"><label><GlassCheckbox checked={checked} onCheckedChange={v=>setChecked(v===true)}/> Sample / Beispiel</label><GlassCheckbox aria-label="Disabled" disabled/><GlassCheckbox aria-label="Invalid" aria-invalid="true"/></div>;
    case "glass-radio": return <GlassRadioGroup value={choice} onValueChange={setChoice} aria-label="Sample choice">{["one","two","disabled"].map(v=><label key={v}><GlassRadioGroupItem value={v} disabled={v==="disabled"}/>{v}</label>)}</GlassRadioGroup>;
    case "glass-switch": return <div className="ein-demo-row"><label><GlassSwitch checked={checked} onCheckedChange={setChecked}/> Enabled / Aktiv</label><GlassSwitch disabled aria-label="Disabled"/></div>;
    case "glass-slider": return <div className="ein-demo-stack"><GlassSlider value={[value]} onValueChange={v=>setValue(v[0])} aria-label="Sample value"/><GlassSlider disabled value={[50]} aria-label="Disabled"/><output>{value}</output></div>;
    case "glass-select": return <div className="ein-demo-stack"><GlassSelect value={choice} onValueChange={setChoice}><GlassSelectTrigger aria-label="Sample choice"><GlassSelectValue/></GlassSelectTrigger><GlassSelectContent><GlassSelectItem value="one">One / Eins</GlassSelectItem><GlassSelectItem value="two">Two / Zwei</GlassSelectItem><GlassSelectItem value="three" disabled>Disabled</GlassSelectItem></GlassSelectContent></GlassSelect><GlassSelect disabled><GlassSelectTrigger aria-label="Disabled"><GlassSelectValue placeholder="Disabled"/></GlassSelectTrigger></GlassSelect></div>;
    case "glass-tabs": return <GlassTabs defaultValue="one"><GlassTabsList aria-label="Preview tabs"><GlassTabsTrigger value="one">One / Eins</GlassTabsTrigger><GlassTabsTrigger value="two">Two / Zwei</GlassTabsTrigger><GlassTabsTrigger value="disabled" disabled>Disabled</GlassTabsTrigger></GlassTabsList><GlassTabsContent value="one">First panel / Erstes Panel</GlassTabsContent><GlassTabsContent value="two">Second panel / Zweites Panel</GlassTabsContent></GlassTabs>;
    case "glass-avatar": return <GlassAvatar aria-label="Sample user"><GlassAvatarFallback>UL</GlassAvatarFallback></GlassAvatar>;
    case "glass-badge": return <div className="ein-demo-row"><GlassBadge>Default</GlassBadge><GlassBadge variant="primary">Primary</GlassBadge></div>;
    case "glass-progress": return <div className="ein-demo-stack"><GlassProgress value={value} aria-label="Sample progress"/><GlassButton onClick={()=>setValue(v=>(v+10)%101)}>Advance / Weiter</GlassButton></div>;
    case "glass-skeleton": return <div aria-busy="true" aria-label="Loading sample"><GlassSkeleton className="ein:h-20 ein:w-full"/></div>;
    case "glass-table": return <div><GlassButton onClick={()=>setReverse(v=>!v)}>Sort / Sortieren</GlassButton><GlassTable><GlassTableHeader><GlassTableRow><GlassTableHead>Name</GlassTableHead><GlassTableHead>Sample value</GlassTableHead></GlassTableRow></GlassTableHeader><GlassTableBody>{(reverse?["B","A"]:["A","B"]).map(v=><GlassTableRow key={v}><GlassTableCell>{v}</GlassTableCell><GlassTableCell>1.00000001</GlassTableCell></GlassTableRow>)}</GlassTableBody></GlassTable></div>;
    case "glass-breadcrumb": return <GlassBreadcrumb><GlassBreadcrumbList><GlassBreadcrumbItem><GlassBreadcrumbLink href="#preview">Sample</GlassBreadcrumbLink></GlassBreadcrumbItem><GlassBreadcrumbSeparator/><GlassBreadcrumbItem><GlassBreadcrumbPage>Current / Aktuell</GlassBreadcrumbPage></GlassBreadcrumbItem></GlassBreadcrumbList></GlassBreadcrumb>;
    case "glass-separator": return <div className="ein-demo-stack"><p>Before / Vorher</p><GlassSeparator/><p>After / Danach</p></div>;
    case "glass-scroll-area": return <GlassScrollArea className="ein:h-48" tabIndex={0} aria-label="Scrollable sample">{Array.from({length:30},(_,i)=><p key={i}>Sample row / Beispielzeile {i+1}</p>)}</GlassScrollArea>;
    default: throw new Error(`Missing primitive example: ${name}`);
  }
}
