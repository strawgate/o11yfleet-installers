import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import type { ReactNode } from "react";
import { getErrorMessage } from "@/utils/errors";

export type ConfirmActionOptions = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  // Optimistic toast. The notification opens as `loading`, then mutates into
  // success or error after `action` resolves. Use this for fire-and-await
  // server commands (Restart, Disconnect, Delete) where the user wants
  // immediate confirmation that the request is in flight.
  loading: { title: string; message: string };
  success: { title: string; message: string };
  errorTitle: string;
  action: () => Promise<unknown>;
};

// Opens a Mantine confirm modal; on confirm, runs `action` with an
// optimistic toast that morphs from loading→success/error. Replaces ~70 LOC
// of boilerplate per call site.
export function confirmAction(opts: ConfirmActionOptions): void {
  modals.openConfirmModal({
    title: opts.title,
    centered: true,
    children: opts.body,
    labels: { confirm: opts.confirmLabel, cancel: "Cancel" },
    confirmProps: opts.destructive ? { color: "red" } : undefined,
    // Mantine's onConfirm is typed `() => void`; wrap the awaited work in
    // a discarded IIFE so the modal closes synchronously while the mutation
    // runs in the background and updates the toast.
    onConfirm: () => {
      void (async () => {
        const toastId = notifications.show({
          loading: true,
          title: opts.loading.title,
          message: opts.loading.message,
          autoClose: false,
          withCloseButton: false,
        });
        try {
          await opts.action();
          notifications.update({
            id: toastId,
            loading: false,
            color: "brand",
            title: opts.success.title,
            message: opts.success.message,
            autoClose: 4000,
            withCloseButton: true,
          });
        } catch (err) {
          notifications.update({
            id: toastId,
            loading: false,
            color: "red",
            title: opts.errorTitle,
            message: getErrorMessage(err),
            autoClose: 6000,
            withCloseButton: true,
          });
        }
      })();
    },
  });
}
