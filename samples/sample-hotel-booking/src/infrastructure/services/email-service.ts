import type { EmailService } from "../types";

/** Logs emails to the console — for development and demo. */
export class ConsoleEmailService implements EmailService {
  async send(to: string, subject: string, body: string): Promise<void> {
    console.log(`[Email → ${to}] ${subject}: ${body}`);
  }
}

/** Captures sent emails in memory — for tests. */
export class InMemoryEmailService implements EmailService {
  public readonly sent: Array<{ to: string; subject: string; body: string }> =
    [];

  async send(to: string, subject: string, body: string): Promise<void> {
    this.sent.push({ to, subject, body });
  }
}
