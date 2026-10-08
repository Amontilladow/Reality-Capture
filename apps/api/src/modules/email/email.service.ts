import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

// Small, single-purpose: real email delivery for password resets, via
// nodemailer's SMTP transport (already an installed dependency, never
// previously used anywhere in this app). Deliberately throws on any
// failure -- not configured, can't connect, rejected send -- rather than
// swallowing it itself: the caller (AuthService.forgotPassword(), per its
// own enumeration-protection requirement) decides whether/how to hide that
// from the end user. This service has no opinion on that; it just sends,
// or explains why it couldn't.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('email.smtpHost')
      && this.config.get<string>('email.smtpUser')
      && this.config.get<string>('email.smtpPassword')
      && this.config.get<string>('email.smtpFrom'),
    );
  }

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('email.smtpHost'),
        port: this.config.get<number>('email.smtpPort'),
        // 465 is SMTPS (implicit TLS); every other common port (587, 25) uses STARTTLS instead.
        secure: this.config.get<number>('email.smtpPort') === 465,
        auth: {
          user: this.config.get<string>('email.smtpUser'),
          pass: this.config.get<string>('email.smtpPassword'),
        },
      });
    }
    return this.transporter;
  }

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM) -- cannot send password reset email.');
    }

    await this.getTransporter().sendMail({
      from: this.config.get<string>('email.smtpFrom'),
      to,
      subject: 'Reset your RealityCapture password',
      text: `We received a request to reset your RealityCapture password. Follow this link to choose a new one (it expires in 1 hour):\n\n${resetLink}\n\nIf you didn't request this, you can safely ignore this email.`,
      html: `
        <p>We received a request to reset your RealityCapture password.</p>
        <p><a href="${resetLink}">Click here to choose a new password</a> (this link expires in 1 hour).</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });
    this.logger.log(`Password reset email sent to ${to}`);
  }
}
