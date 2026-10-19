import type { ReactNode } from 'react';

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;
export const asHex = (v: string, fallback = '#000000'): string => (HEX.test(v) ? v : fallback);

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input type="color" className="color-swatch" aria-label={label} value={asHex(value)} onChange={(e) => onChange(e.target.value)} />;
}

export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export const pct = (digits = 1) => (v: number) => `${(v * 100).toFixed(digits)}%`;
export const deg = (v: number) => `${Math.round(v)}°`;
