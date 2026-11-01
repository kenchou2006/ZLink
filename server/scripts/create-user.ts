/**
 * Create (or reset) an activated account directly in D1, skipping email activation.
 * For local development, and for a deployment's first admin.
 *
 *   npm run user:create -- <username> [--email <email>] [--staff] [--superuser] [--remote]
 *
 * Running the script again with an existing username resets their password
 * and reactivates the account. Roles are only updated if --staff or --superuser
 * is explicitly provided.
 *
 * The password is asked for without echoing it (or read from the
 * CREATE_USER_PASSWORD environment variable for scripts), so it never lands
 * in an argument list or the shell history. It is hashed with the server's
 * own src/lib/crypto.ts, so the stored hash is exactly what sign-in checks.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../src/lib/crypto.ts";

function fail(message: string): never {
  console.error(`create-user: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const out: {
    username?: string;
    email?: string;
    isSuperUser?: boolean;
    isStaff?: boolean;
    remote: boolean;
  } = {
    remote: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i] ?? fail(`${arg} needs a value`);
    if (arg === "--email") out.email = value();
    else if (arg === "--superuser") out.isSuperUser = true;
    else if (arg === "--staff") out.isStaff = true;
    else if (arg === "--remote") out.remote = true;
    else if (arg.startsWith("--")) fail(`unknown option ${arg}`);
    else if (!out.username) out.username = arg;
    else fail(`unexpected argument ${arg}`);
  }

  if (!out.username) {
    fail(
      "usage: npm run user:create -- <username> [--email <email>] [--staff] [--superuser] [--remote]",
    );
  }

  return out as Required<Pick<typeof out, "username">> & typeof out;
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY)
      fail(
        "no terminal to ask for the password; set CREATE_USER_PASSWORD instead",
      );
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let input = "";
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(input);
      } else if (ch === "\u0003") {
        process.stdout.write("\n");
        process.exit(130);
      } else if (ch === "\u007f" || ch === "\b") {
        input = input.slice(0, -1);
      } else {
        input += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.CREATE_USER_PASSWORD;
  if (fromEnv) return fromEnv;
  const first = await askHidden("Password: ");
  const again = await askHidden("Password (again): ");
  if (first !== again) fail("the two passwords differ");
  return first;
}

const sqlStr = (val: string) => `'${val.replaceAll("'", "''")}'`;

const args = parseArgs(process.argv.slice(2));
const password = await readPassword();
if (password.length < 8) fail("the password needs at least 8 characters");

const hash = await hashPassword(password);
const now = new Date().toISOString();
const email = args.email || `${args.username}@example.com`;

const hasRoleFlag =
  args.isSuperUser !== undefined || args.isStaff !== undefined;
const initialSuper = args.isSuperUser ? 1 : 0;
const initialStaff = args.isSuperUser || args.isStaff ? 1 : 0;

let roleUpdateSql = "";
if (hasRoleFlag) {
  roleUpdateSql = `, is_staff = ${initialStaff}, is_superuser = ${initialSuper}`;
}
let emailUpdateSql = "";
if (args.email) {
  emailUpdateSql = `, email = ${sqlStr(args.email)}`;
}

const statement = `
INSERT INTO users (username, email, password, is_staff, is_superuser, is_active, date_joined, last_login)
VALUES (${sqlStr(args.username)}, ${sqlStr(email)}, ${sqlStr(hash)}, ${initialStaff}, ${initialSuper}, 1, ${sqlStr(now)}, NULL)
ON CONFLICT(username) DO UPDATE SET password = excluded.password, is_active = 1${roleUpdateSql}${emailUpdateSql};

INSERT OR IGNORE INTO profiles (user_id, avatar_url, password_login_disabled)
SELECT id, NULL, 0 FROM users WHERE username = ${sqlStr(args.username)};
`;

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "zlink",
    args.remote ? "--remote" : "--local",
    "--command",
    statement,
  ],
  {
    cwd: serverDir,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  },
);

if (result.status !== 0)
  fail(`wrangler d1 execute failed (exit ${result.status})`);

const roleDesc = hasRoleFlag
  ? `staff: ${Boolean(initialStaff)}, superuser: ${Boolean(initialSuper)}`
  : "kept existing role";
console.log(
  `User '${args.username}': active (${roleDesc}), ${args.remote ? "remote" : "local"} D1. Sign in with the password you entered.`,
);
