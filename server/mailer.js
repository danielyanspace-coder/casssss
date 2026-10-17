/**
 * Письма игрокам: пока только ссылка сброса пароля.
 *
 * Почтовый сервер задаётся одной строкой SMTP_URL
 * (smtps://логин:пароль@smtp.example.com:465) и адресом отправителя MAIL_FROM.
 * Пока их нет, сброс пароля по почте выключен, и форма входа говорит игроку
 * написать в поддержку, а не обещает письмо, которое не придёт.
 *
 * SMTP_URL=log - письмо не уходит, а печатается в журнал сервера. Это для
 * разработки и тестов: ссылку сброса видно без настоящего ящика.
 */

import nodemailer from 'nodemailer';

let transport = null;
let transportKey = '';

/** Последнее письмо в режиме log: тесты достают из него ссылку. */
export let lastLoggedMail = null;

export function isMailConfigured() {
  return Boolean(process.env.SMTP_URL && (process.env.MAIL_FROM || process.env.SMTP_URL === 'log'));
}

function getTransport() {
  const url = process.env.SMTP_URL || '';
  if (transport && transportKey === url) return transport;
  transport = url === 'log' ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport(url);
  transportKey = url;
  return transport;
}

export async function sendMail({ to, subject, text }) {
  if (!isMailConfigured()) throw Object.assign(new Error('Почта не настроена'), { code: 'MAIL_OFF' });
  const message = { from: process.env.MAIL_FROM || 'LUCKYBOX <no-reply@localhost>', to, subject, text };
  const info = await getTransport().sendMail(message);
  if (process.env.SMTP_URL === 'log') {
    lastLoggedMail = message;
    console.log(`[почта] ${to}: ${subject}\n${text}`);
  }
  return info;
}
