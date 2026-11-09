/**
 * @fileoverview Pins the mutation-testing scope to the code that ships. The shipped source is the
 * closure of the relative imports of the package entries in `tsup.config.ts`; every file in it must
 * either be matched by `mutate` in `stryker.config.json` or be listed below with the reason it is
 * not. A file that is neither, a listed file that no longer exists, a listed file that `mutate`
 * still matches, and a listed file whose kind no longer holds all fail, so an exclusion cannot go
 * stale or hide runtime code behind a name such as `index.ts`.
 * @layer repository tooling, tests
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import * as ts from 'typescript'

const ROOT = resolve(__dirname, '..')

/** Why shipped files are not mutated, and the property that justifies it, checked against the files. */
type ExclusionKind = 'barrel' | 'types' | 'data'

interface Exclusion {
  readonly kind: ExclusionKind
  readonly reason: string
  readonly files: readonly string[]
}

/** Every shipped source file that `mutate` leaves out. */
const EXCLUSIONS: readonly Exclusion[] = [
  {
    kind: 'barrel',
    reason:
      'Re-exports only: there is no statement to mutate, and a barrel that gains logic fails this spec.',
    files: ['src/server/index.ts', 'src/server/interfaces/index.ts', 'src/shared/index.ts'],
  },
  {
    kind: 'types',
    reason:
      'Types only: it compiles to nothing, and a runtime declaration added to it fails this spec.',
    files: ['src/server/interfaces/*.interface.ts', 'src/shared/types/*.ts'],
  },
  {
    kind: 'data',
    reason:
      'Constant tables and tokens: literals, enum members and Symbol() calls with no function, branch or ' +
      'operator, so Stryker generates 0 mutants for them (measured on the constants files). Their values are ' +
      'pinned whole by constant-tables.spec.ts, default-options usage in apply-defaults.spec.ts, and ' +
      'readme-tables.spec.ts for the error messages and statuses. Logic added to one fails this spec.',
    files: [
      'src/server/bymax-storage.constants.ts',
      'src/server/constants/default-options.constants.ts',
      'src/server/errors/storage-error-messages.ts',
      'src/server/errors/storage-error-status.ts',
      'src/shared/constants/*.constants.ts',
    ],
  },
]

/** The text of a file under the repository root. */
function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

/** A glob (`**`, `*`, literal text) as a regular expression over repository-relative paths. */
function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const rest = glob.slice(i)
    if (rest.startsWith('**/')) {
      source += '(?:.*/)?'
      i += 2
    } else if (rest.startsWith('**')) {
      source += '.*'
      i += 1
    } else if (glob[i] === '*') {
      source += '[^/]*'
    } else {
      source += glob[i]!.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

/** Whether the path is selected by the `mutate` list: patterns apply in order, `!` removes. */
function mutated(path: string, mutate: readonly string[]): boolean {
  let selected = false
  for (const entry of mutate) {
    const negated = entry.startsWith('!')
    if (globToRegExp(negated ? entry.slice(1) : entry).test(path)) selected = !negated
  }
  return selected
}

/** The package entry files named by `tsup.config.ts`. */
function entries(): string[] {
  return [...read('tsup.config.ts').matchAll(/entry:\s*\{\s*'[^']+':\s*'([^']+)'/g)].map(
    (match) => match[1]!,
  )
}

/** The relative module specifiers a source file imports or re-exports, as written. */
function relativeSpecifiers(text: string): string[] {
  return [...text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/?[^'"]*)['"]/g)].map(
    (match) => match[1]!,
  )
}

/** The file a relative specifier resolves to from `from`, or `undefined` when it is not TypeScript source. */
function resolveSpecifier(from: string, specifier: string): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier))
  return [`${base}.ts`, `${base}/index.ts`].find((candidate) => existsSync(join(ROOT, candidate)))
}

/** The source closure of the package entries: every non-spec file they reach through relative imports. */
function shippedSource(): string[] {
  const seen = new Set<string>()
  const queue = entries()
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    if (seen.has(path)) continue
    seen.add(path)
    for (const specifier of relativeSpecifiers(read(path))) {
      const next = resolveSpecifier(path, specifier)
      if (next !== undefined) queue.push(next)
    }
  }
  return [...seen].sort()
}

/** Every shipped file a listed exclusion matches, with the exclusion that matched it. */
function excluded(shipped: readonly string[]): Map<string, Exclusion> {
  const found = new Map<string, Exclusion>()
  for (const exclusion of EXCLUSIONS) {
    for (const pattern of exclusion.files) {
      const matcher = globToRegExp(pattern)
      for (const path of shipped) if (matcher.test(path)) found.set(path, exclusion)
    }
  }
  return found
}

/** The statements the compiler emits for the source, without the module boilerplate every file gets. */
function emittedStatements(text: string): string[] {
  const { outputText } = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
      removeComments: true,
    },
  })
  return outputText
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== '' &&
        line !== '"use strict";' &&
        line !== 'Object.defineProperty(exports, "__esModule", { value: true });' &&
        !line.startsWith('//'),
    )
}

/** The source with comments removed. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Kinds of node that make a constants file logic: a function, a class, a branch or an operator. */
const LOGIC_NODES = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.TaggedTemplateExpression,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.BinaryExpression,
  ts.SyntaxKind.PrefixUnaryExpression,
  ts.SyntaxKind.PostfixUnaryExpression,
  ts.SyntaxKind.TypeOfExpression,
  ts.SyntaxKind.VoidExpression,
  ts.SyntaxKind.DeleteExpression,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.NewExpression,
  ts.SyntaxKind.TemplateExpression,
])

