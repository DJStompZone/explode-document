/**
 * Runs the VS Code extension tests using @vscode/test-electron.
 * Prepares a temp TS workspace on disk, then launches the Dev Host pointed at it.
 */
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { runTests } from "@vscode/test-electron";

async function writeFile(p: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data, "utf8");
}

async function makeWorkspace(): Promise<string> {
  const wsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "explode-e2e-"));
  const tsconfig = `{
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "Bundler",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true
    }
  }`;
  const index = `
    export class Foo { n = 1 }
    export interface Baz { x: number }
    export enum K { A = 1, B = 2 }
    export function bar() { return 42 }
    export const Qux = 7
  `;
  await writeFile(path.join(wsRoot, "tsconfig.json"), tsconfig);
  await writeFile(path.join(wsRoot, "index.ts"), index);
  return wsRoot;
}

async function main(): Promise<void> {
  const workspacePath = await makeWorkspace();

  const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index");

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      workspacePath, // <— open this workspace immediately
      "--disable-telemetry",
      "--skip-welcome",
      "--skip-release-notes"
      // DO NOT pass --disable-extensions; we want TS + your extension loaded
    ],
    extensionTestsEnv: {
      TEST_WORKSPACE: workspacePath
    }
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
