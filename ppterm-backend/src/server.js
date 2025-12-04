const express = require('express');
const WebSocket = require('ws');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const http = require('http');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const { SSHSessionManager } = require('./SSHSessionManager');
const { log } = require('console');

const execAsync = promisify(exec);

class UserImageStore {
  constructor(filePath = './data/user-images.json') {
    this.filePath = filePath;
    this.images = [];
    this.init();
  }

  async init() {
    try {
      // Ensure data directory exists
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      
      // Load existing images
      try {
        const data = await fs.readFile(this.filePath, 'utf-8');
        this.images = JSON.parse(data);
        console.log(`Loaded ${this.images.length} user-defined images`);
      } catch (error) {
        // File doesn't exist yet, start with empty array
        this.images = [];
        await this.save();
      }
    } catch (error) {
      console.error('Error initializing user image store:', error);
      this.images = [];
    }
  }

  async save() {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(this.images, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error saving user images:', error);
    }
  }

  async addImage(image) {
    if (!this.images.includes(image)) {
      this.images.unshift(image); // Add to beginning
      await this.save();
      console.log(`Added user image: ${image}`);
    }
    return this.images;
  }

  async removeImage(image) {
    const index = this.images.indexOf(image);
    if (index > -1) {
      this.images.splice(index, 1);
      await this.save();
      console.log(`Removed user image: ${image}`);
    }
    return this.images;
  }

  getImages() {
    return [...this.images];
  }
}

class ContainerManager {
  constructor() {
    this.containers = new Map();
    this.runtime = null;
  }

  async detectRuntime() {
    if (this.runtime) return this.runtime;

    // Try Docker first
    try {
      await execAsync('docker --version');
      this.runtime = 'docker';
      console.log('Using Docker as container runtime');
      return 'docker';
    } catch (error) {
      console.log('Docker not available, trying containerd...');
    }

    // Try containerd (nerdctl)
    try {
      await execAsync('nerdctl --version');
      this.runtime = 'nerdctl';
      console.log('Using containerd (nerdctl) as container runtime');
      return 'nerdctl';
    } catch (error) {
      console.log('Containerd not available');
    }

    throw new Error('No container runtime found (Docker or containerd)');
  }

  async pullImage(image) {
    const runtime = await this.detectRuntime();
    console.log(`Pulling image: ${image} using ${runtime}`);
    
    // check if image exists
    const images = await this.listImages();
    console.log('Check Images:', images,image);
    if (images.includes(image)) {
      console.log(`Image ${image} already exists`);
      return { success: true, output: '' };
    }

    try {
      const { stdout, stderr } = await execAsync(`${runtime} pull ${image}`);
      console.log('Image pulled successfully:', stdout);
      return { success: true, output: stdout };
    } catch (error) {
      console.error('Error pulling image:', error);
      throw new Error(`Failed to pull image: ${error.message}`);
    }
  }

  async createContainer(image, sessionId) {
    const runtime = await this.detectRuntime();
    const containerName = `ppterm-sandbox-${sessionId}`;
    
    console.log(`Creating container: ${containerName} from image: ${image}`);
    
    try {
      // Create and start container in detached mode with interactive terminal
      const command = `${runtime} run -dit --name ${containerName} --rm ${image} /bin/sh`;
      const { stdout } = await execAsync(command);
      const containerId = stdout.trim();
      
      this.containers.set(sessionId, {
        containerId,
        containerName,
        image,
        created: new Date()
      });
      
      console.log(`Container created: ${containerId}`);
      return { containerId, containerName };
    } catch (error) {
      console.error('Error creating container:', error);
      throw new Error(`Failed to create container: ${error.message}`);
    }
  }

  async execInContainer(containerId, shell = '/bin/sh') {
    const runtime = await this.detectRuntime();
    
    // Use docker/nerdctl exec to attach to the container
    // We'll spawn a pty process that runs docker exec
    const args = ['exec', '-it', containerId, shell];
    
    console.log(`Executing in container: ${runtime} ${args.join(' ')}`);
    
    return {
      command: runtime,
      args: args
    };
  }

