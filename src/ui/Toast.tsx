import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'info' | 'error' | 'success';
type ToastFn = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ToastFn>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ message: string; tone: ToastTone; id: number } | null>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<number>();
  const counter = useRef(0);

  const toast = useCallback<ToastFn>((message, tone = 'info') => {
    window.clearTimeout(timer.current);
    setCurrent({ message, tone, id: ++counter.current });
    setShown(true);
    timer.current = window.setTimeout(() => setShown(false), tone === 'error' ? 6000 : 3500);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={`toast ${current?.tone ?? ''} ${shown ? 'show' : ''}`} role="status" aria-live="polite">
        {current?.message}
      </div>
    </ToastContext.Provider>
  );
}
