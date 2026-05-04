//! o11y-opamp-core: OpAMP protocol implementation in Rust
//!
//! This crate provides a WASM-compatible OpAMP protocol implementation
//! that can be used from both Rust (via native calls) and TypeScript
//! (via wasm-bindgen).

use js_sys::Object;
use prost::Message;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsValue;

// Re-export shared proto types
pub use o11y_opamp_proto::*;

// ─── Shared Memory Configuration ─────────────────────────────────────────────

// Maximum size for decoded data (128KB should cover most messages)
const MAX_DECODE_BUFFER_SIZE: usize = 128 * 1024;

// Static buffer for zero-copy decode - written by WASM, read by TS
// SAFETY: Single-threaded WASM, no concurrent access
static mut DECODE_BUFFER: [u8; MAX_DECODE_BUFFER_SIZE] = [0u8; MAX_DECODE_BUFFER_SIZE];

/// Zero-copy decode v2: single buffer return with pre-computed metadata.
///
/// Layout: [header(58 bytes), uid(...), host_name(...), service_name(...), metadata(...)]
///
/// Header (58 bytes):
///   [version(1), reserved(3)]              = 4 bytes  [0-3]
///   [uid_off(4), uid_len(4)]              = 8 bytes  [4-11]
///   [meta_off(4), meta_len(4)]            = 8 bytes  [12-19]
///   [seq_num(8)]                          = 8 bytes  [20-27]
///   [capabilities_raw(8)]                 = 8 bytes  [28-35]
///   [flags(8)]                            = 8 bytes  [36-43]
///   [opt_flags(2), caps_parsed(2), msg_flags(2), host_off(2), host_len(2), svc_off(2), svc_len(2)] = 14 bytes [44-57]
///
/// Pre-computed values (all in header):
///   opt_flags:    bitmask of optional fields present
///   caps_parsed:  parsed capability flags (bitmask)
///   msg_flags:    is_enrollment, is_pure_heartbeat, is_disconnect, is_health_report
///   routing_key:  first 8 bytes of instance_uid (for consistent hashing/sharding)
///   host_name:    extracted from agent_description["host.name"]
///   service_name: extracted from agent_description["service.name"]
///
/// Only 1 FFI crossing (the Uint8Array return).
#[wasm_bindgen]
pub fn decode_agent_to_server_zero_copy(data: &[u8]) -> Result<js_sys::Uint8Array, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    // Pre-compute capability flags (bitmask for easy TS checks)
    let caps = msg.capabilities;
    let caps_parsed: u16 = (if (caps & 0x001) != 0 { 1 } else { 0 })
        | (if (caps & 0x002) != 0 { 2 } else { 0 })
        | (if (caps & 0x004) != 0 { 4 } else { 0 })
        | (if (caps & 0x008) != 0 { 8 } else { 0 })
        | (if (caps & 0x010) != 0 { 16 } else { 0 })
        | (if (caps & 0x020) != 0 { 32 } else { 0 })
        | (if (caps & 0x040) != 0 { 64 } else { 0 })
        | (if (caps & 0x080) != 0 { 128 } else { 0 })
        | (if (caps & 0x100) != 0 { 256 } else { 0 })
        | (if (caps & 0x200) != 0 { 512 } else { 0 });

    // Pre-compute optional field flags
    let has_description = msg.agent_description.is_some();
    let has_health = msg.health.is_some();
    let has_config = msg.effective_config.is_some();
    let has_status = msg.remote_config_status.is_some();
    let has_disconnect = msg.agent_disconnect.is_some();
    let has_components = msg.available_components.is_some();
    let has_conn_settings = msg.connection_settings_status.is_some();

    let opt_flags: u16 = has_description as u16
        | (has_health as u16) << 1
        | (has_config as u16) << 2
        | (has_status as u16) << 3
        | (has_disconnect as u16) << 4
        | (has_components as u16) << 5
        | (has_conn_settings as u16) << 6;

    // Pre-compute message type flags
    let is_enrollment = msg.sequence_num == 0 && has_description;
    let is_pure_heartbeat = !has_description
        && !has_health
        && !has_config
        && !has_status
        && !has_disconnect
        && !has_components
        && !has_conn_settings
        && msg.sequence_num > 0;
    let is_disconnect = has_disconnect;
    let is_health_report = has_health;

    let msg_flags: u16 = (is_enrollment as u16)
        | (is_pure_heartbeat as u16) << 1
        | (is_disconnect as u16) << 2
        | (is_health_report as u16) << 3;

    // Extract host_name and service_name from agent_description
    let mut host_name = String::new();
    let mut service_name = String::new();

    if let Some(ref desc) = msg.agent_description {
        for kv in desc
            .identifying_attributes
            .iter()
            .chain(desc.non_identifying_attributes.iter())
        {
            if kv.key == "host.name" {
                if let Some(ref v) = kv.value {
                    if let Some(any_value::Value::StringValue(s)) = &v.value {
                        host_name = s.clone();
                    }
                }
            } else if kv.key == "service.name" {
                if let Some(ref v) = kv.value {
                    if let Some(any_value::Value::StringValue(s)) = &v.value {
                        service_name = s.clone();
                    }
                }
            }
        }
    }

    // Safety: single-threaded WASM, no concurrent access
    unsafe {
        let ptr = DECODE_BUFFER.as_mut_ptr();
        let buf = std::slice::from_raw_parts_mut(ptr, MAX_DECODE_BUFFER_SIZE);

        // Header is 58 bytes: 44 fixed bytes + 14 extended bytes
        let header_size = 58;
        let mut offset = header_size;

        // Write uid
        let uid_len = msg.instance_uid.len();
        buf[offset..offset + uid_len].copy_from_slice(&msg.instance_uid);
        let uid_offset = offset;
        offset += uid_len;

        // Write host_name
        buf[offset..offset + host_name.len()].copy_from_slice(host_name.as_bytes());
        let host_offset = offset;
        let host_len = host_name.len();
        offset += host_len;

        // Write service_name
        buf[offset..offset + service_name.len()].copy_from_slice(service_name.as_bytes());
        let svc_offset = offset;
        let svc_len = service_name.len();
        offset += svc_len;

        // Pad to 8-byte alignment
        let pad = (8 - ((offset - header_size) % 8)) % 8;
        offset += pad;

        // Write JSON metadata
        let metadata = build_metadata_json(&msg);
        let meta_len = metadata.len();
        if offset + meta_len > MAX_DECODE_BUFFER_SIZE {
            return Err(JsValue::NULL); // Buffer overflow
        }
        buf[offset..offset + meta_len].copy_from_slice(metadata.as_bytes());
        let meta_offset = offset;

        let total_len = offset + meta_len;

        // Write header
        let mut h = 0;

        // version(1) + reserved(3) = 4 bytes
        buf[h] = 2; // version 2
        h += 4;

        // uid_offset(4) + uid_len(4) = 8 bytes
        buf[h..h + 4].copy_from_slice(&(uid_offset as u32).to_be_bytes());
        buf[h + 4..h + 8].copy_from_slice(&(uid_len as u32).to_be_bytes());
        h += 8;

        // meta_offset(4) + meta_len(4) = 8 bytes
        buf[h..h + 4].copy_from_slice(&(meta_offset as u32).to_be_bytes());
        buf[h + 4..h + 8].copy_from_slice(&(meta_len as u32).to_be_bytes());
        h += 8;

        // seq_num(8)
        buf[h..h + 8].copy_from_slice(&msg.sequence_num.to_be_bytes());
        h += 8;

        // capabilities_raw(8)
        buf[h..h + 8].copy_from_slice(&msg.capabilities.to_be_bytes());
        h += 8;

        // flags(8)
        buf[h..h + 8].copy_from_slice(&msg.flags.to_be_bytes());
        h += 8;

        // Extended header fields (14 bytes)
        // opt_flags(2) + caps_parsed(2) + msg_flags(2) + host_off(2) + host_len(2) + svc_off(2) + svc_len(2)
        buf[h..h + 2].copy_from_slice(&opt_flags.to_be_bytes());
        buf[h + 2..h + 4].copy_from_slice(&caps_parsed.to_be_bytes());
        buf[h + 4..h + 6].copy_from_slice(&msg_flags.to_be_bytes());
        buf[h + 6..h + 8].copy_from_slice(&(host_offset as u16).to_be_bytes());
        buf[h + 8..h + 10].copy_from_slice(&(host_len as u16).to_be_bytes());
        buf[h + 10..h + 12].copy_from_slice(&(svc_offset as u16).to_be_bytes());
        buf[h + 12..h + 14].copy_from_slice(&(svc_len as u16).to_be_bytes());

        // Return buffer
        let result = js_sys::Uint8Array::new_with_length(total_len as u32);
        result.copy_from(&buf[..total_len]);

        Ok(result)
    }
}

