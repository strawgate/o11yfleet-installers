import { Link } from "react-router-dom";
import { CopyButton } from "../../components/common/CopyButton";
import { EmptyState } from "../../components/common/EmptyState";

const INSTALL_COMMAND = (token: string) =>
  `curl --proto '=https' --tlsv1.2 -fsSL https://o11yfleet.com/install.sh | bash -s -- --token ${token}`;

interface EnrollmentDialogBodyProps {
  enrollmentToken: string | null;
  enrollmentTokenError: string | null;
}

export function enrollmentTokenFailureMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string" &&
    (err as { message: string }).message.trim()
  ) {
    return (err as { message: string }).message;
  }
  return "Unknown error";
}

export function EnrollmentDialogBody({
  enrollmentToken,
  enrollmentTokenError,
}: EnrollmentDialogBodyProps) {
  if (enrollmentToken) {
    return (
      <div className="command-panel">
        <div className="banner info">
          <div>
            <div className="b-title">Enrollment token created</div>
            <div className="b-body">
              This token will not be shown again. Copy it now or use the install command below.
              <div className="flex-row gap-sm mt-2">
                <code className="mono-cell token-value">{enrollmentToken}</code>
                <CopyButton value={enrollmentToken} />
              </div>
            </div>
          </div>
        </div>
        <pre className="code-block code-block-wrap">{INSTALL_COMMAND(enrollmentToken)}</pre>
        <CopyButton value={INSTALL_COMMAND(enrollmentToken)} label="Copy command" />
        <Link to="/portal/getting-started" className="btn btn-ghost btn-sm">
          Open guided setup
        </Link>
      </div>
    );
  }

  return (
    <>
      {enrollmentTokenError ? (
        <div className="banner err mb-4" role="alert">
          <div>
            <div className="b-title">Could not create enrollment token</div>
            <div className="b-body">{enrollmentTokenError}</div>
          </div>
        </div>
      ) : null}
      <EmptyState
        icon="plug"
        title="Connect a collector"
        description="Create a one-time enrollment token for this configuration, then run the installer on the host you want to manage."
      />
    </>
  );
}
