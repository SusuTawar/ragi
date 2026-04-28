// Abstract base adapter for vector stores
export interface VectorStoreAdapter {
  /** Initialize the vector store */
  init(): Promise<void>;
  
  /** Add documents with their embeddings */
  add(
    ids: string[],
    embeddings: number[][],
    documents: string[],
    metadata?: Record<string, any>[]
  ): Promise<void>;
  
  /** Search for similar documents */
  search(
    queryEmbedding: number[],
    limit: number
  ): Promise<Array<{ id: string; distance: number; document: string; metadata: Record<string, any> }>>;
  
  /** Delete documents by ID */
  delete(ids: string[]): Promise<void>;
  
  /** Clear all documents from the store */
  clear(): Promise<void>;
  
  /** Get the dimension of embeddings */
  dimension(): number;
}