  async stopContainer(sessionId) {
    const containerData = this.containers.get(sessionId);
    if (!containerData) {
      console.log(`No container found for session: ${sessionId}`);
      return;
    }

    const runtime = await this.detectRuntime();
    const { containerName } = containerData;
    
    try {
      console.log(`Stopping container: ${containerName}`);
      await execAsync(`${runtime} stop ${containerName}`);
      this.containers.delete(sessionId);
      console.log(`Container stopped: ${containerName}`);
    } catch (error) {
      console.error('Error stopping container:', error);
      // Container might already be stopped/removed due to --rm flag
      this.containers.delete(sessionId);
    }
  }

  async listImages() {
    const runtime = await this.detectRuntime();
    
    try {
      const { stdout } = await execAsync(`${runtime} images --format '{{.Repository}}:{{.Tag}}'`);
      const images = stdout.split('\n').filter(img => img.trim() !== '' && !img.includes('<none>'));
      return images;
    } catch (error) {
      console.error('Error listing images:', error);
      return [];
    }
  }
}

class TerminalManager {
  constructor(containerManager) {
    this.terminals = new Map();
    this.clients = new Map();
    this.containerManager = containerManager;
  }

  async createSandboxTerminal(ws, cols, rows, image, title) {
    const sessionId = uuidv4();
    
    try {
      // Pull image if needed
      await this.containerManager.pullImage(image);
      
      // Create container
      const { containerId, containerName } = await this.containerManager.createContainer(image, sessionId);
      
      // Get exec command for container
      const sandbox = await this.containerManager.execInContainer(containerId);
      
      // Create terminal with sandbox
      return this.createTerminal(ws, cols, rows, title || `Sandbox: ${image}`, null, { ...sandbox, containerId, sessionId });
    } catch (error) {
      console.error('Error creating sandbox terminal:', error);
      throw error;
    }
  }

  createTerminal(ws, cols = 80, rows = 30, title = null, kubeContext = null, sandbox = null) {
    const sessionId = sandbox?.sessionId || uuidv4();
    const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    
    console.log(`Creating terminal with shell: ${shell}`);
    console.log(`Environment: ${JSON.stringify({HOME: process.env.HOME, SHELL: process.env.SHELL})}`);
    console.log(`Kube context: ${kubeContext}`);
    console.log(`Sandbox: ${sandbox ? JSON.stringify(sandbox) : 'none'}`);
    
    // Create terminal process with custom environment
    try {
      const terminalEnv = { ...process.env };
      let spawnCommand = shell;
      let spawnArgs = [];
      let isSandbox = false;
      
      // Set KUBECONFIG context if specified
      if (kubeContext) {
        terminalEnv.KUBECONFIG_CONTEXT = kubeContext;
        // Add a custom PS1 prompt to show the kube context
        terminalEnv.PS1_PREFIX = `(${kubeContext}) `;
      }

      // Handle sandbox mode
      if (sandbox && sandbox.containerId) {
        isSandbox = true;
        spawnCommand = sandbox.command;
        spawnArgs = sandbox.args;
        console.log(`Spawning sandbox terminal: ${spawnCommand} ${spawnArgs.join(' ')}`);
      }
      
      const terminal = pty.spawn(spawnCommand, spawnArgs, {
        name: 'xterm-256color',
        cols: cols,
        rows: rows,
        cwd: isSandbox ? undefined : (process.env.HOME || process.env.USERPROFILE || os.homedir()),
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
        kubeContext,
        isSandbox,
        containerId: sandbox?.containerId,
        cwd: isSandbox ? '/root' : (process.env.HOME || process.env.USERPROFILE || os.homedir())
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

    console.log(`[Duplicate] Duplicating terminal ${originalSessionId}`);
    console.log(`[Duplicate] Original terminal info:`, {
      cwd: originalTerminal.cwd,
      isSandbox: originalTerminal.isSandbox,
      containerId: originalTerminal.containerId,
      kubeContext: originalTerminal.kubeContext
    });
    
    // Check if this is a sandbox terminal - reuse the same container
    if (originalTerminal.isSandbox && originalTerminal.containerId) {
      console.log(`[Duplicate] This is a sandbox terminal, reusing container: ${originalTerminal.containerId}`);
      const sessionId = uuidv4();
      
      try {
        // Get the runtime command from containerManager
        const runtime = this.containerManager.runtime || 'docker';
        const args = ['exec', '-it', originalTerminal.containerId, '/bin/sh'];
        
        console.log(`[Duplicate] Spawning new session in container: ${runtime} ${args.join(' ')}`);
        
        const terminal = pty.spawn(runtime, args, {
          name: 'xterm-256color',
          cols: cols,
          rows: rows,
          env: { ...process.env }
        });

        // Store terminal with sandbox info
        this.terminals.set(sessionId, {
          terminal,
          title: `${originalTerminal.title} (2)`,
          created: new Date(),
          cols,
          rows,
          kubeContext: null,
          isSandbox: true,
          containerId: originalTerminal.containerId,
          cwd: '/root'
        });

        this.clients.set(sessionId, ws);

        // Handle terminal output
        terminal.on('data', (data) => {
          if (ws.readyState === 1) { // WebSocket.OPEN
            ws.send(JSON.stringify({
              type: 'data',
              sessionId,
              data
            }));
          }
        });

        // Handle terminal exit
        terminal.on('exit', (code) => {
          console.log(`[Duplicate] Sandbox terminal ${sessionId} exited with code ${code}`);
          this.cleanupTerminal(sessionId);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'terminal_exit',
              sessionId,
              code
            }));
          }
        });

        console.log(`[Duplicate] Sandbox terminal ${sessionId} created successfully`);
        return {
          sessionId,
          title: this.terminals.get(sessionId).title,
          isSandbox: true
        };
      } catch (error) {
        console.error('[Duplicate] Error creating sandbox terminal:', error);
        throw new Error(`Failed to duplicate sandbox terminal: ${error.message}`);
      }
    }
    
