fn main() {
    // Proto files are in packages/core/proto/
    let proto_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap() // crates/
        .parent().unwrap() // repo root
        .join("packages/core/proto");

    let proto_files = &[
        proto_dir.join("opamp.proto"),
        proto_dir.join("anyvalue.proto"),
    ];

    prost_build::Config::new()
        .out_dir("src/")
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .compile_protos(proto_files, &[&proto_dir])
        .expect("Failed to compile protobuf files");

    println!("cargo:rerun-if-changed={}", proto_dir.display());
}
