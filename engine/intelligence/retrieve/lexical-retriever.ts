import type {
  ContextClaim,
  RepositoryRetriever,
  RetrieveQueryOptions,
  SourceReference,
} from '../contracts';
import { createInstructionResolver } from '../instructions/resolver';
import type { SqlJsIndexStore } from '../store/sqljs-index-store';
import { hybridSearchRepositoryContext, hitsToClaims } from './hybrid-ranker';
import type { SearchRepositoryContextOptions } from './types';

/**
 * Hybrid repository retriever: symbol, path, lexical, dependency, call-graph,
 * test, and instruction signals — no embedding dependency required for V0.1.
 */
export class LexicalRepositoryRetriever implements RepositoryRetriever {
  private instructionReady: Promise<
    Awaited<ReturnType<typeof createInstructionResolver>> | undefined
  >;

  constructor(private readonly indexStore: SqlJsIndexStore) {
    this.instructionReady = createInstructionResolver({
      workspaceRoot: indexStore.workspaceRoot,
    }).catch(() => undefined);
  }

  async retrieve(
    query: string,
    options: RetrieveQueryOptions = {}
  ): Promise<{
    readonly claims: readonly ContextClaim[];
    readonly references: readonly SourceReference[];
    readonly incomplete: boolean;
    readonly notes?: readonly string[];
  }> {
    const store = this.indexStore.ragStore;
    const resolver = await this.instructionReady;
    const searchOpts: SearchRepositoryContextOptions = {
      k: options.k ?? 16,
      pathHint: options.pathHint,
      preferMemory: options.preferMemory,
      mode: options.mode,
      profile: options.profile,
      debug: false,
    };
    const result = await hybridSearchRepositoryContext(
      store,
      query,
      searchOpts,
      resolver
    );
    const mapped = hitsToClaims(result.results);
    return {
      claims: mapped.claims,
      references: mapped.references,
      incomplete: result.incomplete,
      notes: result.notes,
    };
  }
}
