"use client";
import { useContext, createContext, useRef, type ReactElement } from "react";
import { Dialog } from "radix-ui";
import { GlassDialog, GlassDialogPortal, GlassDialogOverlay } from "../einui/liquid-glass/glass-dialog";
const FocusReturn = createContext<{current: HTMLElement | null} | null>(null);
/** Existing backdrops and content keep their classes and close handlers; Radix owns focus and scroll lock. */
export function DeskDialog({children,onClose}: {children:ReactElement;onClose:()=>void}) {
 const returnFocus=useRef<HTMLElement | null>(null);
 return <GlassDialog open onOpenChange={next=>{if(!next)onClose();}}><FocusReturn.Provider value={returnFocus}><GlassDialogPortal><GlassDialogOverlay asChild>{children}</GlassDialogOverlay></GlassDialogPortal></FocusReturn.Provider></GlassDialog>;
}
export function DeskDialogPanel({children,label="Dialog"}: {children:ReactElement;label?:string}) {
 const returnFocus=useContext(FocusReturn);
 return <><Dialog.Title hidden>{label}</Dialog.Title><Dialog.Content asChild aria-describedby={undefined} onInteractOutside={event=>event.preventDefault()} onOpenAutoFocus={()=>{if(returnFocus&&document.activeElement instanceof HTMLElement)returnFocus.current=document.activeElement;}} onCloseAutoFocus={event=>{event.preventDefault();returnFocus?.current?.focus();}}>{children}</Dialog.Content></>;
}
