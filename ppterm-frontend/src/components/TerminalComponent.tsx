import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
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
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      convertEol: true,
      // Enable browser-specific features for better compatibility
      screenReaderMode: false,
      windowsMode: true
    });

    // Create addons
    const fit = new FitAddon();
    const webLinks = new WebLinksAddon();
    const search = new SearchAddon();

    // Load addons
    term.loadAddon(fit);
    term.loadAddon(webLinks);
    term.loadAddon(search);

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
    setSearchAddon(search);

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

  // Handle keyboard events for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle events when this terminal is active
      if (!isActive) return;
      
      // Ctrl+F or Cmd+F to open search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchVisible(true);
      }
      
      // Escape to close search
      if (e.key === 'Escape' && isSearchVisible) {
        setIsSearchVisible(false);
        if (searchAddon) {
          searchAddon.clearDecorations();
        }
      }
    };

    // Add event listener to the terminal container
    const container = terminalRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown as EventListener);
      return () => container.removeEventListener('keydown', handleKeyDown as EventListener);
    }
  }, [isActive, sessionId, isSearchVisible, searchAddon]);

  // Fit terminal when becoming active
  useEffect(() => {
    if (isActive && fitAddon && terminal) {
      setTimeout(() => {
        fitAddon.fit();
        terminal.focus();
      }, 100);
    }
  }, [isActive, fitAddon, terminal]);

  // Handle search
  const handleSearch = (term: string) => {
    if (searchAddon && term) {
      // Validate regex pattern if regex mode is enabled
      if (isRegex) {
        try {
          new RegExp(term);
        } catch (_e) {
          console.warn('Invalid regex pattern:', term);
          return;
        }
      }
      
      const searchOptions = {
        incremental: false,
        regex: isRegex,
        wholeWord: false,
        caseSensitive: false
      };
      
      searchAddon.findNext(term, searchOptions);
    }
  };
  
  // Handle previous search
  const handleSearchPrevious = (term: string) => {
    if (searchAddon && term) {
      // Validate regex pattern if regex mode is enabled
      if (isRegex) {
        try {
          new RegExp(term);
        } catch (_e) {
          console.warn('Invalid regex pattern:', term);
          return;
        }
      }
      
      const searchOptions = {
        incremental: false,
        regex: isRegex,
        wholeWord: false,
        caseSensitive: false
      };
      searchAddon.findPrevious(term, searchOptions);
    }
  };
  
  // Handle show all matches
  const handleShowAllMatches = (term: string) => {
    if (searchAddon && term) {
      // Validate regex pattern if regex mode is enabled
      if (isRegex) {
        try {
          new RegExp(term);
        } catch (_e) {
          console.warn('Invalid regex pattern:', term);
          return;
        }
      }
      
      const searchOptions = {
        regex: isRegex,
        wholeWord: false,
        caseSensitive: false
      };
      
      // Clear previous decorations
      searchAddon.clearDecorations();
      
      // Find all matches and highlight them
      // We'll iterate through the buffer to find all matches at once
      let found = true;
      let count = 0;
      const maxAttempts = 1000; // Prevent infinite loops
      
      // Find all matches in one go
      while (found && count < maxAttempts) {
        found = searchAddon.findNext(term, { ...searchOptions, incremental: count > 0 });
        if (found) {
          count++;
        }
      }
      
      // Return to first match
      if (count > 0) {
        searchAddon.findPrevious(term, searchOptions);
      }
    }
  };

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const term = e.target.value;
    setSearchTerm(term);
    if (searchAddon) {
      if (term) {
        // Validate regex pattern if regex mode is enabled
        if (isRegex) {
          try {
            new RegExp(term);
          } catch (_e) {
            console.warn('Invalid regex pattern:', term);
            return;
          }
        }
        
        const searchOptions = {
          incremental: true,
          regex: isRegex,
          wholeWord: false,
          caseSensitive: false
        };
        searchAddon.findNext(term, searchOptions);
      } else {
        searchAddon.clearDecorations();
      }
    }
  };
  
  // Handle search key events
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch(searchTerm);
    } else if (e.key === 'Escape') {
      setIsSearchVisible(false);
      if (searchAddon) {
        searchAddon.clearDecorations();
      }
    }
  };

  // Focus search input when visible
  useEffect(() => {
    if (isSearchVisible && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchVisible]);

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
        flexDirection: 'column',
        position: 'relative'
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
      {isSearchVisible && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          zIndex: 100,
          backgroundColor: '#2d2d2d',
          border: '1px solid #404040',
          borderRadius: '4px',
          padding: '5px',
          display: 'flex',
          alignItems: 'center',
          gap: '5px'
        }}>
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            style={{
              background: '#404040',
              border: '1px solid #505050',
              borderRadius: '3px',
              color: '#ffffff',
              padding: '4px 8px',
              fontSize: '12px',
              outline: 'none',
              width: '150px'
            }}
          />
          <label style={{
            display: 'flex',
            alignItems: 'center',
            color: '#ffffff',
            fontSize: '12px',
            gap: '2px'
          }}>
            <input
              type="checkbox"
              checked={isRegex}
              onChange={(e) => setIsRegex(e.target.checked)}
              style={{
                margin: 0
              }}
            />
            Regex
          </label>

          <button
            onClick={() => handleSearch(searchTerm)}
            style={{
              background: '#007acc',
              border: 'none',
              borderRadius: '3px',
              color: 'white',
              padding: '4px 8px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Next
          </button>
          <button
            onClick={() => handleSearchPrevious(searchTerm)}
            style={{
              background: '#007acc',
              border: 'none',
              borderRadius: '3px',
              color: 'white',
              padding: '4px 8px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Previous
          </button>
          <button
            onClick={() => {
              if (searchTerm) {
                handleShowAllMatches(searchTerm);
              }
            }}
            style={{
              background: '#007acc',
              border: 'none',
              borderRadius: '3px',
              color: 'white',
              padding: '4px 8px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Find All
          </button>
          <button
            onClick={() => {
              setIsSearchVisible(false);
              if (searchAddon) {
                searchAddon.clearDecorations();
              }
              setSearchTerm('');
              setIsRegex(false);

            }}
            style={{
              background: '#404040',
              border: 'none',
              borderRadius: '3px',
              color: '#cccccc',
              padding: '4px 8px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};

export default TerminalComponent;