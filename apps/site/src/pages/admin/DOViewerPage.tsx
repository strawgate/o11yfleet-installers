import { useEffect, useState } from "react";
import { useAdminDoQuery, useAdminDoTables } from "../../api/hooks/admin";
import { useToast } from "../../components/common/Toast";

const DEFAULT_SQL = `SELECT instance_uid, status, healthy, last_seen_at
FROM agents
ORDER BY last_seen_at DESC
LIMIT 50`;

export default function DOViewerPage() {
  const { toast } = useToast();
  const [configId, setConfigId] = useState("");
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [paramsText, setParamsText] = useState("[]");
  const trimmedConfigId = configId.trim();
  const tablesQuery = useAdminDoTables(trimmedConfigId);
  const queryMutation = useAdminDoQuery(trimmedConfigId);
  const { reset } = queryMutation;

  useEffect(() => {
    reset();
  }, [trimmedConfigId, sql, paramsText, reset]);

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
          <div className="do-table-list mt-4">
            {tablesQuery.data.length > 0 ? tablesQuery.data.join(", ") : "No tables found"}
          </div>
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
            disabled={!trimmedConfigId || queryMutation.isPending}
            onClick={() => void runQuery()}
          >
            {queryMutation.isPending ? "Running..." : "Run query"}
          </button>
        </div>
      </section>

      {queryMutation.isError ? (
        <section className="admin-error mt-6">
          {queryMutation.error instanceof Error ? queryMutation.error.message : "Query failed"}
        </section>
      ) : null}

      {queryMutation.data ? (
        <section className="card mt-6 do-results">
          <div className="do-results-head">Rows: {queryMutation.data.row_count}</div>
          <pre>{JSON.stringify(queryMutation.data.rows, null, 2)}</pre>
        </section>
      ) : null}
    </>
  );
}
