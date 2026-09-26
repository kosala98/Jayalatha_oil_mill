import { type ReactNode, useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
}

/** Native <dialog>: focus trapping, Esc to close and inert background for free. */
export function Dialog({ open, title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop tap
      }}
    >
      <div className="dialog__body">
        <h2 className="dialog__title">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
