import { useState } from "react";
import {
  useConfigurations,
  useCreateEnrollmentToken,
  useConfigStats,
} from "../../hooks/queries";
import { Button } from "../../components/ui/Button";
import { toast } from "../../components/ui/Toast";
import { clsx } from "clsx";
import { Link } from "react-router-dom";

type Step = "select" | "token" | "install" | "verify";

export function GettingStartedPage() {
  const { data: configs, isLoading } = useConfigurations();
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("select");

  const tokenMutation = useCreateEnrollmentToken(selectedConfigId ?? "");

  const selectedConfig = configs?.find((c) => c.id === selectedConfigId);

  async function handleGenerateToken() {
    if (!selectedConfigId) return;
    try {
      const result = await tokenMutation.mutateAsync({
        label: "getting-started",
      });
      setGeneratedToken(result.token);
      setStep("install");
    } catch {
      toast("Failed to generate token", undefined, "error");
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast("Copied to clipboard", undefined, "success");
  }

  const steps: { key: Step; label: string; num: number }[] = [
    { key: "select", label: "Select configuration", num: 1 },
    { key: "token", label: "Generate token", num: 2 },
    { key: "install", label: "Install collector", num: 3 },
    { key: "verify", label: "Verify connection", num: 4 },
  ];

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-semibold text-fg mb-6">Getting Started</h1>

      {/* Steps indicator */}
      <div className="flex gap-2 mb-8">
        {steps.map((s) => (
          <div
            key={s.key}
            className={clsx(
              "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs",
              step === s.key
                ? "bg-brand/10 text-brand font-medium"
                : "text-fg-4",
            )}
          >
            <span
              className={clsx(
                "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                step === s.key
                  ? "bg-brand text-gray-950"
                  : "bg-surface-2 text-fg-4",
              )}
            >
              {s.num}
            </span>
            {s.label}
          </div>
        ))}
      </div>

      {/* Step: Select configuration */}
      {step === "select" && (
        <div>
          <h2 className="text-sm font-semibold text-fg mb-3">
            Choose a configuration
          </h2>
          {isLoading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 rounded-lg bg-surface" />
              ))}
            </div>
          ) : configs?.length === 0 ? (
            <p className="text-sm text-fg-3">
              No configurations yet.{" "}
              <Link to="/portal/configurations" className="text-brand hover:underline">
                Create one first
              </Link>
              .
            </p>
          ) : (
            <div className="space-y-2">
              {configs?.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedConfigId(c.id);
                    setStep("token");
                  }}
                  className={clsx(
                    "w-full text-left rounded-lg border p-3 transition-colors",
                    selectedConfigId === c.id
                      ? "border-brand bg-brand/5"
                      : "border-line bg-surface hover:border-line-2",
                  )}
                >
                  <p className="text-sm font-medium text-fg">{c.name}</p>
                  <p className="text-xs text-fg-4 mt-0.5">
                    {c.environment ?? "No environment"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step: Generate token */}
      {step === "token" && (
        <div>
          <h2 className="text-sm font-semibold text-fg mb-3">
            Generate an enrollment token
          </h2>
          <p className="text-xs text-fg-3 mb-4">
            This token lets your collectors register with the{" "}
            <span className="font-medium text-fg">{selectedConfig?.name}</span>{" "}
            configuration.
          </p>
          <Button
            onClick={handleGenerateToken}
            disabled={tokenMutation.isPending}
          >
            {tokenMutation.isPending ? "Generating…" : "Generate Token"}
          </Button>
          <button
            onClick={() => setStep("select")}
            className="ml-3 text-xs text-fg-4 hover:text-fg"
          >
            Back
          </button>
        </div>
      )}

      {/* Step: Install */}
      {step === "install" && generatedToken && (
        <div>
          <h2 className="text-sm font-semibold text-fg mb-3">
            Install the collector
          </h2>
          <p className="text-xs text-fg-3 mb-4">
            Run this command on each host to install and enroll:
          </p>

          <div className="rounded-lg border border-line bg-surface p-4 font-mono text-xs text-fg relative">
            <button
              onClick={() =>
                copyToClipboard(
                  `FP_TOKEN="${generatedToken}" FP_ENDPOINT="${window.location.origin}" bash -c "$(curl -fsSL https://get.o11yfleet.com/install.sh)"`,
                )
              }
              className="absolute top-2 right-2 text-fg-4 hover:text-fg text-xs"
            >
              Copy
            </button>
            <pre className="whitespace-pre-wrap break-all">
              {`FP_TOKEN="${generatedToken}" \\
FP_ENDPOINT="${window.location.origin}" \\
bash -c "$(curl -fsSL https://get.o11yfleet.com/install.sh)"`}
            </pre>
          </div>

          <div className="mt-4 rounded-lg border border-line bg-surface p-4">
            <p className="text-xs text-fg-3 mb-2">Enrollment token:</p>
            <code className="text-xs font-mono text-fg break-all">
              {generatedToken}
            </code>
            <button
              onClick={() => copyToClipboard(generatedToken)}
              className="ml-2 text-xs text-fg-4 hover:text-fg"
            >
              Copy
            </button>
          </div>

          <Button className="mt-4" onClick={() => setStep("verify")}>
            I've installed the collector →
          </Button>
        </div>
      )}

      {/* Step: Verify */}
      {step === "verify" && selectedConfigId && (
        <VerifyStep configId={selectedConfigId} />
      )}
    </div>
  );
}

function VerifyStep({ configId }: { configId: string }) {
  const { data: stats } = useConfigStats(configId);

  return (
    <div>
      <h2 className="text-sm font-semibold text-fg mb-3">
        Waiting for agents…
      </h2>

      <div className="rounded-lg border border-line bg-surface p-6 text-center">
        {stats && stats.connected_agents > 0 ? (
          <>
            <span className="text-4xl">🎉</span>
            <p className="mt-3 text-sm font-semibold text-fg">
              {stats.connected_agents} agent
              {stats.connected_agents === 1 ? "" : "s"} connected!
            </p>
            <p className="mt-1 text-xs text-fg-3">
              Your fleet is reporting to O11yFleet.
            </p>
            <Link
              to={`/portal/configurations/${configId}`}
              className="inline-block mt-4"
            >
              <Button>View Configuration →</Button>
            </Link>
          </>
        ) : (
          <>
            <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <p className="mt-3 text-sm text-fg-3">
              Polling for connected agents…
            </p>
            <p className="mt-1 text-xs text-fg-4">
              This updates automatically every 10 seconds.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
