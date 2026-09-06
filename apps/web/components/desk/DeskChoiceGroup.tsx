"use client";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { GlassRadioGroup, GlassRadioGroupItem } from "../einui/liquid-glass/glass-radio";
import { GlassButton } from "../einui/liquid-glass/glass-button";
/** Single-choice filters keep their data panels mounted; these are not navigation tabs. */
export const DeskChoiceGroup = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof GlassRadioGroup>>(function DeskChoiceGroup(props, ref) {
  return <GlassRadioGroup orientation="horizontal" {...props} ref={ref} />;
});
export const DeskChoiceItem = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof GlassRadioGroupItem>>(function DeskChoiceItem({children, className, ...props}, ref) {
  return <GlassRadioGroupItem {...props} asChild ref={ref}><GlassButton nativeLayout className={className}>{children}</GlassButton></GlassRadioGroupItem>;
});
