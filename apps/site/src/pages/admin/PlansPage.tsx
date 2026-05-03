import { Table } from "@mantine/core";
import { useAdminPlans } from "../../api/hooks/admin";
import { EmptyState, PageHeader, PageShell } from "@/components/app";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function optionalNumber(value: unknown): number | string {
  return typeof value === "number" ? value : "—";
}

function yesNo(value: unknown): string {
  return value === true ? "Yes" : value === false ? "No" : "—";
}

function trackLabel(value: unknown): string {
  if (value === "personal") return "Individual";
  if (value === "business") return "Organization";
  return typeof value === "string" ? value : "—";
}

export default function PlansPage() {
  const { data: plans, isLoading, error, refetch } = useAdminPlans();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const planList = plans ?? [];

  return (
    <PageShell width="wide">
      <PageHeader title="Plans" />

      {planList.length === 0 ? (
        <EmptyState
          icon="box"
          title="No plans configured"
          description="Plan definitions will appear here after they are seeded or configured."
        />
      ) : (
        <Table.ScrollContainer minWidth={700}>
          <Table withTableBorder striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Track</Table.Th>
                <Table.Th>Users</Table.Th>
                <Table.Th>Collectors</Table.Th>
                <Table.Th>Policies</Table.Th>
                <Table.Th>History</Table.Th>
                <Table.Th>API / GitOps</Table.Th>
                <Table.Th>Tenants</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {planList.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>
                    <PlanTag plan={p.id} />
                  </Table.Td>
                  <Table.Td>{trackLabel(p["audience"])}</Table.Td>
                  <Table.Td>{optionalNumber(p["max_users"])}</Table.Td>
                  <Table.Td>{optionalNumber(p["max_collectors"])}</Table.Td>
                  <Table.Td>{optionalNumber(p["max_policies"] ?? p["max_configs"])}</Table.Td>
                  <Table.Td>
                    {typeof p["history_retention"] === "string" ? p["history_retention"] : "—"}
                  </Table.Td>
                  <Table.Td>
                    {yesNo(p["supports_api"])} / {yesNo(p["supports_gitops"])}
                  </Table.Td>
                  <Table.Td>{numberValue(p["tenant_count"], 0)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </PageShell>
  );
}