/** What makes the text more than data, by the compiler's own tree; empty when it is only data. */
function logicIn(text: string): string[] {
  const source = ts.createSourceFile('data.ts', text, ts.ScriptTarget.ES2022, true)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (LOGIC_NODES.has(node.kind)) found.push(ts.SyntaxKind[node.kind])
    if (ts.isCallExpression(node) && node.expression.getText(source) !== 'Symbol') {
      found.push(`call ${node.expression.getText(source)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const mutateList = (JSON.parse(read('stryker.config.json')) as { mutate: string[] }).mutate
const shipped = shippedSource()
const listed = excluded(shipped)

describe('mutation scope', () => {
  it('finds the shipped source from the package entries', () => {
    // An empty closure would make every other check pass vacuously.
    expect(entries()).toHaveLength(2)
    expect(shipped).toEqual(expect.arrayContaining(['src/server/index.ts', 'src/shared/index.ts']))
    expect(shipped.length).toBeGreaterThan(40)
  })

  it('mutates every shipped file that is not listed with a reason', () => {
    // A shipped file is mutated or its absence is explained; nothing is left out by accident.
    const unexplained = shipped.filter((path) => !mutated(path, mutateList) && !listed.has(path))
    expect(unexplained).toEqual([])
  })

  it('lists no file that mutate still selects', () => {
    // A listed file that `mutate` still selects would be both mutated and excused.
    expect([...listed.keys()].filter((path) => mutated(path, mutateList))).toEqual([])
  })

  it('lists no pattern that matches no shipped file', () => {
    // A pattern that matches nothing is a reason about code that is gone.
    for (const exclusion of EXCLUSIONS) {
      for (const pattern of exclusion.files) {
        const matches = shipped.filter((path) => globToRegExp(pattern).test(path)).length
        expect({ pattern, matches }).not.toEqual({ pattern, matches: 0 })
      }
      expect(exclusion.reason.length).toBeGreaterThan(20)
    }
  })

  it('keeps every listed barrel to re-exports', () => {
    // A barrel holds re-exports only: any other statement is code the exclusion would hide.
    const reexport =
      /(?:export|import)\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+'[^']+'/g
    for (const [path, exclusion] of listed) {
      if (exclusion.kind !== 'barrel') continue
      expect({ path, rest: withoutComments(read(path)).replace(reexport, '').trim() }).toEqual({
        path,
        rest: '',
      })
    }
  })

  it('keeps every listed types file free of runtime output', () => {
    // The compiler, not a list of keywords, decides what is runtime.
    for (const [path, exclusion] of listed) {
      if (exclusion.kind !== 'types') continue
      expect({ path, emitted: emittedStatements(read(path)) }).toEqual({ path, emitted: [] })
    }
  })

  it('detects runtime output in a types file that a keyword scan misses', () => {
    // Re-exports, default exports, namespaces and bare calls all emit code.
    expect(
      emittedStatements(
        "export type A = { a: 1 }\nexport interface B { b: A }\nimport type { C } from './c'",
      ),
    ).toEqual([])
    expect(emittedStatements("export { value } from './runtime'")).not.toEqual([])
    expect(emittedStatements('export default { a: 1 }')).not.toEqual([])
    expect(emittedStatements('export namespace N { export const x = 1 }')).not.toEqual([])
    expect(emittedStatements('Object.freeze({})')).not.toEqual([])
  })

  it('keeps every listed data file free of functions, branches and operators', () => {
    // A constants file that gains logic has to leave the list and be mutated.
    for (const [path, exclusion] of listed) {
      if (exclusion.kind !== 'data') continue
      expect({ path, logic: logicIn(read(path)) }).toEqual({ path, logic: [] })
    }
  })

  it('detects logic in a data file', () => {
    // Literals, enum members and Symbol() are data; anything computed is not.
    expect(
      logicIn(
        "export const A = { b: 'c' } as const\nexport const S = Symbol('s')\nexport const N = Http.OK",
      ),
    ).toEqual([])
    expect(logicIn('export const A = 5 * 1024')).toEqual(['BinaryExpression'])
    expect(logicIn('export const A = () => 1')).toEqual(['ArrowFunction'])
    expect(logicIn('export const A = b ? 1 : 2')).toEqual(['ConditionalExpression'])
    expect(logicIn('export const A = load()')).toEqual(['call load'])
    expect(logicIn('export class A {}')).toEqual(['ClassDeclaration'])
    expect(logicIn('export const A = !true')).toEqual(['PrefixUnaryExpression'])
    expect(logicIn('export const A = -1')).toEqual(['PrefixUnaryExpression'])
    expect(logicIn('let n = 0\nexport const A = n++')).toEqual(['PostfixUnaryExpression'])
    expect(logicIn("export const A = typeof 'a'")).toEqual(['TypeOfExpression'])
    expect(logicIn('export const A = void 0')).toEqual(['VoidExpression'])
    expect(logicIn('export const A = delete b.c')).toEqual(['DeleteExpression'])
    expect(logicIn('export const A = { value() { return 1 } }')).toEqual(['MethodDeclaration'])
    expect(logicIn('export const A = { get value() { return 1 } }')).toEqual(['GetAccessor'])
    expect(logicIn('export const A = { set value(v: number) {} }')).toEqual(['SetAccessor'])
    expect(logicIn('export const A = tag`x`')).toEqual(['TaggedTemplateExpression'])
  })
})
