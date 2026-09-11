export type OnboardingStep = {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  href: string;
};

export function currentOnboardingStep(steps: OnboardingStep[]): OnboardingStep | null {
  return steps.find((step) => !step.done) ?? null;
}
