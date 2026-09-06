import type { ReactNode } from "react";
import { GlassCard, GlassCardContent, GlassCardHeader } from "./liquid-glass/glass-card";
/** Presentational composition extracted from Ein's login/signup/reset blocks; consumers own every action. */
export function GlassAuthFrame({ title, icon, children, notice }: { title: ReactNode; icon: ReactNode; children: ReactNode; notice?: ReactNode }) {
  return <div className="ein-auth-page">
    <GlassCard asChild glowEffect={false}><section className="ein-auth-card" aria-labelledby="ein-auth-title">
      <GlassCardHeader className="ein-auth-header">
        <span className="ein-auth-icon" aria-hidden="true">{icon}</span>
        <h1 id="ein-auth-title">{title}</h1>
      </GlassCardHeader>
      <GlassCardContent className="ein-auth-content">{children}</GlassCardContent>
    </section></GlassCard>
    {notice ? <div className="ein-auth-notice">{notice}</div> : null}
  </div>;
}
