export interface CommandHelpSource {
  read(commandName: string): Promise<string>;
}
