const { Client } = require('ssh2');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

/**
 * SSH Connection Pool - Manages reusable SSH connections
 * Similar to SSH ControlMaster functionality
 */
class SSHConnectionPool {
  constructor() {
    this.connections = new Map(); // connectionKey -> { client, refCount, params }
    this.maxIdleTime = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Generate a unique key for connection pooling
   */
  getConnectionKey(params) {
    return `${params.host}:${params.port}:${params.username}`;
  }

  /**
   * Get or create a pooled SSH connection
   */
  async getConnection(params) {
    const key = this.getConnectionKey(params);
    const pooled = this.connections.get(key);

    if (pooled && pooled.client && pooled.client._sock && pooled.client._sock.readable) {
      console.log(`[SSH Pool] Reusing connection: ${key}`);
      pooled.refCount++;
      clearTimeout(pooled.idleTimeout);
      return pooled.client;
    }

    console.log(`[SSH Pool] Creating new connection: ${key}`);
    const client = await this.createConnection(params);
    
    this.connections.set(key, {
      client,
      params,
      refCount: 1,
      createdAt: new Date(),
      idleTimeout: null
    });

    return client;
  }

  /**
   * Create a new SSH connection
   */
  createConnection(params) {
    return new Promise((resolve, reject) => {
      const client = new Client();
      
      const connectionConfig = {
        host: params.host,
        port: params.port || 22,
        username: params.username,
        readyTimeout: 20000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3
      };

      // Handle different authentication methods
      if (params.password) {
        connectionConfig.password = params.password;
      } else if (params.privateKey) {
        connectionConfig.privateKey = params.privateKey;
        if (params.passphrase) {
          connectionConfig.passphrase = params.passphrase;
        }
      }

      client.on('ready', () => {
        console.log(`[SSH] Connection established: ${params.host}`);
        resolve(client);
      });

      client.on('error', (err) => {
        console.error(`[SSH] Connection error: ${err.message}`);
        reject(err);
      });

      client.on('close', () => {
        console.log(`[SSH] Connection closed: ${params.host}`);
        const key = this.getConnectionKey(params);
        this.connections.delete(key);
      });

      client.connect(connectionConfig);
    });
  }

  /**
   * Release a connection (decrease ref count)
   */
  releaseConnection(params) {
    const key = this.getConnectionKey(params);
    const pooled = this.connections.get(key);

    if (pooled) {
      pooled.refCount--;
      console.log(`[SSH Pool] Released connection: ${key}, refCount: ${pooled.refCount}`);

      if (pooled.refCount <= 0) {
        // Start idle timeout
        pooled.idleTimeout = setTimeout(() => {
          console.log(`[SSH Pool] Closing idle connection: ${key}`);
          if (pooled.client) {
            pooled.client.end();
          }
          this.connections.delete(key);
        }, this.maxIdleTime);
      }
    }
  }

  /**
   * Close all connections
   */
  closeAll() {
    for (const [key, pooled] of this.connections.entries()) {
      console.log(`[SSH Pool] Closing connection: ${key}`);
      clearTimeout(pooled.idleTimeout);
      if (pooled.client) {
        pooled.client.end();
      }
    }
    this.connections.clear();
  }
}

/**
 * SSH Session Manager - Manages individual SSH terminal sessions
 */
class SSHSessionManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> SessionInfo
    this.connectionPool = new SSHConnectionPool();
    this.sessionStore = new SessionStore();
  }

  /**
   * Create a new SSH session
   */
  async createSession(ws, params, sessionId = null) {
    const id = sessionId || uuidv4();
    
    console.log(`[SSH Session] Creating session ${id} for ${params.username}@${params.host}`);

    try {
      // Get pooled connection
      const client = await this.connectionPool.getConnection(params);

      // Create a new shell session
      const stream = await new Promise((resolve, reject) => {
        client.shell({
          term: params.term || 'xterm-256color',
          cols: params.cols || 80,
          rows: params.rows || 30
        }, (err, channel) => {
          if (err) reject(err);
          else resolve(channel);
        });
      });

      // Store session info
      const sessionInfo = {
        sessionId: id,
        params: { ...params },
        stream,
        client,
        ws,
        created: new Date(),
        lastActivity: new Date()
      };

      this.sessions.set(id, sessionInfo);

      // Save session parameters for future duplication
      await this.sessionStore.saveSession(id, params);

      // Handle stream data
      stream.on('data', (data) => {
        sessionInfo.lastActivity = new Date();
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(JSON.stringify({
            type: 'ssh_data',
            sessionId: id,
            data: data.toString('utf-8')
          }));
        }
      });

      stream.on('close', () => {
        console.log(`[SSH Session] Stream closed: ${id}`);
        this.closeSession(id);
      });

      stream.stderr.on('data', (data) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'ssh_data',
            sessionId: id,
            data: data.toString('utf-8')
          }));
        }
      });

      console.log(`[SSH Session] Session ${id} created successfully`);
      return {
        sessionId: id,
        title: `${params.username}@${params.host}`,
        params: this.getSafeParams(params)
      };

    } catch (error) {
      console.error(`[SSH Session] Error creating session: ${error.message}`);
      throw error;
    }
  }

  /**
   * Duplicate an existing session (PuTTY-like)
   */
  async duplicateSession(ws, originalSessionId) {
    const originalSession = this.sessions.get(originalSessionId);
    
    if (!originalSession) {
      throw new Error('Original session not found');
    }

    console.log(`[SSH Session] Duplicating session ${originalSessionId}`);

    // Clone parameters from original session
    const clonedParams = {
      ...originalSession.params,
      // Preserve all connection details
      host: originalSession.params.host,
      port: originalSession.params.port,
      username: originalSession.params.username,
      password: originalSession.params.password,
      privateKey: originalSession.params.privateKey,
      passphrase: originalSession.params.passphrase,
      term: originalSession.params.term,
      cols: originalSession.params.cols,
      rows: originalSession.params.rows
    };

    // Create new session with same parameters
    // This will reuse the pooled connection if authentication is the same
    return await this.createSession(ws, clonedParams);
  }

  /**
   * Send input to SSH session
   */
  sendInput(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (session && session.stream) {
      session.lastActivity = new Date();
      session.stream.write(data);
    }
  }

  /**
   * Resize SSH terminal
   */
  resizeTerminal(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (session && session.stream) {
      session.stream.setWindow(rows, cols);
      session.params.cols = cols;
      session.params.rows = rows;
    }
  }

  /**
   * Close SSH session
   */
  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      console.log(`[SSH Session] Closing session: ${sessionId}`);
      
      if (session.stream) {
        session.stream.end();
      }

      // Release connection from pool
      this.connectionPool.releaseConnection(session.params);

      this.sessions.delete(sessionId);

      if (session.ws && session.ws.readyState === 1) {
        session.ws.send(JSON.stringify({
          type: 'ssh_closed',
          sessionId
        }));
      }
    }
  }

  /**
   * Get session info without sensitive data
   */
  getSafeParams(params) {
    return {
      host: params.host,
      port: params.port,
      username: params.username,
      term: params.term,
      hasPassword: !!params.password,
      hasPrivateKey: !!params.privateKey
    };
  }

  /**
   * Get all active sessions
   */
  getActiveSessions() {
    const sessions = [];
    for (const [id, session] of this.sessions.entries()) {
      sessions.push({
        sessionId: id,
        params: this.getSafeParams(session.params),
        created: session.created,
        lastActivity: session.lastActivity
      });
    }
    return sessions;
  }

  /**
   * Reconnect a disconnected session
   */
  async reconnectSession(ws, sessionId) {
    const savedParams = await this.sessionStore.getSession(sessionId);
    if (!savedParams) {
      throw new Error('Session parameters not found');
    }

    console.log(`[SSH Session] Reconnecting session: ${sessionId}`);
    return await this.createSession(ws, savedParams, sessionId);
  }

  /**
   * Cleanup - close all sessions
   */
  cleanup() {
    console.log('[SSH Session] Cleaning up all sessions');
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }
    this.connectionPool.closeAll();
  }
}

