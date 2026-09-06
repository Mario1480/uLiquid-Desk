"use client";
import { useState } from "react";
import { GlassButton } from "../liquid-glass/glass-button";
import { GlassDialog, GlassDialogTrigger, GlassDialogContent, GlassDialogTitle, GlassDialogDescription } from "../liquid-glass/glass-dialog";
import { GlassAlertDialog, GlassAlertDialogTrigger, GlassAlertDialogContent, GlassAlertDialogTitle, GlassAlertDialogDescription, GlassAlertDialogCancel, GlassAlertDialogAction } from "../liquid-glass/glass-alert-dialog";
import { GlassSheet, GlassSheetTrigger, GlassSheetContent, GlassSheetTitle, GlassSheetDescription } from "../liquid-glass/glass-sheet";
import { GlassPopover, GlassPopoverTrigger, GlassPopoverContent } from "../liquid-glass/glass-popover";
import { GlassTooltip, GlassTooltipProvider, GlassTooltipTrigger, GlassTooltipContent } from "../liquid-glass/glass-tooltip";
export default function Overlays({name}: {name:string}) {
 const [result,setResult]=useState("");
 const button=<GlassButton>Open / Öffnen</GlassButton>;
 switch(name) {
  case "glass-dialog": return <GlassDialog><GlassDialogTrigger asChild>{button}</GlassDialogTrigger><GlassDialogContent><GlassDialogTitle>Local dialog / Lokaler Dialog</GlassDialogTitle><GlassDialogDescription>Focus, Escape and scroll-lock example.</GlassDialogDescription><label>Sample input<input className="input"/></label></GlassDialogContent></GlassDialog>;
  case "glass-alert-dialog": return <><GlassAlertDialog><GlassAlertDialogTrigger asChild>{button}</GlassAlertDialogTrigger><GlassAlertDialogContent><GlassAlertDialogTitle>Sample confirmation</GlassAlertDialogTitle><GlassAlertDialogDescription>No real action / Keine echte Aktion.</GlassAlertDialogDescription><div className="ein-demo-row"><GlassAlertDialogCancel>Cancel / Abbrechen</GlassAlertDialogCancel><GlassAlertDialogAction onClick={()=>setResult("Locally confirmed / Lokal bestätigt")}>Confirm / Bestätigen</GlassAlertDialogAction></div></GlassAlertDialogContent></GlassAlertDialog><output aria-live="polite">{result}</output></>;
  case "glass-sheet": return <GlassSheet><GlassSheetTrigger asChild>{button}</GlassSheetTrigger><GlassSheetContent><GlassSheetTitle>Sample sheet</GlassSheetTitle><GlassSheetDescription>Local navigation preview / Lokale Vorschau.</GlassSheetDescription><GlassButton onClick={()=>setResult("Selected")}>Local action</GlassButton><output>{result}</output></GlassSheetContent></GlassSheet>;
  case "glass-popover": return <GlassPopover><GlassPopoverTrigger asChild>{button}</GlassPopoverTrigger><GlassPopoverContent><label>Sample filter<input className="input"/></label></GlassPopoverContent></GlassPopover>;
  case "glass-tooltip": return <GlassTooltipProvider delayDuration={0}><GlassTooltip><GlassTooltipTrigger asChild><GlassButton>Focus or hover / Fokus oder Hover</GlassButton></GlassTooltipTrigger><GlassTooltipContent>Additional sample information / Zusatzinformation</GlassTooltipContent></GlassTooltip></GlassTooltipProvider>;
  default: throw new Error(`Missing overlay example: ${name}`);
 }
}
