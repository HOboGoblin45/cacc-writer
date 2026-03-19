// server/types.d.ts
// Ambient type declarations for Node.js globals and third-party modules
// whose type packages are not installed in node_modules.
// This file is auto-included by tsconfig.json via the server include glob.

// ── Node.js globals ──────────────────────────────────────────────────────────

declare var process: {
  env: Record<string, string | undefined>;
  cwd(): string;
  exit(code?: number): never;
  [key: string]: any;
};

// ── Node.js built-in modules ─────────────────────────────────────────────────

declare module 'path' {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export function normalize(p: string): string;
  export function isAbsolute(p: string): boolean;
  export function relative(from: string, to: string): string;
  export function parse(p: string): { root: string; dir: string; base: string; ext: string; name: string };
  export const sep: string;
  export const delimiter: string;
  const _default: {
    join: typeof join;
    resolve: typeof resolve;
    dirname: typeof dirname;
    basename: typeof basename;
    extname: typeof extname;
    normalize: typeof normalize;
    isAbsolute: typeof isAbsolute;
    relative: typeof relative;
    parse: typeof parse;
    sep: typeof sep;
    delimiter: typeof delimiter;
  };
  export default _default;
}

declare module 'url' {
  export function pathToFileURL(path: string): URL;
  export function fileURLToPath(url: string | URL): string;
  export function parse(urlStr: string, parseQueryString?: boolean, slashesDenoteHost?: boolean): any;
  export function format(urlObject: any): string;
  export function resolve(from: string, to: string): string;
}

// ── Third-party modules ──────────────────────────────────────────────────────

declare module 'langsmith' {
  export class RunTree {
    id: string;
    constructor(config: Record<string, any>);
    postRun(): Promise<void>;
    end(result?: Record<string, any>): Promise<void>;
    patchRun(): Promise<void>;
  }
  export default RunTree;
}

declare module 'langfuse' {
  export class Langfuse {
    constructor(config?: Record<string, any>);
    trace(params: Record<string, any>): any;
    generation(params: Record<string, any>): any;
    span(params: Record<string, any>): any;
    score(params: Record<string, any>): any;
    flush(): Promise<void>;
    shutdown(): Promise<void>;
    [key: string]: any;
  }
  export default Langfuse;
}

declare module 'uuid' {
  export function v4(): string;
  export function v1(): string;
  export function v5(name: string, namespace: string): string;
  export function v3(name: string, namespace: string): string;
  export function validate(uuid: string): boolean;
  export function parse(uuid: string): Uint8Array;
  export function stringify(arr: Uint8Array): string;
}

declare module '@langchain/langgraph' {
  export class StateGraph<T = any> {
    constructor(annotation: T);
    addNode(name: string, fn: (...args: any[]) => any): this;
    addEdge(from: string, to: string): this;
    addConditionalEdges(source: string, fn: (state: any) => string, map?: Record<string, string>): this;
    compile(): any;
  }
  export const END: string;
  export const START: string;
  export function Annotation<T>(config?: any): any;
  export namespace Annotation {
    function Root(fields: Record<string, any>): any;
  }
}

declare module '@langchain/openai' {
  export class ChatOpenAI {
    constructor(config?: Record<string, any>);
    invoke(messages: any[], options?: any): Promise<any>;
    bind(options: any): any;
    [key: string]: any;
  }
  export class OpenAIEmbeddings {
    constructor(config?: Record<string, any>);
    embedQuery(text: string): Promise<number[]>;
    embedDocuments(texts: string[]): Promise<number[][]>;
    [key: string]: any;
  }
}

declare module '@langchain/core/messages' {
  export class BaseMessage {
    constructor(content: string | Record<string, any>);
    content: string;
    [key: string]: any;
  }
  export class HumanMessage extends BaseMessage {
    constructor(content: string | Record<string, any>);
  }
  export class SystemMessage extends BaseMessage {
    constructor(content: string | Record<string, any>);
  }
  export class AIMessage extends BaseMessage {
    constructor(content: string | Record<string, any>);
  }
}

declare module '@pinecone-database/pinecone' {
  export class Pinecone {
    constructor(config?: Record<string, any>);
    index(name: string): any;
    listIndexes(): Promise<any>;
    createIndex(config: Record<string, any>): Promise<any>;
    [key: string]: any;
  }
}
