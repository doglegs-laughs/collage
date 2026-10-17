/**
 * Drag a slot by its badge: a ghost copy follows the pointer, the slot under it is highlighted,
 * and on release `onSwap(from, to)` fires (the target may be empty).
 */
export function startReorder(event: PointerEvent | React.PointerEvent, index: number, slotEl: HTMLElement, onSwap: (from: number, to: number) => void) {
  event.preventDefault();
  const rect = slotEl.getBoundingClientRect();
  const offX = event.clientX - rect.left;
  const offY = event.clientY - rect.top;
  const ghost = slotEl.cloneNode(true) as HTMLElement;
  ghost.className = 'slot filled ghost';
  ghost.removeAttribute('data-slot');
  Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px`, left: `${rect.left}px`, top: `${rect.top}px` });
  document.body.append(ghost);
  slotEl.classList.add('dragging-source');
  let over: HTMLElement | null = null;

  const onMove = (e: PointerEvent) => {
    ghost.style.left = `${e.clientX - offX}px`;
    ghost.style.top = `${e.clientY - offY}px`;
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-slot]') ?? null;
    const next = target && target !== slotEl ? target : null;
    if (next !== over) {
      over?.classList.remove('over');
      over = next;
      over?.classList.add('over');
    }
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    ghost.remove();
    slotEl.classList.remove('dragging-source');
    over?.classList.remove('over');
    if (over) onSwap(index, Number(over.dataset.slot));
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}
