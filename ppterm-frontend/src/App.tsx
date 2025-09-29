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
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);

  // WebSocket event handlers
  useEffect(() => {
    const handleTerminalCreated = (message: TerminalMessage) => {
      console.log('Terminal created:', message);
      if (message.sessionId && message.title) {
        const newTerminal: TerminalSession = {
          sessionId: message.sessionId,
          title: message.title,
          created: new Date()
        };
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

    const handleError = (message: TerminalMessage) => {
      console.error('Terminal error:', message.message);
      alert(`Error: ${message.message}`);
    };

    const handleConnection = (isConnected: boolean) => {
      console.log('WebSocket connection status:', isConnected);
      setConnected(isConnected);
      if (isConnected && terminals.length === 0) {
        // Create initial terminal when connected
        console.log('Creating initial terminal...');
        wsService.createTerminal(80, 30, 'Terminal 1');
      }
    };

    // Register event listeners
    wsService.on('terminal_created', handleTerminalCreated);
    wsService.on('data', handleTerminalData);
    wsService.on('terminal_closed', handleTerminalClosed);
    wsService.on('error', handleError);
    wsService.onConnection(handleConnection);

    return () => {
      wsService.off('terminal_created', handleTerminalCreated);
      wsService.off('data', handleTerminalData);
      wsService.off('terminal_closed', handleTerminalClosed);
      wsService.off('error', handleError);
      wsService.offConnection(handleConnection);
    };
  }, [wsService, activeTerminalId, terminals.length]);

  // Handle terminal input
  const handleTerminalInput = useCallback((sessionId: string, data: string) => {
    wsService.sendInput(sessionId, data);
  }, [wsService]);

  // Handle terminal resize
  const handleTerminalResize = useCallback((sessionId: string, cols: number, rows: number) => {
    wsService.resizeTerminal(sessionId, cols, rows);
  }, [wsService]);

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

  // Close terminal
  const closeTerminal = (sessionId: string) => {
    if (terminals.length > 1 || window.confirm('Are you sure you want to close the last terminal?')) {
      wsService.closeTerminal(sessionId);
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
    };

    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

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
    
    if (connected) {
      loadKubectlContexts();
    }
  }, [connected]);

  return (
    <div className="app">
      <div className="header">
        <div className="title">PPTerm</div>
        <div className="connection-status">
          <span className={`status-indicator ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? '● Connected' : '● Disconnected'}
          </span>
          {terminals.length > 0 && (
            <span className="active-sessions">
              {terminals.length} Active Session{terminals.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

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
                <button 
                  className="new-terminal-btn"
                  onClick={() => createNewTerminal()}
                  disabled={!connected}
                  title="Create new terminal (Ctrl/Cmd + T)"
                >
                  + New Terminal
                </button>
                {kubeContexts.length > 0 && (
                  <button
                    className="kube-context-btn"
                    onClick={showKubeContextSelection}
                    disabled={!connected}
                    title="Create terminal with kubectl context"
                  >
                    ⚙️ K8s
                  </button>
                )}
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
                <div className="hint">Right-click tab: Clone options</div>
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
            onClick={() => cloneTerminal(contextMenu.sessionId, 'simple')}
          >
            Simple Clone
          </div>
          <div 
            className="context-menu-item"
            onClick={() => cloneTerminal(contextMenu.sessionId, 'share')}
          >
            Shared Session
          </div>
          <div 
            className="context-menu-item"
            onClick={() => cloneTerminal(contextMenu.sessionId, 'new')}
          >
            New Session
          </div>
          <div 
            className="context-menu-item"
            onClick={() => cloneTerminal(contextMenu.sessionId, 'window')}
          >
            Window Clone
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
    </div>
  );
}

export default App;