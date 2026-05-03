import { Button, CopyButton as MantineCopyButton } from "@mantine/core";
import { Check, Copy } from "lucide-react";

interface CopyButtonProps {
  value: string;
  label?: string;
}

export function CopyButton({ value, label }: CopyButtonProps) {
  return (
    <MantineCopyButton value={value} timeout={1200}>
      {({ copied, copy }) => (
        <Button
          size="compact-xs"
          variant={copied ? "light" : "default"}
          color={copied ? "green" : undefined}
          leftSection={copied ? <Check size={12} /> : <Copy size={12} />}
          onClick={copy}
        >
          {copied ? "copied" : (label ?? "copy")}
        </Button>
      )}
    </MantineCopyButton>
  );
}
