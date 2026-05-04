//! Shared OpAMP protobuf types
//!
//! This crate contains the prost-generated protobuf types used by both
//! the TypeScript WASM bindings (via wasm-pack) and the Rust worker.

mod proto {
    include!("opamp.proto.rs");
}

pub use proto::*;

// ─── Constants ─────────────────────────────────────────────────────────────

pub const DEFAULT_HEARTBEAT_INTERVAL_NS: u64 = 3_600_000_000_000; // 1 hour

// Server capabilities (OpAMP spec)
pub const CAP_ACCEPTS_STATUS: u64 = 0x01;
pub const CAP_OFFERS_REMOTE_CONFIG: u64 = 0x02;
pub const CAP_ACCEPTS_EFFECTIVE_CONFIG: u64 = 0x04;
pub const CAP_OFFERS_CONNECTION_SETTINGS: u64 = 0x20;

// Agent capabilities
pub const AGENT_CAP_ACCEPTS_REMOTE_CONFIG: u64 = 0x02;

// Flags
pub const FLAG_REPORT_FULL_STATE: u64 = 0x01;
pub const FLAG_REQUEST_INSTANCE_UID: u64 = 0x01;
