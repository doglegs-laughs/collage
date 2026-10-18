import { FONT_KEYS, FONT_LABELS, fontStack } from './fonts';
import type { FontKey } from './model';

/** Font dropdown whose options are each drawn in their own face. */
export function FontSelect({ label, value, onChange }: { label: string; value: FontKey; onChange: (f: FontKey) => void }) {
  return (
    <select className="select font-select" aria-label={label} value={value} style={{ fontFamily: fontStack(value) }} onChange={(e) => onChange(e.target.value as FontKey)}>
      {FONT_KEYS.map((k) => <option key={k} value={k} style={{ fontFamily: fontStack(k), fontSize: 15 }}>{FONT_LABELS[k]}</option>)}
    </select>
  );
}
