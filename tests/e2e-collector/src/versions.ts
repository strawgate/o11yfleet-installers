/**
 * OTel Collector version matrix for compatibility testing.
 *
 * Each entry defines a collector version and its expected OpAMP behavior.
 * The opamp-go library version determines wire format details and
 * which capabilities/fields the agent reports.
 */

export interface CollectorVersion {
  /** Collector release tag (e.g., "0.100.0") — used as Docker image tag */
  tag: string;
  /** opamp-go library version bundled in this release */
  opampGo: string;
  /** Whether this version supports ReportsHeartbeat capability */
  reportsHeartbeat: boolean;
  /** Whether this version sends ComponentHealth with status_time_unix_nano */
  hasStatusTime: boolean;
  /** Whether this version sends effective_config in first message */
  reportsEffectiveConfig: boolean;
  /** Whether this version sends CustomCapabilities */
  hasCustomCapabilities: boolean;
  /** Whether we expect the 0x00 data-type header byte in WS frames */
  hasDataTypeHeader: boolean;
  /** Minimum expected fields in agent_description.identifying_attributes */
  minIdentifyingAttrs: number;
  /** Whether ConnectionSettingsOffers is supported */
  acceptsConnectionSettings: boolean;
}

/**
 * Matrix of collector versions to test.
 *
 * We sample across opamp-go version boundaries to catch wire format
 * and behavioral changes. Every 10 minor versions plus latest.
 */
export const COLLECTOR_VERSIONS: CollectorVersion[] = [
  {
    tag: "0.100.0",
    opampGo: "v0.14.0",
    reportsHeartbeat: false,
    hasStatusTime: false,
    reportsEffectiveConfig: true,
    hasCustomCapabilities: false,
    hasDataTypeHeader: true,
    minIdentifyingAttrs: 1,
    acceptsConnectionSettings: false,
  },
  {
    tag: "0.110.0",
    opampGo: "v0.15.0",
    reportsHeartbeat: false,
    hasStatusTime: false,
    reportsEffectiveConfig: true,
    hasCustomCapabilities: false,
    hasDataTypeHeader: true,
    minIdentifyingAttrs: 1,
    acceptsConnectionSettings: false,
  },
  {
    tag: "0.120.0",
    opampGo: "v0.18.0",
    reportsHeartbeat: true,
    hasStatusTime: true,
    reportsEffectiveConfig: true,
    hasCustomCapabilities: true,
    hasDataTypeHeader: true,
    minIdentifyingAttrs: 2,
    acceptsConnectionSettings: true,
  },
  {
    tag: "0.130.0",
    opampGo: "v0.20.0",
    reportsHeartbeat: true,
    hasStatusTime: true,
    reportsEffectiveConfig: true,
    hasCustomCapabilities: true,
    hasDataTypeHeader: true,
    minIdentifyingAttrs: 2,
    acceptsConnectionSettings: true,
  },
  {
    tag: "0.140.0",
    opampGo: "v0.22.0",
    reportsHeartbeat: true,
    hasStatusTime: true,
    reportsEffectiveConfig: true,
    hasCustomCapabilities: true,
    hasDataTypeHeader: true,
    minIdentifyingAttrs: 2,
    acceptsConnectionSettings: true,
  },
  {
    tag: "0.151.0",
    opampGo: "v0.23.0",
    reportsHeartbeat: true,
    hasStatusTime: true,
    reportsEffectiveConfig: true,
    hasCustomCapabilities: true,
    hasDataTypeHeader: true,
    minIdentifyingAttrs: 2,
    acceptsConnectionSettings: true,
  },
];

/** Docker image base for otelcol-contrib */
export const COLLECTOR_IMAGE =
  "ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib";
