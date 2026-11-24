import { randomBytes } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface, emitKeypressEvents } from 'node:readline';
import bcrypt from 'bcryptjs';
import { parse } from 'dotenv';
import { authenticator } from 'otplib';
import qrcode from 'qrcode-terminal';

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer) => rl.question(question, (answer) => {
    rl.close();
    resolveAnswer(answer);
  }));
}

function askSecret(question: string): Promise<string> {
  return new Promise((resolveAnswer, reject) => {
    process.stdout.write(question);
    let value = '';
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (err?: Error) => {
      process.stdin.removeListener('keypress', onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (err) reject(err);
      else resolveAnswer(value);
    };
    const onKeypress = (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('Configuración cancelada.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') value = Array.from(value).slice(0, -1).join('');
      // Control characters are explicitly excluded from secret input.
      // eslint-disable-next-line no-control-regex
      else if (!key.ctrl && text && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    };
    process.stdin.on('keypress', onKeypress);
  });
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Se requiere una terminal interactiva.');
  const path = resolve(process.cwd(), '.env');
  let original = '';
  let existed = false;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('.env debe ser un archivo normal, no un enlace.');
    original = await readFile(path, 'utf8');
    existed = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const existing = parse(original);
  if (existing.OWNER_USERNAME || existing.OWNER_PASSWORD_HASH || existing.TOTP_SECRET) {
    const answer = await ask('Ya existe configuración de autenticación. ¿Reemplazarla? [s/N] ');
    if (answer.trim().toLowerCase() !== 's') throw new Error('Configuración cancelada.');
  }

  const username = (await ask('Usuario propietario: ')).trim();
  // eslint-disable-next-line no-control-regex
  if (!username || username.length > 255 || /[\x00-\x1f\x7f]/.test(username) ||
      (username.includes("'") && (username.includes('"') || /\\[nr]/.test(username)))) {
    throw new Error('Usuario inválido: contiene caracteres incompatibles con .env.');
  }
  const password = await askSecret('Contraseña (sin eco): ');
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('La contraseña debe tener al menos 12 caracteres y como máximo 72 bytes UTF-8.');
  }
  if (password !== await askSecret('Confirma la contraseña: ')) throw new Error('Las contraseñas no coinciden.');

  const secret = authenticator.generateSecret();
  const values: Record<string, string> = {
    OWNER_USERNAME: username,
    OWNER_PASSWORD_HASH: await bcrypt.hash(password, 12),
    TOTP_SECRET: secret,
    JWT_SECRET: existing.JWT_SECRET || randomBytes(64).toString('hex'),
  };

  // Refuse any multiline quoted assignment: its contents could resemble another key.
  // Preserve all unrelated lines and existing JWT assignments verbatim.
  const lines = original.split(/\r?\n/);
  const seen = new Set<string>();
  const updated = lines.map((line) => {
    const assignment = line.match(/^\s*(?:export\s+)?[\w.-]+\s*=\s*(.*)$/);
    const raw = assignment?.[1].trim();
    if (raw && (raw.startsWith('"') || raw.startsWith("'") || raw.startsWith('`'))) {
      const quote = raw[0];
      const closing = raw.lastIndexOf(quote);
      if (closing === 0 || !/^\s*(?:#.*)?$/.test(raw.slice(closing + 1))) {
        throw new Error('Hay una asignación multilínea o ambigua en .env; no se modificó el archivo.');
      }
    }
    const match = line.match(/^\s*(?:export\s+)?(OWNER_USERNAME|OWNER_PASSWORD_HASH|TOTP_SECRET|JWT_SECRET)\s*=\s*(.*)$/);
    if (!match) return line;
    seen.add(match[1]);
    if (match[1] === 'JWT_SECRET' && existing.JWT_SECRET) return line;
    const value = values[match[1]];
    const quoted = match[1] === 'OWNER_USERNAME' ? (value.includes("'") ? `"${value}"` : `'${value}'`) : match[1] === 'OWNER_PASSWORD_HASH' ? `'${value}'` : value;
    return `${match[1]}=${quoted}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      const quoted = key === 'OWNER_USERNAME' ? (value.includes("'") ? `"${value}"` : `'${value}'`) : key === 'OWNER_PASSWORD_HASH' ? `'${value}'` : value;
      updated.push(`${key}=${quoted}`);
    }
  }
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const output = updated.join(newline).replace(/(?:\r?\n)*$/, newline);
  const temp = join(dirname(path), `.env.auth-${randomBytes(16).toString('hex')}.tmp`);
  let created = false;
  try {
    const file = await open(temp, 'wx', 0o600);
    created = true;
    try { await file.writeFile(output, 'utf8'); } finally { await file.close(); }
    try {
      const info = await lstat(path);
      if (!existed || !info.isFile() || info.isSymbolicLink() || await readFile(path, 'utf8') !== original) {
        throw new Error('.env cambió durante la configuración; no se modificó el archivo.');
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || existed) throw err;
    }
    await rename(temp, path);
    created = false;
  } finally {
    if (created) await unlink(temp).catch(() => undefined);
  }

  console.log('Configuración guardada. Escanea el QR en un lugar privado; concede acceso a la cuenta.');
  qrcode.generate(authenticator.keyuri(username, 'Loop', secret), { small: true });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Error al configurar la autenticación.');
  process.exitCode = 1;
});