import { Check } from "lucide-react";
import { useI18n } from "../../app/providers/LanguageProvider";

type Step = {
  label: string;
};

type Props = {
  steps: Step[];
  activeIndex: number;
  onStepClick: (index: number) => void;
};

export function MacSegmentedControl({ steps, activeIndex, onStepClick }: Props) {
  const { t } = useI18n();

  return (
    <nav className="stepper" aria-label={t("step.workflow")}>
      {steps.map((step, index) => {
        const complete = index < activeIndex;
        const active = index === activeIndex;
        return (
          <button
            key={step.label}
            className={`stepper__item ${active ? "stepper__item--active" : ""}`}
            type="button"
            onClick={() => onStepClick(index)}
          >
            <span className="stepper__marker">{complete ? <Check size={14} /> : index + 1}</span>
            <span>{step.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
