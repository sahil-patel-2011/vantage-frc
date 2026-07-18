"use client";

type Props = {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  required?: boolean;
};

export function LegalAgreementCheckbox({
  id, checked, onChange, className = "consent legal-agreement", required = true,
}: Props) {
  return (
    <label className={className} htmlFor={id}>
      <input id={id} name="termsAccepted" type="checkbox" checked={checked} required={required}
        onChange={(event) => onChange(event.target.checked)} />
      <span>
        I agree to the{" "}
        <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>{" "}
        and{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
      </span>
    </label>
  );
}