/// Get the WASM memory buffer for zero-copy access.
/// Returns ArrayBuffer that TS can use to create Uint8Array views.
#[wasm_bindgen(skip_typescript)]
pub fn get_wasm_memory_buffer() -> js_sys::ArrayBuffer {
    // This returns the underlying ArrayBuffer of WASM linear memory
    // Zero-copy: TS creates Uint8Array view of same underlying memory
    let mem: js_sys::WebAssembly::Memory = wasm_bindgen::memory().dyn_into().unwrap();
    mem.buffer().dyn_into().unwrap()
}

// ─── Error Types ─────────────────────────────────────────────────────────

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

// ─── WASM Exports ───────────────────────────────────────────────────────────

/// Initialize the WASM module
#[wasm_bindgen(start)]
pub fn init() {
    log("o11y-opamp-core initialized");
}

/// Encode ServerToAgent to protobuf bytes with 0x00 header (opamp-go format)
#[wasm_bindgen]
pub fn encode_server_to_agent(
    instance_uid: Vec<u8>,
    flags: u64,
    capabilities: u64,
    heartbeat_ns: u64,
) -> Vec<u8> {
    let response = ServerToAgent {
        instance_uid,
        flags,
        capabilities,
        heart_beat_interval: heartbeat_ns,
        error_response: None,
        remote_config: None,
        agent_identification: None,
        connection_settings: None,
        command: None,
    };

    let payload = response.encode_to_vec();
    let mut result = Vec::with_capacity(1 + payload.len());
    result.push(0x00); // opamp-go varint header
    result.extend_from_slice(&payload);
    result
}

/// Check if a message is a pure heartbeat (no state changes).
/// This is the hot path - used to decide if we can skip most processing.
#[wasm_bindgen]
pub fn is_pure_heartbeat(data: &[u8]) -> bool {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return false,
    };

    msg.health.is_none()
        && msg.agent_description.is_none()
        && msg.effective_config.is_none()
        && msg.remote_config_status.is_none()
        && msg.agent_disconnect.is_none()
        && msg.flags == 0
        && msg.sequence_num > 0
}

/// Strip opamp-go varint header if present
fn strip_header(data: &[u8]) -> &[u8] {
    if !data.is_empty() && data[0] == 0x00 {
        &data[1..]
    } else {
        data
    }
}

