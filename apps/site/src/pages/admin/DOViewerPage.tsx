import { useEffect, useState } from "react";
import { useAdminDoQuery, useAdminDoTables } from "../../api/hooks/admin";
import { useToast } from "../../components/common/Toast";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { getColumnKeys, buildDoCell } from "./utils/do-table";

const DEFAULT_SQL = `SELECT instance_uid, status, healthy, last_seen_at
FROM agents
ORDER BY last_seen_at DESC
LIMIT 50`;

const TABLE_QUERY_LIMIT = 500;

export default function DOViewerPage() {
  const { toast } = useToast();
  const [configId, setConfigId] = useState("");
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [paramsText, setParamsText] = useState("[]");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const trimmedConfigId = configId.trim();
  const tablesQuery = useAdminDoTables(trimmedConfigId);
  const queryMutation = useAdminDoQuery(trimmedConfigId);
  const { reset } = queryMutation;

  useEffect(() => {
    reset();
  }, [trimmedConfigId, sql, paramsText, reset]);

  // Clear selected table when config changes
  useEffect(() => {
    setSelectedTable(null);
  }, [trimmedConfigId]);

  async function runQuery() {
    let params: unknown[];
    try {
      const parsed = JSON.parse(paramsText || "[]") as unknown;
      if (!Array.isArray(parsed)) {
        reset();
        toast("Params must be a JSON array", undefined, "err");
        return;
      }
      params = parsed;
    } catch {
      reset();
      toast("Params must be a valid JSON array", undefined, "err");
      return;
    }

    try {
      await queryMutation.mutateAsync({ sql, params });
    } catch (error) {
      toast("Failed to run query", error instanceof Error ? error.message : String(error), "err");
    }
  }

  function selectTable(tableName: string) {
    const escapedName = tableName.replace(/"/g, '""');
    const tableSql = `SELECT * FROM "${escapedName}" LIMIT ${TABLE_QUERY_LIMIT}`;
    setSql(tableSql);
    setParamsText("[]");
    setSelectedTable(tableName);
    // Auto-run the query
    void queryMutation.reset();
    void queryMutation.mutateAsync({ sql: tableSql, params: [] });
  }

  const isQuerying = queryMutation.isPending;
  const hasQueryResult = queryMutation.isSuccess && queryMutation.data;
  const hasQueryError = queryMutation.isError;
  const rows = queryMutation.data?.rows ?? [];
  const columns = getColumnKeys(rows);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Durable Object Viewer</h1>
          <p className="meta">
            Read-only SQLite inspection for a configuration Durable Object. Queries are limited to a
            single SELECT statement and capped at 500 rows.
          </p>
        </div>
      </div>

      <section className="card card-pad">
        <div className="field">
          <label htmlFor="do-config-id">Configuration ID</label>
          <input
            id="do-config-id"
            value={configId}
            onChange={(event) => setConfigId(event.target.value)}
            placeholder="Paste configuration UUID"
            className="input mono"
          />
        </div>
        <div className="actions mt-4">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!trimmedConfigId || tablesQuery.isFetching}
            onClick={() => void tablesQuery.refetch()}
          >
            {tablesQuery.isFetching ? "Loading tables..." : "Load tables"}
          </button>
          {tablesQuery.data ? <span className="meta">{tablesQuery.data.length} tables</span> : null}
        </div>
        {tablesQuery.data ? (
          tablesQuery.data.length > 0 ? (
            <div className="do-table-buttons mt-4">
              {tablesQuery.data.map((table) => (
                <button
                  key={table}
                  type="button"
                  className={`btn btn-sm do-table-btn${selectedTable === table ? " selected" : ""}`}
                  onClick={() => selectTable(table)}
                >
                  {table}
                </button>
              ))}
            </div>
          ) : (
            <p className="meta mt-4">No tables found</p>
          )
        ) : null}
        {tablesQuery.error ? (
          <div className="admin-error mt-4">{tablesQuery.error.message}</div>
        ) : null}
      </section>

      <section className="card card-pad mt-6">
        <div className="field">
          <label htmlFor="do-sql">SQL</label>
          <textarea
            id="do-sql"
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            className="input mono do-sql"
          />
        </div>
        <div className="field mt-4">
          <label htmlFor="do-params">Params JSON array</label>
          <input
            id="do-params"
            value={paramsText}
            onChange={(event) => setParamsText(event.target.value)}
            className="input mono"
          />
        </div>
        <div className="actions mt-4">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!trimmedConfigId || isQuerying}
            onClick={() => void runQuery()}
          >
            {isQuerying ? "Running..." : "Run query"}
          </button>
        </div>
      </section>

      {hasQueryError ? (
        <section className="admin-error mt-6">
          {queryMutation.error instanceof Error ? queryMutation.error.message : "Query failed"}
        </section>
      ) : null}

      {isQuerying ? (
        <section className="mt-6">
          <LoadingSpinner />
        </section>
      ) : hasQueryResult ? (
        <section className="mt-6">
          {rows.length > 0 ? (
            <>
              <div className="do-results-summary">
                {queryMutation.data!.row_count} row{queryMutation.data!.row_count !== 1 ? "s" : ""}
                {queryMutation.data!.row_count >= TABLE_QUERY_LIMIT
                  ? ` (capped at ${TABLE_QUERY_LIMIT})`
                  : ""}
              </div>
              <div className="card dt-card">
                <div className="dt-toolbar">
                  <span className="count">{rows.length} rows</span>
                </div>
                <div className="dt-overflow">
                  <table className="dt do-results-table">
                    <thead>
                      <tr>
                        {columns.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {columns.map((col) => (
                            <td key={col}>{buildDoCell(row[col])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon="box"
              title="No rows returned"
              description="The query executed successfully but returned no data."
            />
          )}
        </section>
      ) : null}
    </>
  );
}
