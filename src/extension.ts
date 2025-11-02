import * as vscode from "vscode";
import { explodeDocument } from "./explodeDocument";
/**
 * Explode Document Extension
 *
 * Splits each top-level declaration in the current TS/JS document into its own file.
 *
 * Decls covered:
 * - class/interface/enum/function
 * - const/let variables (first declarator name)
 *
 * Author: DJ Stomp <85457381+DJStompZone@users.noreply.github.com>
 * License: MIT
 */

export function deactivate() {}

export function activate(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand(
    "explodeDocument.run",
    explodeDocument
  );

  context.subscriptions.push(cmd);
}
