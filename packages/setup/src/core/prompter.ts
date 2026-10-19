import { MissingAnswerError } from "./errors.js";

export interface ConfirmQuestion {
  message: string;
  /** Pre-selected answer in an interactive terminal. */
  default?: boolean;
  /**
   * Answer used with `--yes`. Defaults to `false`, so anything that is not
   * explicitly marked safe is declined when nobody is there to read the diff.
   */
  yesDefault?: boolean;
}

export interface InputQuestion {
  message: string;
  default?: string;
  validate?: (value: string) => true | string;
  /** Flag that answers this question, shown when running non-interactively. */
  flagHint?: string;
}

export interface SelectChoice<T extends string> {
  name: string;
  value: T;
  description?: string;
}

export interface SelectQuestion<T extends string> {
  message: string;
  choices: SelectChoice<T>[];
  default?: T;
  flagHint?: string;
}

export interface TypedConfirmation {
  message: string;
  /** The exact text the user must type. */
  expected: string;
}

export interface Prompter {
  confirm(q: ConfirmQuestion): Promise<boolean>;
  input(q: InputQuestion): Promise<string>;
  select<T extends string>(q: SelectQuestion<T>): Promise<T>;
  /** Destructive confirmation: the user must type `expected`. Never auto-accepted. */
  typed(q: TypedConfirmation): Promise<boolean>;
}

/** Interactive prompts backed by @inquirer/prompts (loaded lazily). */
export class InquirerPrompter implements Prompter {
  private async lib() {
    return import("@inquirer/prompts");
  }
  async confirm(q: ConfirmQuestion) {
    const { confirm } = await this.lib();
    return confirm({ message: q.message, default: q.default ?? false });
  }
  async input(q: InputQuestion) {
    const { input } = await this.lib();
    return (await input({ message: q.message, default: q.default, validate: q.validate })).trim();
  }
  async select<T extends string>(q: SelectQuestion<T>) {
    const { select } = await this.lib();
    return select<T>({ message: q.message, choices: q.choices, default: q.default, pageSize: 12 });
  }
  async typed(q: TypedConfirmation) {
    const { input } = await this.lib();
    const answer = await input({ message: `${q.message}\n  Type "${q.expected}" to confirm (anything else cancels):` });
    return answer.trim() === q.expected;
  }
}

/**
 * Used with `--yes` (accept safe defaults) or when stdin is not a TTY.
 * Questions without a usable default raise {@link MissingAnswerError}.
 */
export class NonInteractivePrompter implements Prompter {
  constructor(private readonly acceptDefaults: boolean) {}
  async confirm(q: ConfirmQuestion) {
    if (!this.acceptDefaults) throw new MissingAnswerError(q.message, "--yes");
    return q.yesDefault ?? false;
  }
  async input(q: InputQuestion) {
    if (this.acceptDefaults && q.default !== undefined && q.default !== "") {
      const ok = q.validate ? q.validate(q.default) : true;
      if (ok === true) return q.default;
    }
    throw new MissingAnswerError(q.message, q.flagHint);
  }
  async select<T extends string>(q: SelectQuestion<T>) {
    if (this.acceptDefaults && q.default !== undefined) return q.default;
    throw new MissingAnswerError(q.message, q.flagHint);
  }
  async typed(_q: TypedConfirmation) {
    // Destructive actions always need a human.
    return false;
  }
}
