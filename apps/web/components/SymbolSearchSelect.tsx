"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SymbolSearchOption = {
  symbol: string;
  tradable?: boolean;
  label?: string;
  meta?: string | null;
};

type SymbolSearchSelectProps = {
  value: string;
  onChange(value: string): void;
  options: SymbolSearchOption[];
  disabled?: boolean;
  loading?: boolean;
  required?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  loadingLabel: string;
  emptyLabel: string;
  restrictedLabel?: string;
  className?: string;
};

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function optionLabel(option: SymbolSearchOption, restrictedLabel?: string): string {
  const base = option.label?.trim() || option.symbol;
  if (option.tradable === false && restrictedLabel) return `${base} (${restrictedLabel})`;
  return base;
}

export default function SymbolSearchSelect({
  value,
  onChange,
  options,
  disabled = false,
  loading = false,
  required = false,
  placeholder,
  searchPlaceholder,
  loadingLabel,
  emptyLabel,
  restrictedLabel,
  className
}: SymbolSearchSelectProps) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedValue = normalizeSymbol(value);
  const selected = useMemo(
    () => options.find((option) => normalizeSymbol(option.symbol) === normalizedValue) ?? null,
    [normalizedValue, options]
  );
  const selectedLabel = selected ? optionLabel(selected, restrictedLabel) : normalizedValue;

  useEffect(() => {
    if (!open) setQuery(selectedLabel);
  }, [open, selectedLabel]);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeSymbol(query);
    const normalizedSelectedLabel = normalizeSymbol(selectedLabel);
    const filterQuery = open && normalizedQuery === normalizedSelectedLabel ? "" : normalizedQuery;
    if (!filterQuery) return options;
    return options.filter((option) => {
      const symbol = normalizeSymbol(option.symbol);
      const label = normalizeSymbol(option.label ?? "");
      const meta = normalizeSymbol(option.meta ?? "");
      return symbol.includes(filterQuery) || label.includes(filterQuery) || meta.includes(filterQuery);
    });
  }, [open, options, query, selectedLabel]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, options]);

  function closeSoon() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      const normalizedQuery = normalizeSymbol(query);
      const exact = options.find((option) =>
        normalizeSymbol(option.symbol) === normalizedQuery
        || normalizeSymbol(option.label ?? "") === normalizedQuery
      );
      if (exact) {
        selectOption(exact);
        return;
      }
      setQuery(selectedLabel);
      setOpen(false);
    }, 120);
  }

  function cancelClose() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function selectOption(option: SymbolSearchOption) {
    const nextSymbol = normalizeSymbol(option.symbol);
    onChange(nextSymbol);
    setQuery(optionLabel(option, restrictedLabel));
    setOpen(false);
  }

  const visibleOptions = filteredOptions.slice(0, 80);

  function moveActive(delta: number) {
    if (visibleOptions.length === 0) return;
    setActiveIndex((current) => {
      const next = current + delta;
      if (next < 0) return visibleOptions.length - 1;
      if (next >= visibleOptions.length) return 0;
      return next;
    });
  }

  const wrapperClassName = ["symbolSearchSelect", className].filter(Boolean).join(" ");
  const showMenu = open && !disabled;
  const activeOption = visibleOptions[activeIndex] ?? null;

  return (
    <div className={wrapperClassName} onMouseDown={cancelClose}>
      <input
        className="input symbolSearchSelectInput"
        value={query}
        disabled={disabled}
        required={required}
        placeholder={loading ? loadingLabel : (searchPlaceholder ?? placeholder)}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showMenu}
        aria-controls={listboxId}
        aria-activedescendant={showMenu && activeOption ? `${listboxId}-${activeIndex}` : undefined}
        onFocus={(event) => {
          cancelClose();
          setOpen(true);
          event.currentTarget.select();
        }}
        onBlur={closeSoon}
        onChange={(event) => {
          setQuery(event.target.value.toUpperCase());
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            moveActive(1);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            moveActive(-1);
            return;
          }
          if (event.key === "Enter" && showMenu && activeOption) {
            event.preventDefault();
            selectOption(activeOption);
            return;
          }
          if (event.key === "Escape") {
            setOpen(false);
            setQuery(selectedLabel);
          }
        }}
      />
      <span className="symbolSearchSelectChevron" aria-hidden="true" />
      {showMenu ? (
        <div id={listboxId} className="symbolSearchSelectMenu" role="listbox">
          {loading ? (
            <div className="symbolSearchSelectState">{loadingLabel}</div>
          ) : filteredOptions.length === 0 ? (
            <div className="symbolSearchSelectState">{emptyLabel}</div>
          ) : (
            visibleOptions.map((option, index) => {
              const active = index === activeIndex;
              const normalized = normalizeSymbol(option.symbol);
              return (
                <button
                  id={`${listboxId}-${index}`}
                  key={`${normalized}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={normalized === normalizedValue}
                  className={`symbolSearchSelectOption${active ? " symbolSearchSelectOptionActive" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  <span className="symbolSearchSelectSymbol">{option.label?.trim() || normalized}</span>
                  {option.meta || option.tradable === false ? (
                    <span className="symbolSearchSelectMeta">
                      {option.meta ?? restrictedLabel}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