/// Decode AgentToServer from protobuf bytes.
/// Returns a tuple [instance_uid, sequence_num, capabilities, flags] for the hot path.
/// Falls back to full object construction only when optional fields are present.
#[wasm_bindgen]
pub fn decode_agent_to_server_fast(data: &[u8]) -> Result<js_sys::Array, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    // Check if we have any optional fields
    let has_optional = msg.agent_description.is_some()
        || msg.health.is_some()
        || msg.effective_config.is_some()
        || msg.remote_config_status.is_some()
        || msg.agent_disconnect.is_some()
        || msg.available_components.is_some()
        || msg.connection_settings_status.is_some();

    if !has_optional {
        // Hot path: return flat array [uid, seq, caps, flags]
        let arr = js_sys::Array::new();
        arr.push(&obj_to_uint8array(&msg.instance_uid).into());
        arr.push(&JsValue::from(msg.sequence_num));
        arr.push(&JsValue::from(msg.capabilities));
        arr.push(&JsValue::from(msg.flags));
        return Ok(arr);
    }

    // Slow path: build full object
    let obj = Object::new();
    set_property(
        &obj,
        "instance_uid",
        JsValue::from(obj_to_uint8array(&msg.instance_uid)),
    );
    set_property(&obj, "sequence_num", JsValue::from(msg.sequence_num));
    set_property(&obj, "capabilities", JsValue::from(msg.capabilities));
    set_property(&obj, "flags", JsValue::from(msg.flags));

    if let Some(ref desc) = msg.agent_description {
        set_property(&obj, "agent_description", build_agent_description(desc));
    }

    if let Some(ref health) = msg.health {
        set_property(&obj, "health", build_component_health(health));
    }

    if let Some(ref config) = msg.effective_config {
        set_property(&obj, "effective_config", build_effective_config(config));
    }

    if let Some(ref status) = msg.remote_config_status {
        set_property(
            &obj,
            "remote_config_status",
            build_remote_config_status(status),
        );
    }

    if msg.agent_disconnect.is_some() {
        set_property(&obj, "agent_disconnect", JsValue::TRUE);
    }

    if let Some(ref components) = msg.available_components {
        if let Ok(json) = serde_json::to_string(components) {
            if let Ok(parsed) = js_sys::JSON::parse(&json) {
                set_property(&obj, "available_components", parsed);
            }
        }
    }

    if let Some(ref conn_status) = msg.connection_settings_status {
        if let Ok(json) = serde_json::to_string(conn_status) {
            if let Ok(parsed) = js_sys::JSON::parse(&json) {
                set_property(&obj, "connection_settings_status", parsed);
            }
        }
    }

    // Return object wrapped in array with flag indicating it's full object
    let arr = js_sys::Array::new();
    arr.push(&JsValue::from(obj));
    arr.push(&JsValue::TRUE); // second element indicates full object
    Ok(arr)
}

/// Legacy decode - delegates to fast version
#[wasm_bindgen]
pub fn decode_agent_to_server(data: &[u8]) -> JsValue {
    match decode_agent_to_server_fast(data) {
        Ok(arr) => JsValue::from(arr),
        Err(e) => e,
    }
}

/// Decode AgentToServer and serialize to JSON string.
/// This returns a string that should be parsed with JSON.parse() in JS.
/// JSON.parse is highly optimized in V8 and may be faster than
/// building objects piece by piece in WASM.
#[wasm_bindgen]
pub fn decode_agent_to_server_json(data: &[u8]) -> Result<String, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    // Serialize to JSON
    match serde_json::to_string(&msg) {
        Ok(json) => Ok(json),
        Err(_) => Err(JsValue::NULL),
    }
}

/// Decode AgentToServer and return a flat array of fields for the slow path.
/// Returns [instance_uid, sequence_num, capabilities, flags, json_metadata]
/// where json_metadata is a JSON string containing the optional fields.
/// This allows the hot path to be fast while still supporting full decode.
#[wasm_bindgen]
pub fn decode_agent_to_server_hybrid(data: &[u8]) -> Result<js_sys::Array, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    let arr = js_sys::Array::new();

    // Core fields (always present)
    arr.push(&obj_to_uint8array(&msg.instance_uid).into());
    arr.push(&JsValue::from(msg.sequence_num));
    arr.push(&JsValue::from(msg.capabilities));
    arr.push(&JsValue::from(msg.flags));

    // Build metadata JSON for optional fields
    let metadata = build_metadata_json(&msg);
    arr.push(&JsValue::from(metadata));

    Ok(arr)
}

/// Decode AgentToServer and return full JSON string.
/// Returns the complete message as JSON for maximum WASM throughput.
/// JS should use JSON.parse() to get the object.
#[wasm_bindgen]
pub fn decode_agent_to_server_json_full(data: &[u8]) -> Result<String, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    match serde_json::to_string(&msg) {
        Ok(json) => Ok(json),
        Err(_) => Err(JsValue::NULL),
    }
}

/// Decode AgentToServer and return pre-parsed JS object.
/// Uses js_sys::JSON::parse to parse JSON inside WASM, returning a JS object directly.
/// This avoids JSON.parse() call in JS but may have different performance characteristics.
#[wasm_bindgen]
pub fn decode_agent_to_server_parsed(data: &[u8]) -> Result<JsValue, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    // Build full JSON string
    let json = match serde_json::to_string(&msg) {
        Ok(j) => j,
        Err(_) => return Err(JsValue::NULL),
    };

    // Parse JSON to JS object using js_sys
    match js_sys::JSON::parse(&json) {
        Ok(obj) => Ok(obj),
        Err(_) => Err(JsValue::NULL),
    }
}

