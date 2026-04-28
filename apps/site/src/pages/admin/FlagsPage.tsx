import { useState } from "react";
import { PrototypeBanner } from "../../components/common/PrototypeBanner";

interface Flag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

const sampleFlags: Flag[] = [
  {
    id: "dark-mode",
    name: "Dark mode",
    description: "Enable dark mode theme toggle for all users",
    enabled: true,
  },
  {
    id: "beta-pipeline-builder",
    name: "Beta pipeline builder",
    description: "Show the new drag-and-drop pipeline builder UI",
    enabled: false,
  },
  {
    id: "analytics-engine",
    name: "Analytics engine",
    description: "Enable the real-time analytics dashboard",
    enabled: true,
  },
];

export default function FlagsPage() {
  const [flags, setFlags] = useState<Flag[]>(sampleFlags);

  function toggleFlag(id: string) {
    setFlags((prev) => prev.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f)));
  }

  return (
    <>
      <div className="page-head">
        <h1>Feature Flags</h1>
      </div>

      <PrototypeBanner message="Feature flags show sample data" />

      <div className="dt-card mt-6">
        <table className="dt">
          <thead>
            <tr>
              <th>Flag</th>
              <th>Description</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.id}>
                <td className="name mono-cell">{f.id}</td>
                <td className="meta">{f.description}</td>
                <td>
                  <span className={`tag tag-${f.enabled ? "ok" : "warn"}`}>
                    {f.enabled ? "enabled" : "disabled"}
                  </span>
                </td>
                <td style={{ width: 64 }}>
                  <button
                    className={`btn btn-sm ${f.enabled ? "btn-ghost" : "btn-primary"}`}
                    onClick={() => toggleFlag(f.id)}
                  >
                    {f.enabled ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
