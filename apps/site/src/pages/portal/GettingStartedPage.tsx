import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  useConfigurations,
  useCreateEnrollmentToken,
  useConfigurationStats,
} from "../../api/hooks/portal";
import { useToast } from "../../components/common/Toast";
import { CopyButton } from "../../components/common/CopyButton";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";

const INSTALL_SH = (token: string) =>
  `curl --proto '=https' --tlsv1.2 -fsSL https://o11yfleet-site.pages.dev/install.sh | bash -s -- --token ${token}`;

const INSTALL_PS1 = (token: string) =>
  `irm https://o11yfleet-site.pages.dev/install.ps1 -OutFile install.ps1; .\\install.ps1 -Token "${token}"`;

type Step = 1 | 2 | 3 | 4;

export default function GettingStartedPage() {
  const { data: configs, isLoading, error, refetch } = useConfigurations();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);
  const [selectedConfigId, setSelectedConfigId] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [installTab, setInstallTab] = useState<"quick" | "manual-ext" | "manual-sup">("quick");
  const [connected, setConnected] = useState(false);

  const tokenConfigId = selectedConfigId || "__none__";
  const createToken = useCreateEnrollmentToken(tokenConfigId);
  const stats = useConfigurationStats(step >= 4 ? selectedConfigId : undefined);

  // Auto-select first config
  useEffect(() => {
    if (configs && configs.length > 0 && !selectedConfigId) {
      setSelectedConfigId(configs[0]!.id);
    }
  }, [configs, selectedConfigId]);

  // Poll for agent connection in step 4
  useEffect(() => {
    if (step !== 4 || !stats.data) return;
    if ((stats.data.agents_connected ?? 0) > 0) {
      setConnected(true);
    }
  }, [step, stats.data]);

  const refetchStats = useCallback(() => {
    void stats.refetch();
  }, [stats]);

  useEffect(() => {
    if (step !== 4 || connected) return;
    const interval = setInterval(refetchStats, 5000);
    return () => clearInterval(interval);
  }, [step, connected, refetchStats]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const cfgList = configs ?? [];

  async function handleGenerateToken() {
    if (!selectedConfigId) return;
    try {
      const result = await createToken.mutateAsync({ name: "getting-started" });
      if (result.token) {
        setToken(result.token);
        setStep(3);
      }
    } catch (err) {
      toast(
        "Failed to generate token",
        err instanceof Error ? err.message : "Unknown error",
        "err",
      );
    }
  }

  return (
    <div className="main-narrow">
      <div className="page-head">
        <div>
          <h1>Getting started</h1>
          <p className="meta">
            First success means a collector enrolls, connects, and reports state. Generating a token
            is only the bootstrap step.
          </p>
        </div>
      </div>

      {/* Steps indicator */}
      <div className="steps mb-6">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className={`step${s < step ? " done" : ""}${s === step ? " active" : ""}`}>
            <span className="n">{s}</span>
            <span>
              {s === 1 && "Choose group"}
              {s === 2 && "Get token"}
              {s === 3 && "Install"}
              {s === 4 && "First success"}
            </span>
            {s < 4 && <span className="line" />}
          </div>
        ))}
      </div>

      {/* Step 1: Choose configuration */}
      {step === 1 && (
        <div className="card card-pad">
          <h3>Choose a configuration group</h3>
          <p className="meta mt-2">
            A configuration group is the assignment boundary. Collectors enrolled with its token
            should converge to the group&apos;s desired config.
          </p>
          {cfgList.length === 0 ? (
            <p className="meta mt-6">
              No configurations found. <Link to="/portal/configurations">Create one first.</Link>
            </p>
          ) : (
            <>
              <select
                className="select mt-6"
                value={selectedConfigId}
                onChange={(e) => setSelectedConfigId(e.target.value)}
              >
                {cfgList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary mt-6"
                onClick={() => setStep(2)}
                disabled={!selectedConfigId}
              >
                Continue
              </button>
            </>
          )}
        </div>
      )}

      {/* Step 2: Generate enrollment token */}
      {step === 2 && (
        <div className="card card-pad">
          <h3>Enrollment token</h3>
          <p className="meta mt-2">
            Generate a bootstrap token for first enrollment. After enrollment, the collector uses a
            scoped assignment claim for management traffic.
          </p>
          <button
            className="btn btn-primary mt-6"
            onClick={() => void handleGenerateToken()}
            disabled={createToken.isPending}
          >
            {createToken.isPending ? "Generating…" : "Generate token"}
          </button>
        </div>
      )}

      {/* Step 3: Install collector */}
      {step === 3 && (
        <div className="card card-pad">
          <h3>Install &amp; connect</h3>
          <p className="meta mt-2">
            Run one of the commands below to install the OpenTelemetry Collector on your host and
            point it at O11yFleet OpAMP management.
          </p>

          {token && (
            <div className="banner info mt-6">
              <div className="b-title">Your enrollment token</div>
              <div className="b-body">
                <div className="flex-row gap-sm mt-2">
                  <code className="mono-cell">{token}</code>
                  <CopyButton value={token} />
                </div>
              </div>
            </div>
          )}

          <div className="tabs mt-6">
            <button
              className={`tab${installTab === "quick" ? " active" : ""}`}
              onClick={() => setInstallTab("quick")}
            >
              Linux / macOS
            </button>
            <button
              className={`tab${installTab === "manual-ext" ? " active" : ""}`}
              onClick={() => setInstallTab("manual-ext")}
            >
              Windows
            </button>
            <button
              className={`tab${installTab === "manual-sup" ? " active" : ""}`}
              onClick={() => setInstallTab("manual-sup")}
            >
              Manual
            </button>
          </div>

          {installTab === "quick" && (
            <div className="mt-2">
              <pre className="code-block">{INSTALL_SH(token)}</pre>
              <CopyButton value={INSTALL_SH(token)} label="Copy command" />
            </div>
          )}

          {installTab === "manual-ext" && (
            <div className="mt-2">
              <pre className="code-block">{INSTALL_PS1(token)}</pre>
              <CopyButton value={INSTALL_PS1(token)} label="Copy command" />
            </div>
          )}

          {installTab === "manual-sup" && (
            <div className="mt-2">
              <pre className="code-block">
                {`# 1. Download the collector binary for your platform
# 2. Create the configuration file:
#    /etc/o11yfleet/config.yaml
#
# 3. Set the enrollment token:
#    export O11YFLEET_TOKEN="${token}"
#
# 4. Start the collector:
#    o11yfleet-collector --config /etc/o11yfleet/config.yaml`}
              </pre>
            </div>
          )}

          <button className="btn btn-primary mt-6" onClick={() => setStep(4)}>
            I&apos;ve installed the collector
          </button>
        </div>
      )}

      {/* Step 4: Verify connection */}
      {step === 4 && (
        <div className="card card-pad">
          <h3>Confirm first successful connection</h3>
          {connected ? (
            <>
              <div className="flex-row gap-sm mt-6">
                <span className="dot dot-ok" />
                <span>Collector connected and reporting.</span>
              </div>
              <div className="flex-row gap-sm mt-6">
                <Link to="/portal/overview" className="btn btn-primary">
                  Go to overview
                </Link>
                <Link to="/portal/agents" className="btn btn-secondary">
                  View agents
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="flex-row gap-sm mt-6">
                <span className="dot dot-warn dot-pulse" />
                <span className="meta">Waiting for first collector heartbeat…</span>
              </div>
              <p className="meta mt-2 text-sm">This page polls automatically every 5 seconds.</p>
              <div className="banner warn mt-6">
                <div>
                  <div className="b-title">No connection yet?</div>
                  <div className="b-body">
                    Check that the token was copied without quotes, the host can reach the OpAMP
                    endpoint, and the collector process is running.
                  </div>
                </div>
              </div>
              <Link to="/portal/overview" className="btn btn-ghost btn-sm mt-6">
                Skip — go to overview
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
