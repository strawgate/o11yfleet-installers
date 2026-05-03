import { Alert } from "@mantine/core";
import { TriangleAlert } from "lucide-react";

export function PrototypeBanner({ message }: { message: string }) {
  return (
    <Alert
      role="note"
      aria-label="Prototype notice"
      title="Prototype"
      color="yellow"
      variant="light"
      icon={<TriangleAlert size={16} />}
    >
      {message}
    </Alert>
  );
}