/// Decode AgentToServer and return a flat object with all fields.
/// Combines core fields directly with optional fields parsed from JSON.
/// Returns {instance_uid, sequence_num, capabilities, flags, ...optional_fields}
#[wasm_bindgen]
pub fn decode_agent_to_server_flat(data: &[u8]) -> Result<JsValue, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    // Build the object directly using Object.assign-like pattern
    let obj = Object::new();

    // Core fields
    set_property(
        &obj,
        "instance_uid",
        JsValue::from(obj_to_uint8array(&msg.instance_uid)),
    );
    set_property(&obj, "sequence_num", JsValue::from(msg.sequence_num));
    set_property(&obj, "capabilities", JsValue::from(msg.capabilities));
    set_property(&obj, "flags", JsValue::from(msg.flags));

    // Optional fields as parsed JSON
    if let Some(ref desc) = msg.agent_description {
        if !desc.identifying_attributes.is_empty() || !desc.non_identifying_attributes.is_empty() {
            let json = serde_json::to_string(desc).unwrap_or_default();
            if let Ok(parsed) = js_sys::JSON::parse(&json) {
                set_property(&obj, "agent_description", parsed);
            }
        }
    }

    if let Some(ref health) = msg.health {
        if health.healthy || health.start_time_unix_nano != 0 || !health.last_error.is_empty() {
            let json = serde_json::to_string(health).unwrap_or_default();
            if let Ok(parsed) = js_sys::JSON::parse(&json) {
                set_property(&obj, "health", parsed);
            }
        }
    }

    if let Some(ref config) = msg.effective_config {
        if config.config_map.is_some() {
            let json = serde_json::to_string(config).unwrap_or_default();
            if let Ok(parsed) = js_sys::JSON::parse(&json) {
                set_property(&obj, "effective_config", parsed);
            }
        }
    }

    if let Some(ref status) = msg.remote_config_status {
        if !status.last_remote_config_hash.is_empty() || status.status != 0 {
            let json = serde_json::to_string(status).unwrap_or_default();
            if let Ok(parsed) = js_sys::JSON::parse(&json) {
                set_property(&obj, "remote_config_status", parsed);
            }
        }
    }

    Ok(obj.into())
}

/// Minimal decode: returns only essential fields for hot path.
/// Returns array: [instance_uid, sequence_num, capabilities, flags, optional_flags]
/// optional_flags is a bitmask: bit 0=agent_description, bit 1=health, bit 2=config, bit 3=status
/// This avoids all JSON serialization overhead.
#[wasm_bindgen]
pub fn decode_agent_to_server_minimal(data: &[u8]) -> Result<js_sys::Array, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    let arr = js_sys::Array::new();

    // Core fields
    arr.push(&obj_to_uint8array(&msg.instance_uid).into());
    arr.push(&JsValue::from(msg.sequence_num));
    arr.push(&JsValue::from(msg.capabilities));
    arr.push(&JsValue::from(msg.flags));

    // Flags for optional field presence (bitmask)
    // bit 0=agent_description, bit 1=health, bit 2=config, bit 3=status, bit 4=disconnect, bit 5=components, bit 6=conn_settings
    let mut flags = 0u32;
    if msg.agent_description.is_some() {
        flags |= 1;
    }
    if msg.health.is_some() {
        flags |= 2;
    }
    if msg.effective_config.is_some() {
        flags |= 4;
    }
    if msg.remote_config_status.is_some() {
        flags |= 8;
    }
    if msg.agent_disconnect.is_some() {
        flags |= 16;
    }
    if msg.available_components.is_some() {
        flags |= 32;
    }
    if msg.connection_settings_status.is_some() {
        flags |= 64;
    }
    arr.push(&JsValue::from(flags));

    Ok(arr)
}

/// Packed decode v3: Returns raw typed arrays with minimal FFI overhead.
/// Returns array: [instance_uid, metadata_packed]
/// metadata_packed is a Uint8Array containing: [seq_num(8), caps(8), flags(8), opt_flags(4)] = 28 bytes
/// This minimizes js_sys overhead by returning only 2 values.
#[wasm_bindgen]
pub fn decode_agent_to_server_packed(data: &[u8]) -> Result<js_sys::Array, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    // Pack metadata into 28 bytes: seq_num(8) + caps(8) + flags(8) + opt_flags(4) = 28
    let mut metadata = [0u8; 28];

    // Write seq_num as big-endian i64
    metadata[0..8].copy_from_slice(&msg.sequence_num.to_be_bytes());

    // Write capabilities as big-endian u64
    metadata[8..16].copy_from_slice(&msg.capabilities.to_be_bytes());

    // Write flags as big-endian u64
    metadata[16..24].copy_from_slice(&msg.flags.to_be_bytes());

    // Write optional flags as big-endian u32
    let mut opt_flags = 0u32;
    if msg.agent_description.is_some() {
        opt_flags |= 1;
    }
    if msg.health.is_some() {
        opt_flags |= 2;
    }
    if msg.effective_config.is_some() {
        opt_flags |= 4;
    }
    if msg.remote_config_status.is_some() {
        opt_flags |= 8;
    }
    if msg.agent_disconnect.is_some() {
        opt_flags |= 16;
    }
    if msg.available_components.is_some() {
        opt_flags |= 32;
    }
    if msg.connection_settings_status.is_some() {
        opt_flags |= 64;
    }
    metadata[24..28].copy_from_slice(&opt_flags.to_be_bytes());

    let arr = js_sys::Array::new();
    arr.push(&obj_to_uint8array(&msg.instance_uid).into());
    arr.push(&obj_to_uint8array(&metadata).into());
    Ok(arr)
}

