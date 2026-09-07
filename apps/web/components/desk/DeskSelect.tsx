"use client";
import { Children, Fragment, forwardRef, isValidElement, useEffect, useId, useImperativeHandle, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { GlassSelect, GlassSelectTrigger, GlassSelectValue, GlassSelectContent, GlassSelectGroup, GlassSelectLabel, GlassSelectItem } from "../einui/liquid-glass/glass-select";

type Option = { value: string; label: ReactNode; disabled: boolean; group?: string };
function optionsFrom(children: ReactNode, group?: string, disabled = false): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; label?: string; disabled?: boolean }>(child)) return [];
    if (child.type === Fragment) return optionsFrom(child.props.children, group, disabled);
    if (child.type === "optgroup") return optionsFrom(child.props.children, child.props.label, disabled || !!child.props.disabled);
    if (child.type !== "option") throw new Error("DeskSelect supports option, optgroup and Fragment children only");
    const label = child.props.label ?? child.props.children;
    return [{ value: String(child.props.value ?? label ?? ""), label, disabled: disabled || !!child.props.disabled, group }];
  });
}

/** Ein dropdown with a native form bridge: callers still receive real select change events. */
export const DeskSelect = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<"select">>(function DeskSelect(
  { children, className, style, id, value, defaultValue, onChange, disabled, required, autoFocus, ...props }, ref,
) {
  const generatedId = useId();
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = optionsFrom(children);
  const [local, setLocal] = useState(String(defaultValue ?? options.find(o => !o.disabled)?.value ?? ""));
  const [invalid, setInvalid] = useState(false);
  const [labelledBy, setLabelledBy] = useState<string>();
  const selected = String(value ?? local);
  const current = options.find(o => o.value === selected) ?? options.find(o => !o.disabled);
  useImperativeHandle(ref, () => native.current!, []);
  useEffect(() => {
    const labels = [...(native.current?.labels ?? [])];
    for (const [index, label] of labels.entries()) if (!label.id) label.id = `${generatedId}-label-${index}`;
    setLabelledBy(labels.map(label => label.id).join(" ") || undefined);
  }, [generatedId]);
  useEffect(() => {
    const form = native.current?.form;
    const reset = () => { setLocal(String(defaultValue ?? options.find(o => !o.disabled)?.value ?? "")); setInvalid(false); };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue, children]);
  if (props.multiple || (props.size && props.size > 1)) throw new Error("DeskSelect is single-select; use a dedicated multi-choice component");
  const groups = [...new Set(options.map(o => o.group))];
  return <>
    <select {...props} ref={native} id={`${id ?? generatedId}-native`} value={value ?? local} disabled={disabled} required={required}
      className="ein-form-bridge" tabIndex={-1} aria-hidden="true"
      onFocus={event => { props.onFocus?.(event); trigger.current?.focus(); }}
      onInvalid={event => { props.onInvalid?.(event); if (!event.defaultPrevented) { event.preventDefault(); setInvalid(true); trigger.current?.focus(); } }}
      onChange={event => { setLocal(event.currentTarget.value); setInvalid(false); onChange?.(event); }}>
      {children}
    </select>
    <GlassSelect disabled={disabled} value={current ? `value:${current.value}` : ""} onValueChange={encoded => {
      const node = native.current;
      if (!node) return;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(node, encoded.slice(6));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }}>
      <GlassSelectTrigger ref={trigger} id={id} className={className} style={style} autoFocus={autoFocus}
        aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"] ?? labelledBy} aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"] ?? (invalid || undefined)} aria-required={required} title={props.title}>
        <GlassSelectValue>{current?.label}</GlassSelectValue>
      </GlassSelectTrigger>
      <GlassSelectContent position="popper">
        {groups.map((group, index) => <GlassSelectGroup key={group ?? index}>
          {group && <GlassSelectLabel>{group}</GlassSelectLabel>}
          {options.filter(o => o.group === group).map(o => <GlassSelectItem key={o.value} value={`value:${o.value}`} disabled={o.disabled}>{o.label}</GlassSelectItem>)}
        </GlassSelectGroup>)}
      </GlassSelectContent>
    </GlassSelect>
  </>;
});
