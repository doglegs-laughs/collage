import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { clamp } from '../core/geometry';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'soft';
  block?: boolean;
  busy?: boolean;
};

export function Button({ variant = 'default', block, busy, className = '', children, disabled, ...rest }: ButtonProps) {
  const cls = ['btn', variant !== 'default' && variant, block && 'block', busy && 'working', className].filter(Boolean).join(' ');
  return (
    <button type="button" {...rest} className={cls} disabled={disabled || busy}>
      {children}
    </button>
  );
}

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; title?: string };

export function Segmented<T extends string>({ options, value, onChange, label }: { options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, min = 1, max = 20, onChange, label }: { value: number; min?: number; max?: number; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const n = clamp(Math.floor(Number(raw)) || min, min, max);
    setText(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <div className="stepper">
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - 1, min, max))}>−</button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
      />
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + 1, min, max))}>+</button>
    </div>
  );
}

export function Slider({ value, min, max, step = 1, onChange, label, format = String, className = '' }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; format?: (v: number) => string; className?: string;
}) {
  const id = useId();
  return (
    <div className={`range-row ${className}`}>
      <input id={id} type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  );
}
