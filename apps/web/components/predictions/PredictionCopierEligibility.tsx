"use client";
import { DeskBadge } from "@/components/desk/DeskBadge";
import { DeskLink } from "@/components/desk/DeskLink";

import { AppIcon } from "../../app/components/AppIcon";

type PredictionCopierEligibilityProps = {
  eligible: boolean;
  href: string;
  title: string;
  description: string;
  eligibleLabel: string;
  unavailableLabel: string;
  actionLabel: string;
};

export default function PredictionCopierEligibility(props: PredictionCopierEligibilityProps) {
  return (
    <section className="predictionCopierEligibility" aria-label={props.title}>
      <div>
        <div className="predictionSectionEyebrow">Prediction Copier</div>
        <strong>{props.title}</strong>
        <p>{props.description}</p>
      </div>
      <div className="predictionCopierEligibilityActions">
        <DeskBadge className={`badge ${props.eligible ? "badgeOk" : "badgeWarn"}`}>
          {props.eligible ? props.eligibleLabel : props.unavailableLabel}
        </DeskBadge>
        {props.eligible ? (
          <DeskLink className="btn btnPrimary" href={props.href}>
            <AppIcon name="bots" />
            {props.actionLabel}
          </DeskLink>
        ) : null}
      </div>
    </section>
  );
}
