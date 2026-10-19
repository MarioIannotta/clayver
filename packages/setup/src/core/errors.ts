/** An error with an actionable hint. The CLI prints `message`, then `hint`. */
export class ClayverError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "ClayverError";
  }
}

/** Raised when a question needs an answer but the CLI runs non-interactively. */
export class MissingAnswerError extends ClayverError {
  constructor(question: string, flagHint?: string) {
    super(
      `Clayver needs an answer to "${question}" but is running non-interactively.`,
      flagHint ? `Pass ${flagHint}, or run the command in an interactive terminal.` : "Run the command in an interactive terminal.",
    );
    this.name = "MissingAnswerError";
  }
}
