const express = require('express');
const WebSocket = require('ws');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const http = require('http');
const path = require('path');
const os = require('os');

class TerminalManager {
  constructor() {
    this.terminals = new Map();
    this.clients = new Map();
  }

  createTerminal(ws, cols = 80, rows = 30, title = null, kubeContext = null) {
    const sessionId = uuidv4();
    const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    
    console.log(`Creating terminal with shell: ${shell}`);
    console.log(`Environment: ${JSON.stringify({HOME: process.env.HOME, SHELL: process.env.SHELL})}`);
    console.log(`Kube context: ${kubeContext}`);
    
    // Create terminal process with custom environment
    try {
      const terminalEnv = { ...process.env };
      
      // Set KUBECONFIG context if specified
      if (kubeContext) {
        terminalEnv.KUBECONFIG_CONTEXT = kubeContext;
        // Add a custom PS1 prompt to show the kube context
        terminalEnv.PS1_PREFIX = `(${kubeContext}) `;
      }
      
      const terminal = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: cols,
        rows: rows,
        cwd: process.env.HOME || process.env.USERPROFILE || os.homedir(),
        env: terminalEnv
      });
      
      // Send initial commands to set up kubectl context
      if (kubeContext) {
        setTimeout(() => {
          terminal.write(`export KUBECONFIG_CONTEXT=${kubeContext}\r`);
          terminal.write(`kubectl config use-context ${kubeContext}\r`);
          terminal.write(`echo "Switched to Kubernetes context: ${kubeContext}"\r`);
        }, 1000);
      }

      // Store terminal and client connection
      this.terminals.set(sessionId, {
        terminal,
        title: title || `Terminal ${this.terminals.size + 1}`,
        created: new Date(),
        cols,
        rows,
        kubeContext
      });

      this.clients.set(sessionId, ws);

      // Handle terminal output
      terminal.on('data', (data) => {
        console.log(`Terminal ${sessionId} output:`, data.length, 'bytes');
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'data',
            sessionId,
            data
          }));
        }
      });

      // Handle terminal exit
      terminal.on('exit', (code) => {
        console.log(`Terminal ${sessionId} exited with code ${code}`);
        this.cleanupTerminal(sessionId);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'terminal_exit',
            sessionId,
            code
          }));
        }
      });

      console.log(`Terminal ${sessionId} created successfully`);
      return {
        sessionId,
        title: this.terminals.get(sessionId).title
      };
    } catch (error) {
      console.error('Error creating terminal:', error);
      throw new Error(`Failed to create terminal: ${error.message}`);
    }
  }

  cloneTerminal(ws, originalSessionId, cloneType, cols = 80, rows = 30) {
    const originalTerminal = this.terminals.get(originalSessionId);
    if (!originalTerminal) {
      throw new Error('Original terminal not found');
    }

    // For now, we'll implement simple cloning (new terminal in same directory)
    // In a full implementation, you'd handle tmux sessions for shared/window cloning
    return this.createTerminal(ws, cols, rows, `Clone of ${originalTerminal.title}`);
  }

  sendInput(sessionId, data) {
    const terminalData = this.terminals.get(sessionId);
    if (terminalData) {
      terminalData.terminal.write(data);
    }
  }

  resizeTerminal(sessionId, cols, rows) {
    const terminalData = this.terminals.get(sessionId);
    if (terminalData) {
      terminalData.terminal.resize(cols, rows);
      terminalData.cols = cols;
      terminalData.rows = rows;
    }
  }

  cleanupTerminal(sessionId) {
    const terminalData = this.terminals.get(sessionId);
    if (terminalData) {
      try {
        terminalData.terminal.kill();
      } catch (e) {
        console.error('Error killing terminal:', e);
      }
      this.terminals.delete(sessionId);
      this.clients.delete(sessionId);
    }
  }

  getTerminalList() {
    const list = [];
    for (const [sessionId, data] of this.terminals.entries()) {
      list.push({
        sessionId,
        title: data.title,
        created: data.created,
        cols: data.cols,
        rows: data.rows
      });
    }
    return list;
  }
}

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Terminal manager instance
const terminalManager = new TerminalManager();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    terminals: terminalManager.getTerminalList().length,
    uptime: process.uptime()
  });
});

// Get terminals list
app.get('/api/terminals', (req, res) => {
  res.json(terminalManager.getTerminalList());
});

// Get kubectl contexts
app.get('/api/kubectl-contexts', (req, res) => {
  const { exec } = require('child_process');
  
  exec('kubectl config get-contexts -o name', (error, stdout, stderr) => {
    if (error) {
      console.error('Error getting kubectl contexts:', error);
      res.json({ error: 'kubectl not available or no contexts found', contexts: [] });
      return;
    }
    
    const contexts = stdout.split('\n').filter(ctx => ctx.trim() !== '');
    res.json({ contexts });
  });
});

// WebSocket server
const wss = new WebSocket.Server({ 
  server,
  path: '/ws'
});

wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection established');
  
  // Send connection confirmation
  ws.send(JSON.stringify({
    type: 'connection_established',
    timestamp: new Date().toISOString()
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('Received WebSocket message:', data.type, data);
      
      switch (data.type) {
        case 'create_terminal':
          try {
            const result = terminalManager.createTerminal(
              ws, 
              data.cols || 80, 
              data.rows || 30, 
              data.title,
              data.kubeContext
            );
            ws.send(JSON.stringify({
              type: 'terminal_created',
              sessionId: result.sessionId,
              title: result.title
            }));
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              message: `Failed to create terminal: ${error.message}`
            }));
          }
          break;

        case 'clone_terminal':
          try {
            const result = terminalManager.cloneTerminal(
              ws,
              data.originalSessionId,
              data.cloneType,
              data.cols || 80,
              data.rows || 30
            );
            ws.send(JSON.stringify({
              type: 'terminal_created',
              sessionId: result.sessionId,
              title: result.title,
              cloned: true
            }));
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              message: `Failed to clone terminal: ${error.message}`
            }));
          }
          break;

        case 'input':
          terminalManager.sendInput(data.sessionId, data.data);
          break;

        case 'resize':
          terminalManager.resizeTerminal(data.sessionId, data.cols, data.rows);
          break;

        case 'close_terminal':
          terminalManager.cleanupTerminal(data.sessionId);
          ws.send(JSON.stringify({
            type: 'terminal_closed',
            sessionId: data.sessionId
          }));
          break;

        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    // Clean up terminals associated with this connection
    for (const [sessionId, client] of terminalManager.clients.entries()) {
      if (client === ws) {
        terminalManager.cleanupTerminal(sessionId);
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Terminal server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = { app, server, terminalManager };