/// Single-buffer decode: returns everything as one ArrayBuffer.
/// Layout: [uid_len(2), uid(n), seq_num(8), caps(8), flags(8), opt_flags(4)] = 22+n bytes
/// This returns a SINGLE value, completely avoiding js_sys::Array overhead.
#[wasm_bindgen]
pub fn decode_agent_to_server_single(data: &[u8]) -> Result<js_sys::Uint8Array, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    let uid_len = msg.instance_uid.len();
    // Total: 2 (uid_len) + uid_len + 8 + 8 + 8 + 4 = 30 + uid_len
    let total_len = 2 + uid_len + 8 + 8 + 8 + 4;
    let mut result = Vec::with_capacity(total_len);

    // Write uid_len as big-endian u16
    result.extend_from_slice(&(uid_len as u16).to_be_bytes());

    // Write uid
    result.extend_from_slice(&msg.instance_uid);

    // Write seq_num as big-endian i64
    result.extend_from_slice(&msg.sequence_num.to_be_bytes());

    // Write capabilities as big-endian u64
    result.extend_from_slice(&msg.capabilities.to_be_bytes());

    // Write flags as big-endian u64
    result.extend_from_slice(&msg.flags.to_be_bytes());

    // Write optional flags as big-endian u32
    let mut opt_flags = 0u32;
    if msg.agent_description.is_some() {
        opt_flags |= 1;
    }
    if msg.health.is_some() {
        opt_flags |= 2;
    }
    if msg.effective_config.is_some() {
        opt_flags |= 4;
    }
    if msg.remote_config_status.is_some() {
        opt_flags |= 8;
    }
    if msg.agent_disconnect.is_some() {
        opt_flags |= 16;
    }
    if msg.available_components.is_some() {
        opt_flags |= 32;
    }
    if msg.connection_settings_status.is_some() {
        opt_flags |= 64;
    }
    result.extend_from_slice(&opt_flags.to_be_bytes());

    Ok(obj_to_uint8array(&result))
}

/// Hybrid decode v2: Core fields + flags + optional metadata.
/// Returns [instance_uid, seq_num, caps, flags, optional_flags, optional_json]
/// The optional_json contains ONLY the optional fields as JSON.
/// This splits the work between WASM (decode + flags) and JS (parse metadata).
#[wasm_bindgen]
pub fn decode_agent_to_server_hybrid_v2(data: &[u8]) -> Result<js_sys::Array, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    let arr = js_sys::Array::new();

    // Core fields
    arr.push(&obj_to_uint8array(&msg.instance_uid).into());
    arr.push(&JsValue::from(msg.sequence_num));
    arr.push(&JsValue::from(msg.capabilities));
    arr.push(&JsValue::from(msg.flags));

    // Build optional flags
    let mut optional_flags = 0u32;
    if msg.agent_description.is_some() {
        optional_flags |= 1;
    }
    if msg.health.is_some() {
        optional_flags |= 2;
    }
    if msg.effective_config.is_some() {
        optional_flags |= 4;
    }
    if msg.remote_config_status.is_some() {
        optional_flags |= 8;
    }
    if msg.agent_disconnect.is_some() {
        optional_flags |= 16;
    }
    if msg.available_components.is_some() {
        optional_flags |= 32;
    }
    if msg.connection_settings_status.is_some() {
        optional_flags |= 64;
    }
    arr.push(&JsValue::from(optional_flags));

    // Build optional JSON
    let metadata = build_metadata_json(&msg);
    arr.push(&JsValue::from(metadata));

    Ok(arr)
}

/// Decode and return a combined buffer approach.
/// Returns [header_bytes, optional_json]
/// header_bytes contains: [uid_len(2), uid(16), seq_num(8), caps(8), flags(8), opt_flags(4)] = 46 bytes
/// This minimizes FFI overhead by returning only 2 values.
#[wasm_bindgen]
pub fn decode_agent_to_server_combined(data: &[u8]) -> Result<js_sys::Array, JsValue> {
    let payload = strip_header(data);

    let msg = match AgentToServer::decode(payload) {
        Ok(m) => m,
        Err(_) => return Err(JsValue::NULL),
    };

    // Calculate header size: 2 (uid_len) + uid_len + 8 + 8 + 8 + 4 = 30 + uid_len
    let uid_len = msg.instance_uid.len() as u16;
    let header_size = 2 + uid_len as usize + 8 + 8 + 8 + 4;
    let metadata = build_metadata_json(&msg);

    // Pre-allocate combined buffer
    let mut combined = Vec::with_capacity(header_size + metadata.len());

    // Write header
    combined.extend_from_slice(&uid_len.to_be_bytes());
    combined.extend_from_slice(&msg.instance_uid);
    combined.extend_from_slice(&msg.sequence_num.to_be_bytes());
    combined.extend_from_slice(&msg.capabilities.to_be_bytes());
    combined.extend_from_slice(&msg.flags.to_be_bytes());

    // Build optional flags
    let mut optional_flags = 0u32;
    if msg.agent_description.is_some() {
        optional_flags |= 1;
    }
    if msg.health.is_some() {
        optional_flags |= 2;
    }
    if msg.effective_config.is_some() {
        optional_flags |= 4;
    }
    if msg.remote_config_status.is_some() {
        optional_flags |= 8;
    }
    combined.extend_from_slice(&optional_flags.to_be_bytes());

    // Return header + metadata as separate values
    let arr = js_sys::Array::new();
    arr.push(&JsValue::from(obj_to_uint8array(&combined)));
    arr.push(&JsValue::from(metadata));

    Ok(arr)
}

/// Build JSON string for optional fields only
fn build_metadata_json(msg: &AgentToServer) -> String {
    // Pre-calculate capacity to avoid reallocations
    let mut cap = 2; // "{}"
    cap += estimate_agent_description_size(&msg.agent_description);
    cap += estimate_health_size(&msg.health);
    cap += estimate_effective_config_size(&msg.effective_config);
    cap += estimate_remote_config_status_size(&msg.remote_config_status);
    if msg.agent_disconnect.is_some() {
        cap += 20;
    }
    if msg.available_components.is_some() {
        cap += 500;
    }
    if msg.connection_settings_status.is_some() {
        cap += 100;
    }

    let mut s = String::with_capacity(cap);
    s.push('{');

    let mut first = true;

    if let Some(ref desc) = msg.agent_description {
        if !first {
            s.push(',');
        }
        first = false;
        s.push_str("\"agent_description\":");
        append_agent_description(&mut s, desc);
    }

    if let Some(ref health) = msg.health {
        if !first {
            s.push(',');
        }
        first = false;
        s.push_str("\"health\":");
        append_health(&mut s, health);
    }

    if let Some(ref config) = msg.effective_config {
        if !first {
            s.push(',');
        }
        first = false;
        s.push_str("\"effective_config\":");
        append_effective_config(&mut s, config);
    }

    if let Some(ref status) = msg.remote_config_status {
        if !first {
            s.push(',');
        }
        first = false;
        s.push_str("\"remote_config_status\":");
        append_remote_config_status(&mut s, status);
    }

    if msg.agent_disconnect.is_some() {
        if !first {
            s.push(',');
        }
        first = false;
        s.push_str("\"agent_disconnect\":{}");
    }

    if let Some(ref components) = msg.available_components {
        if !first {
            s.push(',');
        }
        first = false;
        s.push_str("\"available_components\":");
        append_available_components(&mut s, components);
    }

    if let Some(ref conn_status) = msg.connection_settings_status {
        if !first {
            s.push(',');
        }
        first = false;
        s.push_str("\"connection_settings_status\":");
        append_connection_settings_status(&mut s, conn_status);
    }

    s.push('}');
    s
}

