import nodemailer from "nodemailer";
import { env } from "../config.js";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

export async function sendPasswordResetEmail(
  to: string,
  resetToken: string
): Promise<void> {
  const resetUrl = `${env.APP_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #1a1a1a; margin-bottom: 16px;">Reset Your Password</h2>
      <p style="color: #555; line-height: 1.6;">
        We received a request to reset your password for your SAP O2C Explorer account. 
        Click the button below to set a new password.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetUrl}" 
           style="background: #eab308; color: #1a1a1a; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p style="color: #888; font-size: 13px; line-height: 1.5;">
        This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #aaa; font-size: 12px;">SAP O2C Explorer</p>
    </div>
  `;

  const smtp = getTransporter();

  if (!smtp) {
    // Development fallback — log reset link to console
    console.log("\n┌─────────────────────────────────────────┐");
    console.log("│  PASSWORD RESET (no SMTP configured)    │");
    console.log("├─────────────────────────────────────────┤");
    console.log(`│  Email: ${to}`);
    console.log(`│  Link:  ${resetUrl}`);
    console.log("└─────────────────────────────────────────┘\n");
    return;
  }

  await smtp.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: "Reset Your Password — SAP O2C Explorer",
    html,
  });
}
