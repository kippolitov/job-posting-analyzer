import { useEffect, useRef, type ReactNode } from "react";

/**
 * Modal around a native `<dialog>` (FR-031). Escape and Close both end in
 * `onClose`; the caller returns focus to its trigger.
 */
export function CompareDialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      // Start on Close so Escape and Tab behave the same in every browser.
      dialog.querySelector("button")?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="compare-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      className="m-0 h-full max-h-none w-full max-w-none bg-white p-4 text-gray-900 backdrop:bg-black/50 dark:bg-gray-900 dark:text-gray-100 sm:m-auto sm:h-auto sm:max-h-[90vh] sm:max-w-5xl sm:rounded-lg"
    >
      {open && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="compare-dialog-title" className="text-lg font-semibold">
              Compare postings
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm dark:border-gray-700"
            >
              Close
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