// Estimate size helpers
fn estimate_agent_description_size(desc: &Option<AgentDescription>) -> usize {
    match desc {
        Some(d) => {
            30 + d.identifying_attributes.len() * 60 + d.non_identifying_attributes.len() * 40
        }
        None => 0,
    }
}

fn estimate_health_size(health: &Option<ComponentHealth>) -> usize {
    match health {
        Some(_) => 100,
        None => 0,
    }
}

fn estimate_effective_config_size(config: &Option<EffectiveConfig>) -> usize {
    match config {
        Some(_) => 200,
        None => 0,
    }
}

fn estimate_remote_config_status_size(status: &Option<RemoteConfigStatus>) -> usize {
    match status {
        Some(_) => 80,
        None => 0,
    }
}

// Append helpers - build JSON without serde
fn append_agent_description(s: &mut String, desc: &AgentDescription) {
    s.push_str("{\"identifying_attributes\":[");
    let mut first_attr = true;
    for kv in &desc.identifying_attributes {
        if !first_attr {
            s.push(',');
        }
        first_attr = false;
        append_key_value(s, kv);
    }
    s.push_str("],\"non_identifying_attributes\":[");
    first_attr = true;
    for kv in &desc.non_identifying_attributes {
        if !first_attr {
            s.push(',');
        }
        first_attr = false;
        append_key_value(s, kv);
    }
    s.push_str("]}"); // Close non_identifying_attributes array and agent_description object
}

fn append_key_value(s: &mut String, kv: &KeyValue) {
    s.push_str("{\"key\":\"");
    escape_json_string(s, &kv.key);
    s.push_str("\",\"value\":");
    if let Some(ref v) = kv.value {
        append_any_value(s, v);
    } else {
        s.push_str("null");
    }
    s.push('}');
}

fn append_any_value(s: &mut String, value: &AnyValue) {
    if let Some(ref v) = &value.value {
        match v {
            any_value::Value::StringValue(str) => {
                s.push_str("{\"string_value\":\"");
                escape_json_string(s, str);
                s.push_str("\"}");
            }
            any_value::Value::BoolValue(b) => {
                s.push_str("{\"bool_value\":");
                s.push_str(if *b { "true" } else { "false" });
                s.push('}');
            }
            any_value::Value::IntValue(i) => {
                s.push_str("{\"int_value\":");
                s.push_str(&i.to_string());
                s.push('}');
            }
            any_value::Value::DoubleValue(d) => {
                s.push_str("{\"double_value\":");
                s.push_str(&d.to_string());
                s.push('}');
            }
            any_value::Value::ArrayValue(arr) => {
                s.push_str("{\"array_value\":{\"values\":[");
                let mut first = true;
                for item in &arr.values {
                    if !first {
                        s.push(',');
                    }
                    first = false;
                    append_any_value(s, item);
                }
                s.push_str("]}}");
            }
            any_value::Value::KvlistValue(kvl) => {
                s.push_str("{\"kvlist_value\":{\"values\":[");
                let mut first = true;
                for kv in &kvl.values {
                    if !first {
                        s.push(',');
                    }
                    first = false;
                    append_key_value(s, kv);
                }
                s.push_str("]}}");
            }
            any_value::Value::BytesValue(b) => {
                s.push_str("{\"bytes_value\":\"");
                s.push_str(&base64_encode(b));
                s.push_str("\"}");
            }
        }
    } else {
        s.push_str("null");
    }
}

fn append_health(s: &mut String, health: &ComponentHealth) {
    s.push_str("{\"healthy\":");
    s.push_str(if health.healthy { "true" } else { "false" });
    if health.start_time_unix_nano != 0 {
        s.push_str(",\"start_time_unix_nano\":");
        s.push_str(&health.start_time_unix_nano.to_string());
    }
    if !health.last_error.is_empty() {
        s.push_str(",\"last_error\":\"");
        escape_json_string(s, &health.last_error);
        s.push('"');
    }
    if !health.status.is_empty() {
        s.push_str(",\"status\":\"");
        escape_json_string(s, &health.status);
        s.push('"');
    }
    if health.status_time_unix_nano != 0 {
        s.push_str(",\"status_time_unix_nano\":");
        s.push_str(&health.status_time_unix_nano.to_string());
    }
    if !health.component_health_map.is_empty() {
        s.push_str(",\"component_health_map\":{");
        let mut first = true;
        for (key, value) in &health.component_health_map {
            if !first {
                s.push(',');
            }
            first = false;
            s.push('"');
            escape_json_string(s, key);
            s.push_str("\":");
            append_health(s, value);
        }
        s.push('}');
    }
    s.push('}');
}

