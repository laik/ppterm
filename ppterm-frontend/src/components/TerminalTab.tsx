import React, { useState, useRef, useEffect } from 'react';

interface TerminalTabProps {
  sessionId: string;
  title: string;
  isActive: boolean;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onContextMenu: (sessionId: string, event: React.MouseEvent) => void;
  onRename: (sessionId: string, newTitle: string) => void;
}

const TerminalTab: React.FC<TerminalTabProps> = ({
  sessionId,
  title,
  isActive,
  onSelect,
  onClose,
  onContextMenu,
  onRename
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    setIsEditing(true);
    setEditTitle(title);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const handleSave = () => {
    const newTitle = editTitle.trim();
    if (newTitle && newTitle !== title) {
      onRename(sessionId, newTitle);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(title);
    setIsEditing(false);
  };

  const handleBlur = () => {
    handleSave();
  };
  return (
    <div
      className={`terminal-tab ${isActive ? 'active' : ''}`}
      onClick={() => onSelect(sessionId)}
      onContextMenu={(e) => onContextMenu(sessionId, e)}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          className="terminal-tab-input"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
      ) : (
        <span 
          className="terminal-tab-title"
          onDoubleClick={handleDoubleClick}
          title="Double-click to rename"
        >
          {title}
        </span>
      )}
      <button
        className="terminal-tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose(sessionId);
        }}
        title="Close terminal"
      >
        ×
      </button>
    </div>
  );
};

export default TerminalTab;