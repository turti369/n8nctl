/**
 * Interactive confirm prompt with inquirer lazy-loaded at call time — keeps
 * inquirer (a heavy dep) off the startup path even though several commands
 * build a confirm gate into their tree.
 */
export async function confirmPrompt(message: string, defaultValue = false): Promise<boolean> {
  const inquirer = (await import('inquirer')).default;
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    { type: 'confirm', name: 'confirm', message, default: defaultValue },
  ]);
  return confirm;
}
