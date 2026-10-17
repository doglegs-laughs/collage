import { useLayoutEffect, useState, type RefObject } from 'react';

/** True while the surrounding `.mode-pane` is not `hidden` (App keeps every mode mounted). */
export function useVisible(ref: RefObject<HTMLElement>): boolean {
  const [visible, setVisible] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    const pane = (el?.closest('.mode-pane') ?? el?.parentElement) as HTMLElement | null | undefined;
    if (!pane) return;
    const read = () => setVisible(!pane.hidden);
    read();
    const mo = new MutationObserver(read);
    mo.observe(pane, { attributes: true, attributeFilter: ['hidden'] });
    return () => mo.disconnect();
  }, [ref]);
  return visible;
}
