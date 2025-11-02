import { describe, it, expect } from "vitest";
import ts from "typescript";
import { isTopLevelDeclaration } from "../../src/explodeDocument";

function sfFrom(code: string): ts.SourceFile {
  return ts.createSourceFile("index.ts", code, ts.ScriptTarget.Latest, true);
}

function topNodes(sf: ts.SourceFile): ts.Node[] {
  const nodes: ts.Node[] = [];
  sf.forEachChild(n => nodes.push(n));
  return nodes;
}

describe("isTopLevelDeclaration", () => {
  it("detects top-level classes, interfaces, enums, functions, types", () => {
    const code = `
      export class Foo {}
      interface IFoo { x: number }
      enum E { A, B }
      export function fun() { return 1 }
      type Alias = { y: string }
    `;
    const sf = sfFrom(code);
    const nodes = topNodes(sf);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      if (ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isEnumDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isTypeAliasDeclaration(n)) {
        expect(isTopLevelDeclaration(n, sf)).toBe(true);
      }
    }
  });

  it("accepts const and let, rejects var", () => {
    const code = `
      const A = 1;
      let B = 2;
      var C = 3;
    `;
    const sf = sfFrom(code);
    const nodes = topNodes(sf);
    const constDecl = nodes.find(n => ts.isVariableStatement(n) && n.getText(sf).includes("const A"));
    const letDecl = nodes.find(n => ts.isVariableStatement(n) && n.getText(sf).includes("let B"));
    const varDecl = nodes.find(n => ts.isVariableStatement(n) && n.getText(sf).includes("var C"));
    expect(constDecl && isTopLevelDeclaration(constDecl, sf)).toBe(true);
    expect(letDecl && isTopLevelDeclaration(letDecl, sf)).toBe(true);
    expect(varDecl && isTopLevelDeclaration(varDecl, sf)).toBe(false);
  });

  it("rejects nested declarations inside functions or classes", () => {
    const code = `
      function outer() {
        class Inner {}
        const X = 1;
      }
      class C {
        method() { const Y = 2 }
      }
    `;
    const sf = sfFrom(code);
    const nodes = topNodes(sf);
    for (const n of nodes) {
      expect(isTopLevelDeclaration(n, sf)).toBe(false);
    }
  });
});
