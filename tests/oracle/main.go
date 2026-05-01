// Oracle fixture generator for OpAMP protobuf wire format.
//
// Uses the canonical opamp-go library to construct AgentToServer messages
// with known field values, serializes them to protobuf binary (with the
// standard 0x00 data-type header), and writes them as fixture files.
//
// The TypeScript test suite (packages/core/test/oracle.test.ts) reads
// these fixtures and verifies our codec decodes them identically.
//
// Usage: go run . [output-dir]
//   Default output-dir: ./fixtures

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/open-telemetry/opamp-go/protobufs"
	"google.golang.org/protobuf/proto"
)

// Known UID: 16 bytes 0x01..0x10
var knownUID = []byte{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10}

// Capabilities matching our CONFIGURABLE_CAPABILITIES constant.
const configurableCapabilities = uint64(
	protobufs.AgentCapabilities_AgentCapabilities_ReportsStatus |
		protobufs.AgentCapabilities_AgentCapabilities_AcceptsRemoteConfig |
		protobufs.AgentCapabilities_AgentCapabilities_ReportsEffectiveConfig |
		protobufs.AgentCapabilities_AgentCapabilities_ReportsHealth |
		protobufs.AgentCapabilities_AgentCapabilities_ReportsRemoteConfig)

const defaultCapabilities = uint64(
	protobufs.AgentCapabilities_AgentCapabilities_ReportsStatus |
		protobufs.AgentCapabilities_AgentCapabilities_ReportsEffectiveConfig |
		protobufs.AgentCapabilities_AgentCapabilities_ReportsHealth)

type fixture struct {
	Name     string
	Message  *protobufs.AgentToServer
	Expected map[string]interface{} // JSON-serializable expected values
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "verify" {
		// Verify mode: read .bin files from a directory and check fields
		verifyDir := "./ts-fixtures"
		if len(os.Args) > 2 {
			verifyDir = os.Args[2]
		}
		if err := verifyFixtures(verifyDir); err != nil {
			fmt.Fprintf(os.Stderr, "verify failed: %v\n", err)
			os.Exit(1)
		}
		return
	}

	outDir := "./fixtures"
	if len(os.Args) > 1 {
		outDir = os.Args[1]
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "mkdir: %v\n", err)
		os.Exit(1)
	}

	fixtures := []fixture{
		helloFixture(),
		heartbeatFixture(),
		healthReportFixture(),
		configAckFixture(),
		descriptionReportFixture(),
		disconnectFixture(),
	}

	for _, f := range fixtures {
		if err := writeFixture(outDir, f); err != nil {
			fmt.Fprintf(os.Stderr, "fixture %s: %v\n", f.Name, err)
			os.Exit(1)
		}
		fmt.Printf("wrote %s\n", f.Name)
	}
}

func writeFixture(dir string, f fixture) error {
	data, err := proto.Marshal(f.Message)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	// Prepend the 0x00 data-type header byte (matches opamp-go wsmessage.go).
	wire := append([]byte{0x00}, data...)

	binPath := filepath.Join(dir, f.Name+".bin")
	if err := os.WriteFile(binPath, wire, 0o644); err != nil {
		return fmt.Errorf("write bin: %w", err)
	}

	jsonData, err := json.MarshalIndent(f.Expected, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal json: %w", err)
	}
	jsonPath := filepath.Join(dir, f.Name+".json")
	return os.WriteFile(jsonPath, jsonData, 0o644)
}

// ─── Fixtures ───────────────────────────────────────────────────────