    // Regular terminal duplication (non-sandbox)
    // Get the current working directory from the original terminal
    let cwd = originalTerminal.cwd;
    
    if (originalTerminal.terminal && originalTerminal.terminal.pid) {
      try {
        const platform = os.platform();
        
        if (platform === 'linux') {
          // Linux: use /proc/[pid]/cwd
          const fs = require('fs');
          const cwdPath = `/proc/${originalTerminal.terminal.pid}/cwd`;
          if (fs.existsSync(cwdPath)) {
            cwd = fs.realpathSync(cwdPath);
            console.log(`[Duplicate] [Linux] Detected cwd from /proc: ${cwd}`);
          }
        } else if (platform === 'darwin') {
          // macOS: use lsof command
          const { execSync } = require('child_process');
          const lsofOutput = execSync(`lsof -a -p ${originalTerminal.terminal.pid} -d cwd -Fn`, { encoding: 'utf-8' });
          const match = lsofOutput.match(/n(.+)/);
          if (match && match[1]) {
            cwd = match[1].trim();
            console.log(`[Duplicate] [macOS] Detected cwd from lsof: ${cwd}`);
          }
        }
      } catch (error) {
        console.log(`[Duplicate] Could not detect cwd from pid (${error.message}), using saved: ${cwd}`);
      }
    }

    // Create a new terminal in the same directory
    const sessionId = uuidv4();
    const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    
    console.log(`[Duplicate] Creating new terminal with shell: ${shell} in directory: ${cwd}`);
    
