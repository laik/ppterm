# PPTerm - Web-based Terminal Application

A minimal web-based terminal application built with React, TypeScript, and Node.js that provides a Google Cloud Shell-like experience with multiple session support and real-time WebSocket communication.

## Features

- **Multiple Terminal Sessions**: Create and manage multiple terminal instances
- **Tab-based Interface**: Intuitive tab navigation with visual indicators
- **Real-time Communication**: WebSocket-based bidirectional communication
- **Terminal Cloning**: Support for different types of terminal cloning
- **Cross-platform**: Works on Windows (PowerShell), macOS, and Linux
- **Modern UI**: Clean, professional dark theme interface
- **Keyboard Shortcuts**: Convenient shortcuts for terminal management

## Architecture

### Backend (Node.js)
- **Express.js** for web server and API endpoints
- **WebSocket** server for real-time communication
- **node-pty** for cross-platform terminal emulation
- **UUID** for unique session identification

### Frontend (React + TypeScript)
- **React** with TypeScript for type safety
- **XTerm.js** for browser-based terminal rendering
- **WebSocket** client for server communication
- **Vite** for fast development and building

## Quick Start

### Prerequisites
- Node.js 16+ installed
- npm or yarn package manager

### Installation & Running

1. **Start the Backend Server**:
   ```bash
   cd ppterm-backend
   npm install
   npm run dev
   ```
   Server will run on http://localhost:3001

2. **Start the Frontend Development Server**:
   ```bash
   cd ppterm-frontend
   npm install
   npm run dev
   ```
   Frontend will run on http://localhost:5173

3. **Open your browser** and navigate to http://localhost:5173

## Usage

### Keyboard Shortcuts
- `Ctrl/Cmd + T`: Create new terminal
- `Ctrl/Cmd + W`: Close current terminal
- `Ctrl/Cmd + 1-9`: Switch to terminal by number

### Terminal Management
- **New Terminal**: Click the "New Terminal" button or use `Ctrl/Cmd + T`
- **Close Terminal**: Click the × button on a tab or use `Ctrl/Cmd + W`
- **Switch Terminals**: Click on tabs or use number shortcuts
- **Clone Terminal**: Right-click on a tab to see cloning options:
  - **Simple Clone**: Create new terminal in same directory
  - **Shared Session**: Share same tmux session (planned)
  - **New Session**: Create independent session (planned)
  - **Window Clone**: Connect to existing session (planned)

### Connection Status
The header shows real-time connection status:
- **● Connected**: WebSocket connection is active
- **● Disconnected**: Connection lost, attempting to reconnect

## WebSocket API

### Client to Server Messages

#### Create Terminal
```json
{
  "type": "create_terminal",
  "cols": 80,
  "rows": 30,
  "title": "Terminal Name"
}
```

#### Clone Terminal
```json
{
  "type": "clone_terminal",
  "originalSessionId": "uuid",
  "cloneType": "simple|share|new|window",
  "cols": 80,
  "rows": 30
}
```

#### Send Input
```json
{
  "type": "input",
  "sessionId": "uuid",
  "data": "command input"
}
```

#### Resize Terminal
```json
{
  "type": "resize",
  "sessionId": "uuid",
  "cols": 120,
  "rows": 40
}
```

#### Close Terminal
```json
{
  "type": "close_terminal",
  "sessionId": "uuid"
}
```

### Server to Client Messages

#### Terminal Created
```json
{
  "type": "terminal_created",
  "sessionId": "uuid",
  "title": "Terminal 1"
}
```

#### Terminal Data
```json
{
  "type": "data",
  "sessionId": "uuid",
  "data": "terminal output"
}
```

#### Terminal Closed
```json
{
  "type": "terminal_closed",
  "sessionId": "uuid"
}
```

#### Error
```json
{
  "type": "error",
  "message": "Error description"
}
```

## Development

### Project Structure
```
ppterm/
├── ppterm-backend/
│   ├── src/
│   │   └── server.js
│   ├── package.json
│   └── README.md
└── ppterm-frontend/
    ├── src/
    │   ├── components/
    │   │   ├── TerminalComponent.tsx
    │   │   └── TerminalTab.tsx
    │   ├── services/
    │   │   └── WebSocketService.ts
    │   ├── App.tsx
    │   ├── App.css
    │   └── main.tsx
    ├── package.json
    └── README.md
```

### Backend Development
```bash
cd ppterm-backend
npm run dev  # Starts with nodemon for auto-reload
npm start    # Production start
```

### Frontend Development
```bash
cd ppterm-frontend
npm run dev    # Development server with hot reload
npm run build  # Production build
npm run preview # Preview production build
```

## Production Deployment

### Backend
```bash
cd ppterm-backend
npm install --production
npm start
```

### Frontend
```bash
cd ppterm-frontend
npm run build
# Serve dist/ folder with your preferred web server
```

## Environment Configuration

### Backend Environment Variables
- `PORT`: Server port (default: 3001)
- `NODE_ENV`: Environment mode

### Frontend Environment Variables
- `VITE_WS_URL`: WebSocket server URL (default: ws://localhost:3001/ws)

## Troubleshooting

### Common Issues

1. **WebSocket Connection Failed**
   - Ensure backend server is running on port 3001
   - Check firewall settings
   - Verify WebSocket URL in frontend configuration

2. **Terminal Not Creating**
   - Check backend logs for errors
   - Ensure node-pty is properly installed
   - Verify shell permissions

3. **Compilation Errors**
   - Clear node_modules and reinstall dependencies
   - Check Node.js version compatibility
   - Verify TypeScript configuration

## Browser Compatibility

- Chrome 88+
- Firefox 78+
- Safari 14+
- Edge 88+

## Security Notes

- This application spawns real terminal processes
- Use appropriate authentication/authorization in production
- Consider containerization for isolation
- Implement proper session management

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Future Enhancements

- [ ] Advanced tmux session management
- [ ] File upload/download capabilities
- [ ] Terminal recording and playback
- [ ] Multi-user collaboration
- [ ] Authentication and authorization
- [ ] Docker container support
- [ ] Theme customization
- [ ] Plugin system