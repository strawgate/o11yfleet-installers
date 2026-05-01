// Email utility for sending tenant approval notifications
// Uses Cloudflare Email Service (CLOUDFLARE_EMAIL_SENDER binding)

import type { Env } from "../index.js";

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface TenantApprovalEmail {
  tenantName: string;
  tenantEmail: string;
  action: "approved" | "rejected";
  reason?: string;
}

/**
 * Email category types for sender address selection
 * Best practice: use different addresses for different notification types
 */
export type EmailCategory = "accounts" | "fleet" | "support" | "default";

/**
 * EmailService interface for testability
 * Allows mocking the email service in tests
 */
export interface EmailService {
  send(options: EmailOptions): Promise<EmailResult>;
  isConfigured(): boolean;
}

/**
 * Get the from address for a given email category
 * Falls back to the default address if category-specific one is not configured
 */
function getFromAddress(env: Env, category: EmailCategory): string {
  // Category-specific addresses (for future use with Cloudflare Email Routing)
  const categoryAddresses: Record<EmailCategory, string | undefined> = {
    accounts: undefined, // e.g., "accounts@o11yfleet.com"
    fleet: undefined, // e.g., "fleet@o11yfleet.com"
    support: undefined, // e.g., "support@o11yfleet.com"
    default: env.CLOUDFLARE_EMAIL_FROM, // the configured default
  };

  return categoryAddresses[category] ?? env.CLOUDFLARE_EMAIL_FROM ?? "noreply@o11yfleet.com";
}

/**
 * Check if Cloudflare Email Service is configured
 */
export function isEmailConfigured(env: Env): boolean {
  return Boolean(env.CLOUDFLARE_EMAIL_SENDER && env.CLOUDFLARE_EMAIL_FROM);
}

function htmlEncode(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildApprovalEmailHtml(data: TenantApprovalEmail): string {
  const isApproved = data.action === "approved";
  const title = isApproved ? "Your workspace is approved!" : "Your workspace application";
  const color = isApproved ? "#4fd27b" : "#f97316";
  const statusText = isApproved ? "approved" : "was not approved";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${htmlEncode(title)}</title>
</head>
<body style="margin:0;padding:0;background:#050608;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#050608;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#101318;border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:${color};padding:32px 24px;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:24px;font-weight:600;">
                ${htmlEncode(title)}
              </h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 24px;color:#f4f7fb;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
                Hello,
              </p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
                Your workspace <strong style="color:${color};">${htmlEncode(data.tenantName)}</strong> has been ${statusText}.
              </p>
              ${
                isApproved
                  ? `
              <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
                You can now log in and start using O11yFleet to manage your collector fleet.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td style="background:${color};border-radius:8px;">
                    <a href="https://o11yfleet.com/login" style="display:inline-block;padding:14px 28px;color:#061008;font-size:15px;font-weight:600;text-decoration:none;">
                      Go to O11yFleet
                    </a>
                  </td>
                </tr>
              </table>
              `
                  : `
              <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
                Unfortunately, your workspace application was not approved at this time.
              </p>
              ${
                data.reason
                  ? `
              <div style="background:#1a1d24;border-radius:8px;padding:16px;margin:16px 0;">
                <p style="margin:0;font-size:14px;color:#b9c0cc;">
                  <strong>Reason:</strong> ${htmlEncode(data.reason)}
                </p>
              </div>
              `
                  : ""
              }
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
                If you believe this was a mistake or have questions, please contact us at
                <a href="mailto:support@o11yfleet.com" style="color:${color};">support@o11yfleet.com</a>.
              </p>
              `
              }
              <hr style="border:none;border-top:1px solid #252b35;margin:32px 0;" />
              <p style="margin:0;font-size:13px;color:#8993a3;">
                O11yFleet — OpenTelemetry fleet management
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildApprovalEmailText(data: TenantApprovalEmail): string {
  const isApproved = data.action === "approved";
  const title = isApproved ? "Your workspace is approved!" : "Your workspace application";

  if (isApproved) {
    return `${title}

Hello,

Your workspace "${data.tenantName}" has been approved.

You can now log in at https://o11yfleet.com/login and start using O11yFleet to manage your collector fleet.

---
O11yFleet — OpenTelemetry fleet management`;
  } else {
    return `${title}

Hello,

Your workspace "${data.tenantName}" was not approved at this time.

${data.reason ? `Reason: ${data.reason}\n` : ""}
If you believe this was a mistake or have questions, please contact us at support@o11yfleet.com.

---
O11yFleet — OpenTelemetry fleet management`;
  }
}

export async function sendEmail(
  env: Env,
  options: EmailOptions,
  category: EmailCategory = "default",
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured(env)) {
    console.warn("[email] Cloudflare Email Service not configured, skipping:", options.subject);
    return { success: false, error: "Email service not configured" };
  }

  try {
    const fromAddress = getFromAddress(env, category);
    const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

    await env.CLOUDFLARE_EMAIL_SENDER!.send({
      to: toAddresses,
      from: fromAddress,
      subject: options.subject,
      body: options.html,
      bodyType: "html",
    });

    console.warn("[email] Sent:", { from: fromAddress, to: toAddresses, subject: options.subject });
    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[email] Send failed:", errorMessage);
    return { success: false, error: errorMessage };
  }
}

export async function sendTenantApprovalEmail(
  env: Env,
  data: TenantApprovalEmail,
): Promise<{ success: boolean; error?: string }> {
  const isApproved = data.action === "approved";
  const subject = isApproved
    ? `[O11yFleet] Your workspace "${data.tenantName}" is approved!`
    : `[O11yFleet] Your workspace application for "${data.tenantName}"`;

  return sendEmail(env, {
    to: data.tenantEmail,
    subject,
    html: buildApprovalEmailHtml(data),
    text: buildApprovalEmailText(data),
  });
}

export function isAutoApproveEnabled(env: Env): boolean {
  return env.FP_SIGNUP_AUTO_APPROVE === "true";
}