    try {
      const terminalEnv = { ...process.env };
      
      const terminal = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: cols,
        rows: rows,
        cwd: cwd, // Use the same working directory
        env: terminalEnv
      });

      // Store terminal with the working directory
      this.terminals.set(sessionId, {
        terminal,
        title: `${originalTerminal.title} (2)`,
        created: new Date(),
        cols,
        rows,
        kubeContext: originalTerminal.kubeContext,
        isSandbox: false,
        cwd: cwd
      });

      this.clients.set(sessionId, ws);

      // Handle terminal output
      terminal.on('data', (data) => {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(JSON.stringify({
            type: 'data',
            sessionId,
            data
          }));
        }
      });

      // Handle terminal exit
      terminal.on('exit', (code) => {
        console.log(`[Duplicate] Terminal ${sessionId} exited with code ${code}`);
        this.cleanupTerminal(sessionId);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'terminal_exit',
            sessionId,
            code
          }));
        }
      });

      console.log(`[Duplicate] Terminal ${sessionId} created successfully in ${cwd}`);
      return {
        sessionId,
        title: this.terminals.get(sessionId).title
      };
    } catch (error) {
      console.error('[Duplicate] Error creating terminal:', error);
      throw new Error(`Failed to duplicate terminal: ${error.message}`);
    }
  }

  sendInput(sessionId, data) {
    const terminalData = this.terminals.get(sessionId);
    if (terminalData) {
      terminalData.terminal.write(data);
      
      // Try to update cwd when user types 'cd' command
      if (data.includes('cd ') && terminalData.terminal.pid) {
        setTimeout(() => {
          try {
            const platform = os.platform();
            
            if (platform === 'linux') {
              // Linux: use /proc/[pid]/cwd
              const fs = require('fs');
              const cwdPath = `/proc/${terminalData.terminal.pid}/cwd`;
              if (fs.existsSync(cwdPath)) {
                const newCwd = fs.realpathSync(cwdPath);
                if (newCwd !== terminalData.cwd) {
                  terminalData.cwd = newCwd;
                  console.log(`[Terminal] Updated cwd for ${sessionId}: ${newCwd}`);
                }
              }
            } else if (platform === 'darwin') {
              // macOS: use lsof command
              const { execSync } = require('child_process');
              const lsofOutput = execSync(`lsof -a -p ${terminalData.terminal.pid} -d cwd -Fn`, { encoding: 'utf-8' });
              const match = lsofOutput.match(/n(.+)/);
              if (match && match[1]) {
                const newCwd = match[1].trim();
                if (newCwd !== terminalData.cwd) {
                  terminalData.cwd = newCwd;
                  console.log(`[Terminal] Updated cwd for ${sessionId}: ${newCwd}`);
                }
              }
            }
          } catch (error) {
            // Ignore errors in cwd detection
          }
        }, 500); // Wait for cd command to execute
      }
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

  async cleanupTerminal(sessionId) {
    const terminalData = this.terminals.get(sessionId);
    if (terminalData) {
      try {
        terminalData.terminal.kill();
      } catch (e) {
        console.error('Error killing terminal:', e);
      }
      
      // Clean up sandbox container if this is a sandbox terminal
      if (terminalData.isSandbox && terminalData.containerId) {
        try {
          await this.containerManager.stopContainer(sessionId);
        } catch (e) {
          console.error('Error stopping sandbox container:', e);
        }
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

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('/app/static'));
  
  // Serve React app for all non-API routes (catch-all)
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/ws') && !req.path.startsWith('/health')) {
      res.sendFile('/app/static/index.html');
    } else {
      next();
    }
  });
}

// Terminal manager instance
const containerManager = new ContainerManager();
const terminalManager = new TerminalManager(containerManager);
const userImageStore = new UserImageStore();
const sshSessionManager = new SSHSessionManager();

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

// Get available container images
app.get('/api/container-images', async (req, res) => {
  try {
    // Only return user-defined images
    const userImages = userImageStore.getImages();
    res.json({ images: userImages });
  } catch (error) {
    console.error('Error listing images:', error);
    res.json({ error: error.message, images: [] });
  }
});

