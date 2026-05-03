import { Box, Drawer, Group, ScrollArea, Stack, Text, UnstyledButton } from "@mantine/core";
import { Plus } from "lucide-react";
import { nanoid } from "nanoid";
import { PIPELINE_COMPONENT_CATALOG } from "@o11yfleet/core/pipeline";
import type { BuilderNode, BuilderRole } from "../types";
import { NodeCard } from "./NodeCard";
import { SignalBadge } from "../SignalBadge";

export type AddComponentPanelProps = {
  opened: boolean;
  onClose: () => void;
  onAddNode: (node: BuilderNode) => void;
  existingNodes: BuilderNode[];
};

export function AddComponentPanel({
  opened,
  onClose,
  onAddNode,
  existingNodes,
}: AddComponentPanelProps) {
  const handleAddComponent = (role: BuilderRole, type: string) => {
    const catalogItem = PIPELINE_COMPONENT_CATALOG.find((c) => c.role === role && c.type === type);
    if (!catalogItem) return;

    const id = `${role}-${type}-${nanoid(6)}`;

    // Default column x-coordinates: receiver=0, processor=300, exporter=600
    let x = 300;
    if (role === "receiver") x = 0;
    else if (role === "exporter") x = 600;
    else if (role === "connector") x = 450;

    // Find highest Y in the column to place below it
    let y = 50;
    const sameColNodes = existingNodes.filter((n) => Math.abs(n.position.x - x) < 100);
    if (sameColNodes.length > 0) {
      y = Math.max(...sameColNodes.map((n) => n.position.y)) + 150;
    }

    const newNode: BuilderNode = {
      id,
      type: role,
      position: { x, y },
      data: {
        name: type,
        type: type,
        signals: [...catalogItem.signals],
      },
    };

    onAddNode(newNode);
    onClose();
  };

  const roles: BuilderRole[] = ["receiver", "processor", "exporter", "connector"];

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      title={<Text fw={600}>Add Component</Text>}
      aria-label="Add Component"
      size="md"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="xl" pb="xl">
        {roles.map((role) => {
          const components = PIPELINE_COMPONENT_CATALOG.filter((c) => c.role === role);
          if (components.length === 0) return null;

          return (
            <Box key={role}>
              <Text fw={500} mb="sm" tt="capitalize">
                {role}s
              </Text>
              <Stack gap="xs">
                {components.map((c) => (
                  <UnstyledButton
                    key={`${c.role}-${c.type}`}
                    onClick={() => handleAddComponent(c.role as BuilderRole, c.type)}
                    w="100%"
                    style={{
                      display: "block",
                      borderRadius: "var(--mantine-radius-sm)",
                    }}
                  >
                    <Group
                      justify="space-between"
                      align="center"
                      w="100%"
                      px="xs"
                      py={8}
                      style={{ border: "1px solid transparent" }}
                    >
                      <Group>
                        <Plus size={16} color="var(--mantine-color-dimmed)" />
                        <NodeCard
                          role={c.role}
                          name={c.type}
                          signals={c.signals.map((s) => (
                            <SignalBadge key={s} signal={s} />
                          ))}
                        />
                      </Group>
                    </Group>
                  </UnstyledButton>
                ))}
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Drawer>
  );
}
