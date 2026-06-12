import { Command } from 'commander';
import { withAction } from '../lib/runtime.js';
import { ValidationError } from '../lib/errors.js';
import type { Factory } from '../factory.js';

const SUPPORTED = ['bash', 'zsh', 'fish', 'powershell'] as const;
type Shell = (typeof SUPPORTED)[number];

export async function completionHandler(
  factory: Factory,
  _opts: unknown,
  args: string[],
): Promise<void> {
  const [shell] = args;
  if (!SUPPORTED.includes(shell as Shell)) {
    throw new ValidationError(
      `Unsupported shell "${shell}"`,
      `Pick one of: ${SUPPORTED.join(', ')}`,
    );
  }
  const script = generate(shell as Shell);
  factory.io.stdout.write(script);
}

export function createCompletionCommand(): Command {
  return new Command('completion')
    .description('Generate a shell completion script')
    .argument('<shell>', `shell to generate for (${SUPPORTED.join('|')})`)
    .action(withAction(completionHandler));
}

/**
 * Static completion scripts. We do not dynamically reflect Commander's tree
 * to keep bundle size low and avoid runtime surprises — the command tree is
 * stable enough that a static list is acceptable.
 */
function generate(shell: Shell): string {
  const nouns = 'workflow wf execution exec credential cred tag auth config profile doctor completion help';
  const workflowVerbs =
    'list ls get create update activate deactivate trigger-webhook trigger backup delete rm validate diff restore tag export-all import watch';
  const executionVerbs = 'list ls get retry wait last-error';

  switch (shell) {
    case 'bash':
      return `# n8nctl bash completion — source this file or add to ~/.bashrc:
#   eval "$(n8nctl completion bash)"

_n8nctl_complete() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${nouns}" -- "$cur") )
    return
  fi

  case "\${COMP_WORDS[1]}" in
    workflow|wf)
      if [ "\${COMP_CWORD}" -eq 2 ]; then
        COMPREPLY=( $(compgen -W "${workflowVerbs}" -- "$cur") )
      fi
      ;;
    execution|exec)
      if [ "\${COMP_CWORD}" -eq 2 ]; then
        COMPREPLY=( $(compgen -W "${executionVerbs}" -- "$cur") )
      fi
      ;;
    credential|cred)
      [ "\${COMP_CWORD}" -eq 2 ] && COMPREPLY=( $(compgen -W "list ls schema" -- "$cur") )
      ;;
    tag)
      [ "\${COMP_CWORD}" -eq 2 ] && COMPREPLY=( $(compgen -W "list ls create" -- "$cur") )
      ;;
    auth)
      [ "\${COMP_CWORD}" -eq 2 ] && COMPREPLY=( $(compgen -W "login status logout" -- "$cur") )
      ;;
    config)
      [ "\${COMP_CWORD}" -eq 2 ] && COMPREPLY=( $(compgen -W "get set list ls" -- "$cur") )
      ;;
    profile)
      [ "\${COMP_CWORD}" -eq 2 ] && COMPREPLY=( $(compgen -W "list ls add switch use remove rm" -- "$cur") )
      ;;
  esac
}

complete -F _n8nctl_complete n8nctl
`;

    case 'zsh':
      return `# n8nctl zsh completion — save as a file in $fpath:
#   n8nctl completion zsh > ~/.zsh/completions/_n8nctl
# Then make sure your ~/.zshrc has: fpath=(~/.zsh/completions $fpath) && autoload -Uz compinit && compinit

#compdef n8nctl

_n8nctl() {
  local -a nouns workflow_verbs exec_verbs

  nouns=(${nouns
    .split(' ')
    .map((n) => `'${n}'`)
    .join(' ')})
  workflow_verbs=(${workflowVerbs
    .split(' ')
    .map((v) => `'${v}'`)
    .join(' ')})
  exec_verbs=(${executionVerbs
    .split(' ')
    .map((v) => `'${v}'`)
    .join(' ')})

  if (( CURRENT == 2 )); then
    _describe 'command' nouns
    return
  fi

  case "\${words[2]}" in
    workflow|wf)
      (( CURRENT == 3 )) && _describe 'verb' workflow_verbs
      ;;
    execution|exec)
      (( CURRENT == 3 )) && _describe 'verb' exec_verbs
      ;;
    credential|cred)
      (( CURRENT == 3 )) && _values 'verb' list ls schema
      ;;
    tag)
      (( CURRENT == 3 )) && _values 'verb' list ls create
      ;;
    auth)
      (( CURRENT == 3 )) && _values 'verb' login status logout
      ;;
    config)
      (( CURRENT == 3 )) && _values 'verb' get set list ls
      ;;
    profile)
      (( CURRENT == 3 )) && _values 'verb' list ls add switch use remove rm
      ;;
  esac
}

_n8nctl "$@"
`;

    case 'fish':
      return `# n8nctl fish completion — save to ~/.config/fish/completions/n8nctl.fish

complete -c n8nctl -f

# Top-level nouns
complete -c n8nctl -n "__fish_use_subcommand" -a "workflow wf" -d "Manage workflows"
complete -c n8nctl -n "__fish_use_subcommand" -a "execution exec" -d "Inspect executions"
complete -c n8nctl -n "__fish_use_subcommand" -a "credential cred" -d "Inspect credentials"
complete -c n8nctl -n "__fish_use_subcommand" -a "tag" -d "Manage tags"
complete -c n8nctl -n "__fish_use_subcommand" -a "auth" -d "Authentication"
complete -c n8nctl -n "__fish_use_subcommand" -a "config" -d "Configuration"
complete -c n8nctl -n "__fish_use_subcommand" -a "profile" -d "Multi-instance profiles"
complete -c n8nctl -n "__fish_use_subcommand" -a "doctor" -d "Health check"
complete -c n8nctl -n "__fish_use_subcommand" -a "completion" -d "Generate shell completion"

# workflow verbs
for verb in ${workflowVerbs}
  complete -c n8nctl -n "__fish_seen_subcommand_from workflow wf" -a "$verb"
end

# execution verbs
for verb in ${executionVerbs}
  complete -c n8nctl -n "__fish_seen_subcommand_from execution exec" -a "$verb"
end
`;

    case 'powershell':
      return `# n8nctl PowerShell completion — add to $PROFILE:
#   n8nctl completion powershell | Out-String | Invoke-Expression

Register-ArgumentCompleter -Native -CommandName n8nctl -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $tokens = $commandAst.CommandElements.Value
  $nouns = @('workflow','wf','execution','exec','credential','cred','tag','auth','config','profile','doctor','completion')
  $workflowVerbs = @(${workflowVerbs
    .split(' ')
    .map((v) => `'${v}'`)
    .join(',')})
  $execVerbs = @(${executionVerbs
    .split(' ')
    .map((v) => `'${v}'`)
    .join(',')})

  if ($tokens.Length -le 2) {
    return $nouns | Where-Object { $_ -like "$wordToComplete*" }
  }
  $noun = $tokens[1]
  if ($tokens.Length -eq 3) {
    switch ($noun) {
      { @('workflow','wf') -contains $_ } { return $workflowVerbs | Where-Object { $_ -like "$wordToComplete*" } }
      { @('execution','exec') -contains $_ } { return $execVerbs | Where-Object { $_ -like "$wordToComplete*" } }
      { @('credential','cred') -contains $_ } { return @('list','ls','schema') | Where-Object { $_ -like "$wordToComplete*" } }
      tag { return @('list','ls','create') | Where-Object { $_ -like "$wordToComplete*" } }
      auth { return @('login','status','logout') | Where-Object { $_ -like "$wordToComplete*" } }
      config { return @('get','set','list','ls') | Where-Object { $_ -like "$wordToComplete*" } }
      profile { return @('list','ls','add','switch','use','remove','rm') | Where-Object { $_ -like "$wordToComplete*" } }
    }
  }
}
`;
  }
}