fn append_effective_config(s: &mut String, config: &EffectiveConfig) {
    s.push('{');
    if let Some(ref config_map) = config.config_map {
        s.push_str("\"config_map\":{");
        let mut first = true;
        for (key, value) in &config_map.config_map {
            if !first {
                s.push(',');
            }
            first = false;
            s.push('"');
            escape_json_string(s, key);
            s.push_str("\":{\"body\":\"");
            s.push_str(&base64_encode(&value.body));
            s.push_str("\",\"content_type\":\"");
            escape_json_string(s, &value.content_type);
            s.push_str("\"}");
        }
        s.push('}');
    }
    s.push('}');
}

fn append_remote_config_status(s: &mut String, status: &RemoteConfigStatus) {
    s.push('{');
    if !status.last_remote_config_hash.is_empty() {
        s.push_str("\"last_remote_config_hash\":\"");
        s.push_str(&base64_encode(&status.last_remote_config_hash));
        s.push_str("\",");
    }
    s.push_str("\"status\":");
    s.push_str(&status.status.to_string());
    if !status.error_message.is_empty() {
        s.push_str(",\"error_message\":\"");
        escape_json_string(s, &status.error_message);
        s.push('"');
    }
    s.push('}');
}

fn append_available_components(s: &mut String, components: &AvailableComponents) {
    s.push_str("{\"hash\":\"");
    s.push_str(&base64_encode(&components.hash));
    s.push_str("\",\"components\":{");
    let mut first = true;
    for (kind, details) in &components.components {
        if !first {
            s.push(',');
        }
        first = false;
        s.push('"');
        s.push_str(kind);
        s.push_str("\":");
        append_component_details(s, details);
    }
    s.push_str("}}");
}

fn append_component_details(s: &mut String, details: &ComponentDetails) {
    s.push_str("{\"metadata\":[");
    let mut first = true;
    for kv in &details.metadata {
        if !first {
            s.push(',');
        }
        first = false;
        append_key_value(s, kv);
    }
    s.push_str("],\"sub_component_map\":{");
    first = true;
    for (name, sub) in &details.sub_component_map {
        if !first {
            s.push(',');
        }
        first = false;
        s.push('"');
        escape_json_string(s, name);
        s.push_str("\":");
        append_component_details(s, sub);
    }
    s.push_str("}}");
}

fn append_connection_settings_status(s: &mut String, status: &ConnectionSettingsStatus) {
    s.push_str("{\"last_connection_settings_hash\":\"");
    s.push_str(&base64_encode(&status.last_connection_settings_hash));
    s.push_str("\",\"status\":");
    s.push_str(&status.status.to_string());
    if !status.error_message.is_empty() {
        s.push_str(",\"error_message\":\"");
        escape_json_string(s, &status.error_message);
        s.push('"');
    }
    s.push('}');
}

