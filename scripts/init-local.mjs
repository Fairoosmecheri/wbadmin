import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.info("Existing .env preserved.");
} else if (process.env.NODE_ENV === "production") {
  throw new Error("Configure production variables securely; local initialization is development-only.");
} else {
  const password = randomBytes(24).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const example = readFileSync(".env.example", "utf8");
  const output = example.replaceAll("replace-with-a-unique-local-password", password).replace("replace-with-at-least-32-random-characters", secret);
  writeFileSync(".env", output, { flag: "wx", mode: 0o600 });
  chmodSync(".env", 0o600);
  console.info("Created local .env with unique database and authentication credentials. WhatsApp mode: mock.");
}
