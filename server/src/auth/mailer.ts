import nodemailer from 'nodemailer';
import type { Mailer } from './types';

const RESEND_URL = 'https://api.resend.com/emails';

export const smtpMailer = (url: string, from: string): Mailer => {
  const transport = nodemailer.createTransport(url);
  return {
    send: async (mail) => {
      await transport.sendMail({ from, ...mail });
    },
  };
};

export const resendMailer = (apiKey: string, from: string): Mailer => ({
  send: async (mail) => {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, ...mail }),
    });
    if (!response.ok) throw new Error(`Resend answered ${response.status}`);
  },
});
