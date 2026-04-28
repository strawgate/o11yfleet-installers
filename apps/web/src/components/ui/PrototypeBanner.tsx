export function PrototypeBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-warn/20 bg-warn/5 px-4 py-3 text-xs text-warn mb-4">
      <span className="font-semibold">Prototype</span> — {message}
    </div>
  );
}
