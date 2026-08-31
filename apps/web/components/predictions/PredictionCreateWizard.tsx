"use client";

import type { ReactNode } from "react";
import { AppIcon } from "../../app/components/AppIcon";

export const PREDICTION_WIZARD_STEPS = ["type", "market", "analysis", "advanced", "scope", "review", "generate"] as const;
export type PredictionWizardStep = (typeof PREDICTION_WIZARD_STEPS)[number];

type PredictionCreateWizardProps = {
  open: boolean;
  step: PredictionWizardStep;
  steps: Array<{ id: PredictionWizardStep; label: string }>;
  title: string;
  description: string;
  backLabel: string;
  nextLabel: string;
  closeLabel: string;
  generateLabel: string;
  generatingLabel: string;
  canGenerate: boolean;
  generating: boolean;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  onGenerate: () => void;
  children: ReactNode;
};

export default function PredictionCreateWizard(props: PredictionCreateWizardProps) {
  if (!props.open) return <>{props.children}</>;
  const stepIndex = Math.max(0, props.steps.findIndex((entry) => entry.id === props.step));
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === props.steps.length - 1;

  return (
    <div className="predictionWizardBackdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="predictionWizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prediction-wizard-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="predictionWizardHeader">
          <div>
            <div className="predictionSectionEyebrow">{props.steps[stepIndex]?.label}</div>
            <h2 id="prediction-wizard-title" className="predictionWizardTitle">{props.title}</h2>
            <p className="predictionWizardDescription">{props.description}</p>
          </div>
          <button className="btn predictionDrawerClose" type="button" onClick={props.onClose} aria-label={props.closeLabel}>
            <AppIcon name="close" />
          </button>
        </header>
        <ol className="predictionWizardSteps" aria-label={props.title}>
          {props.steps.map((entry, index) => (
            <li key={entry.id} className={index === stepIndex ? "predictionWizardStepActive" : index < stepIndex ? "predictionWizardStepDone" : ""}>
              <span>{index + 1}</span>{entry.label}
            </li>
          ))}
        </ol>
        <div className="predictionWizardBody" data-step={props.step}>{props.children}</div>
        <footer className="predictionWizardFooter">
          <button className="btn" type="button" onClick={isFirst ? props.onClose : props.onBack}>
            <AppIcon name={isFirst ? "close" : "back"} />
            {isFirst ? props.closeLabel : props.backLabel}
          </button>
          {isLast ? (
            <button className="btn btnPrimary" type="button" onClick={props.onGenerate} disabled={!props.canGenerate || props.generating}>
              <AppIcon name="create" />
              {props.generating ? props.generatingLabel : props.generateLabel}
            </button>
          ) : (
            <button className="btn btnPrimary" type="button" onClick={props.onNext}>
              {props.nextLabel}
              <AppIcon name="chevronRight" />
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
