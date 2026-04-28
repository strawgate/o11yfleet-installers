import { PrototypeBanner } from "../../components/ui/PrototypeBanner";

export function AdminPrototypePage({ title }: { title: string }) {
  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-semibold text-fg mb-4">{title}</h1>
      <PrototypeBanner
        message={`${title} is not yet implemented. This page is a placeholder for a future feature.`}
      />
    </div>
  );
}
