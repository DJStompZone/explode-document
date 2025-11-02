import * as ts from "typescript";
import * as vscode from "vscode";

/**
 * Determines whether a given TypeScript AST node is a top-level declaration
 * within the provided source file.
 *
 * A node is considered top-level when:
 * - its direct parent is the provided `sourceFile`, and
 * - it is one of the supported declaration kinds:
 *   ClassDeclaration, InterfaceDeclaration, EnumDeclaration,
 *   FunctionDeclaration, TypeAliasDeclaration, or a VariableStatement
 *   that contains at least one block-scoped declaration (const/let).
 *
 * @param node - The ts.Node to evaluate.
 * @param sourceFile - The ts.SourceFile in which to check top-level status.
 * @returns `true` if the node is a supported top-level declaration in the file; otherwise `false`.
 *
 * @remarks
 * Variable statements are considered top-level only if their declaration list
 * is block-scoped (i.e., uses `let` or `const`) and contains one or more declarations.
 *
 * @example
 * // true for `class C {}` declared at file root
 * // true for `const x = 1;` declared at file root
 * isTopLevelDeclaration(node, sourceFile);
 */

let channel: vscode.OutputChannel | undefined;

/** Get a shared output channel for the extension. */
function out(): vscode.OutputChannel {
  if (!channel) {channel = vscode.window.createOutputChannel("Explode Document");}
  return channel;
}

/** Append a timestamped line to the output channel and console.debug. */
function log(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  out().appendLine(line);
   
  console.debug(line);
}

/** Sleep helper to avoid racing the TS Server or FS in headless runs. */
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Determines whether a given TypeScript AST node is a top-level declaration within the provided source file.
 * Supported decls: class, interface, enum, function, type alias, and block-scoped variable statements (const or let).
 */
