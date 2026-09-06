import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeskButton } from "../../components/desk/DeskButton";
import { DeskInput } from "../../components/desk/DeskInput";
import { DeskSelect } from "../../components/desk/DeskSelect";
import { DeskTextarea } from "../../components/desk/DeskTextarea";
import { DeskTable } from "../../components/desk/DeskTable";
import { DeskSurface } from "../../components/desk/DeskSurface";
import { GlassButton } from "../../components/einui/liquid-glass/glass-button";
import { cn } from "../../components/einui/utils";

test("native button retains submit, disabled, form and accessible state without wrappers",()=>{
 const html=renderToStaticMarkup(<DeskButton type="submit" form="order" disabled aria-busy="true" className="btn btnStart">Start</DeskButton>);
 assert.match(html,/^<button /); assert.match(html,/type="submit"/); assert.match(html,/form="order"/); assert.match(html,/disabled=""/); assert.match(html,/aria-busy="true"/); assert.doesNotMatch(html,/<(?:div|span)/);
});
test("asChild button produces one semantic link",()=>{
 const html=renderToStaticMarkup(<GlassButton asChild variant="primary" glowEffect><a href="#local">Local</a></GlassButton>);
 assert.match(html,/^<a /);assert.doesNotMatch(html,/<button|<div|gradient|scale-/);assert.match(html,/ein-button-primary/);
});
test("native numeric fields preserve exact string and empty intermediate values",()=>{
 const full=renderToStaticMarkup(<DeskInput type="number" step="any" name="amount" required value="0.00000001" onChange={()=>{}} aria-invalid="true"/>);
 assert.match(full,/value="0.00000001"/);assert.match(full,/step="any"/);assert.match(full,/name="amount"/);assert.match(full,/aria-invalid="true"/);assert.doesNotMatch(full,/<div/);
 const empty=renderToStaticMarkup(<DeskInput value="" onChange={()=>{}}/>);assert.match(empty,/value=""/);
});
test("select and textarea retain native form markup",()=>{
 const select=renderToStaticMarkup(<DeskSelect name="side" value="short" onChange={()=>{}}><option value="long">Long</option><option value="short">Short</option></DeskSelect>);
 assert.match(select,/^<select /);assert.match(select,/<option value="short" selected=""/);
 const text=renderToStaticMarkup(<DeskTextarea name="note" rows={3} defaultValue="Local"/>);assert.match(text,/^<textarea /);assert.match(text,/>Local<\/textarea>/);
});
test("surface and table preserve original semantic structure and scroll ownership",()=>{
 const html=renderToStaticMarkup(<DeskSurface dense><section className="card"><DeskTable className="stickyTable"><thead><tr><th>Value</th></tr></thead><tbody><tr><td>1</td></tr></tbody></DeskTable></section></DeskSurface>);
 assert.match(html,/^<section /);assert.match(html,/data-ein-density="dense"/);assert.match(html,/<table class="stickyTable"|<table[^>]+class="stickyTable"/);assert.doesNotMatch(html,/<div/);
});
test("Tailwind merge understands the Ein prefix and leaves legacy classes alone",()=>{
 assert.equal(cn("ein:px-2 card", "ein:px-4 btn"),"card ein:px-4 btn");
 assert.equal(cn("flex", "ein:flex"),"flex ein:flex");
});

