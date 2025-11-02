import * as assert from "assert";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

async function waitForFiles(dir: string, names: string[], ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const hits = await Promise.all(names.map(async n => {
      try { await fs.stat(path.join(dir, n)); return true; } catch { return false; }
    }));
    if (hits.every(Boolean)) {return;}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for files: ${names.join(", ")}`);
}

describe("Explode Document E2E", function () {
  this.timeout(90000);

  let wsDir: string;

  before(async () => {
    // Prefer explicit env from runTests; else take the opened workspace folder.
    wsDir = process.env.TEST_WORKSPACE || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    assert.ok(wsDir, "TEST_WORKSPACE not set and no workspace open");

    // Open the file that we precreated in runTest.ts
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(wsDir, "index.ts")));
    await vscode.window.showTextDocument(doc);
  });

  it("explodes a TS file into per-declaration files", async () => {
    await vscode.commands.executeCommand("explodeDocument.run");

    const expected = ["Foo.ts", "Baz.ts", "K.ts", "bar.ts", "Qux.ts"];
    await waitForFiles(wsDir, expected, 30000);

    const fooTxt = await fs.readFile(path.join(wsDir, "Foo.ts"), "utf8");
    assert.match(fooTxt, /class\s+Foo\b/, "Foo.ts should contain class Foo");

    const barTxt = await fs.readFile(path.join(wsDir, "bar.ts"), "utf8");
    assert.match(barTxt, /function\s+bar\b/, "bar.ts should contain function bar");
  });
});