func helloFixture() fixture {
	nowNano := uint64(1700000000000000000) // fixed timestamp for reproducibility

	msg := &protobufs.AgentToServer{
		InstanceUid:  knownUID,
		SequenceNum:  0,
		Capabilities: configurableCapabilities,
		Flags:        0,
		AgentDescription: &protobufs.AgentDescription{
			IdentifyingAttributes: []*protobufs.KeyValue{
				kv("service.instance.id", "01020304-0506-0708-090a-0b0c0d0e0f10"),
				kv("service.name", "oracle-test-agent"),
				kv("service.version", "0.123.0"),
			},
			NonIdentifyingAttributes: []*protobufs.KeyValue{
				kv("host.arch", "arm64"),
				kv("host.name", "oracle-host"),
				kv("os.description", " "),
				kv("os.type", "linux"),
			},
		},
		Health: &protobufs.ComponentHealth{
			Healthy:           true,
			StartTimeUnixNano: nowNano,
			LastError:         "",
			Status:            "StatusOK",
			StatusTimeUnixNano: nowNano,
			ComponentHealthMap: map[string]*protobufs.ComponentHealth{
				"pipeline:traces": {
					Healthy:           true,
					StartTimeUnixNano: 0,
					LastError:         "",
					Status:            "StatusOK",
					StatusTimeUnixNano: nowNano,
					ComponentHealthMap: map[string]*protobufs.ComponentHealth{
						"receiver:otlp": leaf(nowNano),
						"processor:batch": leaf(nowNano),
						"exporter:debug": leaf(nowNano),
					},
				},
			},
		},
		EffectiveConfig: &protobufs.EffectiveConfig{
			ConfigMap: &protobufs.AgentConfigMap{
				ConfigMap: map[string]*protobufs.AgentConfigFile{
					"": {
						Body:        []byte("receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: 0.0.0.0:4317\n"),
						ContentType: "text/yaml",
					},
				},
			},
		},
	}

	return fixture{
		Name:    "hello",
		Message: msg,
		Expected: map[string]interface{}{
			"sequence_num": 0,
			"capabilities": configurableCapabilities,
			"flags":        0,
			"agent_description": map[string]interface{}{
				"identifying_attributes": []interface{}{
					map[string]interface{}{"key": "service.instance.id", "value": map[string]interface{}{"string_value": "01020304-0506-0708-090a-0b0c0d0e0f10"}},
					map[string]interface{}{"key": "service.name", "value": map[string]interface{}{"string_value": "oracle-test-agent"}},
					map[string]interface{}{"key": "service.version", "value": map[string]interface{}{"string_value": "0.123.0"}},
				},
				"non_identifying_attributes": []interface{}{
					map[string]interface{}{"key": "host.arch", "value": map[string]interface{}{"string_value": "arm64"}},
					map[string]interface{}{"key": "host.name", "value": map[string]interface{}{"string_value": "oracle-host"}},
					map[string]interface{}{"key": "os.description", "value": map[string]interface{}{"string_value": " "}},
					map[string]interface{}{"key": "os.type", "value": map[string]interface{}{"string_value": "linux"}},
				},
			},
			"health": map[string]interface{}{
				"healthy":               true,
				"start_time_unix_nano":  nowNano,
				"last_error":            "",
				"status":                "StatusOK",
				"status_time_unix_nano": nowNano,
				"has_component_health":  true,
			},
			"has_effective_config": true,
			"effective_config_key": "",
			"effective_config_content_type": "text/yaml",
		},
	}
}

func heartbeatFixture() fixture {
	msg := &protobufs.AgentToServer{
		InstanceUid:  knownUID,
		SequenceNum:  42,
		Capabilities: configurableCapabilities,
		Flags:        0,
	}
	return fixture{
		Name:    "heartbeat",
		Message: msg,
		Expected: map[string]interface{}{
			"sequence_num": 42,
			"capabilities": configurableCapabilities,
			"flags":        0,
			"has_health":   false,
			"has_description": false,
			"has_effective_config": false,
		},
	}
}

func healthReportFixture() fixture {
	nowNano := uint64(1700000000000000000)
	msg := &protobufs.AgentToServer{
		InstanceUid:  knownUID,
		SequenceNum:  7,
		Capabilities: uint64(protobufs.AgentCapabilities_AgentCapabilities_ReportsStatus | protobufs.AgentCapabilities_AgentCapabilities_ReportsHealth),
		Flags:        0,
		Health: &protobufs.ComponentHealth{
			Healthy:           false,
			StartTimeUnixNano: nowNano,
			LastError:         "OOM killed",
			Status:            "degraded",
			StatusTimeUnixNano: nowNano,
			ComponentHealthMap: map[string]*protobufs.ComponentHealth{},
		},
	}
	return fixture{
		Name:    "health-report",
		Message: msg,
		Expected: map[string]interface{}{
			"sequence_num": 7,
			"capabilities": uint64(protobufs.AgentCapabilities_AgentCapabilities_ReportsStatus | protobufs.AgentCapabilities_AgentCapabilities_ReportsHealth),
			"flags":        0,
			"health": map[string]interface{}{
				"healthy":               false,
				"start_time_unix_nano":  nowNano,
				"last_error":            "OOM killed",
				"status":                "degraded",
				"status_time_unix_nano": nowNano,
				"has_component_health":  false,
			},
		},
	}
}

func configAckFixture() fixture {
	configHash := []byte{0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89}
	msg := &protobufs.AgentToServer{
		InstanceUid:  knownUID,
		SequenceNum:  3,
		Capabilities: configurableCapabilities,
		Flags:        0,
		RemoteConfigStatus: &protobufs.RemoteConfigStatus{
			LastRemoteConfigHash: configHash,
			Status:               protobufs.RemoteConfigStatuses_RemoteConfigStatuses_APPLIED,
			ErrorMessage:         "",
		},
	}
	return fixture{
		Name:    "config-ack",
		Message: msg,
		Expected: map[string]interface{}{
			"sequence_num": 3,
			"capabilities": configurableCapabilities,
			"flags":        0,
			"remote_config_status": map[string]interface{}{
				"status":        1, // APPLIED
				"error_message": "",
			},
		},
	}
}

