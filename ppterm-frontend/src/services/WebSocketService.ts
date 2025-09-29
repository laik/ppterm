export interface TerminalMessage {
  type: string;
  sessionId?: string;
  data?: string;
  cols?: number;
  rows?: number;
  title?: string;
  kubeContext?: string;
  originalSessionId?: string;
  cloneType?: 'simple' | 'share' | 'new' | 'window';
  code?: number;
  message?: string;
  timestamp?: string;
  cloned?: boolean;
}

export interface TerminalSession {
  sessionId: string;
  title: string;
  created: Date;
  cols: number;
  rows: number;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 1000;
  private listeners: Map<string, Set<(message: TerminalMessage) => void>> = new Map();
  private connectionListeners: Set<(connected: boolean) => void> = new Set();
  private isConnected = false;

  private url: string;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private connect() {
    try {
      this.ws = new WebSocket(this.url);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.notifyConnectionListeners(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const message: TerminalMessage = JSON.parse(event.data);
          this.notifyListeners(message.type, message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.isConnected = false;
        this.notifyConnectionListeners(false);
        this.handleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      this.handleReconnect();
    }
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const timeout = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
      console.log(`Attempting to reconnect in ${timeout}ms (attempt ${this.reconnectAttempts})`);
      
      setTimeout(() => {
        this.connect();
      }, timeout);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  private notifyListeners(type: string, message: TerminalMessage) {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.forEach(listener => listener(message));
    }
  }

  private notifyConnectionListeners(connected: boolean) {
    this.connectionListeners.forEach(listener => listener(connected));
  }

  public on(type: string, listener: (message: TerminalMessage) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public off(type: string, listener: (message: TerminalMessage) => void) {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.delete(listener);
    }
  }

  public onConnection(listener: (connected: boolean) => void) {
    this.connectionListeners.add(listener);
    // Immediately notify with current status
    listener(this.isConnected);
  }

  public offConnection(listener: (connected: boolean) => void) {
    this.connectionListeners.delete(listener);
  }

  public send(message: TerminalMessage) {
    console.log('Sending WebSocket message:', message);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, cannot send message', this.ws?.readyState);
    }
  }

  public createTerminal(cols: number = 80, rows: number = 30, title?: string, kubeContext?: string) {
    console.log('Creating terminal with:', { cols, rows, title, kubeContext });
    this.send({
      type: 'create_terminal',
      cols,
      rows,
      title,
      kubeContext
    });
  }

  public cloneTerminal(originalSessionId: string, cloneType: 'simple' | 'share' | 'new' | 'window', cols: number = 80, rows: number = 30) {
    this.send({
      type: 'clone_terminal',
      originalSessionId,
      cloneType,
      cols,
      rows
    });
  }

  public sendInput(sessionId: string, data: string) {
    this.send({
      type: 'input',
      sessionId,
      data
    });
  }

  public resizeTerminal(sessionId: string, cols: number, rows: number) {
    this.send({
      type: 'resize',
      sessionId,
      cols,
      rows
    });
  }

  public closeTerminal(sessionId: string) {
    this.send({
      type: 'close_terminal',
      sessionId
    });
  }

  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}