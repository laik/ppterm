import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface TerminalComponentProps {
  sessionId: string;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  isActive: boolean;
}

const TerminalComponent: React.FC<TerminalComponentProps> = ({
  sessionId,
  onInput,
  onResize,
  isActive
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [fitAddon, setFitAddon] = useState<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    console.log('Creating terminal component for session:', sessionId);

    // Create terminal instance
    const term = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff',
        cursor: '#ffffff',
        selectionBackground: '#5a5a5a',
        black: '#000000',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
        brightBlack: '#4d4d4d',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#d6acff',
        brightMagenta: '#ff92df',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff'
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 1000,
      allowTransparency: false,
      convertEol: true
    });

    // Create addons
    const fit = new FitAddon();
    const webLinks = new WebLinksAddon();

    // Load addons
    term.loadAddon(fit);
    term.loadAddon(webLinks);

    // Open terminal
    term.open(terminalRef.current);
    console.log('Terminal opened for session:', sessionId);
    
    // Initial fit
    setTimeout(() => {
      fit.fit();
      onResize(sessionId, term.cols, term.rows);
      console.log('Terminal fitted:', sessionId, term.cols, term.rows);
    }, 100);

    // Handle input
    term.onData((data) => {
      onInput(sessionId, data);
    });

    // Handle resize
    term.onResize((size) => {
      onResize(sessionId, size.cols, size.rows);
    });

    setTerminal(term);
    setFitAddon(fit);

    // Cleanup on unmount
    return () => {
      term.dispose();
    };
  }, [sessionId]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddon && isActive) {
        setTimeout(() => {
          fitAddon.fit();
        }, 100);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitAddon, isActive]);

  // Fit terminal when becoming active
  useEffect(() => {
    if (isActive && fitAddon && terminal) {
      setTimeout(() => {
        fitAddon.fit();
        terminal.focus();
      }, 100);
    }
  }, [isActive, fitAddon, terminal]);

  // Expose terminal instance for writing data
  useEffect(() => {
    if (terminal) {
      // Use a global registry for terminals (better than window)
      const globalThis = window as unknown as { terminals?: Record<string, Terminal> };
      globalThis.terminals = globalThis.terminals || {};
      globalThis.terminals[sessionId] = terminal;
    }
  }, [terminal, sessionId]);

  return (
    <div 
      className="terminal-component"
      style={{ 
        width: '100%', 
        height: '100%',
        display: isActive ? 'flex' : 'none',
        flexDirection: 'column'
      }}
    >
      <div
        ref={terminalRef} 
        style={{ 
          width: '100%', 
          height: '100%',
          flex: 1
        }}
      />
    </div>
  );
};

export default TerminalComponent;