func descriptionReportFixture() fixture {
	msg := &protobufs.AgentToServer{
		InstanceUid:  knownUID,
		SequenceNum:  1,
		Capabilities: defaultCapabilities,
		Flags:        0,
		AgentDescription: &protobufs.AgentDescription{
			IdentifyingAttributes: []*protobufs.KeyValue{
				kv("service.instance.id", "desc-instance-001"),
				kv("service.name", "description-agent"),
				kv("service.version", "1.0.0"),
			},
			NonIdentifyingAttributes: []*protobufs.KeyValue{
				kv("host.arch", "amd64"),
				kv("host.name", "prod-host-42"),
				kv("os.description", "Ubuntu 22.04"),
				kv("os.type", "linux"),
			},
		},
	}
	return fixture{
		Name:    "description-report",
		Message: msg,
		Expected: map[string]interface{}{
			"sequence_num": 1,
			"capabilities": defaultCapabilities,
			"flags":        0,
			"agent_description": map[string]interface{}{
				"identifying_attributes": []interface{}{
					map[string]interface{}{"key": "service.instance.id", "value": map[string]interface{}{"string_value": "desc-instance-001"}},
					map[string]interface{}{"key": "service.name", "value": map[string]interface{}{"string_value": "description-agent"}},
					map[string]interface{}{"key": "service.version", "value": map[string]interface{}{"string_value": "1.0.0"}},
				},
				"non_identifying_attributes": []interface{}{
					map[string]interface{}{"key": "host.arch", "value": map[string]interface{}{"string_value": "amd64"}},
					map[string]interface{}{"key": "host.name", "value": map[string]interface{}{"string_value": "prod-host-42"}},
					map[string]interface{}{"key": "os.description", "value": map[string]interface{}{"string_value": "Ubuntu 22.04"}},
					map[string]interface{}{"key": "os.type", "value": map[string]interface{}{"string_value": "linux"}},
				},
			},
		},
	}
}

func disconnectFixture() fixture {
	msg := &protobufs.AgentToServer{
		InstanceUid:     knownUID,
		SequenceNum:     99,
		Capabilities:    defaultCapabilities,
		Flags:           0,
		AgentDisconnect: &protobufs.AgentDisconnect{},
	}
	return fixture{
		Name:    "disconnect",
		Message: msg,
		Expected: map[string]interface{}{
			"sequence_num":       99,
			"capabilities":      defaultCapabilities,
			"flags":             0,
			"has_disconnect":    true,
		},
	}
}

// ─── Helpers ────────────────────────────────────────────────────────

func kv(key, strVal string) *protobufs.KeyValue {
	return &protobufs.KeyValue{
		Key: key,
		Value: &protobufs.AnyValue{
			Value: &protobufs.AnyValue_StringValue{StringValue: strVal},
		},
	}
}

func leaf(nowNano uint64) *protobufs.ComponentHealth {
	return &protobufs.ComponentHealth{
		Healthy:           true,
		StartTimeUnixNano: 0,
		LastError:         "",
		Status:            "StatusOK",
		StatusTimeUnixNano: nowNano,
		ComponentHealthMap: map[string]*protobufs.ComponentHealth{},
	}
}

// ─── Verify: decode TS-produced protobuf and check fields ───────────

func verifyFixtures(dir string) error {
	checks := []struct {
		name   string
		verify func(*protobufs.AgentToServer) error
	}{
		{"hello", verifyHello},
		{"heartbeat", verifyHeartbeat},
		{"health-report", verifyHealthReport},
		{"config-ack", verifyConfigAck},
		{"description-report", verifyDescriptionReport},
		{"disconnect", verifyDisconnect},
	}

	passed := 0
	for _, c := range checks {
		path := filepath.Join(dir, c.name+".bin")
		data, err := os.ReadFile(path)
		if err != nil {
			fmt.Printf("SKIP %s: %v\n", c.name, err)
			continue
		}
		// Strip 0x00 header if present
		if len(data) > 0 && data[0] == 0x00 {
			data = data[1:]
		}
		msg := &protobufs.AgentToServer{}
		if err := proto.Unmarshal(data, msg); err != nil {
			return fmt.Errorf("%s: unmarshal: %w", c.name, err)
		}
		if err := c.verify(msg); err != nil {
			return fmt.Errorf("%s: %w", c.name, err)
		}
		fmt.Printf("PASS %s\n", c.name)
		passed++
	}
	fmt.Printf("\n%d/%d verified\n", passed, len(checks))
	return nil
}

