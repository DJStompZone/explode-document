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

export function isTopLevelDeclaration(
  node: ts.Node,
  sourceFile: ts.SourceFile
): boolean {
  const isTop = (n: ts.Node) => node.parent === sourceFile;
  if (!isTop(node)) {
    return false;
  }
  if (
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    return true;
  }
  if (ts.isVariableStatement(node)) {
    const declList = node.declarationList;
    const isBlockScoped =
      (declList.flags & ts.NodeFlags.BlockScoped) !== 0 ||
      (declList.flags & ts.NodeFlags.Const) !== 0 ||
      (declList.flags & ts.NodeFlags.Let) !== 0;
    if (isBlockScoped && declList.declarations.length > 0) {
      return true;
    }
  }
  return false;
}

function checkDocumentLanguage(doc: vscode.TextDocument): boolean {
  return (
    doc.languageId === "typescript" ||
    doc.languageId === "typescriptreact" ||
    doc.languageId === "javascript" ||
    doc.languageId === "javascriptreact"
  );
}

export async function explodeDocument() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showErrorMessage("Explode Document: No active editor.");
    return;
  }

  const doc = editor.document;
  const ok = checkDocumentLanguage(doc);
  if (!ok) {
    void vscode.window.showErrorMessage("Explode Document: TS/JS files only.");
    return;
  }

  const text = doc.getText();
  const sf = ts.createSourceFile(
    doc.fileName,
    text,
    ts.ScriptTarget.Latest,
    true
  );

  // Collect target ranges at the name span of each top-level declaration.
  const nameRanges: vscode.Range[] = [];
  const isTop = (n: ts.Node) => n.parent === sf;

  const pushNameRange = (start: number, end: number) => {
    nameRanges.push(
      new vscode.Range(doc.positionAt(start), doc.positionAt(end))
    );
  };

  function visit(n: ts.Node): void {
    if (!isTop(n)) {
      ts.forEachChild(n, visit);
      return;
    }

    if (!isTopLevelDeclaration(n, sf)) {
      ts.forEachChild(n, visit);
      return;
    } else if (!ts.isVariableStatement(n)) {
      // Prefer the identifier only (tight name span) if present; else the whole node.
      const id = (
        n as
          | ts.ClassDeclaration
          | ts.InterfaceDeclaration
          | ts.EnumDeclaration
          | ts.FunctionDeclaration
          | ts.TypeAliasDeclaration
      ).name;
      if (id) {
        pushNameRange(id.getStart(sf, true), id.getEnd());
      } else {
        pushNameRange(n.getStart(sf, true), n.getEnd());
      }
    } else {
      const declList = n.declarationList;
      const isBlockScoped =
        (declList.flags & ts.NodeFlags.BlockScoped) !== 0 ||
        (declList.flags & ts.NodeFlags.Const) !== 0 ||
        (declList.flags & ts.NodeFlags.Let) !== 0;
      if (isBlockScoped && declList.declarations.length > 0) {
        const first = declList.declarations[0];
        if (ts.isIdentifier(first.name)) {
          pushNameRange(first.name.getStart(sf, true), first.name.getEnd());
        } else {
          pushNameRange(first.getStart(sf, true), first.getEnd());
        }
      }
    }
  }
  visit(sf);

  if (nameRanges.length === 0) {
    void vscode.window.showInformationMessage(
      "Explode Document: No top-level declarations found."
    );
    return;
  }

  const MOVE_NEWFILE_KIND =
    vscode.CodeActionKind.RefactorMove.append("newFile").value;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Explode Document: Move each decl to a new file",
      cancellable: false,
    },
    async (progress) => {
      let done = 0;
      for (const range of nameRanges) {
        progress.report({
          message: `Processing ${++done}/${nameRanges.length}`,
        });

        const actions =
          (await vscode.commands.executeCommand<vscode.CodeAction[]>(
            "vscode.executeCodeActionProvider",
            doc.uri,
            range,
            MOVE_NEWFILE_KIND
          )) || [];

        const candidates = actions.filter(
          (a) =>
            a.kind &&
            vscode.CodeActionKind.RefactorMove.append("newFile").contains(
              a.kind
            )
        );

        for (const action of candidates) {
          try {
            if (action.edit) {
              await vscode.workspace.applyEdit(action.edit, {
                isRefactoring: true,
              });
            }
            if (action.command) {
              await vscode.commands.executeCommand(
                action.command.command,
                ...(action.command.arguments ?? [])
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            void vscode.window.showWarningMessage(
              `Explode Document: one declaration failed: ${msg}`
            );
          }
        }
      }
    }
  );

  void vscode.window.showInformationMessage(
    "Explode Document: Done. Sanity-check the results before committing."
  );
}
