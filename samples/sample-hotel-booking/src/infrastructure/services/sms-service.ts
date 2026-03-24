import type { SmsService } from "../types";

/** Logs SMS to the console — for development and demo. */
export class ConsoleSmsService implements SmsService {
  async send(phone: string, message: string): Promise<void> {
    console.log(`[SMS → ${phone}] ${message}`);
  }
}

/** Captures sent SMS in memory — for tests. */
export class InMemorySmsService implements SmsService {
  public readonly sent: Array<{ phone: string; message: string }> = [];

  async send(phone: string, message: string): Promise<void> {
    this.sent.push({ phone, message });
  }
}
