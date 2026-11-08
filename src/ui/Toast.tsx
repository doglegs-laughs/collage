import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'info' | 'error' | 'success';
/** One optional button on a toast (e.g. "Show in Finder"). Clicking it also dismisses the toast. */
export type ToastAction = { label: string; onClick: () => void };
type ToastFn = (message: string, tone?: ToastTone, action?: ToastAction) => void;

const ToastContext = createContext<ToastFn>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ message: string; tone: ToastTone; id: number; action?: ToastAction } | null>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<number>();
  const counter = useRef(0);

  const toast = useCallback<ToastFn>((message, tone = 'info', action) => {
    window.clearTimeout(timer.current);
    setCurrent({ message, tone, action, id: ++counter.current });
    setShown(true);
    timer.current = window.setTimeout(() => setShown(false), action ? 8000 : tone === 'error' ? 6000 : 3500);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={`toast ${current?.tone ?? ''} ${current?.action ? 'has-action' : ''} ${shown ? 'show' : ''}`} role="status" aria-live="polite">
        {current?.message}
        {current?.action && (
          <button type="button" className="toast-action" onClick={() => { window.clearTimeout(timer.current); setShown(false); current.action?.onClick(); }}>
            {current.action.label}
          </button>
        )}
      </div>
    </ToastContext.Provider>
  );
}