// Base64 encoding for bytes
fn base64_encode(bytes: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((bytes.len() + 2) / 3 * 4);

    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);

        result.push(CHARS[(n >> 18) as usize] as char);
        result.push(CHARS[(n >> 12 & 0x3F) as usize] as char);

        if chunk.len() > 1 {
            result.push(CHARS[(n >> 6 & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(CHARS[(n & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

// JSON string escaping
fn escape_json_string(s: &mut String, str: &str) {
    for c in str.chars() {
        match c {
            '"' => s.push_str("\\\""),
            '\\' => s.push_str("\\\\"),
            '\n' => s.push_str("\\n"),
            '\r' => s.push_str("\\r"),
            '\t' => s.push_str("\\t"),
            c if c.is_ascii_control() => {
                s.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => s.push(c),
        }
    }
}

/// Helper to set a property on a JS object
fn set_property(obj: &Object, key: &str, value: JsValue) {
    let _ = js_sys::Reflect::set(obj, &JsValue::from_str(key), &value);
}

/// Convert a Vec<u8> to a Uint8Array JS object
fn obj_to_uint8array(bytes: &[u8]) -> js_sys::Uint8Array {
    let arr = js_sys::Uint8Array::new_with_length(bytes.len() as u32);
    arr.copy_from(bytes);
    arr
}

/// Build agent_description JS object
fn build_agent_description(desc: &AgentDescription) -> JsValue {
    let obj = Object::new();

    // identifying_attributes as array of KeyValue
    if !desc.identifying_attributes.is_empty() {
        let arr = js_sys::Array::new();
        for kv in &desc.identifying_attributes {
            arr.push(&build_key_value(kv));
        }
        set_property(&obj, "identifying_attributes", arr.into());
    }

    // non_identifying_attributes as array of KeyValue
    if !desc.non_identifying_attributes.is_empty() {
        let arr = js_sys::Array::new();
        for kv in &desc.non_identifying_attributes {
            arr.push(&build_key_value(kv));
        }
        set_property(&obj, "non_identifying_attributes", arr.into());
    }

    obj.into()
}

/// Build KeyValue JS object
fn build_key_value(kv: &KeyValue) -> JsValue {
    let obj = Object::new();
    set_property(&obj, "key", JsValue::from_str(&kv.key));

    if let Some(ref value) = kv.value {
        set_property(&obj, "value", build_any_value(value));
    }

    obj.into()
}

/// Build AnyValue JS object
fn build_any_value(value: &AnyValue) -> JsValue {
    let obj = Object::new();

    if let Some(ref v) = &value.value {
        match v {
            any_value::Value::StringValue(s) => {
                set_property(&obj, "string_value", JsValue::from_str(s));
            }
            any_value::Value::BoolValue(b) => {
                set_property(&obj, "bool_value", JsValue::from(*b));
            }
            any_value::Value::IntValue(i) => {
                set_property(&obj, "int_value", JsValue::from(*i));
            }
            any_value::Value::DoubleValue(d) => {
                set_property(&obj, "double_value", JsValue::from_f64(*d));
            }
            any_value::Value::ArrayValue(arr) => {
                let js_arr = js_sys::Array::new();
                for item in &arr.values {
                    js_arr.push(&build_any_value(item));
                }
                set_property(&obj, "array_value", js_arr.into());
            }
            any_value::Value::KvlistValue(kvl) => {
                let arr = js_sys::Array::new();
                for kv in &kvl.values {
                    arr.push(&build_key_value(kv));
                }
                set_property(&obj, "kvlist_value", arr.into());
            }
            any_value::Value::BytesValue(b) => {
                set_property(&obj, "bytes_value", JsValue::from(obj_to_uint8array(b)));
            }
        }
    }

    obj.into()
}

/// Build component_health JS object
fn build_component_health(health: &ComponentHealth) -> JsValue {
    let obj = Object::new();

    set_property(&obj, "healthy", JsValue::from(health.healthy));

    if health.start_time_unix_nano != 0 {
        set_property(
            &obj,
            "start_time_unix_nano",
            JsValue::from(health.start_time_unix_nano),
        );
    }

    if !health.last_error.is_empty() {
        set_property(&obj, "last_error", JsValue::from_str(&health.last_error));
    }

    if !health.status.is_empty() {
        set_property(&obj, "status", JsValue::from_str(&health.status));
    }

    if health.status_time_unix_nano != 0 {
        set_property(
            &obj,
            "status_time_unix_nano",
            JsValue::from(health.status_time_unix_nano),
        );
    }

    // component_health_map
    if !health.component_health_map.is_empty() {
        let map_obj = Object::new();
        for (key, value) in &health.component_health_map {
            set_property(&map_obj, key, build_component_health(value));
        }
        set_property(&obj, "component_health_map", map_obj.into());
    }

    obj.into()
}

/// Build effective_config JS object
fn build_effective_config(config: &EffectiveConfig) -> JsValue {
    let obj = Object::new();

    if let Some(ref config_map) = config.config_map {
        let map_obj = Object::new();
        for (key, value) in &config_map.config_map {
            let config_obj = Object::new();
            if !value.body.is_empty() {
                set_property(
                    &config_obj,
                    "body",
                    JsValue::from(obj_to_uint8array(&value.body)),
                );
            }
            if !value.content_type.is_empty() {
                set_property(
                    &config_obj,
                    "content_type",
                    JsValue::from_str(&value.content_type),
                );
            }
            set_property(&map_obj, key, config_obj.into());
        }
        set_property(&obj, "config_map", map_obj.into());
    }

    obj.into()
}

/// Build remote_config_status JS object
fn build_remote_config_status(status: &RemoteConfigStatus) -> JsValue {
    let obj = Object::new();

    if !status.last_remote_config_hash.is_empty() {
        set_property(
            &obj,
            "last_remote_config_hash",
            JsValue::from(obj_to_uint8array(&status.last_remote_config_hash)),
        );
    }

    set_property(&obj, "status", JsValue::from(status.status));

    if !status.error_message.is_empty() {
        set_property(
            &obj,
            "error_message",
            JsValue::from_str(&status.error_message),
        );
    }

    obj.into()
}

/// Build agent_disconnect JS object (empty struct, just return empty object)

/// Build a string map JS object

/// Build a minimal heartbeat response
#[wasm_bindgen]
pub fn build_heartbeat_response(instance_uid: Vec<u8>, heartbeat_ns: u64) -> Vec<u8> {
    encode_server_to_agent(
        instance_uid,
        0,
        CAP_ACCEPTS_STATUS
            | CAP_OFFERS_REMOTE_CONFIG
            | CAP_ACCEPTS_EFFECTIVE_CONFIG
            | CAP_OFFERS_CONNECTION_SETTINGS,
        heartbeat_ns,
    )
}

/// Build a config push response
#[wasm_bindgen]
pub fn build_config_push_response(
    instance_uid: Vec<u8>,
    config_hash: Vec<u8>,
    config_body: &[u8],
) -> Vec<u8> {
    let config_map = if !config_body.is_empty() {
        let mut map = std::collections::HashMap::new();
        map.insert(
            String::new(),
            AgentConfigFile {
                body: config_body.to_vec(),
                content_type: "text/yaml".to_string(),
            },
        );
        Some(AgentConfigMap { config_map: map })
    } else {
        None
    };

    let response = ServerToAgent {
        instance_uid,
        flags: 0,
        capabilities: CAP_ACCEPTS_STATUS | CAP_OFFERS_REMOTE_CONFIG | CAP_ACCEPTS_EFFECTIVE_CONFIG,
        heart_beat_interval: DEFAULT_HEARTBEAT_INTERVAL_NS,
        error_response: None,
        remote_config: Some(AgentRemoteConfig {
            config: config_map,
            config_hash,
        }),
        agent_identification: None,
        connection_settings: None,
        command: None,
    };

    let payload = response.encode_to_vec();
    let mut result = Vec::with_capacity(1 + payload.len());
    result.push(0x00);
    result.extend_from_slice(&payload);
    result
}

/// Compute SHA-256 hash of bytes
#[wasm_bindgen]
pub fn sha256_hash(data: &[u8]) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

/// Get module version
#[wasm_bindgen]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Get constant values
#[wasm_bindgen]
pub fn get_default_heartbeat_interval_ns() -> u64 {
    DEFAULT_HEARTBEAT_INTERVAL_NS
}

#[wasm_bindgen]
pub fn get_cap_accepts_status() -> u64 {
    CAP_ACCEPTS_STATUS
}

#[wasm_bindgen]
pub fn get_cap_offers_remote_config() -> u64 {
    CAP_OFFERS_REMOTE_CONFIG
}

#[wasm_bindgen]
pub fn get_cap_accepts_effective_config() -> u64 {
    CAP_ACCEPTS_EFFECTIVE_CONFIG
}

#[wasm_bindgen]
pub fn get_cap_offers_connection_settings() -> u64 {
    CAP_OFFERS_CONNECTION_SETTINGS
}
