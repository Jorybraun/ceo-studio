"use strict";
/**
 * Vertex AI Embeddings Service — semantic search for the Brain system.
 *
 * Provides embedding generation using Google Cloud Vertex AI, enabling
 * semantic search and similarity matching for artifacts, decisions, and
 * other brain content. This enhances the local brain system with
 * intelligent retrieval capabilities.
 *
 * Authentication methods:
 * - GOOGLE_APPLICATION_CREDENTIALS (service account key)
 * - Application Default Credentials (ADC)
 * - VERTEX_API_KEY (API key)
 */

class EmbeddingsProvider {
  constructor({ projectId, location = "us-central1", model = "textembedding-gecko@001" } = {}) {
    this.projectId = projectId;
    this.location = location;
    this.model = model;
  }

  /**
   * Generate embeddings for text using Vertex AI.
   * @param {string[]} texts - Array of texts to embed
   * @returns {Promise<number[][]>} Array of embedding vectors
   */
  async generateEmbeddings(texts) {
    throw new Error("generateEmbeddings() not implemented");
  }

  /**
   * Calculate cosine similarity between two embedding vectors.
   * @param {number[]} vecA - First embedding vector
   * @param {number[]} vecB - Second embedding vector
   * @returns {number} Similarity score between 0 and 1
   */
  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
      throw new Error("Vectors must have same length");
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Find most similar items using embedding similarity.
   * @param {number[]} queryEmbedding - Query embedding vector
   * @param {Array<{embedding: number[], data: any}>} items - Items with embeddings
   * @param {number} topK - Number of top results to return
   * @returns {Array<{similarity: number, data: any}>} Sorted by similarity
   */
  findMostSimilar(queryEmbedding, items, topK = 5) {
    const similarities = items.map(item => ({
      similarity: this.cosineSimilarity(queryEmbedding, item.embedding),
      data: item.data
    }));
    
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }
}

class VertexAIEmbeddings extends EmbeddingsProvider {
  constructor({ projectId, location = "us-central1", model = "textembedding-gecko@001", apiKey = null } = {}) {
    super({ projectId, location, model });
    this.apiKey = apiKey;
    this.baseUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
  }

  async generateEmbeddings(texts) {
    if (!Array.isArray(texts)) {
      texts = [texts];
    }

    const headers = {
      "Content-Type": "application/json",
    };

    // Try different authentication methods
    if (this.apiKey) {
      headers["x-goog-api-key"] = this.apiKey;
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Use service account credentials (handled by gcloud SDK)
      // For simplicity, we'll use the API key approach or require explicit setup
    } else {
      // Try application default credentials
      // This would require the google-auth-library package
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          instances: texts.map(text => ({ content: text }))
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Vertex AI API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const embeddings = data.predictions.map(p => p.embeddings.values);
      
      return embeddings.length === 1 ? embeddings[0] : embeddings;
    } catch (error) {
      throw new Error(`Failed to generate embeddings: ${error.message}`);
    }
  }
}

/**
 * Fallback embeddings provider using simple keyword matching.
 * Used when Vertex AI is not configured or fails.
 */
class SimpleEmbeddings extends EmbeddingsProvider {
  async generateEmbeddings(texts) {
    // Simple token-based similarity as fallback
    if (!Array.isArray(texts)) {
      texts = [texts];
    }
    
    return texts.map(text => {
      const tokens = this.tokenize(text);
      return this.tokensToVector(tokens);
    });
  }

  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(token => token.length > 2);
  }

  tokensToVector(tokens) {
    // Create a simple hash-based vector
    const vector = new Array(128).fill(0);
    tokens.forEach(token => {
      const hash = this.simpleHash(token);
      const index = Math.abs(hash) % vector.length;
      vector[index] += 1;
    });
    
    // Normalize
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => norm > 0 ? val / norm : 0);
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }
}

/**
 * Create an embeddings provider based on environment configuration.
 * Falls back to simple embeddings if Vertex AI is not configured.
 */
function createEmbeddingsProvider(env = process.env) {
  const projectId = env.GOOGLE_CLOUD_PROJECT || env.GOOGLE_PROJECT_ID;
  const apiKey = env.VERTEX_API_KEY;
  
  if (projectId && (apiKey || env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return new VertexAIEmbeddings({
      projectId,
      location: env.VERTEX_LOCATION || "us-central1",
      model: env.VERTEX_MODEL || "textembedding-gecko@001",
      apiKey
    });
  }
  
  // Fallback to simple embeddings
  console.log("Vertex AI not configured, using simple embeddings fallback");
  return new SimpleEmbeddings();
}

module.exports = {
  EmbeddingsProvider,
  VertexAIEmbeddings,
  SimpleEmbeddings,
  createEmbeddingsProvider
};