// tflint configuration. Cloudflare doesn't have an official tflint ruleset
// (only AWS/Azure/GCP do as of Q2 2026), so we use the base `terraform`
// plugin's recommended preset, which still catches deprecated syntax,
// unused variables and outputs, naming convention drift, missing
// version constraints, and the like.
//
// Run with `tflint --init && tflint --recursive --format compact`.

config {
  format           = "compact"
  call_module_type = "all"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
