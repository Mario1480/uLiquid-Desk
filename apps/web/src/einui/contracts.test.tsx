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
