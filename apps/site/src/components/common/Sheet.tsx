import type { ReactNode } from "react";
import { Drawer } from "@mantine/core";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Side-panel equivalent of `<Modal>`. Thin wrapper over Mantine's `<Drawer>`
 * preserving the legacy prop API (`open` / `onClose` / `title` / `children`)
 * so existing call sites don't change.
 *
 * Same a11y wins as the Modal swap: Mantine handles focus trap, scroll lock,
 * portal, ESC dismissal, click-outside-to-close, returnFocus.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  return (
    <Drawer
      opened={open}
      onClose={onClose}
      title={title}
      position="right"
      size="md"
      withCloseButton
      closeButtonProps={{ "aria-label": "Close" }}
      closeOnEscape
      closeOnClickOutside
      trapFocus
      returnFocus
    >
      {children}
    </Drawer>
  );
}