export function isTopLevelDeclaration(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  if (node.parent !== sourceFile) {return false;}
  if (
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {return true;}
  if (ts.isVariableStatement(node)) {
    const flags = node.declarationList.flags;
    const block = (flags & ts.NodeFlags.Const) !== 0 || (flags & ts.NodeFlags.Let) !== 0 || (flags & ts.NodeFlags.BlockScoped) !== 0;
    return block && node.declarationList.declarations.length > 0;
  }
  return false;
}

function isTSLike(doc: vscode.TextDocument): boolean {
  return (
    doc.languageId === "typescript" ||
    doc.languageId === "typescriptreact" ||
    doc.languageId === "javascript" ||
    doc.languageId === "javascriptreact"
  );
}

/** Try to ensure the built-in TS extension and TS Server are awake. */
async function waitForTypeScriptReady(doc: vscode.TextDocument): Promise<void> {
  const tsExt = vscode.extensions.getExtension("vscode.typescript-language-features");
  if (!tsExt) {
    log("TypeScript extension vscode.typescript-language-features not found");
  } else {
    log(`Activating TypeScript extension ${tsExt.id}`);
    try {
      await tsExt.activate();
      log("TypeScript extension activated");
    } catch (e) {
      log(`TypeScript extension activation error: ${(e as Error).message}`);
    }
  }

  // Nudge TS by asking for diagnostics a few times
  for (let i = 0; i < 20; i++) {
    const diags = vscode.languages.getDiagnostics(doc.uri);
    if (diags !== undefined) {
      log(`Diagnostics check ${i + 1} ok for ${doc.uri.fsPath}`);
      return;
    }
    await sleep(100);
  }
  log("Warning: diagnostics ping loop ended without confirmation");
}

/** Query the provider API for move-to-new-file code actions. Falls back to any-kinds and filters. */
async function queryMoveNewFileActions(doc: vscode.TextDocument, sel: vscode.Selection): Promise<vscode.CodeAction[]> {
  const KIND = "refactor.move.newFile";

  // Try strict kind string first
  try {
    log(`Query provider with kind ${KIND} at ${sel.start.line}:${sel.start.character}-${sel.end.line}:${sel.end.character}`);
    const a = (await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", doc.uri, sel, KIND)) || [];
    const filtered = a.filter(x => x.kind && vscode.CodeActionKind.RefactorMove.append("newFile").contains(x.kind));
    log(`Provider returned ${a.length} actions, filtered to ${filtered.length} by kind`);
    if (filtered.length) {return filtered;}
  } catch (e) {
    log(`Provider kind query rejected: ${(e as Error).message}`);
  }

  // Fallback: no kind, filter manually
  log("Query provider without kind and filter client-side");
  const any = (await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", doc.uri, sel)) || [];
  const filtered = any.filter(
    x => (x.kind && vscode.CodeActionKind.RefactorMove.append("newFile").contains(x.kind)) || /Move to a new file/i.test(x.title ?? "")
  );
  log(`Provider no-kind returned ${any.length} actions, filtered to ${filtered.length}`);
  return filtered;
}

/** Directly ask VS Code to run the first matching code action for a given kind. */
async function executeEditorCodeAction(kind: string): Promise<boolean> {
  try {
    log(`Invoke editor.action.codeAction with kind ${kind} and apply first`);
    await vscode.commands.executeCommand("editor.action.codeAction", { kind, apply: "first", preferred: false });
    return true;
  } catch (e) {
    log(`editor.action.codeAction failed: ${(e as Error).message}`);
    return false;
  }
}

export async function explodeDocument(): Promise<void> {
  out().show(true);
  log("==== Explode Document invoked ====");

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    const msg = "Explode Document: No active editor";
    log(msg);
    void vscode.window.showErrorMessage(msg);
    return;
  }

  const doc = editor.document;
  log(`Active document ${doc.uri.fsPath} lang=${doc.languageId}`);

  if (!isTSLike(doc)) {
    const msg = "Explode Document: TS or JS files only";
    log(msg);
    void vscode.window.showErrorMessage(msg);
    return;
  }

  await waitForTypeScriptReady(doc);

  const text = doc.getText();
  const sf = ts.createSourceFile(doc.fileName, text, ts.ScriptTarget.Latest, true);

  type Target = { start: number; end: number; label: string; kind: string };
  const targets: Target[] = [];

  function push(start: number, end: number, label: string, kind: string): void {
    targets.push({ start, end, label, kind });
  }

  function visit(n: ts.Node): void {
    if (!isTopLevelDeclaration(n, sf)) {
      ts.forEachChild(n, visit);
      return;
    }

    if (!ts.isVariableStatement(n)) {
      const named = n as ts.ClassDeclaration | ts.InterfaceDeclaration | ts.EnumDeclaration | ts.FunctionDeclaration | ts.TypeAliasDeclaration;
      const id = named.name;
      const label = id ? id.getText(sf) : "<anonymous>";
      push(id ? id.getStart(sf, true) : n.getStart(sf, true), id ? id.getEnd() : n.getEnd(), label, ts.SyntaxKind[n.kind]);
    } else {
      const first = n.declarationList.declarations[0];
      if (first) {
        if (ts.isIdentifier(first.name)) {
          push(first.name.getStart(sf, true), first.name.getEnd(), first.name.text, "Variable");
        } else {
          push(first.getStart(sf, true), first.getEnd(), "<var>", "Variable");
        }
      }
    }
  }

  ts.forEachChild(sf, visit);

  if (targets.length === 0) {
    const msg = "Explode Document: No top-level declarations found";
    log(msg);
    void vscode.window.showInformationMessage(msg);
    return;
  }

  // Bottom to top to avoid offset drift
  targets.sort((a, b) => b.start - a.start);

  log(`Found ${targets.length} top-level decls`);
  targets.forEach((t, i) => {
    const s = doc.positionAt(t.start);
    const e = doc.positionAt(t.end);
    log(`Decl ${i + 1}/${targets.length} label=${t.label} kind=${t.kind} range=${s.line}:${s.character}-${e.line}:${e.character}`);
  });

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Explode Document running", cancellable: false },
    async progress => {
      let done = 0;

      for (const t of targets) {
        const s = doc.positionAt(t.start);
        const e = doc.positionAt(t.end);
        const sel = new vscode.Selection(s, e);
        editor.selection = sel;
        editor.revealRange(new vscode.Range(s, e), vscode.TextEditorRevealType.InCenterIfOutsideViewport);

        progress.report({ message: `Processing ${++done}/${targets.length} ${t.label}` });
        log(`Processing ${done}/${targets.length} label=${t.label} set selection and reveal`);

        // Try provider path first and apply each by resolving via vscode.executeCodeAction
        let usedProvider = false;
        try {
          const actions = await queryMoveNewFileActions(doc, sel);
          log(`Provider path candidate count for ${t.label}: ${actions.length}`);
          for (const action of actions) {
            const kindStr = action.kind?.value ?? "(no kind)";
            log(`Executing CodeAction via vscode.executeCodeAction title="${action.title}" kind="${kindStr}"`);
            await vscode.commands.executeCommand("vscode.executeCodeAction", action);
            usedProvider = true;
            // Small pause for FS settle
            await sleep(120);
            break; // apply only the first matching “Move to a new file”
          }
        } catch (e) {
          log(`Provider execute failed for ${t.label}: ${(e as Error).message}`);
        }

        if (usedProvider) {continue;}

        // Fallback path: generic codeAction executor
        log(`No provider-executed action for ${t.label}. Fallback to editor.action.codeAction kind=refactor.move.newFile`);
        const ok = await executeEditorCodeAction("refactor.move.newFile");
        if (!ok) {
          log(`Fallback codeAction executor did not apply for ${t.label}`);
        } else {
          log(`Fallback applied for ${t.label}`);
          await sleep(150);
        }
      }
    }
  );

  log("Explode Document finished");
  void vscode.window.showInformationMessage("Explode Document finished. See the Output panel for logs");
}