// Add a user-defined image
app.post('/api/container-images', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Image name is required' });
    }
    
    const images = await userImageStore.addImage(image.trim());
    res.json({ images });
  } catch (error) {
    console.error('Error adding image:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove a user-defined image
app.delete('/api/container-images/:image', async (req, res) => {
  try {
    const image = decodeURIComponent(req.params.image);
    const images = await userImageStore.removeImage(image);
    res.json({ images });
  } catch (error) {
    console.error('Error removing image:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get active SSH sessions
app.get('/api/ssh-sessions', (req, res) => {
  try {
    const sessions = sshSessionManager.getActiveSessions();
    res.json({ sessions });
  } catch (error) {
    console.error('Error getting SSH sessions:', error);
    res.status(500).json({ error: error.message });
  }
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

        case 'create_sandbox':
          (async () => {
            try {
              // Save the image to user store
              await userImageStore.addImage(data.image);
              
              const result = await terminalManager.createSandboxTerminal(
                ws,
                data.cols || 80,
                data.rows || 30,
                data.image,
                data.title
              );
              ws.send(JSON.stringify({
                type: 'terminal_created',
                sessionId: result.sessionId,
                title: result.title,
                isSandbox: true
              }));
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'error',
                message: `Failed to create sandbox: ${error.message}`
              }));
            }
          })();
          break;

        case 'clone_terminal':
          (async () => {
            try {
              console.log(`[Clone] Cloning terminal: ${data.originalSessionId}, type: ${data.cloneType}`);
              console.log(`[Clone] Current terminals:`, Array.from(terminalManager.terminals.keys()));
              console.log(`[Clone] Current SSH sessions:`, Array.from(sshSessionManager.sessions.keys()));
              
              // Check if this is an SSH session
              const isSSHSession = sshSessionManager.sessions.has(data.originalSessionId);
              
              if (isSSHSession) {
                console.log(`[Clone] Detected SSH session, using SSH duplicate`);
                const result = await sshSessionManager.duplicateSession(ws, data.originalSessionId);
                console.log(`[Clone] SSH session duplicated successfully: ${result.sessionId}`);
                ws.send(JSON.stringify({
                  type: 'ssh_created',
                  sessionId: result.sessionId,
                  title: result.title,
                  params: result.params,
                  cloned: true,
                  cloneType: data.cloneType
                }));
              } else {
                console.log(`[Clone] Regular terminal, using standard clone`);
                const result = terminalManager.cloneTerminal(
                  ws,
                  data.originalSessionId,
                  data.cloneType,
                  data.cols || 80,
                  data.rows || 30
                );
                console.log(`[Clone] Terminal cloned successfully: ${result.sessionId}`);
                ws.send(JSON.stringify({
                  type: 'terminal_created',
                  sessionId: result.sessionId,
                  title: result.title,
                  cloned: true,
                  isSandbox: result.isSandbox || false,
                  cloneType: data.cloneType
                }));
              }
            } catch (error) {
              console.error('[Clone] Error:', error);
              ws.send(JSON.stringify({
                type: 'error',
                message: `Failed to clone terminal: ${error.message}`
              }));
            }
          })();
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

        // SSH Session Management
        case 'create_ssh':
          (async () => {
            try {
              const result = await sshSessionManager.createSession(ws, {
                host: data.host,
                port: data.port || 22,
                username: data.username,
                password: data.password,
                privateKey: data.privateKey,
                passphrase: data.passphrase,
                term: data.term || 'xterm-256color',
                cols: data.cols || 80,
                rows: data.rows || 30
              });
              ws.send(JSON.stringify({
                type: 'ssh_created',
                sessionId: result.sessionId,
                title: result.title,
                params: result.params
              }));
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'error',
                message: `Failed to create SSH session: ${error.message}`
              }));
            }
          })();
          break;

        case 'duplicate_ssh':
          (async () => {
            try {
              const result = await sshSessionManager.duplicateSession(ws, data.sessionId);
              ws.send(JSON.stringify({
                type: 'ssh_created',
                sessionId: result.sessionId,
                title: result.title,
                params: result.params,
                duplicated: true
              }));
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'error',
                message: `Failed to duplicate SSH session: ${error.message}`
              }));
            }
          })();
          break;

        case 'ssh_input':
          sshSessionManager.sendInput(data.sessionId, data.data);
          break;

        case 'ssh_resize':
          sshSessionManager.resizeTerminal(data.sessionId, data.cols, data.rows);
          break;

        case 'close_ssh':
          sshSessionManager.closeSession(data.sessionId);
          break;

        case 'reconnect_ssh':
          (async () => {
            try {
              const result = await sshSessionManager.reconnectSession(ws, data.sessionId);
              ws.send(JSON.stringify({
                type: 'ssh_created',
                sessionId: result.sessionId,
                title: result.title,
                params: result.params,
                reconnected: true
              }));
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'error',
                message: `Failed to reconnect SSH session: ${error.message}`
              }));
            }
          })();
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
    // Clean up SSH sessions associated with this connection
    for (const [sessionId, session] of sshSessionManager.sessions.entries()) {
      if (session.ws === ws) {
        sshSessionManager.closeSession(sessionId);
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
  sshSessionManager.cleanup();
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  sshSessionManager.cleanup();
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