"use client";

import React from "react";

import { useTranslations } from "next-intl";
import { AppIcon } from "../../app/components/AppIcon";
import type { AgentSourceRef, AgentUiBlock } from "../../src/agent-chat/contracts";

function Sources({ sources, degradedLabel, staleLabel }: { sources: AgentSourceRef[]; degradedLabel: string; staleLabel: string }) {
  return (
    <ul className="agentChatSourceList">
      {sources.map((source) => (
        <li key={source.id}>
          {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : <span>{source.title}</span>}
          <small>{source.provider}{source.degraded ? ` · ${degradedLabel}` : ""}{source.stale ? ` · ${staleLabel}` : ""}</small>
        </li>
      ))}
    </ul>
  );
}

export default function AgentMessageBlocks({ blocks }: { blocks: AgentUiBlock[] }) {
  const t = useTranslations("agentChat");
  if (blocks.length === 0) return null;
  return (
    <div className="agentChatBlocks">
      {blocks.map((block, index) => {
        const key = `${block.type}:${index}`;
        if (block.type === "summary") return <section className="agentChatBlock" key={key}><div className="agentChatBlockTitle"><span><AppIcon name="ai" />{block.title ?? t("blocks.summary")}</span></div><p>{block.text}</p></section>;
        if (block.type === "key_metrics") return (
          <section className="agentChatBlock" key={key}>
            <div className="agentChatBlockTitle"><span><AppIcon name="performance" />{block.title ?? t("blocks.keyMetrics")}</span></div>
            <div className="agentChatMetricGrid">{block.items.map((item) => <div className={`agentChatMetric agentChatMetric-${item.tone ?? "neutral"}`} key={`${item.label}:${item.value}`}><span>{item.label}</span><b>{item.value}</b></div>)}</div>
          </section>
        );
        if (block.type === "risk_findings") return (
          <section className="agentChatBlock" key={key}>
            <div className="agentChatBlockTitle"><span><AppIcon name="risk" />{block.title ?? t("blocks.riskFindings")}</span><span className={`badge agentChatRisk-${block.riskLevel}`}>{t(`blocks.riskLevels.${block.riskLevel}`)}</span></div>
            <ul>{block.items.map((item) => <li key={`${item.title}:${item.detail}`}><strong>{item.title}</strong><span>{item.detail}</span></li>)}</ul>
          </section>
        );
        if (block.type === "scenario_table") return (
          <section className="agentChatBlock agentChatTableBlock" key={key}><div className="agentChatBlockTitle"><span><AppIcon name="detail" />{block.title ?? t("blocks.scenarios")}</span></div><div className="agentChatTableWrap"><table><thead><tr>{block.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${rowIndex}:${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div></section>
        );
        if (block.type === "prediction_comparison") return <section className="agentChatBlock" key={key}><div className="agentChatBlockTitle"><span><AppIcon name="predictions" />{block.title ?? t("blocks.comparison")}</span></div><dl className="agentChatComparison"><div><dt>{t("blocks.prediction")}</dt><dd>{block.prediction}</dd></div><div><dt>{t("blocks.position")}</dt><dd>{block.position}</dd></div><div><dt>{t("blocks.divergence")}</dt><dd>{block.divergence}</dd></div></dl></section>;
        return <section className="agentChatBlock" key={key}><div className="agentChatBlockTitle"><span><AppIcon name="news" />{block.title ?? t("blocks.sourceList")}</span></div><Sources sources={block.sources} degradedLabel={t("states.degraded")} staleLabel={t("states.stale")} /></section>;
      })}
    </div>
  );
}
