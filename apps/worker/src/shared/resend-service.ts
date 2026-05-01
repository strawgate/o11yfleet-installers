// Mock Email Service for Testing
// Use this in tests instead of the real Cloudflare Email Service

import type { EmailService, EmailOptions, EmailResult } from "./email.js";

export class MockEmailService implements EmailService {
  private sentEmails: EmailOptions[] = [];
  private shouldFail = false;
  private failureError = "Mock failure";

  isConfigured(): boolean {
    return !this.shouldFail;
  }

  async send(options: EmailOptions): Promise<EmailResult> {
    this.sentEmails.push({ ...options });

    if (this.shouldFail) {
      return { success: false, error: this.failureError };
    }

    const mockId = `mock_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return { success: true, messageId: mockId };
  }

  // Test utilities
  getSentEmails(): EmailOptions[] {
    return [...this.sentEmails];
  }

  getLastEmail(): EmailOptions | undefined {
    return this.sentEmails[this.sentEmails.length - 1];
  }

  clearSentEmails(): void {
    this.sentEmails = [];
  }

  setShouldFail(shouldFail: boolean, error?: string): void {
    this.shouldFail = shouldFail;
    if (error) this.failureError = error;
  }

  findEmail(to: string | string[], subject?: string): EmailOptions | undefined {
    const recipients = Array.isArray(to) ? to : [to];
    return this.sentEmails.find(
      (email) =>
        recipients.some((r) => (Array.isArray(email.to) ? email.to.includes(r) : email.to === r)) &&
        (!subject || email.subject.includes(subject)),
    );
  }
}
