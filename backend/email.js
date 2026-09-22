// Transactional email. Sends via SMTP when configured (SMTP_HOST/USER/PASS),
// otherwise runs in "log mode": every message is recorded in the email_log table
// (and printed) so the flow is testable without a mail provider. Add credentials
// and emails start delivering for real — no code change.
import nodemailer from 'nodemailer';
import { query } from './db.js';

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  EMAIL_FROM,
} = process.env;

export const emailConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transport = null;
if (emailConfigured) {
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

const FROM = EMAIL_FROM || SMTP_USER || 'PanHost <no-reply@panhost.app>';

export async function sendEmail({ userId = null, to, subject, html, text }) {
  const body = html || text || '';
  let status = 'logged';
  let errorMsg = null;

  if (transport && to) {
    try {
      await transport.sendMail({ from: FROM, to, subject, text: text || undefined, html: html || undefined });
      status = 'sent';
    } catch (err) {
      status = 'failed';
      errorMsg = err.message;
      console.error('[email] send failed:', err.message);
    }
  } else {
    console.log(`[email:log] to=${to} subject="${subject}" (no SMTP configured — logged only)`);
  }

  try {
    await query(
      `INSERT INTO email_log (user_id, recipient, subject, body, status, error)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, to || null, subject || '', body, status, errorMsg]
    );
  } catch (err) {
    console.error('[email] could not record email_log:', err.message);
  }
  return { status };
}

// Simple branded HTML wrapper.
export function emailTemplate({ heading, lines = [], cta }) {
  const body = lines.map((l) => `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.6">${l}</p>`).join('');
  const button = cta
    ? `<a href="${cta.url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;margin-top:8px">${cta.label}</a>`
    : '';
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <div style="font-size:20px;font-weight:800;color:#4f46e5;margin-bottom:16px">🏡 PanHost</div>
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 16px">${heading}</h1>
    ${body}${button}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
    <p style="color:#94a3b8;font-size:12px">Sent by PanHost property management.</p>
  </div>`;
}
