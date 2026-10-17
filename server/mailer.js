/**
 * Письма игрокам: пока только ссылка сброса пароля.
 *
 * Основной путь - API Resend (RESEND_API_KEY): обычный HTTPS-запрос, без
 * SMTP-портов, которые у части хостингов закрыты. Запасной - любой SMTP одной
 * строкой SMTP_URL (smtps://логин:пароль@smtp.example.com:465). Отправитель -
 * MAIL_FROM.
 *
 * ПОКА ДОМЕН НЕ ПОДТВЕРЖДЁН В RESEND, письма уходят только с
 * onboarding@resend.dev и только на почту владельца аккаунта Resend. Игрокам
 * они не дойдут. Домен подтверждается DNS-записями в кабинете Resend, после
 * этого MAIL_FROM меняется на адрес этого домена.
 *
 * Пока ни ключа, ни SMTP нет, сброс пароля по почте выключен, и форма входа
 * говорит игроку написать в поддержку, а не обещает письмо, которое не придёт.
 *
 * SMTP_URL=log - письмо не уходит, а печатается в журнал сервера. Это для
 * разработки и тестов: ссылку сброса видно без настоящего ящика.
 */

import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

const RESEND_URL = 'https://api.resend.com/emails';

/*
 * Повторы только на перегрузке и сбоях Resend (429, 5xx) и обрыве сети.
 * Отказ 4xx - это неверный ключ или неподтверждённый отправитель, повтор его
 * не исправит. Ключ идемпотентности один на все попытки: если первая дошла,
 * а ответ потерялся, второе письмо не уйдёт.
 */
const RESEND_RETRIES = 2;
const RESEND_BACKOFF_MS = 800;
const RESEND_TIMEOUT_MS = 10_000;

let transport = null;
let transportKey = '';

/** Последнее письмо в режиме log: тесты достают из него ссылку. */
export let lastLoggedMail = null;

const sender = () => process.env.MAIL_FROM || 'LUCKYBOX <onboarding@resend.dev>';

export function isMailConfigured() {
  if (process.env.RESEND_API_KEY) return true;
  return Boolean(process.env.SMTP_URL && (process.env.MAIL_FROM || process.env.SMTP_URL === 'log'));
}

function getTransport() {
  const url = process.env.SMTP_URL || '';
  if (transport && transportKey === url) return transport;
  transport = url === 'log' ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport(url);
  transportKey = url;
  return transport;
}

async function sendViaResend(message) {
  const idempotencyKey = randomUUID();
  let lastError = null;
  for (let attempt = 0; attempt <= RESEND_RETRIES; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, RESEND_BACKOFF_MS * 2 ** (attempt - 1)));
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { id: data.id };
      lastError = Object.assign(new Error(`Resend ${res.status}: ${data.message || data.name || 'отказ'}`),
        { code: 'MAIL_REJECTED', status: res.status });
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function sendMail({ to, subject, text }) {
  if (!isMailConfigured()) throw Object.assign(new Error('Почта не настроена'), { code: 'MAIL_OFF' });
  const message = { from: sender(), to, subject, text };

  if (process.env.RESEND_API_KEY) return sendViaResend(message);

  const info = await getTransport().sendMail(message);
  if (process.env.SMTP_URL === 'log') {
    lastLoggedMail = message;
    console.log(`[почта] ${to}: ${subject}\n${text}`);
  }
  return info;
}
