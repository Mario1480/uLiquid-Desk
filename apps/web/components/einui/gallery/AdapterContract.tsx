"use client";
import { useRef, useState } from "react";
import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskTextarea } from "@/components/desk/DeskTextarea";
import AdminConfirmDialog from "@/app/admin/_components/AdminConfirmDialog";
import { DeskDialog, DeskDialogPanel } from "@/components/desk/DeskDialog";
/** Local-only native form contract harness. No network actions. */
export default function AdapterContract() {
 const [amount,setAmount]=useState("");
 const [side,setSide]=useState("long");
 const [note,setNote]=useState("");
 const [open,setOpen]=useState(false);
 const [pending,setPending]=useState(false);
 const [nativeOpen,setNativeOpen]=useState(false);
 const [result,setResult]=useState("");
 const input=useRef<HTMLInputElement>(null);
 return <div className="ein-demo-stack">
  <form onSubmit={event=>{event.preventDefault();setResult(JSON.stringify({amount,side,note}));}}>
   <label>Decimal amount<DeskInput ref={input} className="input" type="number" step="any" name="amount" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
   <label>Side<DeskSelect className="input" name="side" value={side} onChange={e=>setSide(e.target.value)}><option value="long">Long</option><option value="short">Short</option></DeskSelect></label>
   <label>Note<DeskTextarea className="input" name="note" value={note} onChange={e=>setNote(e.target.value)}/></label>
   <div className="ein-demo-row"><DeskButton className="btn btnPrimary" type="submit">Submit local form</DeskButton><DeskButton className="btn" type="button" onClick={()=>input.current?.focus()}>Focus ref</DeskButton><DeskButton className="btn" disabled>Disabled</DeskButton></div>
  </form>
  <DeskButton className="btn" onClick={()=>{setPending(false);setOpen(true);}}>Open confirmation</DeskButton>
  <DeskButton className="btn" onClick={()=>setNativeOpen(true)}>Open native dialog</DeskButton>
  {nativeOpen && <DeskDialog onClose={()=>setNativeOpen(false)}><div className="fundingModalOverlay" onClick={()=>setNativeOpen(false)}><DeskDialogPanel label="Native dialog contract"><section className="fundingModalCard" aria-label="Native dialog contract" onClick={event=>event.stopPropagation()}><h2>Native dialog contract</h2><label>Local dialog value<DeskInput className="input"/></label><DeskButton className="btn" onClick={()=>setNativeOpen(false)}>Close native dialog</DeskButton></section></DeskDialogPanel></div></DeskDialog>}
  <AdminConfirmDialog open={open} loading={pending} title="Local pending contract" description="No order or payment will be sent." confirmLabel="Start local pending state" onCancel={()=>setOpen(false)} onConfirm={()=>{setPending(true);setTimeout(()=>{setPending(false);setOpen(false);setResult("Local confirmation finished");},1800);}}/>
  <output aria-live="polite">{result}</output>
 </div>;
}
