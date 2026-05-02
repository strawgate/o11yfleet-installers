import type { ReactNode } from "react";
import { Modal as MantineModal, Group, Stack } from "@mantine/core";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Thin wrapper over Mantine's `<Modal>` preserving the legacy prop API
 * (`open`, `title`, optional `footer`) so existing call sites don't need
 * to change. Mantine handles focus trap, ESC dismissal, scroll lock, and
 * portal rendering — replacing the previous hand-rolled implementation
 * which had a fragile querySelector-based focus trap and no scroll lock.
 *
 * Differences from the legacy implementation:
 * - Backdrop click closes the modal (Mantine default; matches legacy).
 * - Focus trap is Mantine's, which handles edge cases (radio groups,
 *   input cursor restoration) the legacy version got wrong.
 * - Title can be any ReactNode; the legacy required a string but every
 *   call site passes a string anyway, so the API is compatible.
 */
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  return (
    <MantineModal
      opened={open}
      onClose={onClose}
      title={title}
      centered
      size="md"
      withCloseButton
      closeButtonProps={{ "aria-label": "Close" }}
      closeOnEscape
      closeOnClickOutside
      trapFocus
      returnFocus
    >
      <Stack gap="md">
        <div>{children}</div>
        {footer ? (
          <Group justify="flex-end" gap="xs">
            {footer}
          </Group>
        ) : null}
      </Stack>
    </MantineModal>
  );
}
