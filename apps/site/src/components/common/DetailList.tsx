import { Fragment, type ReactNode } from "react";

export type DetailRow = {
  // Stable identifier for React reconciliation. Defaults to `label`; pass
  // explicitly when two rows in the same list could share a label.
  key?: string;
  label: string;
  value: ReactNode;
};

// Renders <dl>/<dt>/<dd> so screen readers pair each label with its value.
// Falsy items are skipped, letting callers compose rows conditionally without
// ternary noise. Styling lives in styles/portal-shared.css → `.detail-list`.
export function DetailList({ items }: { items: ReadonlyArray<DetailRow | null | false> }) {
  return (
    <dl className="detail-list">
      {items.map((item) =>
        item ? (
          <Fragment key={item.key ?? item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </Fragment>
        ) : null,
      )}
    </dl>
  );
}
