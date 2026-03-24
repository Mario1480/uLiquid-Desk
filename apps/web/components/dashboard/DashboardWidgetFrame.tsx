"use client";

import type { DragEvent, PointerEvent, ReactNode } from "react";
import type { DashboardLayoutItem } from "../../src/dashboard/layout";
import { DASHBOARD_LAYOUT_ROW_HEIGHT } from "../../src/dashboard/layout";

export default function DashboardWidgetFrame({
  item,
  anchorId,
  title,
  editable,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onHide,
  onResizeStart,
  children
}: {
  item: DashboardLayoutItem;
  anchorId: string;
  title: string;
  editable: boolean;
  isDragging: boolean;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onHide: () => void;
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <div
      id={anchorId}
      className={`dashboardWidgetFrame${editable ? " dashboardWidgetFrameEditable" : ""}${
        isDragging ? " dashboardWidgetFrameDragging" : ""
      }`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        gridColumn: `span ${item.w}`,
        minHeight: editable ? `${item.h * DASHBOARD_LAYOUT_ROW_HEIGHT}px` : undefined
      }}
    >
      {editable ? (
        <div className="dashboardWidgetFrameToolbar">
          <button
            type="button"
            className="dashboardWidgetFrameHandle"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            aria-label={`${title} bewegen`}
            title={`${title} bewegen`}
          >
            <span aria-hidden="true">⋮⋮</span>
          </button>
          <div className="dashboardWidgetFrameTitle" title={title}>
            {title}
          </div>
          <button
            type="button"
            className="dashboardWidgetFrameHide"
            onClick={onHide}
            aria-label={`${title} ausblenden`}
            title={`${title} ausblenden`}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      ) : null}

      <div className="dashboardWidgetFrameBody">
        {children}
      </div>

      {editable ? (
        <button
          type="button"
          className="dashboardWidgetResizeHandle"
          onPointerDown={onResizeStart}
          aria-label={`${title} Größe ändern`}
          title={`${title} Größe ändern`}
        >
          <span aria-hidden="true">◢</span>
        </button>
      ) : null}
    </div>
  );
}
