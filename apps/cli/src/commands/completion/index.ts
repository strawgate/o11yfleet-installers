/**
 * completion command - Generate shell completion scripts
 */

import yargs from "yargs";
import { output } from "../../utils/output.js";
import { LEGACY_COMMAND, PRIMARY_COMMAND } from "../../utils/command-name.js";

const COMMANDS = [
  "login",
  "logout",
  "me",
  "tenant:create",
  "config:create",
  "config:list",
  "config:show",
  "config:upload",
  "config:rollout",
  "config",
  "token:create",
  "token:list",
  "agents:list",
  "agents",
  "bench:enrollment",
  "bench:config-push",
  "bench:provisioning",
  "completion",
  "doctor",
] as const;

const OPTIONS = [
  "--api-url",
  "--json",
  "--email",
  "--password",
  "--token",
  "--name",
  "--config-id",
  "--file",
  "--label",
  "--expires-in",
  "--stats",
  "--collectors",
  "--api-key",
  "--help",
  "--version",
] as const;

function generateBashCompletion(): string {
  return `#!/bin/bash
# bash completion for ${PRIMARY_COMMAND}

_${PRIMARY_COMMAND}() {
  local cur prev words cword
  _init_completion || return

  local -a commands=(${COMMANDS.map((c) => `"${c}"`).join(" ")})
  local -a options=(${OPTIONS.map((o) => `"${o}"`).join(" ")})

  if [[ $cword -eq 1 ]] || [[ "\${words[1]}" == "--"* ]]; then
    if [[ "$cur" == "--"* ]]; then
      COMPREPLY=($(compgen -W "${OPTIONS.join(" ")}" -- "$cur"))
    else
      COMPREPLY=($(compgen -W "${COMMANDS.join(" ")}" -- "$cur"))
    fi
  else
    local command="\${words[1]}"
    case "$command" in
      login)
        COMPREPLY=($(compgen -W "--email --password --token --help" -- "$cur"))
        ;;
      config:show|config|agents:list|agents)
        COMPREPLY=($(compgen -W "--config-id --help" -- "$cur"))
        ;;
      config:upload)
        COMPREPLY=($(compgen -W "--config-id --file --help" -- "$cur"))
        ;;
      config:rollout)
        COMPREPLY=($(compgen -W "--config-id --help" -- "$cur"))
        ;;
      token:create|token:list)
        COMPREPLY=($(compgen -W "--config-id --label --expires-in --help" -- "$cur"))
        ;;
      bench:enrollment)
        COMPREPLY=($(compgen -W "--config-id --collectors --help" -- "$cur"))
        ;;
      bench:config-push)
        COMPREPLY=($(compgen -W "--config-id --file --help" -- "$cur"))
        ;;
      bench:provisioning)
        COMPREPLY=($(compgen -W "--api-key --name --help" -- "$cur"))
        ;;
      tenant:create)
        COMPREPLY=($(compgen -W "--name --api-key --help" -- "$cur"))
        ;;
    esac
  fi
}

complete -F _${PRIMARY_COMMAND} ${PRIMARY_COMMAND} ${LEGACY_COMMAND}
`;
}

function generateZshCompletion(): string {
  return `#!/usr/bin/env zsh
# zsh completion for ${PRIMARY_COMMAND}

_${PRIMARY_COMMAND}() {
  local -a commands
  commands=(
${COMMANDS.map((c) => `    "${c}"`).join("\n")}
  )

  local -a options
  options=(
${OPTIONS.map((o) => `    "${o}"`).join("\n")}
  )

  _arguments -C \\
    '1: :->command' \\
    '*: :->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        login)
          _arguments '(--email)--email[Email address]' '(--password)--password[Password]' '(--token)--token[API token]'
          ;;
        config:show|config|agents:list|agents)
          _arguments '(--config-id)--config-id[Config ID]'
          ;;
        config:upload)
          _arguments '(--config-id)--config-id[Config ID]' '(--file)--file[Config file]'
          ;;
        config:rollout)
          _arguments '(--config-id)--config-id[Config ID]'
          ;;
        token:create|token:list)
          _arguments '(--config-id)--config-id[Config ID]' '(--label)--label[Token label]' '(--expires-in)--expires-in[Expiration in hours]'
          ;;
        bench:enrollment)
          _arguments '(--config-id)--config-id[Config ID]' '(--collectors)--collectors[Number of collectors]'
          ;;
        bench:config-push)
          _arguments '(--config-id)--config-id[Config ID]' '(--file)--file[Config file]'
          ;;
        bench:provisioning)
          _arguments '(--api-key)--api-key[Admin API key]' '(--name)--name[Tenant name]'
          ;;
        tenant:create)
          _arguments '(--name)--name[Tenant name]' '(--api-key)--api-key[Admin API key]'
          ;;
      esac
      ;;
  esac
}

compdef _${PRIMARY_COMMAND} ${PRIMARY_COMMAND} ${LEGACY_COMMAND}
`;
}

