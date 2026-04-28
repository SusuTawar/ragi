import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  Tool as McpTool,
} from "@modelcontextprotocol/sdk/types.js";
import { createIngestionPipeline } from "../ingest/pipeline.js";
import { loadConfig } from "../core/config.js";
import { createProjectContext } from "../core/project.js";

// Helper to safely get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return getErrorMessage(error);
  if (typeof error === 'string') return error;
  return String(error);
}

// Tool definition for rag_index
export const ragIndexTool: McpTool = {
  name: "rag_index",
  description: "Index files/directories for the specified project",
  inputSchema: {
    type: "object",
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory to index"
      },
      paths: {
        type: "array",
        items: {
          type: "string"
        },
        description: "Specific files or directories to index (relative to projectPath). If not provided, indexes entire project."
      }
    },
    required: ["projectPath"]
  }
};

// Tool definition for rag_search
export const ragSearchTool: McpTool = {
  name: "rag_search",
  description: "Semantic search in the specified project RAG",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query"
      },
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory to search"
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default: 10)",
        default: 10
      }
    },
    required: ["query", "projectPath"]
  }
};

// Tool definition for rag_list_projects
export const ragListProjectsTool: McpTool = {
  name: "rag_list_projects",
  description: "List available projects or validate a project path",
  inputSchema: {
    type: "object",
    properties: {
      projectPath: {
        type: "string",
        description: "Optional project path to validate or get info about. If not provided, shows current working directory info."
      }
    }
  }
};

// Handler for rag_index tool
export async function ragIndexHandler(args: any) {
  try {
    const { projectPath, paths = [] } = args;
    
    // Load configuration
    const config = await loadConfig();
    
    // Create project context
    const projectContext = await createProjectContext(projectPath);
    
    // Create ingestion pipeline
    const pipeline = await createIngestionPipeline(projectPath, config);
    
    // Index specific paths or entire project
    if (paths.length > 0) {
      for (const path of paths) {
        await pipeline.process(path);
      }
    } else {
      // Index entire project
      await pipeline.process(".");
    }
    
    return {
      content: [
        {
          type: "text",
          text: `Successfully indexed project at ${projectContext.path}`
        }
      ]
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error indexing project: ${getErrorMessage(error)}`
        }
      ],
      isError: true
    };
  }
}

// Handler for rag_search tool
export async function ragSearchHandler(args: any) {
  try {
    const { query, projectPath, limit = 10 } = args;
    
    // Load configuration
    const config = await loadConfig();
    
    // Create project context
    const projectContext = await createProjectContext(projectPath);
    
    // Import adapter and create vector store
    const { SqliteAdapter } = await import("../adapters/sqlite.js");
    
    // Get dimension from config model
    const modelName = config.embedding?.model || 'Xenova/all-MiniLM-L6-v2';
    const dimension = modelName.includes('all-MiniLM') ? 384 : 768;
    
    const vectorStore = new SqliteAdapter(
      projectContext.id,
      projectContext.dbPath,
      dimension
    );
    
    await vectorStore.init();
    
    // Import embedder and create embedder instance
    const { createEmbedder } = await import("../core/embedder.js");
    const embedder = createEmbedder(config);
    
    // Generate embedding for query
    const queryEmbeddingResult = await embedder.embed(query);
    const queryEmbedding = queryEmbeddingResult.embedding;
    
    // Search vector store
    const results = await vectorStore.search(queryEmbedding, limit);
    
    // Format results
    const formattedResults = results.map((result, index) => {
      return {
        id: `${index + 1}`,
        content: result.document,
        metadata: {
          ...result.metadata,
          distance: result.distance
        }
      };
    });
    
    // Create response object
    const textContent = {
      type: "text",
      text: JSON.stringify(formattedResults, null, 2)
    };

    const contentArray = [textContent];

    const responseObject = {
      content: contentArray
    };

    return responseObject;
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error searching project: ${getErrorMessage(error)}`
        }
      ],
      isError: true
    };
  }
}

// Handler for rag_list_projects tool
export async function ragListProjectsHandler(args: any) {
  try {
    const { projectPath } = args;
    
    // If projectPath is provided, validate it and return info
    // If not provided, return info about current directory
    const targetPath = projectPath || ".";
    
    // Import project utilities
    const { sanitizePath, generateProjectId, isPathAllowed, createProjectContext } = await import("../core/project.js");
    
    // Validate path if provided
    if (projectPath) {
      try {
        const sanitized = sanitizePath(projectPath);
        const isAllowed = isPathAllowed(projectPath);
        const projectId = generateProjectId(sanitized);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                projectPath: sanitized,
                projectId: projectId,
                isValid: true,
                isAllowed: isAllowed,
                ragDirectory: `${sanitized}/.rag`,
                message: "Project path is valid and accessible"
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                projectPath: projectPath,
                isValid: false,
                error: getErrorMessage(error)
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    } else {
      // Return current directory info
      const cwd = process.cwd();
      try {
        const sanitized = sanitizePath(cwd);
        const isAllowed = isPathAllowed(cwd);
        const projectId = generateProjectId(sanitized);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                currentDirectory: cwd,
                sanitizedPath: sanitized,
                projectId: projectId,
                isAllowed: isAllowed,
                ragDirectory: `${sanitized}/.rag`,
                message: "Current directory information"
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting project info: ${getErrorMessage(error)}`
            }
          ],
          isError: true
        };
      }
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error in rag_list_projects: ${getErrorMessage(error)}`
        }
      ],
      isError: true
    };
  }
}