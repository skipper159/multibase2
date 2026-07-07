import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CAPTCHA_TTL_MS = 5 * 60 * 1000; // token valid for 5 minutes
const HMAC_ALGO = 'sha256';

/** Returns the HMAC secret. Falls back to SESSION_SECRET so it works out-of-the-box. */
function getSecret(): string {
  const secret = process.env.CAPTCHA_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('CAPTCHA_SECRET (or SESSION_SECRET) must be set');
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Captcha generation
// ---------------------------------------------------------------------------

interface CaptchaChallenge {
  /** Signed token (base64url) that encodes answer + expiry; safe to send to client */
  token: string;
  /** SVG markup of the rendered challenge (send as-is to the browser) */
  svg: string;
}

/**
 * Generates a random arithmetic challenge, renders it as a noisy SVG and
 * returns a signed token that the client must echo back with the answer.
 */
export function generateCaptcha(): CaptchaChallenge {
  const { expression, answer } = buildExpression();
  const token = signToken(answer);
  const svg = renderSvg(expression);
  return { token, svg };
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

interface TokenPayload {
  answer: number;
  exp: number; // Unix timestamp in ms
}

function signToken(answer: number): string {
  const payload: TokenPayload = {
    answer,
    exp: Date.now() + CAPTCHA_TTL_MS,
  };
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac(HMAC_ALGO, getSecret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

/**
 * Validates the token returned by the client.
 *
 * @returns `true` if the token is valid, not expired, and the supplied answer
 *          matches the encoded answer.
 */
export function validateCaptcha(token: string, rawAnswer: string): boolean {
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return false;

    // Verify signature (constant-time comparison)
    const expectedSig = crypto
      .createHmac(HMAC_ALGO, getSecret())
      .update(b64)
      .digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return false;
    }

    // Decode and check expiry
    const payload: TokenPayload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) return false;

    // Check answer
    const userAnswer = parseInt(rawAnswer.trim(), 10);
    if (isNaN(userAnswer)) return false;

    return userAnswer === payload.answer;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Expression builder
// ---------------------------------------------------------------------------

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

type Op = '+' | '-' | '*';

function buildExpression(): { expression: string; answer: number } {
  const op: Op = (['+', '-', '*'] as Op[])[rand(0, 2)];
  let a: number, b: number, answer: number;

  switch (op) {
    case '+':
      a = rand(1, 20);
      b = rand(1, 20);
      answer = a + b;
      break;
    case '-':
      a = rand(5, 20);
      b = rand(1, a);
      answer = a - b;
      break;
    case '*':
      a = rand(2, 9);
      b = rand(2, 9);
      answer = a * b;
      break;
  }

  return { expression: `${a} ${op} ${b}`, answer };
}

// ---------------------------------------------------------------------------
// SVG renderer
// ---------------------------------------------------------------------------

const WIDTH = 200;
const HEIGHT = 60;
const FONT_SIZE = 28;
const COLORS = ['#c084fc', '#818cf8', '#38bdf8', '#34d399', '#fb923c'];

function randColor(): string {
  return COLORS[rand(0, COLORS.length - 1)];
}

/**
 * Renders a math expression as an SVG string with:
 *  - a dark background
 *  - random noise dots
 *  - random crossing lines
 *  - each character slightly rotated and offset
 */
function renderSvg(expression: string): string {
  const lines: string[] = [];

  // Background
  lines.push(
    `<rect width="${WIDTH}" height="${HEIGHT}" rx="8" fill="#1e1e2e"/>`
  );

  // Noise dots
  for (let i = 0; i < 60; i++) {
    const cx = rand(0, WIDTH);
    const cy = rand(0, HEIGHT);
    const r = rand(1, 2);
    lines.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${randColor()}" opacity="0.35"/>`);
  }

  // Interference lines
  for (let i = 0; i < 5; i++) {
    const x1 = rand(0, WIDTH);
    const y1 = rand(0, HEIGHT);
    const x2 = rand(0, WIDTH);
    const y2 = rand(0, HEIGHT);
    lines.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${randColor()}" stroke-width="1.2" opacity="0.45"/>`
    );
  }

  // Characters, slightly jittered & rotated
  const chars = expression.split('');
  const totalWidth = chars.length * 22;
  let startX = Math.floor((WIDTH - totalWidth) / 2) + 11;

  for (const ch of chars) {
    const dy = rand(-4, 4);
    const rotate = rand(-18, 18);
    const cy = Math.floor(HEIGHT / 2);
    lines.push(
      `<text ` +
        `x="${startX}" ` +
        `y="${cy + dy + FONT_SIZE / 3}" ` +
        `font-size="${FONT_SIZE}" ` +
        `font-family="monospace" ` +
        `font-weight="bold" ` +
        `fill="${randColor()}" ` +
        `transform="rotate(${rotate},${startX},${cy})" ` +
        `text-anchor="middle"` +
      `>${escapeXml(ch)}</text>`
    );
    startX += 22;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    lines.join('') +
    `</svg>`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