/**
 * Session Store - Persists session parameters
 */
class SessionStore {
  constructor(filePath = './data/ssh-sessions.json') {
    this.filePath = filePath;
    this.sessions = new Map();
    this.init();
  }

  async init() {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      
      try {
        const data = await fs.readFile(this.filePath, 'utf-8');
        const sessions = JSON.parse(data);
        this.sessions = new Map(Object.entries(sessions));
        console.log(`[SessionStore] Loaded ${this.sessions.size} saved sessions`);
      } catch (error) {
        // File doesn't exist yet
        this.sessions = new Map();
      }
    } catch (error) {
      console.error('[SessionStore] Error initializing:', error);
    }
  }

  async saveSession(sessionId, params) {
    this.sessions.set(sessionId, {
      ...params,
      savedAt: new Date().toISOString()
    });
    await this.persist();
  }

  async getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  async persist() {
    try {
      const obj = Object.fromEntries(this.sessions);
      await fs.writeFile(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (error) {
      console.error('[SessionStore] Error persisting:', error);
    }
  }

  async clearOldSessions(maxAge = 7 * 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let changed = false;

    for (const [id, session] of this.sessions.entries()) {
      const savedAt = new Date(session.savedAt).getTime();
      if (now - savedAt > maxAge) {
        this.sessions.delete(id);
        changed = true;
      }
    }

    if (changed) {
      await this.persist();
    }
  }
}

module.exports = { SSHSessionManager, SSHConnectionPool, SessionStore };
