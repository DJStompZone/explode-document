import * as path from "path";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 60000 });
  const testsRoot = path.resolve(__dirname, ".");

  const files = await glob("**/*.test.js", { cwd: testsRoot, nodir: true });
  for (const f of files) {
    mocha.addFile(path.resolve(testsRoot, f));
  }

  await new Promise<void>((resolve, reject) => {
    try {
      mocha.run(failures => (failures ? reject(new Error(`${failures} tests failed`)) : resolve()));
    } catch (err) {
      reject(err);
    }
  });
}