test("Desk badges retain business tones and native semantics", async()=>{
 const {DeskBadge}=await import("../../components/desk/DeskBadge");
 const cases={badgeOk:"success",badgeDanger:"destructive",badgeWarn:"warning",tradeMobileChipLong:"success",tradeMobileChipShort:"destructive",subscriptionStatusPillpaid:"success",subscriptionStatusPillreview_required:"warning",subscriptionStatusPillpending:"primary"};
 for(const [className,tone] of Object.entries(cases)) {
  const html=renderToStaticMarkup(<DeskBadge className={className} title="Local status">Status</DeskBadge>);
  assert.match(html,/^<span /);assert.ok(html.includes('data-ein-badge-tone="'+tone+'"'));assert.match(html,/title="Local status"/);
 }
});
test("Ein auth composition has one heading and retains supplied forms and notices",async()=>{
 const {GlassAuthFrame}=await import("../../components/einui/auth-frame");
 const html=renderToStaticMarkup(<GlassAuthFrame title="Login" icon={<span/>} notice={<aside>Legal notice</aside>}><form action="/local"><input name="email"/><button type="submit">Continue</button></form></GlassAuthFrame>);
 assert.equal((html.match(/<h1/g)||[]).length,1);assert.ok(html.includes('<form action="/local"'));assert.ok(html.includes("<aside>Legal notice</aside>"));assert.doesNotMatch(html,/Google|GitHub|Simulate/);
});
test("button links retain real anchor navigation and no nested button",async()=>{
 const {DeskLink}=await import("../../components/desk/DeskLink");
 const html=renderToStaticMarkup(<DeskLink href="/en/register?ref=LOCAL" className="btn" aria-label="Create">Create</DeskLink>);
 assert.match(html,/^<a /);assert.ok(html.includes('href="/en/register?ref=LOCAL"'));assert.match(html,/data-ein-button="true"/);assert.doesNotMatch(html,/<button/);
});

test("full and native controls share material markers; cards have no default rainbow glow", async()=>{
 const {GlassInput}=await import("../../components/einui/liquid-glass/glass-input");
 const {GlassTextarea}=await import("../../components/einui/liquid-glass/glass-textarea");
 const {GlassCard}=await import("../../components/einui/liquid-glass/glass-card");
 for(const node of [<GlassInput name="email"/>,<GlassTextarea name="note"/>]) {
  const html=renderToStaticMarkup(node);assert.match(html,/data-ein-control="true"/);assert.doesNotMatch(html,/bg-linear|from-cyan/);
 }
 const html=renderToStaticMarkup(<GlassCard className="glass-light">Local</GlassCard>);
 assert.match(html,/data-ein-surface="true"/);assert.match(html,/glass-light/);assert.doesNotMatch(html,/ein-card-glow|bg-linear/);
});

test("Desk select renders an Ein combobox while retaining empty values and native form ownership",()=>{
 const html=renderToStaticMarkup(<DeskSelect name="side" required value="" onChange={()=>{}}><option value="">Choose</option><optgroup label="Sides"><option value="long">Long</option><option value="short" disabled>Short</option></optgroup></DeskSelect>);
 assert.match(html,/class="ein-form-bridge"/);assert.match(html,/role="combobox"/);assert.match(html,/data-ein-control="true"/);
 assert.match(html,/name="side"/);assert.match(html,/<option value="" selected=""/);assert.match(html,/<optgroup label="Sides"/);
 assert.equal((html.match(/name="side"/g)||[]).length,1);
});

test("Ein checkbox and switch expose real roles, unique ids and disabled state",async()=>{
 const {DeskCheckbox}=await import("../../components/desk/DeskCheckbox");
 const {DeskSwitch}=await import("../../components/desk/DeskSwitch");
 const html=renderToStaticMarkup(<form><DeskCheckbox checked required name="consent"/><DeskCheckbox disabled/><DeskSwitch checked name="enabled"/></form>);
 assert.equal((html.match(/role="checkbox"/g)||[]).length,2);assert.match(html,/role="switch"/);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length);
 assert.match(html,/aria-checked="true"/);assert.match(html,/disabled=""/);
});

test("progress retains max/value semantics and uses their ratio",async()=>{
 const {GlassProgress}=await import("../../components/einui/liquid-glass/glass-progress");
 const html=renderToStaticMarkup(<GlassProgress value={3} max={6} aria-label="Completion"/>);
 assert.match(html,/aria-valuenow="3"/);assert.match(html,/aria-valuemax="6"/);assert.match(html,/width:50%/);
});

test("native action layout stays caller-owned while Ein variants own material",()=>{
 const html=renderToStaticMarkup(<DeskButton className="btn btnStart adminSidebarToggle" hidden>Start</DeskButton>);
 assert.match(html,/hidden=""/);assert.match(html,/data-ein-button-variant="success"/);assert.match(html,/ein-native-button/);
 assert.doesNotMatch(html,/class="ein-button /);assert.doesNotMatch(html,/ein-button-md/);
});