func assertEqual[T comparable](field string, got, want T) error {
	if got != want {
		return fmt.Errorf("field %s: got %v, want %v", field, got, want)
	}
	return nil
}

func verifyHello(msg *protobufs.AgentToServer) error {
	if err := assertEqual("capabilities", msg.Capabilities, configurableCapabilities); err != nil {
		return err
	}
	if msg.AgentDescription == nil {
		return fmt.Errorf("missing agent_description")
	}
	if len(msg.AgentDescription.IdentifyingAttributes) < 2 {
		return fmt.Errorf("too few identifying_attributes: %d", len(msg.AgentDescription.IdentifyingAttributes))
	}
	// Check service.name is present
	found := false
	for _, attr := range msg.AgentDescription.IdentifyingAttributes {
		if attr.Key == "service.name" {
			found = true
			sv := attr.Value.GetStringValue()
			if sv == "" {
				return fmt.Errorf("service.name has empty string_value")
			}
		}
	}
	if !found {
		return fmt.Errorf("missing service.name in identifying_attributes")
	}
	if msg.Health == nil {
		return fmt.Errorf("missing health")
	}
	if !msg.Health.Healthy {
		return fmt.Errorf("health.healthy should be true")
	}
	if msg.Health.Status != "StatusOK" {
		return fmt.Errorf("health.status: got %q, want StatusOK", msg.Health.Status)
	}
	if msg.EffectiveConfig == nil || msg.EffectiveConfig.ConfigMap == nil {
		return fmt.Errorf("missing effective_config")
	}
	return nil
}

func verifyHeartbeat(msg *protobufs.AgentToServer) error {
	if msg.Health != nil {
		return fmt.Errorf("heartbeat should have no health")
	}
	if msg.AgentDescription != nil {
		return fmt.Errorf("heartbeat should have no agent_description")
	}
	if msg.EffectiveConfig != nil {
		return fmt.Errorf("heartbeat should have no effective_config")
	}
	return nil
}

func verifyHealthReport(msg *protobufs.AgentToServer) error {
	if msg.Health == nil {
		return fmt.Errorf("missing health")
	}
	if msg.Health.Healthy {
		return fmt.Errorf("health.healthy should be false")
	}
	if msg.Health.LastError != "OOM killed" {
		return fmt.Errorf("health.last_error: got %q, want 'OOM killed'", msg.Health.LastError)
	}
	if msg.Health.Status != "degraded" {
		return fmt.Errorf("health.status: got %q, want 'degraded'", msg.Health.Status)
	}
	return nil
}

func verifyConfigAck(msg *protobufs.AgentToServer) error {
	if msg.RemoteConfigStatus == nil {
		return fmt.Errorf("missing remote_config_status")
	}
	if msg.RemoteConfigStatus.Status != protobufs.RemoteConfigStatuses_RemoteConfigStatuses_APPLIED {
		return fmt.Errorf("status: got %v, want APPLIED", msg.RemoteConfigStatus.Status)
	}
	expectedHash := []byte{0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89}
	if len(msg.RemoteConfigStatus.LastRemoteConfigHash) != len(expectedHash) {
		return fmt.Errorf("hash length mismatch")
	}
	for i, b := range expectedHash {
		if msg.RemoteConfigStatus.LastRemoteConfigHash[i] != b {
			return fmt.Errorf("hash byte %d: got 0x%02x, want 0x%02x", i, msg.RemoteConfigStatus.LastRemoteConfigHash[i], b)
		}
	}
	return nil
}

func verifyDescriptionReport(msg *protobufs.AgentToServer) error {
	if msg.AgentDescription == nil {
		return fmt.Errorf("missing agent_description")
	}
	if len(msg.AgentDescription.IdentifyingAttributes) < 2 {
		return fmt.Errorf("too few identifying_attributes")
	}
	// Must have service.name
	found := false
	for _, attr := range msg.AgentDescription.IdentifyingAttributes {
		if attr.Key == "service.name" {
			sv := attr.Value.GetStringValue()
			if sv != "description-agent" {
				return fmt.Errorf("service.name: got %q, want 'description-agent'", sv)
			}
			found = true
		}
	}
	if !found {
		return fmt.Errorf("missing service.name")
	}
	if msg.Health != nil {
		return fmt.Errorf("description report should have no health")
	}
	return nil
}

func verifyDisconnect(msg *protobufs.AgentToServer) error {
	if msg.AgentDisconnect == nil {
		return fmt.Errorf("missing agent_disconnect")
	}
	if msg.Health != nil {
		return fmt.Errorf("disconnect should have no health")
	}
	if msg.AgentDescription != nil {
		return fmt.Errorf("disconnect should have no agent_description")
	}
	if msg.EffectiveConfig != nil {
		return fmt.Errorf("disconnect should have no effective_config")
	}
	return nil
}