function generateFishCompletion(): string {
  return `# fish completion for ${PRIMARY_COMMAND}

complete -c ${PRIMARY_COMMAND} -f
complete -c ${LEGACY_COMMAND} -f

# Commands
complete -c ${PRIMARY_COMMAND} -a 'login' -d 'Login to o11yfleet'
complete -c ${PRIMARY_COMMAND} -a 'logout' -d 'Logout from o11yfleet'
complete -c ${PRIMARY_COMMAND} -a 'me' -d 'Show current user'
complete -c ${PRIMARY_COMMAND} -a 'tenant:create' -d 'Create a new tenant'
complete -c ${PRIMARY_COMMAND} -a 'config:create' -d 'Create a new configuration'
complete -c ${PRIMARY_COMMAND} -a 'config:list' -d 'List configurations'
complete -c ${PRIMARY_COMMAND} -a 'config:show' -d 'Show configuration details'
complete -c ${PRIMARY_COMMAND} -a 'config:upload' -d 'Upload a config version'
complete -c ${PRIMARY_COMMAND} -a 'config:rollout' -d 'Rollout config to agents'
complete -c ${PRIMARY_COMMAND} -a 'config' -d 'Show configuration details'
complete -c ${PRIMARY_COMMAND} -a 'token:create' -d 'Create an enrollment token'
complete -c ${PRIMARY_COMMAND} -a 'token:list' -d 'List enrollment tokens'
complete -c ${PRIMARY_COMMAND} -a 'agents:list' -d 'List agents'
complete -c ${PRIMARY_COMMAND} -a 'agents' -d 'List agents'
complete -c ${PRIMARY_COMMAND} -a 'bench:enrollment' -d 'Run enrollment benchmark'
complete -c ${PRIMARY_COMMAND} -a 'bench:config-push' -d 'Run config push benchmark'
complete -c ${PRIMARY_COMMAND} -a 'bench:provisioning' -d 'Run provisioning benchmark'
complete -c ${PRIMARY_COMMAND} -a 'completion' -d 'Generate shell completion'
complete -c ${LEGACY_COMMAND} -a 'login' -d 'Login to o11yfleet'
complete -c ${LEGACY_COMMAND} -a 'logout' -d 'Logout from o11yfleet'
complete -c ${LEGACY_COMMAND} -a 'me' -d 'Show current user'
complete -c ${LEGACY_COMMAND} -a 'tenant:create' -d 'Create a new tenant'
complete -c ${LEGACY_COMMAND} -a 'config:create' -d 'Create a new configuration'
complete -c ${LEGACY_COMMAND} -a 'config:list' -d 'List configurations'
complete -c ${LEGACY_COMMAND} -a 'config:show' -d 'Show configuration details'
complete -c ${LEGACY_COMMAND} -a 'config:upload' -d 'Upload a config version'
complete -c ${LEGACY_COMMAND} -a 'config:rollout' -d 'Rollout config to agents'
complete -c ${LEGACY_COMMAND} -a 'config' -d 'Show configuration details'
complete -c ${LEGACY_COMMAND} -a 'token:create' -d 'Create an enrollment token'
complete -c ${LEGACY_COMMAND} -a 'token:list' -d 'List enrollment tokens'
complete -c ${LEGACY_COMMAND} -a 'agents:list' -d 'List agents'
complete -c ${LEGACY_COMMAND} -a 'agents' -d 'List agents'
complete -c ${LEGACY_COMMAND} -a 'bench:enrollment' -d 'Run enrollment benchmark'
complete -c ${LEGACY_COMMAND} -a 'bench:config-push' -d 'Run config push benchmark'
complete -c ${LEGACY_COMMAND} -a 'bench:provisioning' -d 'Run provisioning benchmark'
complete -c ${LEGACY_COMMAND} -a 'completion' -d 'Generate shell completion'

# Global options
complete -c ${PRIMARY_COMMAND} -l 'api-url' -d 'o11yfleet API URL'
complete -c ${PRIMARY_COMMAND} -l 'json' -d 'Output JSON'
complete -c ${PRIMARY_COMMAND} -l 'help' -d 'Show help'
complete -c ${PRIMARY_COMMAND} -l 'version' -d 'Show version'
complete -c ${LEGACY_COMMAND} -l 'api-url' -d 'o11yfleet API URL'
complete -c ${LEGACY_COMMAND} -l 'json' -d 'Output JSON'
complete -c ${LEGACY_COMMAND} -l 'help' -d 'Show help'
complete -c ${LEGACY_COMMAND} -l 'version' -d 'Show version'
`;
}

interface CompletionOptions {
  shell: "bash" | "zsh" | "fish";
}

export async function completion(args: string[]): Promise<void> {
  const values = yargs(args)
    .option("shell", { type: "string", default: "bash" })
    .parse() as CompletionOptions;

  const shell = values.shell || "bash";

  let script: string;
  let extension: string;

  switch (shell) {
    case "zsh":
      script = generateZshCompletion();
      extension = "zsh";
      break;
    case "fish":
      script = generateFishCompletion();
      extension = "fish";
      break;
    case "bash":
    default:
      script = generateBashCompletion();
      extension = "sh";
  }

  output.log(`Add this to your ${shell} profile:`);
  output.log("");
  output.log("```bash");
  process.stdout.write(script + "\n");
  output.log("```");
  output.log("");
  output.log(`Or save to ~/.config/o11y/completion.${extension} and source it.`);
}
