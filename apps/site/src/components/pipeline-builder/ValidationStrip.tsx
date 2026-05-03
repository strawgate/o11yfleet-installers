import type { BuilderValidation } from "@/pages/portal/useBuilderState";

export interface ValidationStripProps {
  validation: BuilderValidation;
  yamlPreviewError: string | null;
}

export function ValidationStrip({ validation, yamlPreviewError }: ValidationStripProps) {
  const hasErrors = yamlPreviewError !== null || validation.errors.length > 0;
  const hasWarnings = validation.warnings.length > 0;
  const noIssues = !hasErrors && !hasWarnings;

  return (
    <section className="card card-pad mt-6 pipe-validation-strip">
      <h3>Validation and rollout readiness</h3>
      <p className="meta mt-2">
        Graph checks run locally from the model. Collector runtime validation and rollout gates are
        separate backend contracts.
      </p>

      <div className="pipe-issues mt-4">
        {!validation.canSave ? (
          <div className="banner err mt-2">
            <div>
              <div className="b-title">Cannot save draft</div>
              <div className="b-body">Please resolve all errors before saving.</div>
            </div>
          </div>
        ) : null}

        {yamlPreviewError !== null ? (
          <div className="banner err mt-2">
            <div>
              <div className="b-title">YAML preview unavailable</div>
              <div className="b-body">{yamlPreviewError}</div>
            </div>
          </div>
        ) : null}

        {noIssues ? (
          <div className="banner ok">
            <div>
              <div className="b-title">No graph issues detected</div>
              <div className="b-body">Review the generated YAML before creating a version.</div>
            </div>
          </div>
        ) : null}

        {validation.errors.length > 0 ? (
          <details className="mt-2" open>
            <summary className="font-semibold text-sm cursor-pointer select-none">
              Errors ({validation.errors.length})
            </summary>
            {validation.errors.map((issue, index) => (
              <div key={`error-${index}-${issue.code}`} className="banner err mt-2">
                <div>
                  <div className="b-title">Error: {issue.code}</div>
                  <div className="b-body">{issue.message}</div>
                </div>
              </div>
            ))}
          </details>
        ) : null}

        {validation.warnings.length > 0 ? (
          <details className="mt-2" open>
            <summary className="font-semibold text-sm cursor-pointer select-none">
              Warnings ({validation.warnings.length})
            </summary>
            {validation.warnings.map((issue, index) => (
              <div key={`warning-${index}-${issue.code}`} className="banner warn mt-2">
                <div>
                  <div className="b-title">Warning: {issue.code}</div>
                  <div className="b-body">{issue.message}</div>
                </div>
              </div>
            ))}
          </details>
        ) : null}
      </div>
    </section>
  );
}
