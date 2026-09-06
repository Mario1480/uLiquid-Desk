"use client";

import { Check, Sparkles, Zap, Building2, ArrowRight } from "lucide-react";
import { GlassCard, GlassCardContent, GlassCardDescription, GlassCardHeader, GlassCardTitle } from "@/components/einui/liquid-glass/glass-card";
import { GlassButton } from "@/components/einui/liquid-glass/glass-button";
import { GlassBadge } from "@/components/einui/liquid-glass/glass-badge";
import { pricingCatalogSnapshot, type PricingPlan } from "./sample-pricing";
import { formatUsdc, planCopy } from "./sample-pricing";

const icons = { free: Zap, pro: Sparkles, premium: Building2 };
const gradients = {
  free: "ein:from-cyan-500 ein:to-blue-500",
  pro: "ein:from-blue-500 ein:to-purple-500",
  premium: "ein:from-purple-500 ein:to-pink-500",
};

/** Adapted from @einui/pricing-page; illustrative data is isolated from the live billing catalog. */
export default function PricingBlockPage({
  plans = pricingCatalogSnapshot.plans,
  showHeader = true,
  comparisonHref = "/pricing/#feature-matrix-title",
}: { plans?: PricingPlan[]; showHeader?: boolean; comparisonHref?: string }) {
  return <div className="ein-pricing">
    {showHeader && <div className="ein-pricing-heading">
      <GlassBadge><Sparkles className="ein:size-3 ein:mr-1" aria-hidden="true" /> Monthly pricing</GlassBadge>
      <h1>Choose your uLiquid Desk plan.</h1>
      <p>Free, Pro and Premium. Clear monthly USDC pricing, with AI Credits and capacity to match your workflow.</p>
      <p className="ein-pricing-policy">All plans available · Activation and payment take place in uLiquid Desk.</p>
    </div>}
    <div className="ein-pricing-grid">
      {plans.map(plan => {
        const Icon = icons[plan.plan];
        const copy = planCopy[plan.plan];
        const highlighted = plan.plan === "pro";
        return <article key={plan.code} className={`ein-pricing-plan ${highlighted ? "ein-pricing-plan--featured" : ""}`} aria-label={`${plan.name} plan`}>
          {highlighted && <div className="ein-pricing-ribbon"><GlassBadge variant="primary"><Sparkles className="ein:size-3 ein:mr-1" aria-hidden="true" /> AI included</GlassBadge></div>}
          <GlassCard className={`ein-pricing-card ${highlighted ? "ein:ring-2 ein:ring-cyan-500/50 ein:shadow-xl ein:shadow-cyan-500/10" : ""}`}>
            <GlassCardHeader className="ein:text-center ein:pb-2">
              <div className={`ein:mx-auto ein:p-3 ein:rounded-xl ein:bg-linear-to-br ${gradients[plan.plan]} ein:w-fit ein:mb-3`}><Icon className="ein:h-6 ein:w-6 ein:text-white" aria-hidden="true" /></div>
              <GlassCardTitle className="ein:text-xl">{plan.name}</GlassCardTitle>
              <GlassCardDescription className="ein-pricing-description">{copy.description}</GlassCardDescription>
            </GlassCardHeader>
            <GlassCardContent className="ein-pricing-content">
              <div className="ein-pricing-price"><strong>{formatUsdc(plan.priceCents)}</strong><span>USDC / month</span></div>
              <ul className="ein-pricing-features">{copy.features(plan).map(feature => <li key={feature}>
                <span className="ein:p-0.5 ein:rounded-full ein:bg-linear-to-br ein:from-cyan-500 ein:to-blue-500 ein:shrink-0 ein:mt-0.5"><Check className="ein:size-3 ein:text-white" aria-hidden="true" /></span><span>{feature}</span>
              </li>)}</ul>
              <div className="ein-pricing-cta"><GlassButton asChild variant={highlighted ? "primary" : "outline"} className="ein:w-full ein:justify-center ein:py-5 ein:group"><a href={comparisonHref}>Compare {plan.name}<ArrowRight className="ein:h-4 ein:w-4 ein:ml-2" aria-hidden="true" /></a></GlassButton></div>
            </GlassCardContent>
          </GlassCard>
        </article>;
      })}
    </div>
  </div>;
}
