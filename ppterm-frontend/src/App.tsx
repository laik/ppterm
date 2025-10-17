import React, { useState, useEffect, useCallback } from 'react';
import { WebSocketService, type TerminalMessage } from './services/WebSocketService';
import { Terminal as XTerminal } from '@xterm/xterm';
import TerminalComponent from './components/TerminalComponent';
import TerminalTab from './components/TerminalTab';
import './App.css';

interface TerminalSession {
  sessionId: string;
  title: string;
  created: Date;
  kubeContext?: string;
  isSSH?: boolean;
  isSandbox?: boolean;
  sshParams?: Record<string, unknown>;
}

const WEBSOCKET_URL = 'ws://localhost:3001/ws';

function App() {
  const [wsService] = useState(() => new WebSocketService(WEBSOCKET_URL));
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [kubeContexts, setKubeContexts] = useState<string[]>([]);
  const [showKubeContextModal, setShowKubeContextModal] = useState(false);
  const [showSandboxModal, setShowSandboxModal] = useState(false);
  const [containerImages, setContainerImages] = useState<string[]>([]);
  const [customImage, setCustomImage] = useState('');
  const [showNewTerminalDropdown, setShowNewTerminalDropdown] = useState(false);
  const [showSSHModal, setShowSSHModal] = useState(false);
  const [sshForm, setSSHForm] = useState({
    host: '',
    port: 22,
    username: '',
    password: '',
    privateKey: '',
    authMethod: 'password' as 'password' | 'key'
  });
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);

  // WebSocket event handlers
  useEffect(() => {
    const handleTerminalCreated = (message: TerminalMessage) => {
      console.log('[App] Terminal created event received:', message);
      if (message.sessionId && message.title) {
        const newTerminal: TerminalSession = {
          sessionId: message.sessionId,
          title: message.title,
          created: new Date(),
          isSandbox: message.isSandbox || false
        };
        console.log('[App] Adding terminal to state:', newTerminal);
        setTerminals(prev => {
          console.log('[App] Previous terminals:', prev.length);
          return [...prev, newTerminal];
        });
        setActiveTerminalId(message.sessionId);
        console.log('[App] Terminal added successfully, total:', terminals.length + 1);
      } else {
        console.warn('[App] Invalid terminal created message:', message);
      }
    };

    const handleSSHCreated = (message: TerminalMessage) => {
      console.log('[App] SSH session created event received:', message);
      if (message.sessionId && message.title) {
        const newTerminal: TerminalSession = {
          sessionId: message.sessionId,
          title: message.title,
          created: new Date(),
          isSSH: true,
          sshParams: message.params
        };
        console.log('[App] Adding SSH terminal to state:', newTerminal);
        setTerminals(prev => [...prev, newTerminal]);
        setActiveTerminalId(message.sessionId);
      }
    };

    const handleTerminalData = (message: TerminalMessage) => {
      console.log('Terminal data received:', message.sessionId, message.data?.length);
      if (message.sessionId && message.data) {
        const globalThis = window as unknown as { terminals?: Record<string, XTerminal> };
        const terminal = globalThis.terminals?.[message.sessionId];
        if (terminal && typeof terminal.write === 'function') {
          terminal.write(message.data);
        } else {
          console.warn('Terminal not found or write method not available:', message.sessionId);
        }
      }
    };

    const handleSSHData = (message: TerminalMessage) => {
      console.log('SSH data received:', message.sessionId, message.data?.length);
      if (message.sessionId && message.data) {
        const globalThis = window as unknown as { terminals?: Record<string, XTerminal> };
        const terminal = globalThis.terminals?.[message.sessionId];
        if (terminal && typeof terminal.write === 'function') {
          terminal.write(message.data);
        } else {
          console.warn('SSH terminal not found:', message.sessionId);
        }
      }
    };

    const handleTerminalClosed = (message: TerminalMessage) => {
      if (message.sessionId) {
        setTerminals(prev => {
          const filtered = prev.filter(t => t.sessionId !== message.sessionId);
          if (activeTerminalId === message.sessionId && filtered.length > 0) {
            setActiveTerminalId(filtered[0].sessionId);
          } else if (filtered.length === 0) {
            setActiveTerminalId(null);
          }
          return filtered;
        });
      }
    };

    const handleSSHClosed = (message: TerminalMessage) => {
      if (message.sessionId) {
        setTerminals(prev => {
          const filtered = prev.filter(t => t.sessionId !== message.sessionId);
          if (activeTerminalId === message.sessionId && filtered.length > 0) {
            setActiveTerminalId(filtered[0].sessionId);
          } else if (filtered.length === 0) {
            setActiveTerminalId(null);
          }
          return filtered;
        });
      }
    };

    const handleError = (message: TerminalMessage) => {
      console.error('Terminal error:', message.message);
      alert(`Error: ${message.message}`);
    };

    const handleConnection = (isConnected: boolean) => {
      console.log('WebSocket connection status:', isConnected);
      const wasConnected = connected;
      setConnected(isConnected);
      
      if (isConnected && wasConnected === false) {
        // Reconnecting after disconnect - clear all stale terminals
        // because server has lost all session state on restart
        console.log('Connection restored after disconnect, clearing stale terminals');
        setTerminals([]);
        setActiveTerminalId(null);
        // Create initial terminal
        console.log('Creating initial terminal...');
        wsService.createTerminal(80, 30, 'Terminal 1');
      } else if (isConnected && terminals.length === 0) {
        // Initial connection with no terminals
        console.log('Creating initial terminal...');
        wsService.createTerminal(80, 30, 'Terminal 1');
      }
    };

    // Register event listeners
    wsService.on('terminal_created', handleTerminalCreated);
    wsService.on('ssh_created', handleSSHCreated);
    wsService.on('data', handleTerminalData);
    wsService.on('ssh_data', handleSSHData);
    wsService.on('terminal_closed', handleTerminalClosed);
    wsService.on('ssh_closed', handleSSHClosed);
    wsService.on('error', handleError);
    wsService.onConnection(handleConnection);

    return () => {
      wsService.off('terminal_created', handleTerminalCreated);
      wsService.off('ssh_created', handleSSHCreated);
      wsService.off('data', handleTerminalData);
      wsService.off('ssh_data', handleSSHData);
      wsService.off('terminal_closed', handleTerminalClosed);
      wsService.off('ssh_closed', handleSSHClosed);
      wsService.off('error', handleError);
      wsService.offConnection(handleConnection);
    };
  }, [wsService, activeTerminalId, terminals.length]);

  // Handle terminal input
  const handleTerminalInput = useCallback((sessionId: string, data: string) => {
    // Check if this is an SSH session
    const terminal = terminals.find(t => t.sessionId === sessionId);
    if (terminal?.isSSH) {
      wsService.sendSSHInput(sessionId, data);
    } else {
      wsService.sendInput(sessionId, data);
    }
  }, [wsService, terminals]);

  // Handle terminal resize
  const handleTerminalResize = useCallback((sessionId: string, cols: number, rows: number) => {
    // Check if this is an SSH session
    const terminal = terminals.find(t => t.sessionId === sessionId);
    if (terminal?.isSSH) {
      wsService.resizeSSH(sessionId, cols, rows);
    } else {
      wsService.resizeTerminal(sessionId, cols, rows);
    }
  }, [wsService, terminals]);

  // Create new terminal with optional kubernetes context
  const createNewTerminal = (kubeContext?: string) => {
    const terminalNumber = terminals.length + 1;
    const title = kubeContext ? `${kubeContext}` : `Terminal ${terminalNumber}`;
    wsService.createTerminal(80, 30, title, kubeContext);
  };

  // Show kubectl context selection modal
  const showKubeContextSelection = () => {
    setShowKubeContextModal(true);
  };

  // Create terminal with selected kubectl context
  const createTerminalWithContext = (context: string) => {
    createNewTerminal(context);
    setShowKubeContextModal(false);
  };

  // Show sandbox modal
  const showSandboxSelection = () => {
    setShowSandboxModal(true);
  };

  // Create sandbox with selected image
  const createSandboxWithImage = (image: string) => {
    wsService.createSandbox(image, 80, 30);
    setShowSandboxModal(false);
    setCustomImage('');
  };

  // Delete a user-defined image
  const deleteUserImage = async (image: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (window.confirm(`Delete "${image}" from your saved images?`)) {
      try {
        const response = await fetch(`http://localhost:3001/api/container-images/${encodeURIComponent(image)}`, {
          method: 'DELETE'
        });
        const data = await response.json();
        if (data.images) {
          setContainerImages(data.images);
        }
      } catch (error) {
        console.error('Error deleting image:', error);
      }
    }
  };

  // Close terminal
  const closeTerminal = (sessionId: string) => {
    if (terminals.length > 1 || window.confirm('Are you sure you want to close the last terminal?')) {
      // Check if this is an SSH session
      const terminal = terminals.find(t => t.sessionId === sessionId);
      if (terminal?.isSSH) {
        wsService.closeSSH(sessionId);
      } else {
        wsService.closeTerminal(sessionId);
      }
    }
  };

  // Select terminal tab
  const selectTerminal = (sessionId: string) => {
    setActiveTerminalId(sessionId);
  };

  // Handle context menu
  const handleContextMenu = (sessionId: string, event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({
      sessionId,
      x: event.clientX,
      y: event.clientY
    });
  };

  // Clone terminal
  const cloneTerminal = (originalSessionId: string, cloneType: 'simple' | 'share' | 'new' | 'window') => {
    wsService.cloneTerminal(originalSessionId, cloneType, 80, 30);
    setContextMenu(null);
  };

  // Rename terminal
  const renameTerminal = (sessionId: string, newTitle: string) => {
    setTerminals(prev =>
      prev.map(terminal =>
        terminal.sessionId === sessionId
          ? { ...terminal, title: newTitle }
          : terminal
      )
    );
  };

  // Toggle sidebar
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => !prev);
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu(null);
      setShowNewTerminalDropdown(false);
    };

    if (contextMenu || showNewTerminalDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu, showNewTerminalDropdown]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 't':
            e.preventDefault();
            createNewTerminal();
            break;
          case 'w':
            if (activeTerminalId) {
              e.preventDefault();
              closeTerminal(activeTerminalId);
            }
            break;
          case 'b':
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              toggleSidebar();
            }
            break;
          case 'r':
            // Prevent refresh when there are active terminals
            if (terminals.length > 0) {
              e.preventDefault();
              const shouldRefresh = window.confirm(
                `You have ${terminals.length} active terminal${terminals.length > 1 ? 's' : ''}. ` +
                'Refreshing will close all terminals. Are you sure?'
              );
              if (shouldRefresh) {
                window.location.reload();
              }
            }
            break;
          default: {
            // Handle number keys for terminal switching
            const num = parseInt(e.key);
            if (num >= 1 && num <= 9 && terminals[num - 1]) {
              e.preventDefault();
              selectTerminal(terminals[num - 1].sessionId);
            }
            break;
          }
        }
      } else if (e.key === 'F5') {
        // Prevent F5 refresh when there are active terminals
        if (terminals.length > 0) {
          e.preventDefault();
          const shouldRefresh = window.confirm(
            `You have ${terminals.length} active terminal${terminals.length > 1 ? 's' : ''}. ` +
            'Refreshing will close all terminals. Are you sure?'
          );
          if (shouldRefresh) {
            window.location.reload();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeTerminalId, terminals]);

  // Prevent browser close/navigation when there are active terminals
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (terminals.length > 0) {
        const message = `You have ${terminals.length} active terminal${terminals.length > 1 ? 's' : ''}. ` +
          'Closing this page will terminate all terminal sessions.';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };

    if (terminals.length > 0) {
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }
  }, [terminals.length]);

  // Load kubectl contexts on mount
  useEffect(() => {
    const loadKubectlContexts = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/kubectl-contexts');
        const data = await response.json();
        if (data.contexts) {
          setKubeContexts(data.contexts);
        }
      } catch (error) {
        console.error('Error loading kubectl contexts:', error);
      }
    };

    const loadContainerImages = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/container-images');
        const data = await response.json();
        if (data.images) {
          setContainerImages(data.images);
        }
        // if not found, notify user
        if (!data.images) {
          alert('No container images found. Please check your configuration.');
        }
      } catch (error) {
        console.error('Error loading container images:', error);
      }
    };

    if (connected) {
      loadKubectlContexts();
      loadContainerImages();
    }
  }, [connected]);

  return (
    <div className="app">
      <div className="terminal-container">
        <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <button
              className="sidebar-toggle"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? '▶' : '◀'}
            </button>
            {!sidebarCollapsed && (
              <>
                <div className="new-terminal-dropdown">
                  <button
                    className="new-terminal-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowNewTerminalDropdown(!showNewTerminalDropdown);
                    }}
                    disabled={!connected}
                    title="Create new terminal"
                  >
                    + New ▼
                  </button>
                  {showNewTerminalDropdown && (
                    <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
                      <div
                        className="dropdown-item"
                        onClick={() => {
                          createNewTerminal();
                          setShowNewTerminalDropdown(false);
                        }}
                      >
                        <span className="dropdown-icon">⌘</span>
                        <span className="dropdown-text">Terminal</span>
                      </div>
                      <div
                        className="dropdown-item"
                        onClick={() => {
                          showSandboxSelection();
                          setShowNewTerminalDropdown(false);
                        }}
                      >
                        <span className="dropdown-icon">📦</span>
                        <span className="dropdown-text">Sandbox</span>
                      </div>
                      {kubeContexts.length > 0 && (
                        <div
                          className="dropdown-item"
                          onClick={() => {
                            showKubeContextSelection();
                            setShowNewTerminalDropdown(false);
                          }}
                        >
                          <span className="dropdown-icon">⚙️</span>
                          <span className="dropdown-text">Kubernetes</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {!sidebarCollapsed && (
            <>
              <div className="terminal-tabs">
                {terminals.map((terminal) => (
                  <TerminalTab
                    key={terminal.sessionId}
                    sessionId={terminal.sessionId}
                    title={terminal.title}
                    isActive={terminal.sessionId === activeTerminalId}
                    onSelect={selectTerminal}
                    onClose={closeTerminal}
                    onContextMenu={handleContextMenu}
                    onRename={renameTerminal}
                  />
                ))}
              </div>

              <div className="hints">
                <div className="hint">Ctrl/Cmd + T: New Terminal</div>
                <div className="hint">Ctrl/Cmd + W: Close Terminal</div>
                <div className="hint">Ctrl/Cmd + B: Toggle Sidebar</div>
                <div className="hint">Ctrl/Cmd + 1-9: Switch Terminal</div>
                <div className="hint">Double-click tab: Rename</div>
                <div className="hint">Right-click tab: Duplicate</div>
              </div>
            </>
          )}

          {sidebarCollapsed && (
            <div className="collapsed-terminal-icons">
              {terminals.map((terminal, index) => {
                const firstLetter = terminal.title.charAt(0).toUpperCase();
                return (
                  <div
                    key={terminal.sessionId}
                    className={`terminal-icon ${terminal.sessionId === activeTerminalId ? 'active' : ''}`}
                    onClick={() => selectTerminal(terminal.sessionId)}
                    onContextMenu={(e) => handleContextMenu(terminal.sessionId, e)}
                    title={terminal.title}
                  >
                    <div className="terminal-icon-letter">{firstLetter}</div>
                    <span className="terminal-icon-number">{index + 1}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className={`status-bar ${sidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="status-badge">
              <span className={`status-badge-icon ${connected ? 'connected' : 'disconnected'}`}>
                {connected ? '●' : '●'}
              </span>
              {terminals.length > 0 && (
                <span className="status-badge-count">
                  {terminals.length}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="main-content">
          {terminals.length === 0 ? (
            <div className="no-terminals">
              <div className="loading-message">
                {connected ? 'Creating terminal...' : 'Connecting to server...'}
              </div>
            </div>
          ) : (
            <>
              {activeTerminalId && (
                <div className="terminal-header">
                  <div className="terminal-session-info">
                    <span className="terminal-session-icon">▢</span>
                    <span className="terminal-session-name">
                      {terminals.find(t => t.sessionId === activeTerminalId)?.title || 'Terminal'}
                    </span>
                    <span className="terminal-session-id">
                      Session: {activeTerminalId?.substring(0, 8)}
                    </span>
                  </div>
                </div>
              )}
              <div className="terminal-content">
                {terminals.map((terminal) => (
                  <TerminalComponent
                    key={terminal.sessionId}
                    sessionId={terminal.sessionId}
                    onInput={handleTerminalInput}
                    onResize={handleTerminalResize}
                    isActive={terminal.sessionId === activeTerminalId}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y
          }}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              cloneTerminal(contextMenu.sessionId, 'simple');
            }}
          >
            🔄 Duplicate Session
          </div>
        </div>
      )}

      {/* Kubectl Context Selection Modal */}
      {showKubeContextModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Select Kubernetes Context</h3>
              <button
                className="modal-close"
                onClick={() => setShowKubeContextModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="context-list">
                <button
                  className="context-item default"
                  onClick={() => { createNewTerminal(); setShowKubeContextModal(false); }}
                >
                  <span className="context-name">Default Terminal</span>
                  <span className="context-desc">No kubectl context</span>
                </button>
                {kubeContexts.map((context) => (
                  <button
                    key={context}
                    className="context-item"
                    onClick={() => createTerminalWithContext(context)}
                  >
                    <span className="context-name">⚙️ {context}</span>
                    <span className="context-desc">Kubernetes context</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sandbox Image Selection Modal */}
      {showSandboxModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Create Sandbox Terminal</h3>
              <button
                className="modal-close"
                onClick={() => { setShowSandboxModal(false); setCustomImage(''); }}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="sandbox-input-group">
                <label htmlFor="custom-image">Image Name:</label>
                <input
                  id="custom-image"
                  type="text"
                  className="custom-image-input"
                  placeholder="e.g., alpine:latest, ubuntu:22.04"
                  value={customImage}
                  onChange={(e) => setCustomImage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customImage.trim()) {
                      createSandboxWithImage(customImage.trim());
                    }
                  }}
                />
                <button
                  className="create-sandbox-btn"
                  onClick={() => customImage.trim() && createSandboxWithImage(customImage.trim())}
                  disabled={!customImage.trim()}
                >
                  Create
                </button>
              </div>
              {containerImages.length > 0 && (
                <div className="context-list">
                  <p className="section-title">Recent Images:</p>
                  {containerImages.map((image) => (
                    <div
                      key={image}
                      className="image-item"
                    >
                      <button
                        className="image-item-button"
                        onClick={() => createSandboxWithImage(image)}
                      >
                        <span className="image-icon">📦</span>
                        <span className="image-name">{image}</span>
                      </button>
                      <button
                        className="image-delete-btn"
                        onClick={(e) => deleteUserImage(image, e)}
                        title="Delete this image"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;